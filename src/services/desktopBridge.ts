/**
 * desktopBridge.ts — ponte única front ⇄ core Tauri (desktop on-premise).
 *
 * No sabor web/cloud (ou em testes) `window.__TAURI_INTERNALS__` não existe e
 * toda a API resolve como "indisponível" — chamadores fazem feature-detect
 * via isDesktopBridgeAvailable(). No exe, os comandos Rust expõem:
 *   - scan_alfred_command: varredura tolerante da RAIZ_ALFRED
 *     (OSs + órfãos + candidatos de janela temporal);
 *   - pick_folder_command: diálogo nativo de seleção de pasta.
 *
 * Import do módulo `tauri` é lazy: no bundle standalone o chunk só carrega
 * quando a ponte existe; na web nunca entra na árvore de primeiro load.
 */

export interface DesktopBlock {
  path: string;
  file_name: string;
  size_bytes: number;
  mtime_epoch: number;
}

/** Espelha OsScanResult do Rust (serde → camelCase já declarado lá). */
export interface DesktopOsScan {
  os_id: string;
  folder_path: string;
  studio_norm: string;
  day_iso: string | null;
  declared_path_match: boolean;
  blocks: DesktopBlock[];
}

export interface DesktopOrphanGroup {
  folder_path: string;
  studio_norm: string;
  day_iso: string | null;
  blocks: DesktopBlock[];
}

export interface DesktopWindowMatch {
  os_id: string;
  conflicting_os_ids: string[];
  studio_norm: string;
  day_iso: string | null;
  block_paths: string[];
  confidence_hint: 'unique-window' | 'conflict-window';
}

/** Espelha AlfredScanReport do Rust. */
export interface DesktopBridgeReport {
  root: string;
  scanned_dirs: number;
  skipped_permission_errors: number;
  oss: DesktopOsScan[];
  orphan_groups: DesktopOrphanGroup[];
  window_matches: DesktopWindowMatch[];
}

type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

interface TauriInternals {
  invoke?: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
}

/**
 * Primitivo bruto de IPC do WebView Tauri v2. Injetado pelo runtime DENTRO da
 * página (não é módulo npm): usar `require('tauri/...')` aqui quebraria o
 * bundle web e a resolução no WebView. Na web o objeto não existe → null.
 */
function getInvoke(): InvokeFn | null {
  try {
    if (typeof window === 'undefined') return null;
    const internals = (
      window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
    ).__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === 'function') {
      return (cmd, args) => internals.invoke!(cmd, args);
    }
  } catch {
    /* runtime sem Tauri — segue null */
  }
  return null;
}

/** Há ponte Tauri real neste runtime? (false na web e nos testes) */
export function isDesktopBridgeAvailable(): boolean {
  return getInvoke() !== null;
}

/** Diálogo nativo de pasta. `null` ⇒ cancelado / sem ponte / erro de diálogo. */
export async function pickDesktopFolder(
  title?: string,
  startPath?: string,
): Promise<string | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    const res = (await invoke('pick_folder_command', {
      title: title ?? null,
      startPath: startPath ?? null,
    })) as { path?: string | null };
    return res?.path ?? null;
  } catch {
    return null;
  }
}

/** Scan Alfred via core Rust. `null` ⇒ sem ponte ou falha do comando. */
export async function scanAlfredDesktop(
  root: string,
  opts?: { maxDepth?: number; declaredOsPaths?: string[] },
): Promise<DesktopBridgeReport | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    const res = (await invoke('scan_alfred_command', {
      req: {
        root,
        maxDepth: opts?.maxDepth ?? null,
        declaredOsPaths: opts?.declaredOsPaths ?? [],
      },
    })) as { report?: DesktopBridgeReport };
    return res?.report ?? null;
  } catch {
    return null;
  }
}

/**
 * Persiste o relatório do último scan no SQLite local do exe
 * (%APPDATA%/dev.chr-z.solaris). Fire-and-forget amigável: resolve `false`
 * fora da ponte ou em qualquer falha — persistir cache NUNCA derruba a UI.
 */
export async function saveLastReportDesktop(
  report: DesktopBridgeReport,
): Promise<boolean> {
  const invoke = getInvoke();
  if (!invoke) return false;
  try {
    await invoke('save_last_report_command', { req: { report } });
    return true;
  } catch {
    return false;
  }
}

export interface LastReportResult {
  /** `null` ⇒ nenhum scan salvo neste computador ainda. */
  report: DesktopBridgeReport | null;
  /** Momento da gravação (UTC, datetime do SQLite). */
  scannedAt: string | null;
}

/** Recupera o último scan salvo — usado pra restaurar o estado ao reabrir. */
export async function loadLastReportDesktop(): Promise<LastReportResult | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    const res = (await invoke('load_last_report_command')) as {
      report?: DesktopBridgeReport | null;
      scannedAt?: string | null;
    };
    return { report: res?.report ?? null, scannedAt: res?.scannedAt ?? null };
  } catch {
    return null;
  }
}

export interface ModeWriteResult {
  /** Caminho do config.local.json gravado (diagnóstico/suporte). */
  configPath: string;
  /** Bytes escritos. */
  bytesWritten: number;
}

/**
 * Grava a escolha de modo do operador no config.local.json da máquina
 * (set_standalone_mode_command). `null` ⇒ sem ponte ou falha de escrita —
 * o chamador decide se mostra erro (toggle explícito MERECE feedback, ao
 * contrário do cache de relatório que é fire-and-forget).
 */
export async function setStandaloneModeDesktop(
  standalone: boolean,
): Promise<ModeWriteResult | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    const res = (await invoke('set_standalone_mode_command', {
      req: { standalone },
    })) as { configPath?: string; bytesWritten?: number } | null;
    if (!res || typeof res.configPath !== 'string') return null;
    return { configPath: res.configPath, bytesWritten: res.bytesWritten ?? 0 };
  } catch {
    return null;
  }
}

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

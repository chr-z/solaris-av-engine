/**
 * SOLARIS runtime mode (P3 — standalone sem nuvem).
 *
 * Dois sabores de build:
 * - CLOUD (default): web demo hospedado — Firebase RTDB + Google OAuth ativos.
 * - STANDALONE: desktop Tauri/on-premise — nenhuma rede externa; persistência
 *   100% local (SQLite via comandos Tauri + estado local).
 *
 * Detecção (ordem):
 * 1. Override manual em localStorage (`solaris.runtimeMode`) — p/ testes.
 * 2. Opinião remota APLICADA em boot (`solaris.runtimeModeRemoteApplied`) —
 *    flag STANDALONE_MODE do ambiente (env/config via core Tauri ou config
 *    same-origin do deploy). Gravada por applyRemoteModeOpinion com guarda
 *    anti-rebaixamento; persiste entre recargas até a fonte mudar.
 * 3. Build flag: `__SOLARIS_STANDALONE__` definido pelo vite.config no sabor
 *    desktop (npm run build:desktop ou SOLARIS_STANDALONE=1).
 * 4. Presença do runtime Tauri (`window.__TAURI_INTERNALS__`) — fallback.
 */

import {
  guardedFetchDeployModeOpinion,
  fetchCoreModeOpinion,
  noOpinion,
  opinionToApply,
  type ModeOpinion,
} from './remoteModeFlag';

export type RuntimeMode = 'cloud' | 'standalone';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

/** Definido em build-time pelo vite.config.ts (define). */
declare const __SOLARIS_STANDALONE__: boolean;

const MODE_KEY = 'solaris.runtimeMode';

/** Opinião remota já aplicada em boot (flag STANDALONE_MODE do ambiente). */
const APPLIED_REMOTE_KEY = 'solaris.runtimeModeRemoteApplied';

function fromAppliedRemote(): RuntimeMode | null {
  try {
    const v = window.localStorage.getItem(APPLIED_REMOTE_KEY);
    if (v === 'standalone' || v === 'cloud') return v;
  } catch {
    /* storage indisponível — segue fluxo */
  }
  return null;
}

function fromLocalStorage(): RuntimeMode | null {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    if (v === 'standalone' || v === 'cloud') return v;
  } catch {
    /* storage indisponível — segue fluxo */
  }
  return null;
}

function fromBuildFlag(): RuntimeMode | null {
  try {
    if (typeof __SOLARIS_STANDALONE__ !== 'undefined' && __SOLARIS_STANDALONE__) {
      return 'standalone';
    }
  } catch {
    /* símbolo ausente (ex.: teste node puro) — segue fluxo */
  }
  return null;
}

function fromTauriRuntime(): RuntimeMode | null {
  try {
    if (typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__)) {
      return 'standalone';
    }
  } catch {
    /* sem window (SSR/teste) — segue fluxo */
  }
  return null;
}

/** Modo efetivo desta sessão. Síncrono por contrato (usável em render). */
export function getRuntimeMode(): RuntimeMode {
  return (
    fromLocalStorage() ??
    fromAppliedRemote() ??
    fromBuildFlag() ??
    fromTauriRuntime() ??
    'cloud'
  );
}

/** true quando NENHUM serviço de nuvem deve ser usado/inicializado. */
export function isStandalone(): boolean {
  return getRuntimeMode() === 'standalone';
}

/** true quando chamadas Tauri (ipc) estão disponíveis no ambiente atual. */
export function hasDesktopBridge(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
  } catch {
    return false;
  }
}

/** Só para testes: grava/remove o override manual. */
export function setRuntimeModeOverride(mode: RuntimeMode | null): void {
  try {
    if (mode === null) window.localStorage.removeItem(MODE_KEY);
    else window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ambiente sem storage — override ignorado */
  }
}

/**
 * P3 refinamento (zero affordance de nuvem no standalone): mensagem humana
 * usada quando uma fonte de nuvem (link de planilha YouTube/Drive) é
 * acionada num build sem nuvem. Substitui o comportamento anterior, que
 * estourava ReferenceError de `gapi` ausente (os loaders Google nem existem
 * no shell desktop) e exibia erro genérico ao usuário.
 */
export const STANDALONE_CLOUD_SOURCE_MESSAGE =
  'This video lives on Google\u2019s cloud and Solaris is running in local mode ' +
  '(no cloud). Open the file from disk or register a local path/file on the row.';

/** Classifica uma fonte remota de nuvem a partir das flags de descoberta. */
export type CloudSourceKind = 'youtube' | 'drive' | null;

export function describeCloudSource(info?: {
  isYoutube?: boolean;
  isDriveLink?: boolean;
}): CloudSourceKind {
  if (!info) return null;
  if (info.isYoutube) return 'youtube';
  if (info.isDriveLink) return 'drive';
  return null;
}

/**
 * P3 — flag STANDALONE_MODE em RUNTIME (sem rebuild).
 *
 * Consulta as fontes de opinião do ambiente — core Tauri (env
 * `STANDALONE_MODE` > `%APPDATA%/dev.chr-z.solaris/config.local.json`) e
 * deploy web (`solaris.config.json` same-origin) — aplica a decisão com a
 * guarda anti-rebaixamento e persiste entre recargas até a fonte mudar.
 * Deve ser AWAITED ANTES do primeiro render: o modo é lido sincronamente
 * durante o render inicial (contrato dos gates de UI).
 *
 * Contrato:
 * - Nunca rejeita nem derruba o boot (falha de fonte ⇒ sem opinião).
 * - Override manual do usuário tem precedência máxima e bloqueia a aplicação.
 * - Opinião cloud NUNCA desliga um artefato que já nasceu standalone.
 *
 * @returns a opinião EFETIVAMENTE APLICADA (ou nula, p/ diagnóstico/testes).
 */
export async function applyRemoteModeOpinion(): Promise<ModeOpinion> {
  // Override manual do usuário fala mais alto que qualquer flag de ambiente.
  if (fromLocalStorage() !== null) return noOpinion();

  const [core, deploy] = await Promise.all([
    fetchCoreModeOpinion(),
    guardedFetchDeployModeOpinion(),
  ]);
  // Core vence: dentro do exe ele enxerga a máquina real (env + APPDATA).
  const opinion = core.standalone !== null ? core : deploy;

  const decision = opinionToApply(opinion, isStandalone());
  try {
    if (decision === null) {
      window.localStorage.removeItem(APPLIED_REMOTE_KEY);
    } else {
      window.localStorage.setItem(
        APPLIED_REMOTE_KEY,
        decision ? 'standalone' : 'cloud',
      );
    }
  } catch {
    /* storage indisponível — opinião vale só nesta sessão */
  }
  return decision === null ? noOpinion() : opinion;
}

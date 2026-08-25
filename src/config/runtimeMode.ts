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
 * 2. Build flag: `__SOLARIS_STANDALONE__` definido pelo vite.config no sabor
 *    desktop (npm run build:desktop ou SOLARIS_STANDALONE=1).
 * 3. Presença do runtime Tauri (`window.__TAURI_INTERNALS__`) — fallback.
 */

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
  return fromLocalStorage() ?? fromBuildFlag() ?? fromTauriRuntime() ?? 'cloud';
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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getRuntimeMode,
  getRuntimeModeOrigin,
  applyRemoteModeOpinion,
  setRuntimeModeOverride,
} from '../runtimeMode';

const TAURI_KEY = '__TAURI_INTERNALS__';

type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

function installTauri(invoke: InvokeFn): void {
  (window as unknown as Record<string, unknown>)[TAURI_KEY] = {
    invoke: invoke as unknown,
  };
}

function removeTauri(): void {
  delete (window as unknown as Record<string, unknown>)[TAURI_KEY];
}

/** Substitui o fetch global por um roteador simples (mesmo idioma dos irmãos). */
function installFetchRouter(
  router: (url: string) => { status: number; body?: unknown } | undefined,
): void {
  vi.stubGlobal('fetch', ((url: string) => {
    const hit = router(String(url));
    if (!hit) return Promise.reject(new TypeError('simulated network failure'));
    return Promise.resolve({
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      json: () =>
        hit.body === undefined
          ? Promise.reject(new SyntaxError('bad json'))
          : Promise.resolve(hit.body),
    });
  }) as unknown as typeof fetch);
}

describe('runtimeMode.getRuntimeModeOrigin — badge de origem do modo', () => {
  beforeEach(() => {
    setRuntimeModeOverride(null);
    window.localStorage.removeItem('solaris.runtimeModeRemoteApplied');
    window.localStorage.removeItem('solaris.runtimeModeRemoteOrigin');
    removeTauri();
  });

  afterEach(() => {
    setRuntimeModeOverride(null);
    window.localStorage.removeItem('solaris.runtimeModeRemoteApplied');
    window.localStorage.removeItem('solaris.runtimeModeRemoteOrigin');
    removeTauri();
    vi.unstubAllGlobals();
  });

  it('web pura sem sinais ⇒ cloud com origem nula', () => {
    expect(getRuntimeMode()).toBe('cloud');
    expect(getRuntimeModeOrigin()).toBeNull();
  });

  it('override manual do usuário aparece como "user override"', () => {
    setRuntimeModeOverride('standalone');
    expect(getRuntimeMode()).toBe('standalone');
    expect(getRuntimeModeOrigin()).toBe('user override');
  });

  it('runtime Tauri sem mais nada ⇒ origem "Tauri runtime"', () => {
    installTauri(() => Promise.resolve(null));
    expect(getRuntimeMode()).toBe('standalone');
    expect(getRuntimeModeOrigin()).toBe('Tauri runtime');
  });

  it('opinião aplicada persiste a ORIGEM junto (deploy config)', async () => {
    installFetchRouter(() => ({
      status: 200,
      body: { standaloneMode: true },
    }));
    await applyRemoteModeOpinion();
    expect(getRuntimeMode()).toBe('standalone');
    expect(getRuntimeModeOrigin()).toBe('deploy config.local');
  });

  it('origem some quando a fonte de opinião desaparece e o boot re-decide null', async () => {
    // Boot 1: deploy diz standalone (origem gravada).
    installFetchRouter(() => ({
      status: 200,
      body: { standaloneMode: true },
    }));
    await applyRemoteModeOpinion();
    expect(getRuntimeModeOrigin()).toBe('deploy config.local');

    // Boot 2: arquivo saiu do ar — decisão vira null, chave e origem limpam.
    installFetchRouter(() => ({ status: 404 }));
    await applyRemoteModeOpinion();
    expect(getRuntimeMode()).toBe('cloud');
    expect(getRuntimeModeOrigin()).toBeNull();
  });

  it('origem lixo/oversized no storage é ignorada com segurança', () => {
    window.localStorage.setItem('solaris.runtimeModeRemoteApplied', 'standalone');
    window.localStorage.setItem('solaris.runtimeModeRemoteOrigin', 'x'.repeat(500));
    expect(getRuntimeMode()).toBe('standalone');
    // Origem inválida não quebra a leitura — cai no fallback null.
    expect(getRuntimeModeOrigin()).toBeNull();
  });
});

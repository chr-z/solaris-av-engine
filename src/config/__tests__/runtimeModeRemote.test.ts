import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getRuntimeMode,
  isStandalone,
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

/** Substitui o fetch global por um roteador simples. */
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

describe('runtimeMode.applyRemoteModeOpinion — integração', () => {
  beforeEach(() => {
    setRuntimeModeOverride(null);
    window.localStorage.removeItem('solaris.runtimeModeRemoteApplied');
    removeTauri();
  });

  afterEach(() => {
    setRuntimeModeOverride(null);
    window.localStorage.removeItem('solaris.runtimeModeRemoteApplied');
    removeTauri();
    vi.unstubAllGlobals();
  });

  it('sem fontes: limpa opinião aplicada anteriormente e segue cloud', async () => {
    window.localStorage.setItem('solaris.runtimeModeRemoteApplied', 'standalone');
    installFetchRouter(() => ({ status: 404 }));
    const applied = await applyRemoteModeOpinion();
    expect(applied.standalone).toBeNull();
    expect(getRuntimeMode()).toBe('cloud');
  });

  it('deploy config standalone=true liga o modo em runtime (web pura)', async () => {
    installFetchRouter(() => ({ status: 200, body: { standaloneMode: true } }));
    const applied = await applyRemoteModeOpinion();
    expect(applied.standalone).toBe(true);
    expect(isStandalone()).toBe(true);
    // Persiste entre recargas.
    expect(getRuntimeMode()).toBe('standalone');
  });

  it('deploy config standalone=false desliga APENAS artefato cloud', async () => {
    installFetchRouter(() => ({ status: 200, body: { standaloneMode: false } }));
    const applied = await applyRemoteModeOpinion();
    expect(applied.standalone).toBe(false);
    expect(getRuntimeMode()).toBe('cloud');
  });

  it('GUARDA: opinião cloud nunca rebaixa quem já nasceu standalone (build flag)', async () => {
    vi.stubGlobal('__SOLARIS_STANDALONE__', true);
    installFetchRouter(() => ({ status: 200, body: { standaloneMode: false } }));
    const applied = await applyRemoteModeOpinion();
    expect(applied.standalone).toBeNull(); // nada foi aplicado
    expect(isStandalone()).toBe(true); // e o modo local permanece
  });

  it('core Tauri vence sobre deploy config nos dois sentidos', async () => {
    // Core standalone vs deploy cloud.
    installTauri(() => Promise.resolve({ standalone: true, source: 'env' }));
    installFetchRouter(() => ({ status: 200, body: { standaloneMode: false } }));
    let applied = await applyRemoteModeOpinion();
    expect(applied.origin).toContain('core');
    expect(getRuntimeMode()).toBe('standalone');

    // Reset e inverte: core manda cloud ⇒ GUARDA bloqueia (runtime Tauri
    // presente já é artefato nato-sem-nuvem): nada é aplicado (retorno nulo),
    // opinião anterior persistida é removida e o modo efetivo segue
    // standalone pelo sinal local.
    window.localStorage.removeItem('solaris.runtimeModeRemoteApplied');
    installTauri(() => Promise.resolve({ standalone: true, source: 'env' }));
    await applyRemoteModeOpinion(); // grava 'standalone' persistido
    expect(window.localStorage.getItem('solaris.runtimeModeRemoteApplied')).toBe(
      'standalone',
    );
    installTauri(() => Promise.resolve({ standalone: false, source: 'file' }));
    applied = await applyRemoteModeOpinion();
    expect(applied.origin).toBeNull();
    expect(applied.standalone).toBeNull();
    expect(
      window.localStorage.getItem('solaris.runtimeModeRemoteApplied'),
    ).toBeNull();
    expect(getRuntimeMode()).toBe('standalone'); // sinal local intocado
  });

  it('comando ausente no exe antigo ⇒ sem opinião, sem erro (e modo segue pelo runtime)', async () => {
    installTauri(() => Promise.reject(new Error('unknown command')));
    installFetchRouter(() => ({ status: 404 }));
    const applied = await applyRemoteModeOpinion();
    expect(applied.standalone).toBeNull();
    // Exe antigo é nato-standalone pela presença do runtime — nada mudou.
    expect(getRuntimeMode()).toBe('standalone');
  });

  it('override manual do usuário bloqueia a aplicação da flag de ambiente', async () => {
    setRuntimeModeOverride('cloud');
    installFetchRouter(() => ({ status: 200, body: { standaloneMode: true } }));
    const applied = await applyRemoteModeOpinion();
    expect(applied.standalone).toBeNull();
    // Override continua mandando.
    expect(getRuntimeMode()).toBe('cloud');
  });

  it('fetch lento/travado não segura a decisão além do timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        (() => new Promise(() => undefined)) as unknown as typeof fetch,
      );
      const pending = applyRemoteModeOpinion();
      await vi.advanceTimersByTimeAsync(1500);
      const applied = await pending;
      expect(applied.standalone).toBeNull();
      expect(getRuntimeMode()).toBe('cloud');
    } finally {
      vi.useRealTimers();
    }
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getRuntimeMode,
  isStandalone,
  hasDesktopBridge,
  setRuntimeModeOverride,
} from '../config/runtimeMode';

const TAURI_KEY = '__TAURI_INTERNALS__';

describe('runtimeMode — dois modos de build', () => {
  beforeEach(() => {
    setRuntimeModeOverride(null);
    delete (window as unknown as Record<string, unknown>)[TAURI_KEY];
  });

  afterEach(() => {
    setRuntimeModeOverride(null);
    delete (window as unknown as Record<string, unknown>)[TAURI_KEY];
  });

  it('default é cloud quando não há override, build flag ou runtime Tauri', () => {
    expect(getRuntimeMode()).toBe('cloud');
    expect(isStandalone()).toBe(false);
    expect(hasDesktopBridge()).toBe(false);
  });

  it('override em localStorage força standalone (e volta ao limpar)', () => {
    setRuntimeModeOverride('standalone');
    expect(getRuntimeMode()).toBe('standalone');
    expect(isStandalone()).toBe(true);

    setRuntimeModeOverride(null);
    expect(getRuntimeMode()).toBe('cloud');
  });

  it('override tem precedência sobre o runtime Tauri', () => {
    (window as unknown as Record<string, unknown>)[TAURI_KEY] = {};
    setRuntimeModeOverride('cloud');
    // Mesmo dentro de um webview Tauri, o override explícito vence.
    expect(getRuntimeMode()).toBe('cloud');
    expect(isStandalone()).toBe(false);
  });

  it('runtime Tauri (__TAURI_INTERNALS__) implica standalone e bridge presente', () => {
    (window as unknown as Record<string, unknown>)[TAURI_KEY] = {};
    expect(hasDesktopBridge()).toBe(true);
    expect(isStandalone()).toBe(true);
  });

  it('override standalone vale mesmo fora do Tauri (modo desktop simulado)', () => {
    setRuntimeModeOverride('standalone');
    expect(hasDesktopBridge()).toBe(false); // sem bridge ipc
    expect(isStandalone()).toBe(true); // mas regra de negócio standalone
  });
});

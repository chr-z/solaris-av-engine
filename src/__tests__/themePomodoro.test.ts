// Solaris v3 — F2 QoL A2 — núcleos puros de tema e Pomodoro (bordas).
import { describe, it, expect } from 'vitest';
import {
  sanitizeThemePref,
  resolveDark,
  readStoredTheme,
  writeStoredTheme,
  THEME_STORAGE_KEY,
} from '../features/qol/theme';
import {
  derivePomodoro,
  formatPomodoroClock,
  PomodoroController,
  POMODORO_DEFAULT_SECONDS,
  IDLE_POMODORO,
} from '../features/qol/pomodoro';

describe('theme core', () => {
  it('sanitiza preferências', () => {
    expect(sanitizeThemePref('light')).toBe('light');
    expect(sanitizeThemePref('dark')).toBe('dark');
    expect(sanitizeThemePref('system')).toBe('system');
    expect(sanitizeThemePref('azul')).toBe('system'); // lixo → sistema
    expect(sanitizeThemePref(undefined)).toBe('system');
    expect(sanitizeThemePref(null)).toBe('system');
    expect(sanitizeThemePref(42)).toBe('system');
  });

  it('resolve escuro só quando decide é o sistema', () => {
    expect(resolveDark('dark', false)).toBe(true);
    expect(resolveDark('light', true)).toBe(false);
    expect(resolveDark('system', true)).toBe(true);
    expect(resolveDark('system', false)).toBe(false);
  });

  it('leitura tolerante: storage que lança vira system', () => {
    expect(readStoredTheme(() => 'dark')).toBe('dark');
    expect(readStoredTheme(() => null)).toBe('system');
    expect(
      readStoredTheme(() => {
        throw new Error('quota');
      }),
    ).toBe('system');
  });

  it('escrita best-effort não derruba a UI', () => {
    const seen: string[] = [];
    writeStoredTheme('light', (v) => seen.push(v));
    expect(seen).toEqual(['light']);
    expect(() =>
      writeStoredTheme('dark', () => {
        throw new Error('quota');
      }),
    ).not.toThrow();
    expect(THEME_STORAGE_KEY).toBe('solaris.theme');
  });
});

describe('pomodoro core', () => {
  const NOW = 1_800_000_000_000;

  it('deriva estados tolerantes', () => {
    expect(derivePomodoro(null, NOW)).toEqual(IDLE_POMODORO);
    expect(derivePomodoro('não-json{', NOW)).toEqual(IDLE_POMODORO);
    expect(derivePomodoro('"string"', NOW)).toEqual(IDLE_POMODORO);
    expect(derivePomodoro(JSON.stringify({ v: 1 }), NOW)).toEqual(IDLE_POMODORO);
    expect(derivePomodoro(JSON.stringify({ v: 1, endsAtMs: 'x' }), NOW)).toEqual(IDLE_POMODORO);
  });

  it('running com teto por cima (ceil)', () => {
    const s = derivePomodoro(JSON.stringify({ v: 1, endsAtMs: NOW + 90_500 }), NOW);
    expect(s.phase).toBe('running');
    expect(s.remainingSeconds).toBe(91); // 90,5 → 91
    expect(s.endsAtMs).toBe(NOW + 90_500);
  });

  it('expira exatamente em endsAt e descarta bloco velho (>5min)', () => {
    const endsAt = NOW + 1000;
    expect(derivePomodoro(JSON.stringify({ v: 1, endsAtMs: endsAt }), endsAt - 1).phase).toBe('running');
    expect(derivePomodoro(JSON.stringify({ v: 1, endsAtMs: endsAt }), endsAt).phase).toBe('expired');
    const stale = derivePomodoro(JSON.stringify({ v: 1, endsAtMs: endsAt }), endsAt + 5 * 60_000);
    expect(stale.phase).toBe('idle');
  });

  it('formatPomodoroClock clampa bordas', () => {
    expect(formatPomodoroClock(POMODORO_DEFAULT_SECONDS)).toBe('25:00');
    expect(formatPomodoroClock(-5)).toBe('00:00');
    expect(formatPomodoroClock(100 * 60)).toBe('99:59');
    expect(formatPomodoroClock(65)).toBe('01:05');
  });

  function makeController(store: { data?: string }, now: { value: number }, fired: number[]) {
    return new PomodoroController({
      read: () => store.data ?? null,
      write: (p) => {
        store.data = p;
      },
      clear: () => {
        delete store.data;
      },
      now: () => now.value,
      schedule: (_fn) => {
        fired.push(1);
        return () => {};
      },
      onExpire: () => {},
    });
  }

  it('start persiste, roda e para (duplo-stop seguro)', () => {
    const store: { data?: string } = {};
    const now = { value: NOW };
    const c = makeController(store, now, []);
    const s = c.start();
    expect(s.phase).toBe('running');
    expect(s.remainingSeconds).toBe(POMODORO_DEFAULT_SECONDS);
    expect(JSON.parse(store.data!).endsAtMs).toBe(NOW + POMODORO_DEFAULT_SECONDS * 1000);
    expect(c.stop()).toEqual(IDLE_POMODORO);
    expect(store.data).toBeUndefined();
    expect(c.stop()).toEqual(IDLE_POMODORO); // idempotente
  });

  it('start reinicia bloco existente com fim novo', () => {
    const store: { data?: string } = {};
    const now = { value: NOW };
    const c = makeController(store, now, []);
    const first = c.start();
    now.value += 60_000;
    const second = c.start();
    expect(second.endsAtMs! - first.endsAtMs!).toBe(60_000);
  });

  it('expira via agendador: onExpire 1x + subscribers notificados', () => {
    const store: { data?: string } = {};
    const now = { value: NOW };
    let timer: (() => void) | null = null;
    let expiredCount = 0;
    const c = new PomodoroController({
      read: () => store.data ?? null,
      write: (p) => {
        store.data = p;
      },
      clear: () => {
        delete store.data;
      },
      now: () => now.value,
      schedule: (fn) => {
        timer = fn;
        return () => {
          timer = null;
        };
      },
      onExpire: () => {
        expiredCount += 1;
      },
    });
    const seen: number[] = [];
    c.subscribe((s) => seen.push(s.phase === 'expired' ? 1 : 0));
    c.start();
    now.value += POMODORO_DEFAULT_SECONDS * 1000;
    timer!();
    expect(c.snapshot().phase).toBe('expired');
    expect(expiredCount).toBe(1);
    expect(seen).toContain(1);
  });

  it('resume retoma bloco persistido (reload) sem reiniciar o relógio', () => {
    const store: { data?: string } = {};
    const now = { value: NOW };
    const a = makeController(store, now, []);
    a.start();
    now.value += 10 * 60_000; // 10min depois (recarregou a página)
    const b = makeController(store, now, []);
    const resumed = b.resume();
    expect(resumed.phase).toBe('running');
    expect(resumed.remainingSeconds).toBe(POMODORO_DEFAULT_SECONDS - 600);
    expect(resumed.endsAtMs).toBe(NOW + POMODORO_DEFAULT_SECONDS * 1000); // mesmo fim
  });

  it('resume em idle não agenda nada', () => {
    const fired: number[] = [];
    const c = makeController({}, { value: NOW }, fired);
    expect(c.resume()).toEqual(IDLE_POMODORO);
    expect(fired).toEqual([]);
  });

  it('bloco expirado há pouco tempo continua expired (janela 5min)', () => {
    const store: { data?: string } = {};
    const now = { value: NOW };
    const c = makeController(store, now, []);
    c.start();
    now.value += POMODORO_DEFAULT_SECONDS * 1000 + 60_000; // expirou há 1min
    const s = c.snapshot();
    expect(s.phase).toBe('expired');
    expect(s.remainingSeconds).toBe(0);
  });
});

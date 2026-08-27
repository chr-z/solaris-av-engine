// Solaris v3 — QoL A1 — atalhos configuráveis: núcleo puro do remapeamento.
import { describe, it, expect } from 'vitest';
import {
  sanitizeMap,
  loadShortcutMap,
  saveShortcutMap,
  validateBinding,
  commitBinding,
  clearBinding,
  applyShortcutMap,
  remappableShortcuts,
  resolveKey,
  SHORTCUT_PREFS_KEY,
} from '../features/qol/shortcutPrefs';
import { ANALYST_SHORTCUTS, matchShortcut } from '../utils/shortcuts';

function fakeStorage(initial: Record<string, string> = {}) {
  const bag: Record<string, string> = { ...initial };
  return {
    getItem: (k: string) => (k in bag ? bag[k] : null),
    setItem: (k: string, v: string) => { bag[k] = v; },
    removeItem: (k: string) => { delete bag[k]; },
    clear: () => { for (const k of Object.keys(bag)) delete bag[k]; },
    key: (i: number) => Object.keys(bag)[i] ?? null,
    get length() { return Object.keys(bag).length; },
    _bag: bag,
  } as Storage & { _bag: Record<string, string> };
}

describe('shortcutPrefs — mapa sanitizado', () => {
  it('descarta ids desconhecidos, teclas reservadas e valores não-string', () => {
    const map = sanitizeMap({
      jumpBack: 'q',        // ok
      playPauseNative: 'x', // nativo → fora
      toggleCompare: ' ',   // Space reservado → fora
      dashNextSection: 'F1',// multi-char → fora
      markTime: 42,         // não-string → fora
      legacyGone: 'z',      // id que não existe → fora
      seekStart: 'ARROWLEFT', // reservada normalizada → fora
    });
    expect(map).toEqual({ jumpBack: 'q' });
  });

  it('storage corrompido/JSON inválido = padrões (mapa vazio)', () => {
    expect(loadShortcutMap(fakeStorage({ [SHORTCUT_PREFS_KEY]: '{quebrado' }))).toEqual({});
    expect(loadShortcutMap(null)).toEqual({});
  });

  it('round-trip grava/relê', () => {
    const storage = fakeStorage();
    expect(saveShortcutMap(storage, { markTime: 'w' })).toBe(true);
    expect(loadShortcutMap(storage)).toEqual({ markTime: 'w' });
  });

  it('saveShortcutMap dispara evento de hot-reload', () => {
    const events: string[] = [];
    const target = { dispatchEvent: (e: Event) => { events.push(e.type); return true; } };
    saveShortcutMap(fakeStorage(), { markTime: 'w' }, target as unknown as Window);
    expect(events).toEqual(['solaris:shortcuts-changed']);
  });
});

describe('validateBinding / commitBinding — conflitos e padrões', () => {
  it('recusa tecla reservada com motivo', () => {
    expect(validateBinding('markTime', 'm', {})).toEqual({ ok: false, reason: 'reserved' });
    expect(validateBinding('markTime', 'f', {})).toEqual({ ok: false, reason: 'reserved' });
  });

  it('recusa conflito apontando o dono atual da tecla', () => {
    const map = commitBinding({}, 'jumpBack', 'u');
    const verdict = validateBinding('markTime', 'u', map);
    expect(verdict).toEqual({ ok: false, reason: 'conflict', ownerId: 'jumpBack' });
  });

  it('recusa id inválido e tecla inválida', () => {
    expect(validateBinding('playPauseNative', 'p', {}).ok).toBe(false);
    expect(validateBinding('markTime', 'Shift', {}).reason).toBe('invalid');
  });

  it('commit de volta ao padrão REMOVE do mapa (enxuto); commit novo adiciona', () => {
    let map = commitBinding({}, 'markTime', 'w');
    expect(map).toEqual({ markTime: 'w' });
    map = commitBinding(map, 'markTime', 't'); // t é o padrão
    expect(map).toEqual({}); // voltou ao default → sem entrada
  });

  it('clearBinding restaura o padrão sem tocar nos outros', () => {
    const map = commitBinding(commitBinding({}, 'markTime', 'w'), 'jumpBack', 'u');
    expect(clearBinding(map, 'markTime')).toEqual({ jumpBack: 'u' });
    expect(clearBinding(map, 'toggleCompare')).toBe(map); // nada a fazer → mesma ref
  });

  it('resolveKey: mapa > padrão', () => {
    expect(resolveKey('markTime', { markTime: 'w' })).toBe('w');
    expect(resolveKey('markTime', {})).toBe('t');
  });
});

describe('applyShortcutMap + matching global', () => {
  it('substitui keys/display só dos remapeados; nativos intocados', () => {
    const defs = applyShortcutMap({ markTime: 'w', playPause: 'ç' });
    const markTime = defs.find(d => d.id === 'markTime')!;
    const playPause = defs.find(d => d.id === 'playPause')!;
    const native = defs.find(d => d.id === 'fullscreenNative')!;
    expect(markTime.keys).toBe('w');
    expect(playPause.keys).toBe('ç');
    expect(native.keys).toBe('f'); // intocado
    // Ordem do catálogo preservada:
    expect(defs.map(d => d.id)).toEqual(ANALYST_SHORTCUTS.map(d => d.id));
  });

  it('matchShortcut respeita o mapa aplicado (contrato ponta a ponta)', () => {
    const effective = applyShortcutMap({ jumpForward: 'ç' });
    // Simula o matching como o hook faz — mas com lista efetiva injetável.
    const found = effective.find(s => !s.native && s.keys === 'ç');
    expect(found?.id).toBe('jumpForward');
    // O matcher original continua íntegro para os padrões:
    expect(matchShortcut({ key: 'l' }, { scopeEnabled: { player: true } })?.id).toBe('jumpForward');
  });

  it('universo remapeável exclui nativos', () => {
    const remappable = remappableShortcuts();
    expect(remappable.some(d => d.native)).toBe(false);
    expect(remappable.length).toBe(ANALYST_SHORTCUTS.filter(d => !d.native).length);
  });
});

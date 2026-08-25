// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Modo foco (spec A1): esconde tudo exceto player+timeline — "F11-like
// interno". Núcleo puro decide QUAIS regiões da UI permanecem visíveis;
// o hook React só aplica as classes e guarda o toggle (persistente).

/** Regiões da UI que o workspace sabe esconder/mostrar. */
export type FocusRegion =
  | 'header'
  | 'sheetList'
  | 'monitors'
  | 'form'
  | 'player'
  | 'timeline';

export interface FocusLayout {
  hidden: readonly FocusRegion[];
  visible: readonly FocusRegion[];
}

/** Regiões sempre preservadas no modo foco (spec: player + timeline). */
export const FOCUS_KEEP_REGIONS: readonly FocusRegion[] = ['player', 'timeline'];

/** Layout alvo para um dado estado de foco. */
export function focusLayout(focusOn: boolean): FocusLayout {
  if (!focusOn) {
    return {
      hidden: [],
      visible: ['header', 'sheetList', 'monitors', 'form', 'player', 'timeline'],
    };
  }
  return {
    hidden: ['header', 'sheetList', 'monitors', 'form'],
    visible: [...FOCUS_KEEP_REGIONS],
  };
}

/**
 * Combina o layout com a preferência do usuário de manter monitores.
 * Alguns analistas querem foco COM os monitores de áudio/vídeo; a spec
 * pede player+timeline como mínimo, monitores são opt-in.
 */
export function applyFocusPreferences(
  layout: FocusLayout,
  prefs: { keepMonitors?: boolean } = {},
): FocusLayout {
  if (!prefs.keepMonitors) return layout;
  return {
    hidden: layout.hidden.filter((r) => r !== 'monitors'),
    visible: layout.visible.includes('monitors')
      ? layout.visible
      : [...layout.visible, 'monitors' as const].sort(),
  };
}

/** Chave de persistência do toggle (localStorage). */
export const FOCUS_PREF_KEY = 'solaris.qol.focus';
export const FOCUS_MONITORS_KEY = 'solaris.qol.focus.monitors';

/** Lê boolean persistido com fallback seguro (SSR/storage bloqueado). */
export function readFocusFlag(storage: Pick<Storage, 'getItem'> | null, key: string): boolean {
  try {
    return storage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Grava boolean de forma best-effort. */
export function writeFocusFlag(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, key: string, value: boolean): void {
  try {
    if (value) storage?.setItem(key, '1');
    else storage?.removeItem(key);
  } catch {
    /* best-effort */
  }
}

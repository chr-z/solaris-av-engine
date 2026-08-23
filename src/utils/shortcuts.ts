/**
 * SOLARIS analyst keyboard shortcuts (S5.1) — pure matching logic + docs.
 *
 * The global listener lives in useAnalystShortcuts; everything testable
 * (matching, grouping, docs metadata) is here so the hook stays thin.
 *
 * Keys already handled natively by VideoPlayer's own container-level
 * listener (Space, ←/→ seek, F, M) are listed with `native: true`: they
 * appear in the help modal but are deliberately NOT matched here, so each
 * keypress triggers exactly one action.
 */

export type ShortcutContext = 'global' | 'workspace' | 'player';

export interface ShortcutDef {
  /** Stable id used by tests and the help modal. */
  id: string;
  /** Key in `e.key` semantics, lowercased (matching contract). */
  keys: string;
  /** Optional pretty combo for non-obvious keys. */
  display?: string;
  /** Where the shortcut applies. */
  scope: ShortcutContext;
  /** i18n key for the description shown in the help modal. */
  descriptionKey: string;
  /** Handled by the VideoPlayer's own listener — docs only, never matched. */
  native?: boolean;
}

export const ANALYST_SHORTCUTS: readonly ShortcutDef[] = [
  // Documented but handled inside VideoPlayer (no global match):
  { id: 'playPauseNative', keys: ' ', display: 'Space', scope: 'player', descriptionKey: 'shortcuts.playPause.description', native: true },
  { id: 'seekBackNative', keys: 'arrowleft', display: '←', scope: 'player', descriptionKey: 'shortcuts.seekBack.description', native: true },
  { id: 'seekForwardNative', keys: 'arrowright', display: '→', scope: 'player', descriptionKey: 'shortcuts.seekForward.description', native: true },
  { id: 'fullscreenNative', keys: 'f', display: 'F', scope: 'player', descriptionKey: 'shortcuts.fullscreen.description', native: true },
  { id: 'muteNative', keys: 'm', display: 'M', scope: 'player', descriptionKey: 'shortcuts.mute.description', native: true },
  // Global analyst layer (matched here):
  { id: 'playPause', keys: 'k', display: 'K', scope: 'player', descriptionKey: 'shortcuts.playPause.description' },
  { id: 'jumpBack', keys: 'j', display: 'J', scope: 'player', descriptionKey: 'shortcuts.jumpBack.description' },
  { id: 'jumpForward', keys: 'l', display: 'L', scope: 'player', descriptionKey: 'shortcuts.jumpForward.description' },
  { id: 'seekStart', keys: ',', scope: 'player', descriptionKey: 'shortcuts.seekStart.description' },
  { id: 'frameBack', keys: 'arrowup', display: '↑', scope: 'player', descriptionKey: 'shortcuts.frameBack.description' },
  { id: 'frameForward', keys: 'arrowdown', display: '↓', scope: 'player', descriptionKey: 'shortcuts.frameForward.description' },
  { id: 'volumeUp', keys: '+', scope: 'player', descriptionKey: 'shortcuts.volumeUp.description' },
  { id: 'volumeDown', keys: '-', scope: 'player', descriptionKey: 'shortcuts.volumeDown.description' },
  { id: 'markTime', keys: 't', display: 'T', scope: 'workspace', descriptionKey: 'shortcuts.markTime.description' },
  { id: 'saveAnalysis', keys: 's', display: 'Ctrl+S', scope: 'workspace', descriptionKey: 'shortcuts.saveAnalysis.description' },
];

export const SHORTCUT_HELP_KEY = 'header.shortcutHelp';

/** Ids of the shortcuts the global layer actually dispatches. */
export function getActiveShortcutIds(shortcuts: readonly ShortcutDef[] = ANALYST_SHORTCUTS): string[] {
  return shortcuts.filter(def => !def.native).map(def => def.id);
}

export function getShortcutById(id: string): ShortcutDef | undefined {
  return ANALYST_SHORTCUTS.find(def => def.id === id);
}

/**
 * Resolves an event to a ShortcutDef, ignoring combos with modifiers
 * (browser/OS reserved), events from form fields, and native/player-owned
 * entries. `scopeEnabled` lets callers gate whole scopes (e.g. workspace
 * closed). All inputs are injected for testability.
 */
export function matchShortcut(
  event: Pick<KeyboardEvent, 'key'>,
  deps: {
    hasModifier?: boolean;
    isEditableTarget?: boolean;
    scopeEnabled?: Partial<Record<ShortcutContext, boolean>>;
  } = {},
): ShortcutDef | null {
  const { hasModifier = false, isEditableTarget = false, scopeEnabled } = deps;
  if (hasModifier || isEditableTarget) return null;
  const def = ANALYST_SHORTCUTS.find(s => !s.native && s.keys === event.key.toLowerCase());
  if (!def) return null;
  if (scopeEnabled && scopeEnabled[def.scope] === false) return null;
  return def;
}

/**
 * True when the event is the "save analysis" combo (Ctrl/Cmd+S).
 * Kept separate from matchShortcut so plain `s` never saves accidentally.
 */
export function isSaveCombo(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's';
}

/** Groups shortcuts by scope for the help modal columns. Order-stable. */
export function groupShortcutsByScope(): Record<ShortcutContext, ShortcutDef[]> {
  const groups: Record<ShortcutContext, ShortcutDef[]> = { global: [], workspace: [], player: [] };
  for (const def of ANALYST_SHORTCUTS) groups[def.scope].push(def);
  return groups;
}

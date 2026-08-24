import { describe, it, expect } from 'vitest';
import {
  ANALYST_SHORTCUTS,
  SHORTCUT_HELP_KEY,
  getActiveShortcutIds,
  getShortcutById,
  matchShortcut,
  isSaveCombo,
  groupShortcutsByScope,
  DASHBOARD_SECTIONS,
  nextDashboardSection,
  prevDashboardSection,
  type DashboardSectionId,
} from '../utils/shortcuts';
import { en, pt } from '../i18n/translations';

const key = (k: string) => ({ key: k });

describe('Analyst shortcuts — S5.1', () => {
  it('registers the documented analyst keys with unique ids and keys', () => {
    const active = getActiveShortcutIds();
    expect(active).toEqual([
      'playPause',
      'jumpBack',
      'jumpForward',
      'seekStart',
      'frameBack',
      'frameForward',
      'volumeUp',
      'volumeDown',
      'markTime',
      'saveAnalysis',
      'toggleCompare',
      // v3 P8: dashboards console
      'dashNextSection',
      'dashPrevSection',
      'dashExportCsv',
      'dashClearPeriod',
    ]);
    const keys = ANALYST_SHORTCUTS.map(def => def.keys);
    expect(new Set(keys).size).toBe(keys.length); // no key collisions at all
  });

  it('marks native/player-owned entries so they are never double-dispatched', () => {
    const nativeIds = ANALYST_SHORTCUTS.filter(def => def.native).map(def => def.id);
    expect(nativeIds).toContain('playPauseNative');
    expect(nativeIds).toContain('fullscreenNative');
    // Native entries exist in docs but never match:
    expect(matchShortcut(key(' '))).toBeNull();
    expect(matchShortcut(key('f'))).toBeNull();
    expect(matchShortcut(key('m'))).toBeNull();
  });

  it('matches player keys case-insensitively (K or k)', () => {
    expect(matchShortcut(key('k'))?.id).toBe('playPause');
    expect(matchShortcut(key('K'))?.id).toBe('playPause');
    expect(matchShortcut(key('j'))?.id).toBe('jumpBack');
    expect(matchShortcut(key('l'))?.id).toBe('jumpForward');
    expect(matchShortcut(key(','))?.id).toBe('seekStart');
  });

  it('matches arrow-key fine trim and volume steps', () => {
    expect(matchShortcut(key('ArrowUp'))?.id).toBe('frameBack');
    expect(matchShortcut(key('ArrowDown'))?.id).toBe('frameForward');
    expect(matchShortcut(key('+'))?.id).toBe('volumeUp');
    expect(matchShortcut(key('-'))?.id).toBe('volumeDown');
  });

  it('ignores modifier combos, form fields and unknown keys', () => {
    expect(matchShortcut(key('k'), { hasModifier: true })).toBeNull();
    expect(matchShortcut(key('t'), { isEditableTarget: true })).toBeNull();
    expect(matchShortcut(key('x'))).toBeNull();
  });

  it('respects scope gating (player off → player keys stop matching)', () => {
    expect(matchShortcut(key('k'), { scopeEnabled: { player: false } })).toBeNull();
    expect(matchShortcut(key('t'), { scopeEnabled: { player: false } })?.id).toBe('markTime');
    expect(matchShortcut(key('s'), { scopeEnabled: { workspace: false } })).toBeNull();
  });

  it('isSaveCombo requires Ctrl/Cmd+S and rejects plain s or Alt+S', () => {
    const combo = (over: Partial<KeyboardEvent> & { key: string }) =>
      isSaveCombo(over as KeyboardEvent);
    expect(combo({ key: 's', ctrlKey: true, metaKey: false })).toBe(true);
    expect(combo({ key: 'S', ctrlKey: false, metaKey: true })).toBe(true);
    expect(combo({ key: 's', ctrlKey: false, metaKey: false })).toBe(false);
    expect(combo({ key: 's', ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
  });

  it('groups shortcuts by scope in a stable shape for the help modal', () => {
    const groups = groupShortcutsByScope();
    expect(Object.keys(groups).sort()).toEqual(['dashboard', 'global', 'player', 'workspace']);
    expect(groups.player.length).toBeGreaterThan(groups.workspace.length);
    expect(groups.workspace.map(d => d.id)).toEqual(['markTime', 'saveAnalysis', 'toggleCompare']);
    expect(groups.dashboard.map(d => d.id)).toEqual([
      'dashNextSection',
      'dashPrevSection',
      'dashExportCsv',
      'dashClearPeriod',
    ]);
    // Every definition lands in exactly one group.
    const total =
      groups.global.length +
      groups.player.length +
      groups.workspace.length +
      groups.dashboard.length;
    expect(total).toBe(ANALYST_SHORTCUTS.length);
  });

  it('lookup + i18n wiring is consistent for the help modal', () => {
    expect(SHORTCUT_HELP_KEY).toBe('header.shortcutHelp');
    expect(getShortcutById('saveAnalysis')?.display).toBe('Ctrl+S');
    for (const def of ANALYST_SHORTCUTS) {
      const isShortcutsKey = def.descriptionKey.startsWith('shortcuts.');
      const isCompareKey = def.descriptionKey.startsWith('compare.');
      expect(isShortcutsKey || isCompareKey).toBe(true);
      // Every referenced key must exist in both dictionaries.
      expect(en[def.descriptionKey as keyof typeof en]).toBeTruthy();
      expect(pt[def.descriptionKey as keyof typeof pt]).toBeTruthy();
    }
  });
});

describe('Dashboard shortcuts — v3 P8', () => {
  it('matches dashboard keys only when the dashboard scope is enabled', () => {
    const on = { scopeEnabled: { dashboard: true } };
    const off = { scopeEnabled: { dashboard: false } };

    // With the scope ON every dashboard key matches its action…
    expect(matchShortcut(key('n'), on)?.id).toBe('dashNextSection');
    expect(matchShortcut(key('p'), on)?.id).toBe('dashPrevSection');
    expect(matchShortcut(key('e'), on)?.id).toBe('dashExportCsv');
    expect(matchShortcut(key('c'), on)?.id).toBe('dashClearPeriod');

    // …case-insensitively, like the other scopes.
    expect(matchShortcut(key('N'), on)?.id).toBe('dashNextSection');
    expect(matchShortcut(key('E'), on)?.id).toBe('dashExportCsv');

    // With the scope OFF nothing leaks into the analyst layer:
    expect(matchShortcut(key('n'), off)).toBeNull();
    expect(matchShortcut(key('p'), off)).toBeNull();
    expect(matchShortcut(key('e'), off)).toBeNull();
    expect(matchShortcut(key('c'), off)).toBeNull();

    // Workspace callers opt out explicitly (same semantics as every scope):
    expect(matchShortcut(key('n'), { scopeEnabled: { dashboard: false, player: true } })).toBeNull();
  });

  it('dashboard keys stay inert in form fields even inside the scope', () => {
    const on = { scopeEnabled: { dashboard: true }, isEditableTarget: true };
    expect(matchShortcut(key('n'), on)).toBeNull();
    expect(matchShortcut(key('e'), on)).toBeNull();
  });

  it('cycles sections forward with wrap-around', () => {
    expect(nextDashboardSection('summary')).toBe('studios');
    expect(nextDashboardSection('studios')).toBe('instructors');
    expect(nextDashboardSection('instructors')).toBe('analysts');
    expect(nextDashboardSection('analysts')).toBe('trend');
    expect(nextDashboardSection('trend')).toBe('summary');
  });

  it('cycles sections backward with wrap-around', () => {
    expect(prevDashboardSection('summary')).toBe('trend');
    expect(prevDashboardSection('studios')).toBe('summary');
    expect(prevDashboardSection('instructors')).toBe('studios');
    expect(prevDashboardSection('analysts')).toBe('instructors');
    expect(prevDashboardSection('trend')).toBe('analysts');
  });

  it('degrades an unknown section id to the first section instead of throwing', () => {
    const bogus = 'nope' as DashboardSectionId;
    expect(nextDashboardSection(bogus)).toBe('summary');
    expect(prevDashboardSection(bogus)).toBe('summary');
  });

  it('DASHBOARD_SECTIONS is the canonical cycle shared with the panel', () => {
    expect(DASHBOARD_SECTIONS).toEqual(['summary', 'studios', 'instructors', 'analysts', 'trend']);
  });
});

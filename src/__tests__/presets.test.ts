import { describe, it, expect } from 'vitest';
import {
  CONTENT_PRESETS,
  OPACITY_MATCH_TOLERANCE,
  getPresetIds,
  getPresetById,
  applyPreset,
  findPresetForOverlay,
} from '../utils/presets';
import { OverlaySettings } from '../types';

const BASE_SETTINGS: OverlaySettings = {
  type: 'none',
  opacity: 0.5,
  crosshairPosition: { x: 42, y: 17 },
};

describe('Content presets — S5.1', () => {
  it('exposes exactly the five documented preset ids', () => {
    expect(getPresetIds()).toEqual([
      'clean',
      'framing',
      'leveling',
      'onsiteCeiling',
      'homeCeiling',
    ]);
    // No accidental duplicates.
    expect(new Set(getPresetIds()).size).toBe(getPresetIds().length);
  });

  it('covers every overlay type offered by OverlayControls', () => {
    const presetTypes = CONTENT_PRESETS.map(p => p.overlay.type).sort();
    expect(presetTypes).toEqual(['crosshair', 'grid', 'homestudio', 'none', 'onsite']);
  });

  it('getPresetById resolves known ids and rejects unknown ones', () => {
    expect(getPresetById('framing')?.overlay).toEqual({ type: 'grid', opacity: 0.4 });
    expect(getPresetById('does-not-exist')).toBeUndefined();
  });

  it('applyPreset overrides only type/opacity and preserves user state', () => {
    const framing = getPresetById('framing')!;
    const next = applyPreset(framing, BASE_SETTINGS);
    expect(next).not.toBe(BASE_SETTINGS); // new object, no mutation
    expect(next.type).toBe('grid');
    expect(next.opacity).toBe(0.4);
    expect(next.crosshairPosition).toEqual({ x: 42, y: 17 }); // untouched
    expect(BASE_SETTINGS.type).toBe('none'); // original intact
  });

  it('findPresetForOverlay matches the exact preset settings', () => {
    for (const preset of CONTENT_PRESETS) {
      const found = findPresetForOverlay({
        type: preset.overlay.type,
        opacity: preset.overlay.opacity,
      });
      expect(found?.id).toBe(preset.id);
    }
  });

  it('findPresetForOverlay tolerates slider rounding within half a step', () => {
    const found = findPresetForOverlay({ type: 'grid', opacity: 0.42 });
    expect(found?.id).toBe('framing');
    expect(Math.abs(0.42 - 0.4)).toBeLessThanOrEqual(OPACITY_MATCH_TOLERANCE);
  });

  it('findPresetForOverlay returns null for custom dial-ins and wrong types', () => {
    expect(findPresetForOverlay({ type: 'grid', opacity: 0.9 })).toBeNull(); // custom opacity
    expect(findPresetForOverlay({ type: 'none', opacity: 0.99 })).toBeNull(); // not clean's 0.5
  });

  it('clean preset disables overlays; ceiling presets use low opacity', () => {
    const clean = getPresetById('clean')!;
    const onsite = getPresetById('onsiteCeiling')!;
    const home = getPresetById('homeCeiling')!;
    expect(clean.overlay.type).toBe('none');
    expect(onsite.overlay.type).toBe('onsite');
    expect(home.overlay.type).toBe('homestudio');
    expect(onsite.overlay.opacity).toBeLessThan(0.35);
    expect(home.overlay.opacity).toBe(onsite.overlay.opacity); // visual parity
  });

  it('every preset declares i18n name/description keys', () => {
    for (const preset of CONTENT_PRESETS) {
      expect(preset.nameKey.startsWith('preset.')).toBe(true);
      expect(preset.descriptionKey.endsWith('.description')).toBe(true);
    }
  });
});

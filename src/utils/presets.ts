/**
 * SOLARIS content presets (S5.1) — one-click monitor overlays tuned per
 * content type (raw review, framing check, leveling, ceiling guides).
 *
 * Pure module: no React, no DOM. Overlay values merge onto the current
 * OverlaySettings so user state (crosshair position) is never destroyed.
 */
import { OverlaySettings } from '../types';
import { TranslationKey } from '../i18n/translations';

export interface ContentPreset {
  /** Stable id persisted nowhere (derived from live settings instead). */
  id: string;
  /** i18n key for the display name. */
  nameKey: TranslationKey;
  /** i18n key for a short hint (select title / aria help). */
  descriptionKey: TranslationKey;
  /** Overlay slice applied by the preset; the rest of the settings survive. */
  overlay: {
    type: OverlaySettings['type'];
    opacity: number;
  };
}

export const CONTENT_PRESETS: readonly ContentPreset[] = [
  {
    id: 'clean',
    nameKey: 'preset.clean.name',
    descriptionKey: 'preset.clean.description',
    overlay: { type: 'none', opacity: 0.5 },
  },
  {
    id: 'framing',
    nameKey: 'preset.framing.name',
    descriptionKey: 'preset.framing.description',
    overlay: { type: 'grid', opacity: 0.4 },
  },
  {
    id: 'leveling',
    nameKey: 'preset.leveling.name',
    descriptionKey: 'preset.leveling.description',
    overlay: { type: 'crosshair', opacity: 0.55 },
  },
  {
    id: 'onsiteCeiling',
    nameKey: 'preset.onsite.name',
    descriptionKey: 'preset.onsite.description',
    overlay: { type: 'onsite', opacity: 0.3 },
  },
  {
    id: 'homeCeiling',
    nameKey: 'preset.homeStudio.name',
    descriptionKey: 'preset.homeStudio.description',
    overlay: { type: 'homestudio', opacity: 0.3 },
  },
];

/** Half of the opacity slider step (0.05) — treats slider rounding as equal. */
export const OPACITY_MATCH_TOLERANCE = 0.026;

/** Returns every preset id exactly once (guards against copy-paste dupes). */
export function getPresetIds(presets: readonly ContentPreset[] = CONTENT_PRESETS): string[] {
  return presets.map(preset => preset.id);
}

export function getPresetById(
  id: string,
  presets: readonly ContentPreset[] = CONTENT_PRESETS,
): ContentPreset | undefined {
  return presets.find(preset => preset.id === id);
}

/**
 * Merges a preset onto the current settings. Returns a NEW object —
 * crosshair position and any future per-user fields are preserved.
 */
export function applyPreset(
  preset: ContentPreset,
  current: OverlaySettings,
): OverlaySettings {
  return {
    ...current,
    type: preset.overlay.type,
    opacity: preset.overlay.opacity,
  };
}

/**
 * Finds which preset (if any) matches the live settings. `null` means the
 * analyst dialed something custom and the selector should show that state.
 */
export function findPresetForOverlay(
  settings: Pick<OverlaySettings, 'type' | 'opacity'>,
  presets: readonly ContentPreset[] = CONTENT_PRESETS,
): ContentPreset | null {
  return (
    presets.find(
      preset =>
        preset.overlay.type === settings.type &&
        Math.abs(preset.overlay.opacity - settings.opacity) <= OPACITY_MATCH_TOLERANCE,
    ) ?? null
  );
}

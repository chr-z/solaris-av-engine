import React from 'react';
import {
  CONTENT_PRESETS,
  applyPreset,
  findPresetForOverlay,
} from '../../utils/presets';
import { OverlaySettings } from '../../types';
import { useI18n } from '../../i18n/I18nContext';
import { NoSymbolIcon, GridIcon, LevelIcon, ImageIcon } from '../Core/icons';

interface PresetSelectorProps {
  settings: OverlaySettings;
  setSettings: React.Dispatch<React.SetStateAction<OverlaySettings>>;
}

const PRESET_ICONS: Record<string, React.ReactNode> = {
  clean: <NoSymbolIcon className="w-4 h-4" />,
  framing: <GridIcon className="w-4 h-4" />,
  leveling: <LevelIcon className="w-4 h-4" />,
  onsiteCeiling: <ImageIcon className="w-4 h-4" />,
  homeCeiling: <ImageIcon className="w-4 h-4" />,
};

/**
 * S5.1: one-click content presets for the monitor overlays.
 * Compact segmented control; shows "Custom" when the live settings don't
 * match any preset (analyst dialed their own opacity/type).
 */
const PresetSelector: React.FC<PresetSelectorProps> = ({ settings, setSettings }) => {
  const { t } = useI18n();
  const activePreset = findPresetForOverlay(settings);

  return (
    <div
      className="mt-2 pt-2 border-t border-solar-dark-border/60"
      role="group"
      aria-label={t('preset.title')}
    >
      <p className="text-xs font-bold uppercase text-white px-2 mb-1">{t('preset.title')}</p>
      <p className="text-[11px] leading-tight text-ink-secondary dark:text-gray-400 px-2 mb-2">
        {t('preset.select')}
      </p>
      <div className="grid grid-cols-3 gap-1">
        {CONTENT_PRESETS.map(preset => {
          const isActive = activePreset?.id === preset.id;
          const description = t(preset.descriptionKey as never);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setSettings(current => applyPreset(preset, current))}
              title={`${t(preset.nameKey as never)} — ${description}`}
              aria-label={`${t(preset.nameKey as never)} — ${description}`}
              aria-pressed={isActive}
              className={`flex flex-col items-center justify-start gap-0.5 p-1.5 rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent ${
                isActive
                  ? 'bg-solar-accent/20 text-solar-accent'
                  : 'text-ink-secondary wash-hover'
              }`}
            >
              {PRESET_ICONS[preset.id]}
              <span className="text-[10px] leading-tight text-center">
                {t(preset.nameKey as never)}
              </span>
            </button>
          );
        })}
        <div
          aria-hidden="true"
          className={`flex items-center justify-center p-1.5 rounded-md text-[10px] uppercase tracking-wide ${
            activePreset ? 'text-gray-500' : 'bg-solar-accent/20 text-solar-accent'
          }`}
        >
          {t('preset.custom')}
        </div>
      </div>
    </div>
  );
};

export default PresetSelector;

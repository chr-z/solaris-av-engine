// Solaris v3 — F2 QoL — seletor de densidade no Header (spec A2:
// confortável/compacta). Mesmo desenho do ThemeMenu: radiogroup ARIA com
// roving tabindex e setas, estado via useDensityPreference
// (useSyncExternalStore — aba cruzada reflete ao vivo), zero deps novas.

import React from 'react';
import { useDensityPreference } from '../../features/qol/useDensityPreference';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import type { DensityPreference } from '../../features/qol/density';

const OPTIONS: { id: DensityPreference; labelKey: TranslationKey; icon: string }[] = [
  { id: 'comfortable', labelKey: 'density.comfortable', icon: '▢' },
  { id: 'compact', labelKey: 'density.compact', icon: '▤' },
];

const DensityMenu: React.FC = () => {
  const { pref, setPref } = useDensityPreference();
  const { t } = useI18n();

  // Radiogroup ARIA: a seleção segue o foco nas setas (wrap circular).
  const moveFocus = (delta: number) => {
    const idx = OPTIONS.findIndex((o) => o.id === pref);
    const next = OPTIONS[(idx + delta + OPTIONS.length) % OPTIONS.length];
    setPref(next.id);
    const el = document.querySelector<HTMLButtonElement>(`[data-density-opt="${next.id}"]`);
    el?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t('density.label')}
      data-testid="density-menu"
      className="flex items-center rounded-md border border-solar-light-border dark:border-solar-dark-border overflow-hidden"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          moveFocus(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          moveFocus(-1);
        }
      }}
    >
      {OPTIONS.map(({ id, labelKey, icon }, index) => {
        const isActive = pref === id;
        return (
          <button
            key={id}
            data-density-opt={id}
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setPref(id)}
            title={t(labelKey)}
            aria-label={t(labelKey)}
            className={`px-2 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-solar-accent ${
              index > 0 ? 'border-l border-solar-light-border dark:border-solar-dark-border' : ''
            } ${
              isActive
                ? 'bg-solar-accent text-white'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-500/10 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <span aria-hidden="true">{icon}</span>
          </button>
        );
      })}
    </div>
  );
};

export default DensityMenu;

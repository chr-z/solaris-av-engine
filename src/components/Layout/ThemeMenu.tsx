// Solaris v3 — F2 QoL — menu de tema no Header (spec A2: claro/escuro/sistema).
//
// Grupo compacto de 3 opções (mesmo estilo do LanguageSwitcher), acessível
// (radiogroup com roving tabindex + setas) e zero dependência nova.
// O estado vem de useThemePreference (useSyncExternalStore — aba cruzada e
// mudança do sistema refletem ao vivo).

import React from 'react';
import { useThemePreference } from '../../features/qol/useThemePreference';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import type { ThemePreference } from '../../features/qol/theme';

const OPTIONS: { id: ThemePreference; labelKey: TranslationKey; icon: string }[] = [
  { id: 'light', labelKey: 'theme.light', icon: '☀' },
  { id: 'dark', labelKey: 'theme.dark', icon: '☾' },
  { id: 'system', labelKey: 'theme.system', icon: '◐' },
];

const ThemeMenu: React.FC = () => {
  const { pref, setPref } = useThemePreference();
  const { t } = useI18n();

  // Radiogroup ARIA: a seleção segue o foco nas setas (wrap circular).
  const moveFocus = (delta: number) => {
    const idx = OPTIONS.findIndex((o) => o.id === pref);
    const next = OPTIONS[(idx + delta + OPTIONS.length) % OPTIONS.length];
    setPref(next.id);
    const el = document.querySelector<HTMLButtonElement>(`[data-theme-opt="${next.id}"]`);
    el?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label')}
      data-testid="theme-menu"
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
            data-theme-opt={id}
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

export default ThemeMenu;

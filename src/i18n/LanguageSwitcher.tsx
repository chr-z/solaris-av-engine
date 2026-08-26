import React from 'react';
import { useI18n } from './I18nContext';
import { Locale } from './core';

const LOCALES: { id: Locale; shortLabel: string; fullLabel: string }[] = [
  { id: 'en', shortLabel: 'EN', fullLabel: 'English' },
  { id: 'pt', shortLabel: 'PT', fullLabel: 'Português (BR)' },
];

interface LanguageSwitcherProps {
  /** 'full' shows the language name; 'short' shows a compact EN/PT pill. */
  variant?: 'short' | 'full';
}

const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ variant = 'short' }) => {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t('header.changeLanguage')}
      className="flex items-center rounded-md border border-hairline overflow-hidden"
    >
      {LOCALES.map(({ id, shortLabel, fullLabel }, index) => {
        const isActive = locale === id;
        return (
          <button
            key={id}
            onClick={() => setLocale(id)}
            disabled={isActive}
            aria-pressed={isActive}
            lang={id}
            className={`px-2 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-solar-accent ${
              index > 0 ? 'border-l border-hairline' : ''
            } ${
              isActive
                ? 'bg-solar-accent text-bg'
                : 'text-ink-secondary wash-hover'
            }`}
          >
            {variant === 'full' ? fullLabel : shortLabel}
          </button>
        );
      })}
    </div>
  );
};

export default LanguageSwitcher;

import React from 'react';
import { useI18n } from '../../i18n/I18nContext';

interface ProLockOverlayProps {
  /** i18n key of the feature being gated (shown as the lock title). */
  titleKey: string;
}

/**
 * S6.1: upsell overlay for Pro-gated features. Renders INLINE — the parent
 * must be `relative` — covering the feature surface while keeping its layout
 * space. Fully keyboard/AT friendly (role=button + Enter/Space activation).
 */
const ProLockOverlay: React.FC<ProLockOverlayProps> = ({ titleKey }) => {
  const { t } = useI18n();

  const handleOpenUpgrade = () => {
    window.dispatchEvent(new CustomEvent('solaris:open-pro-upgrade'));
  };

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-solar-dark-bg/60">
      <div
        role="button"
        tabIndex={0}
        onClick={handleOpenUpgrade}
        onKeyDown={(event: React.KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpenUpgrade();
          }
        }}
        aria-label={t('pro.lock.openUpgrade', { feature: t(titleKey as never) })}
        className="group w-full max-w-xs rounded-lg border border-solar-dark-border bg-solar-dark-content/90 backdrop-blur-sm p-4 text-center cursor-pointer hover:border-solar-accent/60 transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent focus:outline-none"
      >
        <svg
          className="w-8 h-8 mx-auto mb-2 text-solar-accent"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <p className="font-bold text-sm text-white mb-1">{t('pro.lock.title')}</p>
        <p className="text-xs text-gray-400 leading-snug">
          {t('pro.lock.description', { feature: t(titleKey as never) })}
        </p>
        <span className="inline-block mt-3 px-3 py-1.5 rounded-md bg-gradient-to-br from-accent-from to-accent-to text-bg text-xs font-bold">
          {t('pro.lock.cta')}
        </span>
      </div>
    </div>
  );
};

export default ProLockOverlay;

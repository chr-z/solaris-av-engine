import React from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { useOfflineStatus } from '../../pwa/registerSW';

/**
 * Compact connectivity pill for the header (S2.1).
 * Hidden while online; shows an amber "offline — cached mode" badge otherwise.
 * Announces transitions politely to screen readers.
 */
const OfflineIndicator: React.FC = () => {
  const { t } = useI18n();
  const { isOnline } = useOfflineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      title={t('pwa.offlineBadgeTitle')}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold border border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-300"
    >
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
      {t('pwa.offlineBadge')}
    </div>
  );
};

export default OfflineIndicator;

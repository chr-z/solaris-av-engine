import React from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { getRuntimeMode, getRuntimeModeOrigin } from '../../config/runtimeMode';

/**
 * Badge de suporte do modo de execução (P3).
 *
 * Mostra quando o app está em modo LOCAL (standalone) e, no tooltip, DE ONDE
 * veio a decisão (env/config local via core Tauri, config do deploy, build
 * flag ou runtime Tauri). Em cloud sem sinal nenhum não renderiza nada — o
 * default da web demo não precisa de anúncio. No exe standalone fica sempre
 * visível: suporte diagnostica "em que modo estou e por quê" de olho só.
 */
const ModeBadge: React.FC = () => {
  const { t } = useI18n();
  const standalone = getRuntimeMode() === 'standalone';
  if (!standalone) return null;
  const origin = getRuntimeModeOrigin();
  const title = origin
    ? t('mode.badgeOriginTitle', { origin })
    : t('mode.badgeTitle');

  return (
    <div
      role="status"
      title={title}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold border border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 select-none"
    >
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-emerald-500" />
      {t('mode.badgeStandalone')}
    </div>
  );
};

export default ModeBadge;

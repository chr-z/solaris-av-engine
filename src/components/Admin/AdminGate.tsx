// Solaris v3 — #/admin route: RBAC-gated rules console.
// Non-admins see a denial screen; the panel itself never renders without role.
// The app shell stays mounted underneath — the gate simply replaces <main>.

import React, { useState } from 'react';
import AdminRulesPanel from './AdminRulesPanel';
import DashboardPanel from './DashboardPanel';
import { useAdminRole } from '../../hooks/useAdminRole';
import LoadingIndicator from '../Core/LoadingIndicator';
import { useI18n } from '../../i18n/I18nContext';

// F5: painel ao vivo é um chunk separado (echarts só carrega se abrir a aba).
const LiveDashboardPanel = React.lazy(() => import('./LiveDashboardPanel'));

type AdminView = 'sheets' | 'live';

/** i18n key por visão do toggle (evita mapa tipado redundante). */
const VIEW_LABEL_KEY = {
  sheets: 'admin.viewSheets',
  live: 'admin.viewLive',
} as const;

const AdminGate: React.FC<{
  dashboards?: boolean;
  viewer?: { id: string; name: string } | null;
}> = ({ dashboards = false, viewer = null }) => {
  const { t } = useI18n();
  const { isAdmin, source, loading } = useAdminRole();
  const [view, setView] = useState<AdminView>('sheets');

  if (loading) {
    return (
      <main className="flex items-center justify-center h-screen bg-solar-dark-bg">
        <LoadingIndicator statusText={t('admin.checkingRole')} />
      </main>
    );
  }

  const backLink = (
    <a
      href="#/"
      data-testid="admin-back"
      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-500 text-gray-300 hover:bg-gray-500/10 text-sm transition-colors"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </svg>
      {t('admin.backToApp')}
    </a>
  );

  if (!isAdmin) {
    return (
      <main
        role="alert"
        data-testid="admin-denied"
        className="flex flex-col items-center justify-center h-screen gap-4 bg-solar-dark-bg text-gray-300 p-8 text-center"
      >
        <h1 className="text-xl font-bold text-red-400">{t('admin.deniedTitle')}</h1>
        <p className="max-w-md text-sm">
          {t('admin.deniedBody')}
        </p>
        {backLink}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-solar-dark-bg">
      <div className="max-w-5xl mx-auto pt-4 flex items-center justify-between gap-2">
        {backLink}
        <span className="text-xs text-gray-500" title={t('admin.roleSourceTitle')}>
          {source === 'firebase-claim' ? t('admin.roleViaClaim') : t('admin.roleViaLocal')}
        </span>
      </div>
      {dashboards ? (
        <>
          {/* Toggle Planilhas / Ao vivo — teclas acessíveis, estilo do app */}
          <div
            role="tablist"
            aria-label={t('admin.viewToggleLabel')}
            className="max-w-5xl mx-auto mt-2 flex items-center gap-1"
          >
            {(['sheets', 'live'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                data-testid={`admin-view-${v}`}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  view === v
                    ? 'bg-solar-accent/20 text-solar-accent font-medium'
                    : 'text-gray-400 hover:bg-gray-500/10'
                }`}
              >
                {t(VIEW_LABEL_KEY[v])}
              </button>
            ))}
          </div>
          <React.Suspense fallback={<ChartFallbackLazy />}>
            {view === 'live' ? (
              <LiveDashboardPanel viewer={viewer} />
            ) : (
              <DashboardPanel />
            )}
          </React.Suspense>
        </>
      ) : (
        <AdminRulesPanel />
      )}
    </main>
  );
};

/** Fallback local (mesma forma visual do placeholder dos gráficos). */
function ChartFallbackLazy(): React.ReactElement {
  return (
    <div className="mt-6 flex h-40 items-center justify-center text-xs text-gray-500">
      …
    </div>
  );
}

export default AdminGate;

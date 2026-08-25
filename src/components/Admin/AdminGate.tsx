// Solaris v3 — #/admin route: RBAC-gated rules console.
// Non-admins see a denial screen; the panel itself never renders without role.
// The app shell stays mounted underneath — the gate simply replaces <main>.

import React from 'react';
import AdminRulesPanel from './AdminRulesPanel';
import DashboardPanel from './DashboardPanel';
import { useAdminRole } from '../../hooks/useAdminRole';
import LoadingIndicator from '../Core/LoadingIndicator';
import { useI18n } from '../../i18n/I18nContext';

const AdminGate: React.FC<{ dashboards?: boolean }> = ({ dashboards = false }) => {
  const { t } = useI18n();
  const { isAdmin, source, loading } = useAdminRole();

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
        <span className="text-xs text-ink-secondary" title={t('admin.roleSourceTitle')}>
          {source === 'firebase-claim' ? t('admin.roleViaClaim') : t('admin.roleViaLocal')}
        </span>
      </div>
      {dashboards ? <DashboardPanel /> : <AdminRulesPanel />}
    </main>
  );
};

export default AdminGate;

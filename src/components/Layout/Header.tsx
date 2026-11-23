import React, { useState } from 'react';
import { VideoIcon, ArrowLeftIcon } from '../Core/icons';
import SolarisLogo from '../Core/SolarisLogo';
import Popover from '../Core/Popover';
import SourceSelector from '../Media/SourceSelector';
import { UserProfile } from '../../types';
import OnlineUsers from './OnlineUsers';
import UserAvatar from '../Auth/UserAvatar';
import LanguageSwitcher from '../../i18n/LanguageSwitcher';
import { useI18n } from '../../i18n/I18nContext';
import OfflineIndicator from '../Core/OfflineIndicator';
import { QCExportButton } from '../Analysis/QCExportButton';
import ProUpgradeModal from '../Admin/ProUpgradeModal';
import { useLicense } from '../../licensing/LicenseContext';
// F2 QoL A2: tema claro/escuro/sistema, densidade e timer de pausa (Pomodoro).
import ThemeMenu from './ThemeMenu';
import DensityMenu from './DensityMenu';
import PomodoroBadge from './PomodoroBadge';
import { describeFeature } from '../../licensing/core';
import { useAdminRole } from '../../hooks/useAdminRole';
import './header.css';

// Code splitting (S3.1): admin/report modals ship in separate chunks and are
// fetched only on first open. `isOpen && ...` keeps them out of the tree while
// closed, so the chunk request never fires until actually needed.
const BugReportModal = React.lazy(() => import('../Admin/BugReportModal'));
const BugReportViewer = React.lazy(() => import('../Admin/BugReportViewer'));


interface HeaderProps {
  onSourceSelected: (source: File | string, info?: { name?: string; isDriveLink?: boolean; isYoutube?: boolean }) => void;
  isWorkspaceOpen: boolean;
  onCloseWorkspace: () => void;
  title: string;
  userProfile: UserProfile | null;
  onLogout: () => void;
}

const Header: React.FC<HeaderProps> = ({ 
  onSourceSelected, 
  isWorkspaceOpen, 
  onCloseWorkspace, 
  title, 
  userProfile, 
  onLogout 
}) => {
  const { t } = useI18n();
  const { isPro } = useLicense();
  const { isAdmin: isAdminUser } = useAdminRole();
  const [isBugReportModalOpen, setIsBugReportModalOpen] = useState(false);
  const [isBugReportViewerOpen, setIsBugReportViewerOpen] = useState(false);
  // S6.1: the lock overlay opens this via a window event (no prop drilling
  // through the workspace tree).
  const [isProUpgradeOpen, setIsProUpgradeOpen] = useState(false);

  React.useEffect(() => {
    const open = () => setIsProUpgradeOpen(true);
    window.addEventListener('solaris:open-pro-upgrade', open as EventListener);
    return () => window.removeEventListener('solaris:open-pro-upgrade', open as EventListener);
  }, []);

  const isWorkOrder = title.startsWith('W.O');

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <button
            type="button"
            onClick={onCloseWorkspace}
            className={`topbar__back ${isWorkspaceOpen ? 'is-on' : ''}`}
            disabled={!isWorkspaceOpen}
            aria-label={t('header.backToList')}
          >
            <ArrowLeftIcon className="w-4 h-4" />
          </button>

          <a className="topbar__mark" href="#/" onClick={(e) => { if (isWorkspaceOpen) { e.preventDefault(); onCloseWorkspace(); } }}>
            <SolarisLogo size={18} />
            <span className="topbar__wordmark">Solaris</span>
          </a>

          <span className="topbar__rule" aria-hidden="true" />

          <span className={`topbar__title ${isWorkOrder ? 'tnum' : ''}`} title={title}>
            {title}
          </span>
        </div>

        <div className="topbar__right">
          {!isWorkspaceOpen && (
            <Popover
              contentClassName="w-96"
              trigger={
                <button className="topbar__cta" type="button">
                  <VideoIcon className="w-4 h-4" />
                  <span>{t('header.loadMedia')}</span>
                </button>
              }
            >
              {(close) => <SourceSelector onSourceSelected={onSourceSelected} onClosePopover={close} />}
            </Popover>
          )}

          {/* S4.1: printable QC report download (dataset summary). */}
          <QCExportButton className="topbar__ghost" />

          {isPro ? (
            <span className="topbar__badge" title={t('solaris.pro.activeTitle')}>
              {t('pro.badge')}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setIsProUpgradeOpen(true)}
              className="topbar__ghost"
              title={describeFeature('abCompareMode')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <span>{t('header.upgrade')}</span>
            </button>
          )}

          <span className="topbar__rule" aria-hidden="true" />

          <div className="topbar__icons">
            <OfflineIndicator />
            <ThemeMenu />
            <DensityMenu />
            <PomodoroBadge />
            <OnlineUsers />
          </div>

          <span className="topbar__rule" aria-hidden="true" />

          <LanguageSwitcher />

          {userProfile && (
            <Popover
              contentClassName="w-56"
              trigger={
                <button className="topbar__user" aria-label={userProfile.name}>
                  <UserAvatar user={userProfile} className="w-7 h-7" />
                </button>
              }
            >
              {(close) => (
                <div className="p-1">
                  <div className="px-3 py-2 border-b border-hairline">
                    <p className="text-sm font-semibold truncate" title={userProfile.name}>{userProfile.name}</p>
                    <p className="text-xs text-ink-secondary truncate" title={userProfile.email}>{userProfile.email}</p>
                  </div>
                  <div className="py-1">
                    <button
                      onClick={() => { setIsBugReportModalOpen(true); close(); }}
                      className="menu-item"
                    >
                      {t('header.reportIssue')}
                    </button>
                    {/* F4: Liga dos Analistas (#/liga) — todos os autenticados. */}
                    <a href="#/liga" data-testid="header-league-link" className="menu-item">
                      {t('header.league')}
                    </a>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        try { window.localStorage.removeItem('solaris.onboarded'); } catch { /* ignore */ }
                        close();
                        window.location.hash = '';
                        window.location.reload();
                      }}
                    >
                      {t('header.replayTour')}
                    </button>
                    {/* v3: Scoring Rules console (#/admin) — same RBAC decision as the gate. */}
                    {isAdminUser && (
                      <a href="#/admin" className="menu-item">
                        {t('header.adminPanel')}
                      </a>
                    )}
                    {/* P5: Scoring dashboards (#/admin/dashboards) — same RBAC decision. */}
                    {isAdminUser && (
                      <a href="#/admin/dashboards" data-testid="header-dashboards-link" className="menu-item">
                        {t('header.dashboards')}
                      </a>
                    )}
                    {/* Admin Panel Link */}
                    {userProfile.email.endsWith('.admin') && (
                      <button
                        onClick={() => { setIsBugReportViewerOpen(true); close(); }}
                        className="menu-item"
                      >
                        {t('header.systemReports')}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => { onLogout(); close(); }}
                    className="menu-item menu-item-danger mt-1 border-t border-hairline"
                  >
                    {t('header.signOut')}
                  </button>
                </div>
              )}
            </Popover>
          )}
        </div>
      </header>

      {isBugReportModalOpen && (
        <React.Suspense fallback={null}>
          <BugReportModal
            isOpen
            onClose={() => setIsBugReportModalOpen(false)}
            userProfile={userProfile}
          />
        </React.Suspense>
      )}

      {/* Conditional rendering for admin view logic can be expanded here */}
      {isBugReportViewerOpen && (
        <React.Suspense fallback={null}>
          <BugReportViewer
            isOpen
            onClose={() => setIsBugReportViewerOpen(false)}
          />
        </React.Suspense>
      )}

      {/* S6.1: Pro activation/upgrade dialog (also opened by lock overlays). */}
      <ProUpgradeModal isOpen={isProUpgradeOpen} onClose={() => setIsProUpgradeOpen(false)} />
    </>
  );
};

export default Header;

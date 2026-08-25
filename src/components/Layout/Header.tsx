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
import { describeFeature } from '../../licensing/core';
import { useAdminRole } from '../../hooks/useAdminRole';

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

  return (
    <>
      <header className="flex-shrink-0 flex items-center justify-between p-3 h-16 border-b border-hairline bg-surface/80 dark:bg-surface/80 backdrop-blur-sm z-20">
        <div className="flex items-center gap-2">
          <div className={`transition-all duration-150 ease-in-out ${isWorkspaceOpen ? 'w-0 opacity-0 -translate-x-2' : 'w-6 opacity-100'}`}>
            <SolarisLogo size={24} />
          </div>
          
          <button 
            onClick={onCloseWorkspace}
            className={`transition-all duration-150 ease-in-out flex items-center gap-2 ${isWorkspaceOpen ? 'w-auto opacity-100' : 'w-0 opacity-0 -translate-x-2'}`}
            disabled={!isWorkspaceOpen}
            aria-label={t('header.backToList')}
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>

          <h1 className="text-lg font-bold text-gray-900 dark:text-white truncate">{title}</h1>
        </div>
        <div className="flex items-center gap-4">
          {!isWorkspaceOpen && (
              <Popover 
                contentClassName="w-96"
                trigger={
                  <button className="flex items-center gap-2 px-3 py-2 rounded-md bg-gradient-to-br from-accent-from to-accent-to text-[#0b0e14] font-semibold hover:shadow-glow transition-shadow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-accent">
                    <VideoIcon className="w-5 h-5" />
                    <span>{t('header.loadMedia')}</span>
                  </button>
                }
              >
                {(close) => <SourceSelector onSourceSelected={onSourceSelected} onClosePopover={close} />}
              </Popover>
          )}
          
          <div className="h-6 w-px bg-hairline"></div>
          
          <OfflineIndicator />

          {/* S6.1: edition badge + upgrade entry point (free tier only). */}
          {isPro ? (
            <span
              title={t('solaris.pro.activeTitle')}
              className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-solar-accent/20 text-solar-accent border border-solar-accent/40 select-none"
            >
              {t('pro.badge')}
            </span>
          ) : (
            <button
              onClick={() => setIsProUpgradeOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gradient-to-r from-yellow-500 to-orange-500 text-white text-sm font-semibold hover:from-yellow-400 hover:to-orange-400 transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
              title={describeFeature('abCompareMode')}
            >
              <svg
                className="w-4 h-4"
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
              <span>{t('header.upgrade')}</span>
            </button>
          )}

          {/* S4.1: printable QC report download (dataset summary). */}
          <QCExportButton className="!px-2" />

          <OnlineUsers />

          <LanguageSwitcher />

          {userProfile && (
              <Popover 
                contentClassName="w-56"
                trigger={
                  <button className="icon-btn flex items-center gap-2 p-1 rounded-full">
                      <UserAvatar user={userProfile} className="w-8 h-8"/>
                  </button>
                }
              >
                {(close) => (
                  <div className="p-1">
                    <div className="px-3 py-2 border-b border-hairline">
                        <p className="font-bold truncate" title={userProfile.name}>{userProfile.name}</p>
                        <p className="text-xs text-gray-400 truncate" title={userProfile.email}>{userProfile.email}</p>
                    </div>
                    <div className="py-1">
                        <button
                          onClick={() => { setIsBugReportModalOpen(true); close(); }}
                          className="menu-item"
                        >
                          {t('header.reportIssue')}
                        </button>
                        {/* v3: Scoring Rules console (#/admin) — same RBAC decision as the gate. */}
                        {isAdminUser && (
                          <a
                            href="#/admin"
                            className="menu-item"
                          >
                            {t('header.adminPanel')}
                          </a>
                        )}
                        {/* P5: Scoring dashboards (#/admin/dashboards) — same RBAC decision. */}
                        {isAdminUser && (
                          <a
                            href="#/admin/dashboards"
                            data-testid="header-dashboards-link"
                            className="menu-item"
                          >
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
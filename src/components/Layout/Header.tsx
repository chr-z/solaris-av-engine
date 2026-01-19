import React, { useState } from 'react';
import { VideoIcon, ArrowLeftIcon } from '../Core/icons';
import Popover from '../Core/Popover';
import SourceSelector from '../Media/SourceSelector';
import { UserProfile } from '../../types';
import OnlineUsers from './OnlineUsers';
import UserAvatar from '../Auth/UserAvatar';
import BugReportModal from '../Admin/BugReportModal';
import BugReportViewer from '../Admin/BugReportViewer';


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
  const [isBugReportModalOpen, setIsBugReportModalOpen] = useState(false);
  const [isBugReportViewerOpen, setIsBugReportViewerOpen] = useState(false);

  return (
    <>
      <header className="flex-shrink-0 flex items-center justify-between p-3 h-16 border-b border-solar-light-border dark:border-solar-dark-border bg-solar-light-content/80 dark:bg-solar-dark-content/80 backdrop-blur-sm z-20">
        <div className="flex items-center gap-2">
          <div className={`transition-all duration-300 ease-in-out ${isWorkspaceOpen ? 'w-0 opacity-0 -translate-x-2' : 'w-6 opacity-100'}`}>
            <div className="w-6 h-6 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full"></div>
          </div>
          
          <button 
            onClick={onCloseWorkspace}
            className={`transition-all duration-300 ease-in-out flex items-center gap-2 ${isWorkspaceOpen ? 'w-auto opacity-100' : 'w-0 opacity-0 -translate-x-2'}`}
            disabled={!isWorkspaceOpen}
            aria-label="Back to List"
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
                  <button className="flex items-center gap-2 px-3 py-2 rounded-md bg-solar-accent text-white hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-light-content dark:focus:ring-offset-solar-dark-content focus:ring-solar-accent">
                    <VideoIcon className="w-5 h-5" />
                    <span>Load Media</span>
                  </button>
                }
              >
                {(close) => <SourceSelector onSourceSelected={onSourceSelected} onClosePopover={close} />}
              </Popover>
          )}
          
          <div className="h-6 w-px bg-solar-dark-border"></div>
          
          <OnlineUsers />

          {userProfile && (
              <Popover 
                contentClassName="w-56"
                trigger={
                  <button className="flex items-center gap-2 p-1 rounded-full hover:bg-gray-500/20 transition-colors">
                      <UserAvatar user={userProfile} className="w-8 h-8"/>
                  </button>
                }
              >
                {(close) => (
                  <div className="p-1">
                    <div className="px-3 py-2 border-b border-solar-dark-border">
                        <p className="font-bold truncate" title={userProfile.name}>{userProfile.name}</p>
                        <p className="text-xs text-gray-400 truncate" title={userProfile.email}>{userProfile.email}</p>
                    </div>
                    <div className="py-1">
                        <button 
                          onClick={() => { setIsBugReportModalOpen(true); close(); }} 
                          className="w-full text-left px-3 py-2 text-sm rounded-md text-gray-200 hover:bg-gray-500/20 transition-colors"
                        >
                          Report Issue
                        </button>
                        {/* Admin Panel Link */}
                        {userProfile.email.endsWith('.admin') && (
                          <button 
                            onClick={() => { setIsBugReportViewerOpen(true); close(); }} 
                            className="w-full text-left px-3 py-2 text-sm rounded-md text-gray-200 hover:bg-gray-500/20 transition-colors"
                          >
                            System Reports
                          </button>
                        )}
                    </div>
                    <button 
                      onClick={() => { onLogout(); close(); }} 
                      className="w-full text-left mt-1 px-3 py-2 text-sm rounded-md text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors border-t border-solar-dark-border"
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </Popover>
          )}
        </div>
      </header>

      <BugReportModal 
          isOpen={isBugReportModalOpen}
          onClose={() => setIsBugReportModalOpen(false)}
          userProfile={userProfile}
      />
      
      {/* Conditional rendering for admin view logic can be expanded here */}
      <BugReportViewer
          isOpen={isBugReportViewerOpen}
          onClose={() => setIsBugReportViewerOpen(false)}
      />
    </>
  );
};

export default Header;
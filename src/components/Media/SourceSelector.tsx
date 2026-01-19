import React, { useState, useCallback, useRef } from 'react';
import { UploadIcon, GoogleDriveIcon, YouTubeIcon } from '../Core/icons';
import DriveFilePicker from './DriveFilePicker';
import { DriveFile } from '../Analysis/AnalysisSheet';

interface SourceSelectorProps {
  onSourceSelected: (source: File | string, info?: { name?: string; isDriveLink?: boolean; isYoutube?: boolean }) => void;
  onClosePopover?: () => void;
}

type SourceType = 'local' | 'youtube' | 'drive';

const SourceSelector: React.FC<SourceSelectorProps> = ({ onSourceSelected, onClosePopover }) => {
  const [activeTab, setActiveTab] = useState<SourceType>('local');
  const [url, setUrl] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onSourceSelected(file, { name: file.name });
      if (onClosePopover) onClosePopover();
    }
  }, [onSourceSelected, onClosePopover]);

  const handleUrlSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    if (url) {
      if (activeTab === 'youtube') {
        onSourceSelected(url, { isYoutube: true });
      } else if (activeTab === 'drive') {
        onSourceSelected(url, { isDriveLink: true });
      }
      if (onClosePopover) onClosePopover();
    }
  }, [url, onSourceSelected, activeTab, onClosePopover]);
  
  const handleButtonClick = () => {
      fileInputRef.current?.click();
  }

  const handleFileSelectedFromPicker = (file: DriveFile) => {
    onSourceSelected(file.id, { name: file.name, isDriveLink: true });
    setIsPickerOpen(false);
    if (onClosePopover) onClosePopover();
  };

  const renderUrlInput = (placeholder: string) => (
    <form onSubmit={handleUrlSubmit} className="flex gap-2">
        <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={placeholder}
            className="flex-grow bg-solar-light-bg dark:bg-solar-dark-bg border border-solar-light-border dark:border-solar-dark-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200 dark:placeholder-gray-500"
        />
        <button type="submit" className="px-4 py-2 bg-solar-accent text-white rounded-md hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-light-content dark:focus:ring-offset-solar-dark-content focus:ring-solar-accent">
            Load
        </button>
    </form>
  );

  const renderContent = () => {
    const DRIVE_FOLDER_ID = import.meta.env.VITE_GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root';
    switch (activeTab) {
      case 'youtube':
        return renderUrlInput("Enter YouTube Video URL");
      case 'drive':
        return (
          <>
            {isPickerOpen && (
              <DriveFilePicker
                folderId={DRIVE_FOLDER_ID}
                onFileSelected={handleFileSelectedFromPicker}
                onCancel={() => setIsPickerOpen(false)}
              />
            )}
            <div className="space-y-4">
              {renderUrlInput("Enter Google Drive Link")}
              <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                <div className="flex-grow h-px bg-solar-light-border dark:bg-solar-dark-border"></div>
                <span className="text-xs">OR</span>
                <div className="flex-grow h-px bg-solar-light-border dark:bg-solar-dark-border"></div>
              </div>
              <button
                onClick={() => setIsPickerOpen(true)}
                className="w-full px-4 py-2 bg-gray-500/10 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-500/20 transition-colors flex items-center justify-center gap-2"
              >
                <GoogleDriveIcon className="w-5 h-5" />
                <span>Select from Drive Folder</span>
              </button>
            </div>
          </>
        );
      case 'local':
      default:
        return (
          <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-solar-light-border dark:border-solar-dark-border rounded-lg text-center">
            <input
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              className="hidden"
              ref={fileInputRef}
            />
            <button onClick={handleButtonClick} className="px-4 py-2 bg-solar-accent text-white rounded-md hover:bg-solar-accent-hover transition-colors flex items-center gap-2">
                <UploadIcon className="w-5 h-5" />
                <span>Select Local File</span>
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Or drag and drop a video file here</p>
          </div>
        );
    }
  };

  const TabButton = ({ id, label, icon }: { id: SourceType, label: string, icon: React.ReactNode }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-t-md transition-colors ${
        activeTab === id
          ? 'bg-solar-light-content dark:bg-solar-dark-content text-solar-accent border-b-2 border-solar-accent'
          : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-500/10'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="bg-solar-light-content dark:bg-solar-dark-content rounded-lg p-1">
      <div className="flex border-b border-solar-light-border dark:border-solar-dark-border">
        <TabButton id="local" label="Local File" icon={<UploadIcon className="w-5 h-5"/>} />
        <TabButton id="youtube" label="YouTube" icon={<YouTubeIcon className="w-5 h-5"/>} />
        <TabButton id="drive" label="Google Drive" icon={<GoogleDriveIcon className="w-5 h-5"/>} />
      </div>
      <div className="p-4">{renderContent()}</div>
    </div>
  );
};

export default SourceSelector;
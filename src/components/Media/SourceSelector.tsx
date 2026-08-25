import React, { useState, useCallback, useRef } from 'react';
import { UploadIcon, GoogleDriveIcon, YouTubeIcon } from '../Core/icons';
import DriveFilePicker from './DriveFilePicker';
import { DriveFile } from '../Analysis/AnalysisSheet';
import { useI18n } from '../../i18n/I18nContext';

interface SourceSelectorProps {
  onSourceSelected: (source: File | string, info?: { name?: string; isDriveLink?: boolean; isYoutube?: boolean }) => void;
  onClosePopover?: () => void;
}

type SourceType = 'local' | 'youtube' | 'drive';

const SourceSelector: React.FC<SourceSelectorProps> = ({ onSourceSelected, onClosePopover }) => {
  const { t } = useI18n();
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

  const renderUrlInput = (placeholderKey: 'source.placeholder.youtube' | 'source.placeholder.drive') => (
    <form onSubmit={handleUrlSubmit} className="flex gap-2">
        <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t(placeholderKey)}
            aria-label={t(placeholderKey)}
            className="flex-grow bg-surface border border-hairline rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200 dark:placeholder-gray-500"
        />
        <button type="submit" className="px-4 py-2 bg-gradient-to-br from-accent-from to-accent-to text-[#0b0e14] font-semibold rounded-md hover:shadow-glow transition-shadow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-accent">
            {t('source.load')}
        </button>
    </form>
  );

  const renderContent = () => {
    const DRIVE_FOLDER_ID = import.meta.env.VITE_GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root';
    switch (activeTab) {
      case 'youtube':
        return renderUrlInput('source.placeholder.youtube');
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
              {renderUrlInput('source.placeholder.drive')}
              <div className="flex items-center gap-2 text-gray-400 dark:text-ink-secondary">
                <div className="flex-grow h-px bg-hairline"></div>
                <span className="text-xs">{t('source.or')}</span>
                <div className="flex-grow h-px bg-hairline"></div>
              </div>
              <button
                onClick={() => setIsPickerOpen(true)}
                className="w-full px-4 py-2 bg-gray-500/10 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-500/20 transition-colors flex items-center justify-center gap-2"
              >
                <GoogleDriveIcon className="w-5 h-5" />
                <span>{t('source.selectFromDrive')}</span>
              </button>
            </div>
          </>
        );
      case 'local':
      default:
        return (
          <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-hairline rounded-lg text-center">
            <input
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              className="hidden"
              ref={fileInputRef}
            />
            <button onClick={handleButtonClick} className="px-4 py-2 bg-solar-accent text-bg rounded-md hover:bg-solar-accent-hover transition-colors flex items-center gap-2">
                <UploadIcon className="w-5 h-5" />
                <span>{t('source.selectLocalFile')}</span>
            </button>
            <p className="text-xs text-ink-secondary dark:text-gray-400 mt-2">{t('source.dragDropHint')}</p>
          </div>
        );
    }
  };

  return (
    <div className="bg-surface dark:bg-surface rounded-lg p-1">
      <div className="flex border-b border-hairline" role="tablist">
        <TabButton id="local" label={t('source.tab.local')} icon={<UploadIcon className="w-5 h-5"/>} activeTab={activeTab} onSelect={setActiveTab} />
        <TabButton id="youtube" label={t('source.tab.youtube')} icon={<YouTubeIcon className="w-5 h-5"/>} activeTab={activeTab} onSelect={setActiveTab} />
        <TabButton id="drive" label={t('source.tab.drive')} icon={<GoogleDriveIcon className="w-5 h-5"/>} activeTab={activeTab} onSelect={setActiveTab} />
      </div>
      <div className="p-4">{renderContent()}</div>
    </div>
  );
};

interface TabButtonProps {
  id: SourceType;
  label: string;
  icon: React.ReactNode;
  activeTab: SourceType;
  onSelect: (id: SourceType) => void;
}

const TabButton = ({ id, label, icon, activeTab, onSelect }: TabButtonProps) => (
  <button
    onClick={() => onSelect(id)}
    role="tab"
    aria-selected={activeTab === id}
    className={`flex items-center gap-2 px-4 py-2 rounded-t-md transition-colors ${
      activeTab === id
        ? 'bg-surface dark:bg-surface text-solar-accent border-b-2 border-solar-accent'
        : 'bg-transparent text-ink-secondary dark:text-gray-400 hover:bg-gray-500/10'
    }`}
  >
    {icon}
    {label}
  </button>
);

export default SourceSelector;

import React from 'react';
import { ExpandIcon } from '../Core/icons';
import { useI18n } from '../../i18n/I18nContext';

interface DockProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  onZoom?: () => void;
}

const Dock: React.FC<DockProps> = ({ children, className = '', title, onZoom }) => {
  const { t } = useI18n();
  return (
    <div className={`bg-surface/90 backdrop-blur-md rounded-lg shadow-sm flex flex-col border border-hairline h-full ${className}`}>
      {(title || onZoom) && (
        <header className="flex-shrink-0 flex justify-between items-center p-2 border-b border-solar-dark-border/50 h-9">
          <h3 className="font-bold text-xs uppercase text-ink-secondary">{title}</h3>
          {onZoom && (
            <button
              onClick={onZoom}
              className="icon-btn p-1 -mr-1 rounded-md"
              title={t('dock.expandMonitor', { monitor: title ?? '' })}
              aria-label={t('dock.expandMonitor', { monitor: title ?? '' })}
            >
              <ExpandIcon className="w-4 h-4" />
            </button>
          )}
        </header>
      )}
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 w-full h-full p-1">
            {children}
        </div>
      </div>
    </div>
  );
};

export default Dock;
import React from 'react';
import { ExpandIcon } from '../Core/icons';
import { useI18n } from '../../i18n/I18nContext';
import './dock.css';

interface DockProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  onZoom?: () => void;
}

/**
 * Monitor dock — the instrument frame around every scope.
 * Chrome is a 1px hairline plus a mono label; the canvas owns the rest.
 */
const Dock: React.FC<DockProps> = ({ children, className = '', title, onZoom }) => {
  const { t } = useI18n();
  return (
    <div className={`dock ${className}`}>
      {(title || onZoom) && (
        <header className="dock__head">
          <h3 className="dock__title">{title}</h3>
          <span className="dock__dots" aria-hidden="true">
            <i /><i /><i />
          </span>
          {onZoom && (
            <button
              onClick={onZoom}
              className="dock__zoom"
              title={t('dock.expandMonitor', { monitor: title ?? '' })}
              aria-label={t('dock.expandMonitor', { monitor: title ?? '' })}
            >
              <ExpandIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </header>
      )}
      <div className="dock__body">
        <div className="dock__inner">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Dock;

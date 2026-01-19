import React from 'react';
import { ExpandIcon } from '../Core/icons';

interface DockProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  onZoom?: () => void;
}

const Dock: React.FC<DockProps> = ({ children, className = '', title, onZoom }) => {
  return (
    <div className={`bg-solar-light-content/80 dark:bg-solar-dark-content/80 backdrop-blur-md rounded-lg shadow-sm flex flex-col border border-solar-light-border dark:border-solar-dark-border h-full ${className}`}>
      {(title || onZoom) && (
        <header className="flex-shrink-0 flex justify-between items-center p-2 border-b border-solar-dark-border/50 h-9">
          <h3 className="font-bold text-xs uppercase text-gray-400">{title}</h3>
          {onZoom && (
            <button
              onClick={onZoom}
              className="p-1 -mr-1 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors"
              title="Expand"
              aria-label={`Expand monitor ${title}`}
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
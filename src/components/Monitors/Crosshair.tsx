import React, { useCallback } from 'react';
import { OverlaySettings } from '../types';

interface CrosshairProps {
  settings: OverlaySettings;
  setSettings: React.Dispatch<React.SetStateAction<OverlaySettings>>;
  containerRef: React.RefObject<HTMLDivElement>;
}

const Crosshair: React.FC<CrosshairProps> = ({ settings, setSettings, containerRef }) => {
  
  const handleMouseDown = useCallback((e: React.MouseEvent, direction: 'horizontal' | 'vertical') => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();

      if (direction === 'horizontal') {
        const newY = ((moveEvent.clientY - rect.top) / rect.height) * 100;
        setSettings(prev => ({
          ...prev,
          crosshairPosition: { ...prev.crosshairPosition, y: Math.max(0, Math.min(100, newY)) }
        }));
      } else {
        const newX = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        setSettings(prev => ({
          ...prev,
          crosshairPosition: { ...prev.crosshairPosition, x: Math.max(0, Math.min(100, newX)) }
        }));
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [containerRef, setSettings]);

  return (
    <div 
      className="absolute inset-0" 
      style={{ opacity: settings.opacity }}
    >
      {/* Horizontal Bar */}
      <div
        className="absolute left-0 right-0 bg-white/80"
        style={{
          top: `${settings.crosshairPosition.y}%`,
          height: '9.5px',
          transform: 'translateY(-50%)',
          cursor: 'ns-resize',
        }}
        onMouseDown={(e) => handleMouseDown(e, 'horizontal')}
        aria-label="Draggable horizontal line"
      />
      {/* Vertical Bar */}
      <div
        className="absolute top-0 bottom-0 bg-white/80"
        style={{
          left: `${settings.crosshairPosition.x}%`,
          width: '9.5px',
          transform: 'translateX(-50%)',
          cursor: 'ew-resize',
        }}
        onMouseDown={(e) => handleMouseDown(e, 'vertical')}
        aria-label="Draggable vertical line"
      />
    </div>
  );
};

export default Crosshair;
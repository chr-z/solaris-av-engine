import React from 'react';
import { OverlaySettings } from '../../types';
import { GridIcon, ImageIcon, NoSymbolIcon, LevelIcon } from '../Core/icons';

interface OverlayControlsProps {
  settings: OverlaySettings;
  setSettings: React.Dispatch<React.SetStateAction<OverlaySettings>>;
}

const OverlayControls: React.FC<OverlayControlsProps> = ({ settings, setSettings }) => {
  const handleTypeChange = (type: OverlaySettings['type']) => {
    setSettings(prev => ({ ...prev, type }));
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const opacity = parseFloat(e.target.value);
    setSettings(prev => ({ ...prev, opacity }));
  };
  
  const TypeButton = ({ type, label, icon }: { type: OverlaySettings['type'], label: string, icon: React.ReactNode }) => (
    <button
      onClick={() => handleTypeChange(type)}
      title={label}
      className={`flex flex-col items-center justify-start p-2 rounded-md transition-colors flex-1 h-16 ${
        settings.type === type ? 'bg-solar-accent/20 text-solar-accent' : 'text-white hover:bg-gray-500/10'
      }`}
    >
      {icon}
      <span className="text-xs mt-1 text-center">{label}</span>
    </button>
  );

  return (
    <div className="bg-solar-light-content dark:bg-solar-dark-content rounded-lg p-2">
      <h3 className="text-xs font-bold uppercase text-white px-2 mb-2">Overlays</h3>
      <div className="flex justify-around gap-1">
        <TypeButton type="none" label="None" icon={<NoSymbolIcon className="w-5 h-5"/>} />
        <TypeButton type="grid" label="Grid" icon={<GridIcon className="w-5 h-5"/>} />
        <TypeButton type="crosshair" label="Level" icon={<LevelIcon className="w-5 h-5"/>} />
        <TypeButton type="onsite" label="Onsite" icon={<ImageIcon className="w-5 h-5"/>} />
        <TypeButton type="homestudio" label="Home" icon={<ImageIcon className="w-5 h-5"/>} />
      </div>
      {settings.type !== 'none' && (
        <div className="p-2 mt-2">
          <label htmlFor="opacity" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Opacity
          </label>
          <input
            id="opacity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.opacity}
            onChange={handleOpacityChange}
            className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-solar-accent"
          />
        </div>
      )}
    </div>
  );
};

export default OverlayControls;
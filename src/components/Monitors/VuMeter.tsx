import React, { useState, useEffect, useRef } from 'react';
import { ExpandIcon } from './icons';

interface VuMeterProps {
  volume: number;
  isReady: boolean;
  onZoom?: () => void;
}

const VuMeter: React.FC<VuMeterProps> = ({ volume, isReady, onZoom }) => {
  const [smoothedDb, setSmoothedDb] = useState(-Infinity);
  const [peakDb, setPeakDb] = useState(-Infinity);
  
  const peakHoldTimeoutRef = useRef<number | null>(null);
  const peakFalloffIntervalRef = useRef<number | null>(null);
  const smoothedDbRef = useRef(smoothedDb);
  smoothedDbRef.current = smoothedDb;

  const MIN_DB = -60;
  const MAX_DB = 0;

  // Linear (0-1) to Logarithmic (dB) conversion
  const db = volume > 0 ? 20 * Math.log10(volume) : -Infinity;
  const clampedDb = Math.max(MIN_DB, Math.min(db, MAX_DB));

  useEffect(() => {
    if (!isReady) {
      setSmoothedDb(-Infinity);
      return;
    }
    // Fast attack smoothing
    const smoothingFactor = 0.6;
    setSmoothedDb(prev => {
        if (!isFinite(prev)) return clampedDb;
        return prev * (1 - smoothingFactor) + clampedDb * smoothingFactor;
    });
  }, [clampedDb, isReady]);

  // Peak Hold Logic
  useEffect(() => {
    if (!isReady) {
      setPeakDb(-Infinity);
      if (peakHoldTimeoutRef.current) clearTimeout(peakHoldTimeoutRef.current);
      if (peakFalloffIntervalRef.current) clearInterval(peakFalloffIntervalRef.current);
      return;
    }

    if (clampedDb >= peakDb) {
      setPeakDb(clampedDb);
      
      if (peakHoldTimeoutRef.current) clearTimeout(peakHoldTimeoutRef.current);
      if (peakFalloffIntervalRef.current) clearInterval(peakFalloffIntervalRef.current);
      peakFalloffIntervalRef.current = null;

      // Hold peak for 1.5s then decay
      peakHoldTimeoutRef.current = window.setTimeout(() => {
        peakFalloffIntervalRef.current = window.setInterval(() => {
          setPeakDb(prev => {
            const newPeak = prev - 1.0; // Decay rate
            if (newPeak < smoothedDbRef.current || newPeak < MIN_DB) {
              if (peakFalloffIntervalRef.current) clearInterval(peakFalloffIntervalRef.current);
              return Math.max(smoothedDbRef.current, MIN_DB);
            }
            return newPeak;
          });
        }, 50);
      }, 1500);
    }
  }, [clampedDb, isReady, peakDb]);

  useEffect(() => {
    return () => {
      if (peakHoldTimeoutRef.current) clearTimeout(peakHoldTimeoutRef.current);
      if (peakFalloffIntervalRef.current) clearInterval(peakFalloffIntervalRef.current);
    }
  }, []);

  const dbToPercent = (val: number) => {
      if (!isFinite(val) || !isReady) return 0;
      return Math.max(0, Math.min(100, ((val - MIN_DB) / (MAX_DB - MIN_DB)) * 100));
  }
  
  const heightPercent = dbToPercent(smoothedDb);
  const peakPercent = dbToPercent(peakDb);

  const getColor = (peakValPercent: number) => {
    if (peakValPercent >= 100) return 'bg-red-500'; // Clip
    if (peakValPercent > 90) return 'bg-yellow-400'; // Warning
    return 'bg-green-500'; // Nominal
  };
  
  const ticks = [-42.1, -24, -12, -6, 0];
  const displayDb = isFinite(peakDb) ? peakDb.toFixed(1) : '-∞';

  return (
    <div className="h-full w-12 bg-solar-light-content/80 dark:bg-solar-dark-content/80 backdrop-blur-md rounded-lg shadow-sm flex flex-col border border-solar-light-border dark:border-solar-dark-border">
      <header className="flex-shrink-0 flex justify-between items-center p-2 border-b border-solar-dark-border/50 h-9">
        <h3 className="font-bold text-xs uppercase text-gray-400">VU</h3>
        {onZoom && (
          <button
            onClick={onZoom}
            className="p-1 -mr-1 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors"
            title="Expand"
            aria-label="Expand VU Meter"
          >
            <ExpandIcon className="w-4 h-4" />
          </button>
        )}
      </header>
      <div className="flex-1 min-h-0 flex flex-col items-center px-2 pt-1 pb-2">
        <div className="w-full flex-1 relative border-2 border-solar-light-border dark:border-solar-dark-border rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
          {/* Main Bar */}
          <div 
            className="absolute bottom-0 left-0 right-0 transition-height duration-75 ease-out"
            style={{ height: `${heightPercent}%` }}
          >
              <div className={`h-full ${getColor(peakPercent)}`}></div>
          </div>

          {/* Peak Hold Indicator */}
          {isReady && isFinite(peakDb) && (
              <div 
                  className="absolute left-0 right-0 h-0.5 bg-red-400"
                  style={{ bottom: `${peakPercent}%`}}
              />
          )}

          {/* dB Scale */}
          <div className="absolute inset-y-0 -right-0.5 w-px bg-gray-400 dark:bg-gray-600/50">
            {ticks.map(tick => (
                <div key={tick} className="absolute w-2 h-px bg-gray-400 dark:bg-gray-600" style={{bottom: `${dbToPercent(tick)}%`, right: '0px'}}></div>
            ))}
          </div>
          {/* Headroom Marker (-6dB) */}
          <div className="absolute left-0 right-0 h-px bg-solar-accent/70" style={{ bottom: `${dbToPercent(-6)}%` }}/>
        </div>
        <span className="mt-1 font-mono text-base font-bold">{displayDb}</span>
      </div>
    </div>
  );
};

export default VuMeter;
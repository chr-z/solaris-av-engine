import React, { useState, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';

import RgbParade from '../Monitors/RgbParade';
import Waveform from '../Monitors/Waveform';
import VuMeter from '../Monitors/VuMeter';
import Spectrogram from '../Monitors/Spectrogram';
import Dock from '../Layout/Dock';
import { XIcon } from '../Core/icons';
import { useAVAnalysis } from '../../hooks/useAVAnalysis';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';

/**
 * LiveMonitors (turbo-web runtime perf).
 *
 * Owns the 15 Hz useAVAnalysis state so that playback ticks re-render ONLY
 * this island (4 canvas docks + zoom modal), never the whole
 * AnalysisWorkspace tree (sheet form, filters, header, shortcuts...).
 *
 * Contract with the parent:
 *   - videoRef: the SAME <video> element ref used by VideoPlayer (shared,
 *     read-only here — we only draw from it inside useAVAnalysis).
 *   - videoSrc: current source; drives hook setup/teardown.
 */
export type ZoomedDock = 'rgbParade' | 'waveform' | 'spectrogram' | 'vuMeter';

interface LiveMonitorsProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  videoSrc: string | null;
}

const ZOOM_TITLES: Record<ZoomedDock, string> = {
  rgbParade: 'RGB Parade',
  waveform: 'Waveform',
  spectrogram: 'Spectrogram',
  vuMeter: 'VU Meter',
};

const LiveMonitors: React.FC<LiveMonitorsProps> = ({ videoRef, videoSrc }) => {
  const { analysisData, isAudioReady } = useAVAnalysis(videoRef, videoSrc);
  const [zoomedDock, setZoomedDock] = useState<ZoomedDock | null>(null);

  const openZoom = useCallback((dock: ZoomedDock) => () => {
    setZoomedDock(dock);
  }, []);

  const closeZoom = useCallback(() => setZoomedDock(null), []);
  useEscapeToClose(zoomedDock !== null, closeZoom);
  const stopPropagation = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  const renderZoomedContent = useCallback(() => {
    switch (zoomedDock) {
      case 'rgbParade':
        return <RgbParade pixelData={analysisData.video} isZoomed />;
      case 'waveform':
        return <Waveform pixelData={analysisData.video} isZoomed />;
      case 'spectrogram':
        return <Spectrogram frequencyData={analysisData.frequency} isReady={isAudioReady} />;
      case 'vuMeter':
        return (
          <div className="w-full h-full flex justify-center items-center p-4">
            <div className="h-full w-40">
              <VuMeter volume={analysisData.volume} isReady={isAudioReady} />
            </div>
          </div>
        );
      default:
        return null;
    }
  }, [zoomedDock, analysisData, isAudioReady]);

  // Fullscreen zoom overlay lives on document.body so dock CSS contexts
  // (backdrop-blur/transform ancestors) can't clip or offset it.
  const zoomModal =
    zoomedDock === null ? null : createPortal(
      <div
        className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8 animate-fade-in-fast"
        onClick={closeZoom}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="relative w-full h-full max-w-5xl bg-surface border border-hairline rounded-lg shadow-pop flex flex-col p-4 animate-fade-in-fast"
          onClick={stopPropagation}
          role="document"
          aria-label={`${ZOOM_TITLES[zoomedDock]} zoom`}
        >
          <header className="flex-shrink-0 flex justify-between items-center pb-2 mb-2 border-b border-hairline">
            <h2 className="text-lg font-bold">{ZOOM_TITLES[zoomedDock]}</h2>
            <button
              onClick={closeZoom}
              className="p-2 rounded-full text-ink-secondary hover:bg-white/5 hover:text-ink transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Close"
            >
              <XIcon className="w-6 h-6" />
            </button>
          </header>
          <div className="flex-1 min-h-0">
            {renderZoomedContent()}
          </div>
        </div>
      </div>,
      document.body
    );

  return (
    <>
      <div className="h-32 flex-shrink-0 flex gap-4">
        <div className="flex-1">
          <Dock title="RGB Parade" onZoom={openZoom('rgbParade')}>
            <RgbParade pixelData={analysisData.video} />
          </Dock>
        </div>
        <div className="flex-1">
          <Dock title="Waveform" onZoom={openZoom('waveform')}>
            <Waveform pixelData={analysisData.video} />
          </Dock>
        </div>
        <div className="flex-1">
          <Dock title="Spectrogram" onZoom={openZoom('spectrogram')}>
            <Spectrogram frequencyData={analysisData.frequency} isReady={isAudioReady} />
          </Dock>
        </div>
        <VuMeter volume={analysisData.volume} isReady={isAudioReady} onZoom={openZoom('vuMeter')} />
      </div>
      {zoomModal}
    </>
  );
};

export default memo(LiveMonitors);

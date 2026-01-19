import React, { forwardRef, useRef, useState, useEffect, useCallback } from 'react';
import { OverlaySettings } from '../types';
import Crosshair from './Crosshair';
import { PlayIcon, PauseIcon, VolumeHighIcon, VolumeMediumIcon, VolumeLowIcon, VolumeMuteIcon, FullscreenIcon, ExitFullscreenIcon, XIcon, Replay5Icon, Forward5Icon } from './icons';
import { useAudioWaveform } from '../../hooks/useAudioWaveform';
import WaveformTimeline from './WaveformTimeline';
import { useWaveformCache } from '../../contexts/WaveformCacheContext';

// Import SVGs as URLs
import tetoPresencialUrl from './svg/Teto Presencial.svg';
import tetoHomeUrl from './svg/Teto Home.svg';

interface VideoPlayerProps {
  src: string | null;
  videoId: string | null;
  title: string;
  overlaySettings: OverlaySettings;
  setOverlaySettings: React.Dispatch<React.SetStateAction<OverlaySettings>>;
  isLoading?: boolean;
  errorMessage?: string | null;
  children?: React.ReactNode;
  onRetry?: () => void;
  onClose?: () => void;
}

const formatTime = (totalSeconds: number): string => {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const usePrevious = <T,>(value: T): T | undefined => {
    const ref = useRef<T | undefined>(undefined);
    useEffect(() => {
        ref.current = value;
    }, [value]);
    return ref.current;
};


const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(
  ({ src, videoId, title, overlaySettings, setOverlaySettings, isLoading: isMediaLoading, errorMessage, children, onRetry, onClose }, ref) => {
    const internalVideoRef = ref as React.RefObject<HTMLVideoElement>;
    const containerRef = useRef<HTMLDivElement>(null);
    const controlsTimeoutRef = useRef<number | null>(null);

    // Controls State
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isControlsVisible, setIsControlsVisible] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const { waveform, isLoading: isWaveformLoading } = useAudioWaveform(src, videoId);
    const { addCachedId } = useWaveformCache();
    const wasWaveformLoading = usePrevious(isWaveformLoading);
    
    useEffect(() => {
        if (wasWaveformLoading && !isWaveformLoading && videoId && waveform.length > 0) {
            addCachedId(videoId);
        }
    }, [isWaveformLoading, wasWaveformLoading, videoId, waveform, addCachedId]);

    // Visibility Logic
    const showControlsAndStartTimer = useCallback(() => {
        setIsControlsVisible(true);
        if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
        }
        if (isPlaying) {
            controlsTimeoutRef.current = window.setTimeout(() => {
                setIsControlsVisible(false);
            }, 3000);
        }
    }, [isPlaying]);

    // Playback Logic
    const handlePlayPause = useCallback(() => {
        const video = internalVideoRef.current;
        if (!video) return;
        if (isPlaying) {
            video.pause();
        } else {
            video.play();
        }
    }, [isPlaying, internalVideoRef]);

    const handleSeek = useCallback((time: number) => {
        const video = internalVideoRef.current;
        if (!video) return;
        video.currentTime = time;
        setCurrentTime(time);
    }, [internalVideoRef]);
    
    const handleSeekOffset = useCallback((offset: number) => {
        const video = internalVideoRef.current;
        if (!video || !isFinite(video.duration)) return;
        const newTime = video.currentTime + offset;
        video.currentTime = Math.max(0, Math.min(video.duration, newTime));
        showControlsAndStartTimer();
    }, [internalVideoRef, showControlsAndStartTimer]);

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value);
        setVolume(newVolume);
        if (internalVideoRef.current) {
            internalVideoRef.current.volume = newVolume;
            if (newVolume > 0 && isMuted) {
                setIsMuted(false);
                internalVideoRef.current.muted = false;
            }
        }
    };

    const toggleMute = useCallback(() => {
        const video = internalVideoRef.current;
        if (!video) return;
        const newMutedState = !isMuted;
        setIsMuted(newMutedState);
        video.muted = newMutedState;
        if (!newMutedState && volume === 0) {
            setVolume(0.5);
            video.volume = 0.5;
        }
        showControlsAndStartTimer();
    }, [isMuted, volume, internalVideoRef, showControlsAndStartTimer]);
    
    const toggleFullscreen = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        if (!document.fullscreenElement) {
            container.requestFullscreen().catch(err => {
                console.error(`Error enabling fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        container?.addEventListener('mousemove', showControlsAndStartTimer);
        return () => {
            container?.removeEventListener('mousemove', showControlsAndStartTimer);
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        };
    }, [showControlsAndStartTimer]);


    useEffect(() => {
        const video = internalVideoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => setCurrentTime(video.currentTime);
        const handleDurationChange = () => {
            if (isFinite(video.duration)) {
                setDuration(video.duration);
            } else {
                setDuration(0);
            }
        };
        
        const handlePlay = () => {
            setIsPlaying(true);
            showControlsAndStartTimer();
        };

        const handlePause = () => {
            setIsPlaying(false);
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current);
            }
            setIsControlsVisible(true);
        };

        const handleVolumeChange = () => {
            setVolume(video.volume);
            setIsMuted(video.muted);
        };
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('durationchange', handleDurationChange);
        video.addEventListener('loadedmetadata', handleDurationChange);
        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('volumechange', handleVolumeChange);
        document.addEventListener('fullscreenchange', handleFullscreenChange);

        handleDurationChange();
        handleVolumeChange();
        handleFullscreenChange();
        if (video.paused) {
            handlePause();
        } else {
            handlePlay();
        }
        
        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('durationchange', handleDurationChange);
            video.removeEventListener('loadedmetadata', handleDurationChange);
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('volumechange', handleVolumeChange);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, [src, internalVideoRef, showControlsAndStartTimer]);
    
    // Shortcuts
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
                return;
            }

            if (['ArrowLeft', 'ArrowRight', ' ', 'f', 'm'].includes(e.key)) {
                e.preventDefault();
            }

            switch (e.key) {
                case ' ':
                    handlePlayPause();
                    break;
                case 'ArrowLeft':
                    handleSeekOffset(-5);
                    break;
                case 'ArrowRight':
                    handleSeekOffset(5);
                    break;
                case 'f':
                    toggleFullscreen();
                    break;
                case 'm':
                    toggleMute();
                    break;
            }
        };

        container.addEventListener('keydown', handleKeyDown);
        return () => container.removeEventListener('keydown', handleKeyDown);
    }, [handlePlayPause, handleSeekOffset, toggleFullscreen, toggleMute]);

    const VolumeIcon = () => {
        if (isMuted || volume === 0) return <VolumeMuteIcon className="w-6 h-6" />;
        if (volume < 0.33) return <VolumeLowIcon className="w-6 h-6" />;
        if (volume < 0.66) return <VolumeMediumIcon className="w-6 h-6" />;
        return <VolumeHighIcon className="w-6 h-6" />;
    };

    const renderOverlay = () => {
      if (overlaySettings.type === 'none') return null;

      const style: React.CSSProperties = {
        opacity: overlaySettings.opacity,
      };

      if (overlaySettings.type === 'grid') {
        const numLines = 15; 
        return (
          <div className="absolute inset-0 pointer-events-none" style={style}>
            {Array.from({ length: numLines }).map((_, i) => (
              <div
                key={`v-${i}`}
                className="absolute top-0 bottom-0 w-px bg-white/50"
                style={{ left: `${((i + 1) / 16) * 100}%` }}
              ></div>
            ))}
            {Array.from({ length: numLines }).map((_, i) => (
              <div
                key={`h-${i}`}
                className="absolute left-0 right-0 h-px bg-white/50"
                style={{ top: `${((i + 1) / 16) * 100}%` }}
              ></div>
            ))}
          </div>
        );
      }
      
      if (overlaySettings.type === 'onsite' || overlaySettings.type === 'homestudio') {
        const imageUrl = overlaySettings.type === 'onsite' 
            ? tetoPresencialUrl
            : tetoHomeUrl;
        
        return (
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{ ...style, backgroundImage: `url("${imageUrl}")`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }}
          />
        );
      }

      if (overlaySettings.type === 'crosshair') {
        return (
          <Crosshair 
            settings={overlaySettings}
            setSettings={setOverlaySettings}
            containerRef={containerRef}
          />
        )
      }

      return null;
    };

    return (
      <div ref={containerRef} tabIndex={0} className="w-full h-full relative bg-black flex items-center justify-center rounded-lg group overflow-hidden focus:outline-none">
        {src && onClose && (
            <button
                onClick={onClose}
                className="absolute top-2 right-2 z-20 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-all opacity-0 group-hover:opacity-100"
                title="Close Media"
                aria-label="Close Media"
            >
                <XIcon className="w-4 h-4" />
            </button>
        )}
        <video
          key={src}
          ref={ref}
          src={src || ''}
          crossOrigin="anonymous"
          className="w-full h-full object-contain"
          title={title}
          style={{ visibility: isMediaLoading || errorMessage || !src ? 'hidden' : 'visible' }}
          onClick={handlePlayPause}
          onDoubleClick={toggleFullscreen}
        />

        {/* Custom Controls UI */}
        <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-4 text-white transition-opacity duration-300 ${isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <WaveformTimeline
                duration={duration}
                currentTime={currentTime}
                onSeek={handleSeek}
                waveform={waveform}
                isLoading={isWaveformLoading}
            />
            <div className="flex justify-between items-center mt-2">
                <div className="flex items-center gap-2 sm:gap-4">
                    <button onClick={() => handleSeekOffset(-5)} title="Back 5s (Left Arrow)" className="p-1 rounded-full hover:bg-white/10 transition-colors">
                        <Replay5Icon className="w-7 h-7"/>
                    </button>
                    <button onClick={handlePlayPause} title={isPlaying ? "Pause (Space)" : "Play (Space)"} className="p-1 rounded-full hover:bg-white/10 transition-colors">
                        {isPlaying ? <PauseIcon className="w-8 h-8"/> : <PlayIcon className="w-8 h-8"/>}
                    </button>
                     <button onClick={() => handleSeekOffset(5)} title="Forward 5s (Right Arrow)" className="p-1 rounded-full hover:bg-white/10 transition-colors">
                        <Forward5Icon className="w-7 h-7"/>
                    </button>
                    <div className="flex items-center gap-2 group/volume">
                         <button onClick={toggleMute} title="Mute (m)"><VolumeIcon /></button>
                         <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={isMuted ? 0 : volume}
                            onChange={handleVolumeChange}
                            className="w-0 sm:w-24 h-1 accent-white cursor-pointer opacity-0 group-hover/volume:opacity-100 group-hover/volume:w-24 transition-all duration-300"
                         />
                    </div>
                    <span className="font-mono text-sm">{formatTime(currentTime)} / {formatTime(duration)}</span>
                </div>
                <button onClick={toggleFullscreen} title="Fullscreen (f)" className="p-1 rounded-full hover:bg-white/10 transition-colors">
                    {isFullscreen ? <ExitFullscreenIcon className="w-7 h-7" /> : <FullscreenIcon className="w-7 h-7" />}
                </button>
            </div>
        </div>

        {isMediaLoading && (
            <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center text-gray-400 pointer-events-none p-8 text-center">
                <div className="w-8 h-8 border-4 border-solar-accent border-t-transparent rounded-full animate-spin"></div>
                <p className="mt-4 truncate max-w-full">{title}</p>
            </div>
        )}
        {errorMessage && (
             <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center text-gray-400 p-8 text-center">
                <p className="font-semibold text-lg text-red-400 mb-2">Media Error</p>
                <p className="mb-4 max-w-md">{errorMessage}</p>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="px-4 py-2 bg-solar-accent text-white rounded-md hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-bg focus:ring-solar-accent"
                  >
                    Retry
                  </button>
                )}
            </div>
        )}
        {!src && !isMediaLoading && !errorMessage && children}
        {renderOverlay()}
      </div>
    );
  }
);

VideoPlayer.displayName = "VideoPlayer";

export default VideoPlayer;
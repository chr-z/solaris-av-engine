import React, { forwardRef, useRef, useState, useEffect, useCallback } from 'react';
import { OverlaySettings, Timestamp } from '../../types';
import Crosshair from '../Monitors/Crosshair';
import { PlayIcon, PauseIcon, VolumeHighIcon, VolumeMediumIcon, VolumeLowIcon, VolumeMuteIcon, FullscreenIcon, ExitFullscreenIcon, XIcon, Replay5Icon, Forward5Icon } from '../Core/icons';
import { useAudioWaveform } from '../../hooks/useAudioWaveform';
import WaveformTimeline from '../Monitors/WaveformTimeline';
import { useWaveformCache } from '../../contexts/WaveformCacheContext';
import { useI18n } from '../../i18n/I18nContext';
import { pulseShuttle, formatRate, SHUTTLE_RATES, INITIAL_SHUTTLE_STATE } from '../../features/qol/shuttle';
// F2 QoL A2: conforto do playback — pular silêncios + volume normalize leve.
import { useMediaComfort } from '../../features/qol/useMediaComfort';
import MediaComfortToggle from '../Layout/MediaComfortToggle';
import { humanizeError } from '../../utils/humanErrors';

// Import SVGs as URLs
import tetoPresencialUrl from '../svg/homestudio.svg';
import tetoHomeUrl from '../svg/homestudio.svg';

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
  /** S5.1: imperative handle for the global analyst shortcut layer. */
  registerPlayerControls?: (controls: {
    togglePlay: () => void;
    seekBy: (seconds: number) => void;
    seekToStart: () => void;
    /** F2 QoL: seek absoluto (retomada de posição do auto-save). */
    seekTo?: (seconds: number) => void;
    changeVolume: (delta: number) => void;
  }) => () => void;
  /** S5.2: transport telemetry for the A/B compare follower pane. */
  onTransport?: (state: { time: number; playing: boolean; duration: number }) => void;
  /** R3 v3: time markers rendered as stackable pins on the waveform timeline. */
  markers?: Timestamp[];
  /** R3 v3: click on a marker pin (defaults to seeking to the marker time). */
  onMarkerSelect?: (time: number) => void;
}

const formatTime = (totalSeconds: number): string => {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};


const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(
  ({ src, videoId, title, overlaySettings, setOverlaySettings, isLoading: isMediaLoading, errorMessage, children, onRetry, onClose, registerPlayerControls, onTransport, markers, onMarkerSelect }, ref) => {
    const { t } = useI18n();
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
    // A2 QoL: shuttle adaptativo (cada pulso mesma direção sobe/desce degrau).
    const [shuttleState, setShuttleState] = useState(INITIAL_SHUTTLE_STATE);

    const { waveform, peakDbfs, isLoading: isWaveformLoading } = useAudioWaveform(src, videoId);
    // Waveform cache bookkeeping: when the waveform just finished loading
    // (loading → loaded transition), register the id in the shared cache.
    // Tracked via an effect-updated ref instead of render-time reads.
    const wasWaveformLoadingRef = useRef(false);
    const { addCachedId } = useWaveformCache();

    useEffect(() => {
        const wasLoading = wasWaveformLoadingRef.current;
        if (wasLoading && !isWaveformLoading && videoId && waveform.length > 0) {
            addCachedId(videoId);
        }
        wasWaveformLoadingRef.current = isWaveformLoading;
    }, [isWaveformLoading, videoId, waveform, addCachedId]);

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

    // A2 QoL: conforto do playback (skip silêncio + normalize). O ganho vive
    // no grafo WebAudio do hook — o volume/mute nativos seguem livres pro
    // usuário; o skip é efeito sobre currentTime com seek estável.
    const comfort = useMediaComfort(
        waveform,
        duration,
        currentTime,
        src,
        internalVideoRef,
        handleSeek,
        { peakDbfs },
    );
    
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


    // A2 shuttle: aplica velocidade adaptativa ao vídeo real.
    useEffect(() => {
        const video = internalVideoRef.current;
        if (!video) return;
        const rate = SHUTTLE_RATES[shuttleState.index] ?? 1;
        if (video.playbackRate !== rate) video.playbackRate = rate;
    }, [shuttleState]);

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

    // S5.1: expose player controls to the global analyst shortcut layer.
    useEffect(() => {
        if (!registerPlayerControls) return;
        return registerPlayerControls({
            togglePlay: () => handlePlayPause(),
            seekBy: (seconds: number) => {
                const video = internalVideoRef.current;
                if (!video || !isFinite(video.duration)) return;
                video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
                setCurrentTime(video.currentTime);
                showControlsAndStartTimer();
            },
            seekToStart: () => {
                const video = internalVideoRef.current;
                if (!video) return;
                video.currentTime = 0;
                setCurrentTime(0);
                showControlsAndStartTimer();
            },
            // F2 QoL: seek absoluto p/ retomada da posição salva.
            seekTo: (seconds: number) => {
                const video = internalVideoRef.current;
                if (!video || !isFinite(video.duration)) return;
                video.currentTime = Math.max(0, Math.min(video.duration, seconds));
                setCurrentTime(video.currentTime);
                showControlsAndStartTimer();
            },
            changeVolume: (delta: number) => {
                const video = internalVideoRef.current;
                if (!video) return;
                const next = Math.max(0, Math.min(1, (isMuted ? 0 : video.volume) + delta));
                video.volume = next;
                video.muted = next === 0;
                showControlsAndStartTimer();
            },
        });
    }, [registerPlayerControls, handlePlayPause, internalVideoRef, isMuted, showControlsAndStartTimer]);

    // S5.2: emit transport telemetry (time/play/duration) so the compare
    // follower can stay in lockstep. Callback mirrored in a ref inside an
    // effect; the listener binds once per src change.
    const onTransportRef = useRef(onTransport);
    useEffect(() => {
        onTransportRef.current = onTransport;
    });

    useEffect(() => {
        if (!onTransportRef.current) return;
        const video = internalVideoRef.current;
        if (!video) return;

        let lastPlaying = false;
        let lastTime = -1;

        const emit = () => {
            onTransportRef.current?.({
                time: video.currentTime,
                playing: !video.paused && !video.ended,
                duration: Number.isFinite(video.duration) ? video.duration : 0,
            });
        };

        const handleTimeUpdate = () => {
            // Throttle: only forward when the second decimal actually moved.
            if (Math.abs(video.currentTime - lastTime) >= 0.05) {
                lastTime = video.currentTime;
                emit();
            }
        };
        const handlePlayState = () => {
            const playing = !video.paused && !video.ended;
            if (playing !== lastPlaying) {
                lastPlaying = playing;
                emit();
            }
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('play', handlePlayState);
        video.addEventListener('playing', handlePlayState);
        video.addEventListener('pause', handlePlayState);
        video.addEventListener('ended', handlePlayState);
        video.addEventListener('seeked', emit);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('play', handlePlayState);
            video.removeEventListener('playing', handlePlayState);
            video.removeEventListener('pause', handlePlayState);
            video.removeEventListener('ended', handlePlayState);
            video.removeEventListener('seeked', emit);
        };
    }, [src, internalVideoRef]);

    // Render function, not a component (react-hooks/static-components):
    // returns fresh JSX without remounting state on each render.
    const renderVolumeIcon = () => {
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
        <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-4 text-white transition-opacity duration-150 ${isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <WaveformTimeline
                duration={duration}
                currentTime={currentTime}
                onSeek={handleSeek}
                waveform={waveform}
                isLoading={isWaveformLoading}
                markers={markers}
                onMarkerSelect={onMarkerSelect}
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
                         <button onClick={toggleMute} title="Mute (m)" aria-label={t('shortcuts.mute.description')}>{renderVolumeIcon()}</button>
                         <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={isMuted ? 0 : volume}
                            onChange={handleVolumeChange}
                            aria-label={t('workspace.volume')} className="w-0 sm:w-24 h-1 accent-white cursor-pointer opacity-0 group-hover/volume:opacity-100 group-hover/volume:w-24 transition-all duration-150"
                         />
                    </div>
                    <div className="flex flex-shrink-0 flex items-center gap-1.5 text-[11px] mx-1 bg-black/40 rounded-full px-2 py-0.5 select-none ring-1 ring-white/10">
                <span className="opacity-70">S</span>
                <button
                  onClick={() => setShuttleState(s => pulseShuttle(s, 'down'))}
                  title="S < — diminui ritmo (A2 shuttle)"
                  aria-label="A2: diminuir ritmo do shuttle"
                  className="hover:text-amber-300 focus-visible:ring-1 focus-visible:ring-amber-300 px-0.5 transition-colors font-bold text-xs leading-none"
                >−</button>
                <button
                  onClick={() => setShuttleState(s => pulseShuttle(s, 'up'))}
                  title="S > — acelera ritmo (A2 shuttle)"
                  aria-label="A2: aumentar ritmo do shuttle"
                  className="hover:text-amber-300 focus-visible:ring-1 focus-visible:ring-amber-300 px-0.5 transition-colors font-bold text-xs leading-none"
                >+</button>
                <span className="font-mono text-xs tabular-nums min-w-[1.75rem] text-center text-white" aria-live="polite">
                  {formatRate(SHUTTLE_RATES[shuttleState.index] || 1)}
                </span>
              </div>
              {/* A2 QoL: conforto do playback (skip silêncio / normalize). */}
              <MediaComfortToggle api={comfort} />
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
        {errorMessage && (() => {
            const he = humanizeError(errorMessage);
            return (
                <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center text-ink-secondary p-8 text-center">
                    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true" className="mb-3">
                        <rect x="8" y="12" width="40" height="28" rx="5" stroke="var(--color-border-strong)" strokeWidth="1.5" />
                        <path d="M25 22l10 6-10 6v-12z" fill="var(--color-fail)" opacity="0.85" />
                        <path d="M16 48h24" stroke="var(--color-border-strong)" strokeWidth="1.5" strokeLinecap="round" />
                        <circle cx="44" cy="18" r="9" fill="var(--color-bg)" stroke="var(--color-fail)" strokeWidth="1.5" />
                        <path d="M44 13.5v5.5M44 22.2v.4" stroke="var(--color-fail)" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                    {/* Erro humano: nunca a mensagem crua (spec v3) */}
                    <p className="font-semibold text-lg text-fail mb-1">{he.title}</p>
                    <p className="mb-4 max-w-md">{he.hint}</p>
                    {onRetry && (
                      <button
                        onClick={onRetry}
                        className="btn-primary px-4 py-2 rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                      >
                        Retry
                      </button>
                    )}
                </div>
            );
        })()}        {!src && !isMediaLoading && !errorMessage && children}
        {renderOverlay()}
      </div>
    );
  }
);

VideoPlayer.displayName = "VideoPlayer";

export default VideoPlayer;
import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { Timestamp } from '../../types';
import {
    layoutTimelinePins,
    rulerStepSeconds,
} from '../../utils/timelineLayout';


interface WaveformTimelineProps {
    duration: number;
    currentTime: number;
    onSeek: (time: number) => void;
    waveform: number[];
    isLoading: boolean;
    /** R3 v3: marcadores de tempo (pins empilháveis com tooltip rico). */
    markers?: Timestamp[];
    /** Clique num pin: normalmente busca o vídeo pro tempo do marcador. */
    onMarkerSelect?: (time: number) => void;
}

const normalizedPeakToDb = (peak: number): string => {
    if (peak <= 0) return '-∞ dB';
    const db = 20 * Math.log10(peak);
    return `${db.toFixed(1)} dB`;
};

/**
 * Cor do pico preserva as semânticas funcionais do MVP (vermelho=clip,
 * amarelo=quente); o resto ganha o gradiente accent da marca com opacidade
 * pela amplitude — o "gradiente de opacidade" da spec.
 */
const peakStyle = (peak: number): React.CSSProperties => {
    if (peak >= 0.99) return { backgroundColor: 'var(--color-fail)' };
    if (peak >= 0.794) return { backgroundColor: 'var(--color-warn)' };
    if (peak < 0.316) return { backgroundColor: 'rgba(230, 234, 242, 0.14)' };
    return {
        backgroundImage: 'var(--gradient-accent)',
        opacity: 0.45 + Math.min(1, peak) * 0.55,
    };
};

const formatClock = (totalSeconds: number): string => {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const PIN_TIP = 8; // px — altura visual do pino abaixo do ponto

const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
    duration,
    currentTime,
    onSeek,
    waveform,
    isLoading,
    markers = [],
    onMarkerSelect,
}) => {
    const timelineRef = useRef<HTMLDivElement>(null);
    const [isSeeking, setIsSeeking] = useState(false);
    const [hoverPosition, setHoverPosition] = useState<number | null>(null);
    const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);

    const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!timelineRef.current || !duration) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        onSeek(pos * duration);
    }, [duration, onSeek]);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        setIsSeeking(true);
        handleSeek(e);
    };

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!timelineRef.current || !duration) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        setHoverPosition(pos);
    }, [duration]);

    const handleMouseLeave = useCallback(() => {
        setHoverPosition(null);
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isSeeking && timelineRef.current && duration) {
                 const rect = timelineRef.current.getBoundingClientRect();
                 const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                 onSeek(pos * duration);
            }
        };

        const handleMouseUp = () => {
            setIsSeeking(false);
        };

        if (isSeeking) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

    }, [isSeeking, duration, onSeek]);

    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
    const hoverIndex = hoverPosition !== null ? Math.floor(hoverPosition * waveform.length) : -1;
    const hoverPeak = hoverIndex >= 0 && waveform[hoverIndex] !== undefined ? waveform[hoverIndex] : null;

    // Pins empilhados (puro, testado) + régua com passo "bonito".
    const laidOutMarkers = useMemo(
        () => layoutTimelinePins(markers, duration, 600),
        [markers, duration],
    );
    const markerById = useMemo(
        () => new Map(markers.map((m) => [m.id, m])),
        [markers],
    );
    const step = useMemo(() => rulerStepSeconds(duration), [duration]);
    const ticks = useMemo(() => {
        const list: number[] = [];
        if (duration > 0) {
            for (let s = step; s < duration; s += step) list.push(s);
        }
        return list;
    }, [duration, step]);
    const showTickLabels = step >= 15;

    return (
        <div className="w-full cursor-pointer group select-none">
            {/* Zona de pins (empilháveis) + tooltip rico */}
            {laidOutMarkers.length > 0 && (
                <div className="relative h-5 mb-0.5">
                    {laidOutMarkers.map((pin) => {
                        const ts = markerById.get(pin.id);
                        if (!ts) return null;
                        const isHovered = hoveredMarkerId === pin.id;
                        return (
                            <button
                                key={pin.id}
                                type="button"
                                className="absolute bottom-0 z-10 p-1 -translate-x-1/2 focus:outline-none"
                                style={{ left: `${pin.position * 100}%` }}
                                onMouseEnter={() => setHoveredMarkerId(pin.id)}
                                onMouseLeave={() => setHoveredMarkerId(null)}
                                onFocus={() => setHoveredMarkerId(pin.id)}
                                onBlur={() => setHoveredMarkerId(null)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onMarkerSelect?.(ts.time);
                                }}
                                aria-label={`Time marker ${formatClock(ts.time)}: ${ts.comment}`}
                            >
                                <span
                                    className={`block w-2 h-2 rounded-full border transition-transform duration-150 ${isHovered ? 'scale-150' : ''}`}
                                    style={{
                                        backgroundColor: 'var(--color-info)',
                                        borderColor: 'rgba(8, 12, 20, 0.9)',
                                        boxShadow: isHovered
                                            ? '0 0 0 2px var(--color-accent-glow)'
                                            : 'none',
                                        marginBottom: -PIN_TIP / 2,
                                        clipPath: 'polygon(50% 100%, 0 35%, 15% 0, 85% 0, 100% 35%)',
                                    }}
                                />
                            </button>
                        );
                    })}

                    {/* Tooltip rico do pin em hover/foco */}
                    {hoveredMarkerId && markerById.get(hoveredMarkerId) && (() => {
                        const ts = markerById.get(hoveredMarkerId)!;
                        const pinPos =
                            laidOutMarkers.find((p) => p.id === hoveredMarkerId)?.position ?? 0;
                        return (
                            <div
                                className="absolute bottom-full mb-1 -translate-x-1/2 pointer-events-none z-20 tooltip-rich"
                                style={{
                                    left: `${Math.min(92, Math.max(8, pinPos * 100))}%`,
                                    minWidth: '160px',
                                }}
                            >
                                <div className="tooltip-title font-mono">
                                    {formatClock(ts.time)}
                                </div>
                                <div>{ts.comment}</div>
                                {ts.analyst?.givenName && (
                                    <div className="mt-1 text-2xs opacity-75">
                                        — {ts.analyst.givenName}
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* Trilha: waveform + playhead */}
            <div
                ref={timelineRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                className="w-full h-9 relative rounded-md overflow-visible bg-black/25 border border-hairline"
                role="presentation"
            >
                {isLoading ? (
                    <div className="absolute inset-x-2 inset-y-1.5 skeleton skeleton-line !h-auto opacity-40" />
                ) : (
                    <div className="absolute inset-0 flex items-end justify-between px-0.5 overflow-hidden rounded-md">
                        {waveform.map((peak, i) => (
                            <div
                                key={i}
                                className="flex-shrink-0 rounded-full will-change-transform"
                                style={{
                                    width: '2px',
                                    height: `${Math.max(5, peak * 100)}%`,
                                    ...peakStyle(peak),
                                }}
                            />
                        ))}
                    </div>
                )}

                {/* Véu sobre a parte não reproduzida (leitura de progresso sem pintar por cima do áudio) */}
                {!isLoading && (
                    <div
                        className="absolute top-0 right-0 h-full pointer-events-none rounded-r-md"
                        style={{
                            left: `${progressPercent}%`,
                            backgroundColor: 'rgba(11, 14, 20, 0.62)',
                        }}

                    />
                )}

                {/* Playhead: linha fina + knob com glow */}
                {!isLoading && (
                    <div
                        className="absolute top-0 bottom-0 pointer-events-none"
                        style={{ left: `${progressPercent}%` }}
                    >
                        <div
                            className="absolute top-0 bottom-0 -translate-x-1/2 w-px"
                            style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
                        />
                        <div
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full border-2 transition-transform duration-150 group-hover:scale-125"
                            style={{
                                borderColor: 'var(--color-accent)',
                                boxShadow: '0 0 8px var(--color-accent-glow)',
                            }}
                        />
                    </div>
                )}

                {/* Hover: linha guia + dB */}
                {hoverPosition !== null && hoverPeak !== null && (
                    <div
                        className="absolute top-0 bottom-0 pointer-events-none"
                        style={{ left: `${hoverPosition * 100}%` }}
                    >
                        <div className="absolute top-0 bottom-0 w-px bg-white/40"></div>
                        <div className="absolute -top-6 -translate-x-1/2 bg-black/80 text-white text-xs font-mono px-1.5 py-0.5 rounded-md shadow-pop border border-hairline whitespace-nowrap">
                            {normalizedPeakToDb(hoverPeak)} · {formatClock(hoverPosition * duration)}
                        </div>
                    </div>
                )}
            </div>

            {/* Régua redesenhada */}
            {!isLoading && duration > 0 && (
                <div className="relative h-3 mt-0.5" aria-hidden="true">
                    {ticks.map((s) => (
                        <div
                            key={s}
                            className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
                            style={{ left: `${(s / duration) * 100}%` }}
                        >
                            <div className="w-px h-1" style={{ backgroundColor: 'var(--color-border-strong)' }} />
                            {showTickLabels && (
                                <span className="font-mono text-[9px] leading-none mt-px text-ink-secondary tnum">
                                    {formatClock(s)}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default WaveformTimeline;

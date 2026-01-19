import React, { useRef, useCallback, useState, useEffect } from 'react';

interface WaveformTimelineProps {
    duration: number;
    currentTime: number;
    onSeek: (time: number) => void;
    waveform: number[];
    isLoading: boolean;
}

const getPeakColor = (peak: number): string => {
    // Coloring based on audio levels (approximate dB mapping)
    if (peak >= 0.99) return 'bg-red-500';      // Clipping (~0dB)
    if (peak >= 0.794) return 'bg-yellow-400'; // High (~-2dB)
    if (peak >= 0.447) return 'bg-green-500';   // Nominal (~-7dB)
    if (peak < 0.316) return 'bg-gray-800';   // Silence/Noise floor

    return 'bg-white/30';
};

const normalizedPeakToDb = (peak: number): string => {
    if (peak <= 0) return '-∞ dB';
    const db = 20 * Math.log10(peak);
    return `${db.toFixed(1)} dB`;
};


const WaveformTimeline: React.FC<WaveformTimelineProps> = ({ duration, currentTime, onSeek, waveform, isLoading }) => {
    const timelineRef = useRef<HTMLDivElement>(null);
    const [isSeeking, setIsSeeking] = useState(false);
    const [hoverPosition, setHoverPosition] = useState<number | null>(null);

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

    return (
        <div 
            ref={timelineRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="w-full h-12 cursor-pointer flex items-center group"
        >
            <div className="w-full h-8 relative bg-black/20 rounded-md">
                {/* Waveform Visualization */}
                <div className="absolute inset-0 flex items-end justify-between px-0.5 overflow-hidden">
                    {isLoading ? (
                        <div className="w-full h-full flex items-center justify-center">
                            <div className="w-4 h-4 border-2 border-white/50 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    ) : (
                        waveform.map((peak, i) => (
                            <div
                                key={i}
                                className={`w-[2px] rounded-full ${getPeakColor(peak)}`}
                                style={{ height: `${Math.max(5, peak * 100)}%` }}
                            />
                        ))
                    )}
                </div>

                {/* Playhead Progress */}
                <div 
                    className="absolute top-0 left-0 h-full bg-solar-accent/60 rounded-md"
                    style={{ width: `${progressPercent}%` }}
                />

                {/* Scrubber Knob */}
                <div 
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full transition-transform group-hover:scale-125"
                    style={{ left: `${progressPercent}%` }}
                />

                {/* Hover Tooltip */}
                {hoverPosition !== null && hoverPeak !== null && (
                    <div 
                        className="absolute top-0 bottom-0 pointer-events-none"
                        style={{ left: `${hoverPosition * 100}%` }}
                    >
                        <div className="absolute top-0 bottom-0 w-px bg-white/50"></div>
                        <div className="absolute -top-6 -translate-x-1/2 bg-black/70 text-white text-xs font-mono px-1.5 py-0.5 rounded-md shadow-lg">
                            {normalizedPeakToDb(hoverPeak)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WaveformTimeline;
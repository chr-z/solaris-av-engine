import { useState, useEffect, useRef } from 'react';
import { database } from '../config/firebase';

// Persistent, size-limited cache for waveform data.
export const CACHE_KEY_PREFIX = 'solaris_waveform_cache_';
const MAX_CACHE_ENTRIES = 50; 

interface CacheEntry {
    timestamp: number;
    data: number[];
}

const waveformCache = {
    get: (key: string): number[] | null => {
        try {
            const item = localStorage.getItem(`${CACHE_KEY_PREFIX}${key}`);
            if (!item) return null;
            const entry: CacheEntry = JSON.parse(item);
            return entry.data;
        } catch (error) {
            console.error("Cache Read Error:", error);
            return null;
        }
    },
    set: (key: string, data: number[]) => {
        try {
            const entry: CacheEntry = { timestamp: Date.now(), data };
            localStorage.setItem(`${CACHE_KEY_PREFIX}${key}`, JSON.stringify(entry));
            waveformCache.prune();
        } catch (error) {
            console.error("Cache Write Error (Storage Full?):", error);
            // Handle QuotaExceededError
            if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
                console.warn("Storage quota exceeded. Pruning aggressively...");
                waveformCache.prune(Math.floor(MAX_CACHE_ENTRIES / 2));
                try {
                     const entry: CacheEntry = { timestamp: Date.now(), data };
                    localStorage.setItem(`${CACHE_KEY_PREFIX}${key}`, JSON.stringify(entry));
                } catch (retryError) {
                    console.error("Retry failed:", retryError);
                }
            }
        }
    },
    prune: (targetSize: number = MAX_CACHE_ENTRIES) => {
        try {
            const keys: [string, number][] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith(CACHE_KEY_PREFIX)) {
                    const item = localStorage.getItem(key);
                    if (item) {
                        try {
                            const entry: CacheEntry = JSON.parse(item);
                            keys.push([key, entry.timestamp]);
                        } catch {
                             localStorage.removeItem(key);
                        }
                    }
                }
            }

            if (keys.length > targetSize) {
                // Remove oldest entries
                keys.sort((a, b) => a[1] - b[1]); 
                const keysToRemove = keys.slice(0, keys.length - targetSize);
                keysToRemove.forEach(([key]) => localStorage.removeItem(key));
            }
        } catch (error) {
            console.error("Cache Prune Error:", error);
        }
    }
};

// Singleton AudioContext
let audioContext: AudioContext | null = null;
const getAudioContext = (): AudioContext | null => {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch (e) {
            console.error("Web Audio API not supported.", e);
        }
    }
    return audioContext;
};

/**
 * Decodes AudioBuffer into peak array for visualization.
 * Uses requestAnimationFrame to prevent blocking the main thread during heavy processing.
 */
const processAudioBufferProgressively = async (
    audioBuffer: AudioBuffer,
    onProgress: (peaks: number[]) => void,
    bucketCount: number = 150,
): Promise<number[]> => {
    const rawData = audioBuffer.getChannelData(0);
    const samplesPerBucket = Math.floor(rawData.length / bucketCount);
    const peaks = new Array(bucketCount).fill(0);
    
    let maxPeakOverall = 0;
    const tempPeaks: number[] = [];

    // Pass 1: Find absolute peaks
    for (let i = 0; i < bucketCount; i++) {
        const start = i * samplesPerBucket;
        const end = start + samplesPerBucket;
        let maxPeakInBucket = 0;
        for (let j = start; j < end; j++) {
            const peak = Math.abs(rawData[j]);
            if (peak > maxPeakInBucket) maxPeakInBucket = peak;
        }
        tempPeaks.push(maxPeakInBucket);
        if (maxPeakInBucket > maxPeakOverall) maxPeakOverall = maxPeakInBucket;
    }

    // Pass 2: Normalize and update UI
    let lastUpdateTime = 0;
    for (let i = 0; i < bucketCount; i++) {
        peaks[i] = maxPeakOverall > 0 ? tempPeaks[i] / maxPeakOverall : 0;
        
        // Throttle updates to ~60fps
        const now = performance.now();
        if (now - lastUpdateTime > 16) {
            onProgress([...peaks]);
            lastUpdateTime = now;
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }

    onProgress([...peaks]);
    return peaks;
};

export const useAudioWaveform = (src: string | null, videoId: string | null) => {
    const [waveform, setWaveform] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        if (!src || !videoId) {
            setWaveform([]);
            setIsLoading(false);
            setError(null);
            return;
        }
        
        // Strategy 1: Local Browser Cache (Fastest)
        const localCacheKey = videoId;
        const cachedWaveform = waveformCache.get(localCacheKey);
        if (cachedWaveform) {
            setWaveform(cachedWaveform);
            setIsLoading(false);
            setError(null);
            return;
        }

        const generateWaveform = async () => {
            setIsLoading(true);
            setError(null);

            // Strategy 2: Firebase Distributed Cache (Shared)
            try {
                const dbRef = database.ref(`waveforms/${videoId}`);
                const snapshot = await dbRef.get();
                if (snapshot.exists()) {
                    const firebaseData = snapshot.val();
                    if (Array.isArray(firebaseData)) {
                        setWaveform(firebaseData);
                        waveformCache.set(localCacheKey, firebaseData);
                        setIsLoading(false);
                        return;
                    }
                }
            } catch (dbError) {
                console.warn("Firebase cache miss/error, generating from source.", dbError);
            }

            // Strategy 3: Compute from Source (Slowest)
            const context = getAudioContext();
            if (!context) {
                setError("Browser audio processing not supported.");
                setIsLoading(false);
                return;
            }
            if (context.state === 'suspended') await context.resume();

            try {
                const response = await fetch(src, { signal });
                if (!response.ok) {
                    let errorMessage = `HTTP Error: ${response.status}`;
                    try {
                        const errorJson = await response.json();
                        errorMessage = errorJson.error || errorMessage;
                    } catch {}
                    throw new Error(errorMessage);
                }
                
                const contentType = response.headers.get('content-type');
                if (contentType && (contentType.includes('application/json') || contentType.includes('text/html'))) {
                    throw new Error("Invalid media content type. Proxy may require authentication.");
                }

                const arrayBuffer = await response.arrayBuffer();
                if (signal.aborted) return;
                
                const audioBuffer = await context.decodeAudioData(arrayBuffer);
                if (signal.aborted) return;

                setIsLoading(false);

                const finalPeaks = await processAudioBufferProgressively(audioBuffer, (progressPeaks) => {
                    if (!signal.aborted) setWaveform(progressPeaks);
                });
                
                if (!signal.aborted) {
                    waveformCache.set(localCacheKey, finalPeaks);
                    // Async cache write to DB
                    database.ref(`waveforms/${videoId}`).set(finalPeaks)
                        .catch(err => console.error("Firebase cache write failed:", err));
                }

            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    console.error("Waveform generation failed:", err);
                    setError(err.message || "Could not process audio source.");
                    setIsLoading(false);
                }
            }
        };

        generateWaveform();
        
        return () => {
             if (abortControllerRef.current) abortControllerRef.current.abort();
        };

    }, [src, videoId]);

    return { waveform, isLoading, error };
};
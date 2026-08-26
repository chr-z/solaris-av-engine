import React, { createContext, useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { CACHE_KEY_PREFIX } from '../hooks/useAudioWaveform';

interface WaveformCacheContextType {
    cachedVideoIds: Set<string>;
    addCachedId: (id: string) => void;
    isLoading: boolean;
}

const DEFAULT_VALUE: WaveformCacheContextType = {
    cachedVideoIds: new Set(),
    addCachedId: () => {},
    isLoading: true,
};

const WaveformCacheContext = createContext<WaveformCacheContextType>(DEFAULT_VALUE);

export const useWaveformCache = () => useContext(WaveformCacheContext);

export const WaveformCacheProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [cachedVideoIds, setCachedVideoIds] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchInitialCacheState = async () => {
            setIsLoading(true);
            try {
                // Determine which videos have cached waveforms stored locally.
                // This allows the UI to display "pre-cached" indicators instantly without querying the database.
                const localKeys: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key?.startsWith(CACHE_KEY_PREFIX)) {
                        localKeys.push(key.substring(CACHE_KEY_PREFIX.length));
                    }
                }
                
                setCachedVideoIds(new Set(localKeys));
            } catch (error) {
                console.error("Failed to initialize waveform cache state from localStorage:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchInitialCacheState();
    }, []);

    const addCachedId = useCallback((id: string) => {
        setCachedVideoIds(prev => {
            if (prev.has(id)) {
                return prev;
            }
            const newSet = new Set(prev);
            newSet.add(id);
            return newSet;
        });
    }, []);

    // Stable context value: a new object identity is emitted ONLY when the
    // cached-id set or the loading flag actually changes. Without this memo,
    // every provider render (including parent-driven ones) produced a fresh
    // value object and re-rendered ALL consumers down the tree, defeating
    // React.memo on AnalysisSheet/VideoPlayer/DriveFilePicker.
    const value = useMemo<WaveformCacheContextType>(
        () => ({ cachedVideoIds, addCachedId, isLoading }),
        [cachedVideoIds, addCachedId, isLoading]
    );

    return (
        <WaveformCacheContext.Provider value={value}>
            {children}
        </WaveformCacheContext.Provider>
    );
};

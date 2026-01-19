import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { CACHE_KEY_PREFIX } from '../hooks/useAudioWaveform';

interface WaveformCacheContextType {
    cachedVideoIds: Set<string>;
    addCachedId: (id: string) => void;
    isLoading: boolean;
}

const WaveformCacheContext = createContext<WaveformCacheContextType>({
    cachedVideoIds: new Set(),
    addCachedId: () => {},
    isLoading: true,
});

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

    const value = { cachedVideoIds, addCachedId, isLoading };

    return (
        <WaveformCacheContext.Provider value={value}>
            {children}
        </WaveformCacheContext.Provider>
    );
};
import React, { useState, useEffect, useCallback, memo } from 'react';
import { SearchIcon, LinkIcon, ChevronDownIcon, FilterIcon, RefreshIcon, XIcon, WaveformIcon } from '../Core/icons';
import LoadingIndicator from '../Core/LoadingIndicator';
import Popover from '../Core/Popover';
import FilterControls, { FilterState } from './FilterControls';
import { database } from '../../config/firebase';
import { UserProfile } from '../../types';
import UserAvatar from '../Auth/UserAvatar';
import { useWaveformCache } from '../../contexts/WaveformCacheContext';
import { getVideoIdFromUrl } from '../../utils/videoUtils';

declare const gapi: any;

type CellData = {
    value: string;
    link?: string;
};
export type RowData = CellData[];

export interface RowWithSheetIndex {
  rowIndex: number;
  row: RowData;
}

export interface DriveFile {
    id: string;
    name: string;
    iconLink: string;
    webContentLink?: string;
}

type LockInfo = { user: UserProfile, timestamp: number };

interface AnalysisSheetListProps {
  onRowSelected: (rowIndex: number, row: RowData) => void;
  onDataLoaded: (headers: string[], rows: RowWithSheetIndex[]) => void;
  selectedOsIndex: number | null;
  userProfile: UserProfile | null;
  headers: string[];
  filteredPendingRows: RowWithSheetIndex[];
  filteredCompletedRows: RowWithSheetIndex[];
  filteredSpecialRows: RowWithSheetIndex[];
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
}

export const fetchFullRowData = async (rowIndex: number): Promise<RowData> => {
    const response = await fetch(`/api/sheet-row?rowIndex=${rowIndex}`);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch row data.' }));
        throw new Error(errorData.error || 'Unknown server error.');
    }
    return response.json();
};

export const updateSheetRow = async (rowIndex: number, rowData: RowData): Promise<any> => {
    const token = gapi.client.getToken()?.access_token;
    if (!token) {
      throw new Error("User not authenticated. Please sign in again.");
    }
    const response = await fetch('/api/sheet-row', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ rowIndex, rowData }),
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to save data.' }));
        throw new Error(errorData.error || 'Unknown server error.');
    }
    return response.json();
};

type RowWithIndex = RowWithSheetIndex;

// --- ListItem Component (Memoized) ---
interface ListItemProps extends RowWithIndex {
    headers: string[];
    isSelected: boolean;
    onClick: (index: number, row: RowData) => void;
    lockInfo?: LockInfo | null;
    isLockedByCurrentUser: boolean;
}

const ListItem: React.FC<ListItemProps> = memo(({ row, rowIndex, headers, isSelected, onClick, lockInfo, isLockedByCurrentUser }) => {
    const { cachedVideoIds } = useWaveformCache();
    const [hasCachedWaveform, setHasCachedWaveform] = useState(false);

    // Using new English Headers
    const osCell = row[headers.indexOf('W.O.')];
    const professorCell = row[headers.indexOf('INSTRUCTOR')];
    const dataCell = row[headers.indexOf('DATE')];
    const estudioCell = row[headers.indexOf('STUDIO')];
    const finalCell = row[headers.indexOf('FINAL SCORE')];
    
    const infoParts = [estudioCell?.value, dataCell?.value].filter(Boolean);
    const isLockedByOther = lockInfo && !isLockedByCurrentUser;

    useEffect(() => {
        const osLink = row[headers.indexOf('W.O.')]?.link;
        const operatorLink = row[headers.indexOf('OPERATOR')]?.link;
        const potentialLinks = [osLink, operatorLink].filter(Boolean);

        let found = false;
        for (const link of potentialLinks) {
            const videoId = getVideoIdFromUrl(link!);
            if (videoId && cachedVideoIds.has(videoId)) {
                found = true;
                break;
            }
        }
        setHasCachedWaveform(found);
    }, [cachedVideoIds, row, headers]);

    const handleForceUnlock = (e: React.MouseEvent) => {
        e.stopPropagation(); 
        if (lockInfo && window.confirm(`Are you sure you want to unlock ${lockInfo.user.givenName}? This might interrupt active work.`)) {
            database.ref(`locks/${rowIndex}`).set(null).catch(err => {
                console.error("Failed to remove lock:", err);
                alert("Could not remove lock. Try again.");
            });
        }
    };
    
    return (
        <li 
            onClick={!isLockedByOther ? () => onClick(rowIndex, row) : undefined} 
            className={`p-4 border-b border-solar-light-border dark:border-solar-dark-border transition-all duration-200 ${
                isSelected 
                    ? 'bg-solar-accent/20 border-l-4 border-solar-accent' 
                    : isLockedByOther
                    ? 'border-l-4 border-blue-500 bg-blue-500/5'
                    : 'border-l-4 border-transparent hover:bg-gray-500/10 cursor-pointer'
            }`}
            title={isLockedByOther ? `${lockInfo?.user.givenName} is editing.` : ''}
        >
            <div className={`flex justify-between items-start ${isLockedByOther ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-base truncate flex items-center gap-2">
                        {osCell?.value || 'N/A'}
                        {osCell?.link && <LinkIcon className="w-3 h-3 text-solar-accent flex-shrink-0" />}
                        {hasCachedWaveform && <WaveformIcon title="Cached Waveform" className="w-4 h-4 text-solar-accent/70 flex-shrink-0" />}
                    </h3>
                    <p className="text-sm text-gray-400 truncate mt-1">{professorCell?.value || 'No Instructor'}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-2 flex flex-col items-end">
                    {infoParts.length > 0 && (
                        <p className="text-xs text-gray-500 truncate">
                            {infoParts.join(' • ')}
                        </p>
                    )}
                    {finalCell?.value && (
                        <div className="mt-1.5 flex items-baseline gap-1">
                            <span className="text-xs text-gray-400">Score:</span>
                            <span className="font-bold text-lg leading-none">
                                {finalCell.value}
                            </span>
                        </div>
                    )}
                </div>
            </div>
            {isLockedByOther && lockInfo && (
                <div className="mt-3 pt-3 border-t border-solar-dark-border/30 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar user={lockInfo.user} className="w-8 h-8 flex-shrink-0" />
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-200 truncate">{lockInfo.user.givenName}</p>
                            <p className="text-xs text-blue-400">is editing...</p>
                        </div>
                    </div>
                    <button 
                        onClick={handleForceUnlock}
                        className="p-2 rounded-full text-gray-400 hover:bg-red-500/20 hover:text-red-400 transition-colors flex-shrink-0"
                        title="Force Unlock"
                        aria-label="Force Unlock"
                    >
                        <XIcon className="w-4 h-4" />
                    </button>
                </div>
            )}
        </li>
    );
});

const AnalysisSheetList: React.FC<AnalysisSheetListProps> = ({ 
    onRowSelected, 
    onDataLoaded, 
    selectedOsIndex, 
    userProfile,
    headers,
    filteredPendingRows,
    filteredCompletedRows,
    filteredSpecialRows,
    searchTerm,
    setSearchTerm,
    filters,
    setFilters,
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Fetching Work Orders...');
    const [error, setError] = useState<string | null>(null);

    const [isSpecialOpen, setIsSpecialOpen] = useState(false);
    const [isPendingOpen, setIsPendingOpen] = useState(true);
    const [isCompletedOpen, setIsCompletedOpen] = useState(false);
    const [activeLocks, setActiveLocks] = useState<{[key: number]: LockInfo}>({});

    useEffect(() => {
        const locksRef = database.ref('locks');
        const listener = (snapshot: any) => {
          setActiveLocks(snapshot.val() || {});
        };
        locksRef.on('value', listener);
        return () => locksRef.off('value', listener);
      }, []);

    const fetchData = useCallback(async (currentFilters: FilterState, forceRefresh = false) => {
        setIsLoading(true);
        setLoadingMessage('Syncing Data...');
        setError(null);
        try {
            const queryParams = new URLSearchParams();
            if (currentFilters.startDate) queryParams.append('startDate', currentFilters.startDate);
            if (currentFilters.endDate) queryParams.append('endDate', currentFilters.endDate);
            if (forceRefresh) {
                queryParams.append('force', 'true');
            }

            const response = await fetch(`/api/get-sheets-data?${queryParams.toString()}`);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Request failed: ${response.statusText}` }));
                throw new Error(errorData.error);
            }

            const data = await response.json();
            onDataLoaded(data.headers, data.rows);
            setLoadingMessage('Ready');

        } catch (err: any) {
            setError(`Sync Error: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [onDataLoaded]);

    useEffect(() => {
        fetchData(filters);
    }, [filters, fetchData]);
    
    const activeFilterCount = (filters.startDate && filters.endDate ? 1 : 0) + filters.inconformities.length + (filters.studio ? 1 : 0);

    const renderList = (list: RowWithIndex[]) => (
        <ul>
            {list.map(item => {
                const lockInfo = activeLocks[item.rowIndex];
                const isLockedByCurrentUser = !!(lockInfo && userProfile && lockInfo.user.id === userProfile.id);
                return (
                    <ListItem 
                        key={item.rowIndex} 
                        {...item} 
                        headers={headers} 
                        isSelected={selectedOsIndex === item.rowIndex} 
                        onClick={onRowSelected} 
                        lockInfo={lockInfo}
                        isLockedByCurrentUser={isLockedByCurrentUser}
                    />
                );
            })}
        </ul>
    );


    const renderContent = () => {
        if (isLoading) {
             return (
                <div className="flex items-center justify-center h-full">
                    <LoadingIndicator 
                        statusText={loadingMessage}
                    />
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex items-center justify-center h-full">
                    <LoadingIndicator 
                        statusText=""
                        error={error}
                        onRetry={() => fetchData(filters)}
                    />
                </div>
            );
        }
       
        const hasNoRowsAtAll = filteredPendingRows.length === 0 && filteredCompletedRows.length === 0 && filteredSpecialRows.length === 0;

        return (
            <div className="flex flex-col h-full min-h-0 bg-solar-light-content dark:bg-solar-dark-content border-r border-solar-light-border dark:border-solar-dark-border">
                <div className="p-2 border-b border-solar-light-border dark:border-solar-dark-border flex items-center gap-2">
                     <div className="relative flex-grow">
                        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search W.O. or Instructor..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full bg-solar-light-bg dark:bg-solar-dark-bg border border-solar-light-border dark:border-solar-dark-border rounded-md pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200 dark:placeholder-gray-500"
                        />
                    </div>
                    <button
                        onClick={() => fetchData(filters, true)}
                        disabled={isLoading}
                        className="flex-shrink-0 p-2 rounded-md hover:bg-gray-500/20 transition-colors focus:outline-none focus:ring-2 focus:ring-solar-accent"
                        title="Refresh List"
                        aria-label="Refresh List"
                    >
                        <RefreshIcon className={`w-5 h-5 transition-transform ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    <Popover
                        trigger={
                            <button
                                className="flex-shrink-0 p-2 rounded-md hover:bg-gray-500/20 transition-colors focus:outline-none focus:ring-2 focus:ring-solar-accent relative"
                                title="Filters"
                                aria-label="Open Filters"
                            >
                                <FilterIcon className="w-5 h-5" />
                                { activeFilterCount > 0 &&
                                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-solar-accent text-white text-xs rounded-full flex items-center justify-center font-mono">
                                        {activeFilterCount}
                                    </span>
                                }
                            </button>
                        }
                    >
                         {(close) => (
                            <FilterControls 
                                activeFilters={filters}
                                onFiltersChange={setFilters}
                                onClose={close}
                            />
                        )}
                    </Popover>
                </div>

                {hasNoRowsAtAll && !isLoading && (
                    <div className="text-center p-4 text-gray-500">No Work Orders found.</div>
                )}
                
                <div className="overflow-y-auto flex-1">
                    <div>
                        <button onClick={() => setIsPendingOpen(!isPendingOpen)} className="sticky top-0 z-10 w-full flex justify-between items-center p-3 bg-solar-light-content dark:bg-solar-dark-content border-b border-solar-light-border dark:border-solar-dark-border">
                            <h2 className="font-bold text-sm uppercase text-gray-400">Pending ({filteredPendingRows.length})</h2>
                            <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${isPendingOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isPendingOpen && (
                            <>
                                {filteredPendingRows.length > 0 ? (
                                    renderList(filteredPendingRows)
                                ) : (
                                    <li className="p-4 text-center text-sm text-gray-500 list-none">
                                        {searchTerm || activeFilterCount > 0 ? 'No results found.' : 'No pending W.O.'}
                                    </li>
                                )}
                            </>
                        )}
                    </div>

                    <div>
                        <button onClick={() => setIsCompletedOpen(!isCompletedOpen)} className="sticky top-0 z-10 w-full flex justify-between items-center p-3 bg-solar-light-content dark:bg-solar-dark-content border-b border-solar-light-border dark:border-solar-dark-border">
                            <h2 className="font-bold text-sm uppercase text-gray-400">Completed ({filteredCompletedRows.length})</h2>
                            <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${isCompletedOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isCompletedOpen && (
                             <>
                                {filteredCompletedRows.length > 0 ? (
                                    renderList(filteredCompletedRows)
                                ) : (
                                     <li className="p-4 text-center text-sm text-gray-500 list-none">
                                        {searchTerm || activeFilterCount > 0 ? 'No results found.' : 'No completed W.O.'}
                                    </li>
                                )}
                            </>
                        )}
                    </div>
                    
                    <div>
                        <button onClick={() => setIsSpecialOpen(!isSpecialOpen)} className="sticky top-0 z-10 w-full flex justify-between items-center p-3 bg-solar-light-content dark:bg-solar-dark-content border-b border-solar-light-border dark:border-solar-dark-border">
                            <h2 className="font-bold text-sm uppercase text-gray-400">System/Special ({filteredSpecialRows.length})</h2>
                            <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${isSpecialOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isSpecialOpen && (
                            <>
                                {filteredSpecialRows.length > 0 ? (
                                    renderList(filteredSpecialRows)
                                ) : (
                                    <li className="p-4 text-center text-sm text-gray-500 list-none">
                                        {searchTerm || activeFilterCount > 0 ? 'No results found.' : 'No special W.O.'}
                                    </li>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }
    
    return renderContent();
};

export default AnalysisSheetList;
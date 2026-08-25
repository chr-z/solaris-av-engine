import React, { useState, useEffect, useCallback, memo } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { SearchIcon, LinkIcon, ChevronDownIcon, FilterIcon, RefreshIcon, XIcon, WaveformIcon } from '../Core/icons';
import LoadingIndicator from '../Core/LoadingIndicator';
import Popover from '../Core/Popover';
import FilterControls, { FilterState } from './FilterControls';
import { database, auth } from '../../config/firebase';
import { UserProfile } from '../../types';
import UserAvatar from '../Auth/UserAvatar';
import { useWaveformCache } from '../../contexts/WaveformCacheContext';
import { getVideoIdFromUrl } from '../../utils/videoUtils';
// Tick 12: badge de score com tier semântico (pill tabular verde/amarelo/vermelho)
import { formatScore, scoreBandClass } from '../../utils/scoreFormat';

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
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
        throw new Error('Not authenticated. Please sign in again.');
    }
    const response = await fetch(`/api/sheet-row?rowIndex=${rowIndex}`, {
        headers: { Authorization: `Bearer ${idToken}` },
    });
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
            className={`p-4 border-b border-hairline transition-all duration-150 ${
                isSelected 
                    ? 'bg-solar-accent/20 border-l-4 border-solar-accent' 
                    : isLockedByOther
                    ? 'border-l-4 border-blue-500 bg-blue-500/5'
                    : 'border-l-4 border-transparent hover:bg-surface/50 even:bg-surface/30 even:hover:bg-surface/70 cursor-pointer transition-all duration-150'
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
                        <p className={`text-xs truncate ${isSelected ? 'text-ink' : 'text-ink-secondary'}`}>
                            {infoParts.join(' • ')}
                        </p>
                    )}
                    {finalCell?.value && (
                        <div className="mt-1.5 flex items-baseline gap-1">
                            <span className="text-xs text-gray-400">Score:</span>
                            {/* Tick 12: pill com número tabular, cor pelo tier semântico
                                (verde=ok, amarelo=atenção, vermelho=inconformidade).
                                Mesma informação do MVP (o valor cru), acabamento v3. */}
                            <span className={`badge-pill badge-score ${scoreBandClass(finalCell.value)}`}>
                                <span className="tnum">{formatScore(finalCell.value) ?? finalCell.value}</span>
                            </span>
                        </div>
                    )}
                </div>
            </div>
            {isLockedByOther && lockInfo && (
                <div className="mt-3 pt-3 border-t border-hairline/30 flex items-center justify-between gap-3">
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

// --- Empty state ilustrado com dica contextual (R3) ---
// Anatomia do MVP intacta (seções Pending/Completed/Special com contagem):
// só o vazio ganha ilustração SVG inline e uma dica do que fazer agora.
const QueueIllustration: React.FC<{ variant: 'list' | 'info' }> = ({ variant }) => (
    variant === 'list' ? (
        <svg width="56" height="40" viewBox="0 0 56 40" fill="none" aria-hidden="true" className="mb-3 mx-auto">
            <rect x="6" y="4" width="44" height="32" rx="5" stroke="var(--color-border-strong)" strokeWidth="1.5" />
            <path d="M13 13h22M13 20h30M13 27h16" stroke="var(--color-text-secondary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
        </svg>
    ) : (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true" className="mb-1.5 mx-auto">
            <circle cx="14" cy="14" r="10" stroke="var(--color-border-strong)" strokeWidth="1.5" />
            <circle cx="14" cy="9.5" r="1.4" fill="var(--color-info)" />
            <path d="M14 13v6" stroke="var(--color-info)" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    )
);

interface EmptyStateProps {
    title: string;
    hint: string;
    icon?: 'list' | 'info';
    className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ title, hint, icon = 'info', className = '' }) => {
    const Tag = (className.includes('as-li') ? 'li' : 'div') as 'li' | 'div';
    return (
        <Tag
            role="status"
            data-testid="queue-empty"
            className={`text-center px-4 py-6 list-none ${className}`}
        >
            <QueueIllustration variant={icon} />
            <p className="text-sm font-semibold text-ink leading-snug">{title}</p>
            <p className="text-xs text-ink-secondary mt-1 max-w-[26ch] mx-auto">{hint}</p>
        </Tag>
    );
};

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
    const { t } = useI18n();
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
        if (userProfile?.id === 'guest-reviewer-id') {
            setIsLoading(false);
            setLoadingMessage('Ready');
            setError(null);
            return;
        }

        setIsLoading(true);
        setLoadingMessage('Syncing Data...');
        setError(null);
        try {
            const idToken = await auth.currentUser?.getIdToken();
            if (!idToken) {
                throw new Error('Session expired. Please sign in again.');
            }

            const queryParams = new URLSearchParams();
            if (currentFilters.startDate) queryParams.append('startDate', currentFilters.startDate);
            if (currentFilters.endDate) queryParams.append('endDate', currentFilters.endDate);
            if (forceRefresh) {
                queryParams.append('force', 'true');
            }

            const response = await fetch(`/api/get-sheets-data?${queryParams.toString()}`, {
                headers: { Authorization: `Bearer ${idToken}` },
            });
            
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
    }, [onDataLoaded, userProfile]);

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
        const isFiltered = !!searchTerm || activeFilterCount > 0;

        return (
            <div className="flex flex-col h-full min-h-0 bg-surface dark:bg-surface border-r border-hairline">
                <div className="p-2 border-b border-hairline flex items-center gap-2">
                     <div className="relative flex-grow">
                        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search W.O. or Instructor..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full bg-surface border border-hairline rounded-md pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200 dark:placeholder-gray-500"
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
                                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-solar-accent text-bg text-xs rounded-full flex items-center justify-center font-mono">
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
                    <EmptyState
                        icon="list"
                        title={isFiltered ? t('queue.empty.search') : t('queue.empty.all')}
                        hint={isFiltered ? t('queue.empty.searchHint') : t('queue.empty.allHint')}
                    />
                )}
                
                <div className="overflow-y-auto flex-1">
                    <div>
                        <button onClick={() => setIsPendingOpen(!isPendingOpen)} className="sticky top-0 z-10 w-full flex justify-between items-center p-3 bg-surface dark:bg-surface border-b border-hairline">
                            <h2 className="font-bold text-sm uppercase text-gray-400">Pending ({filteredPendingRows.length})</h2>
                            <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${isPendingOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isPendingOpen && (
                            <>
                                {filteredPendingRows.length > 0 ? (
                                    renderList(filteredPendingRows)
                                ) : (
                                    <EmptyState
                                        title={searchTerm || activeFilterCount > 0 ? t('queue.empty.search') : t('queue.empty.pending')}
                                        hint={searchTerm || activeFilterCount > 0 ? t('queue.empty.searchHint') : t('queue.empty.pendingHint')}
                                    />
                                )}
                            </>
                        )}
                    </div>

                    <div>
                        <button onClick={() => setIsCompletedOpen(!isCompletedOpen)} className="sticky top-0 z-10 w-full flex justify-between items-center p-3 bg-surface dark:bg-surface border-b border-hairline">
                            <h2 className="font-bold text-sm uppercase text-gray-400">Completed ({filteredCompletedRows.length})</h2>
                            <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${isCompletedOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isCompletedOpen && (
                             <>
                                {filteredCompletedRows.length > 0 ? (
                                    renderList(filteredCompletedRows)
                                ) : (
                                    <EmptyState
                                        title={searchTerm || activeFilterCount > 0 ? t('queue.empty.search') : t('queue.empty.completed')}
                                        hint={searchTerm || activeFilterCount > 0 ? t('queue.empty.searchHint') : t('queue.empty.completedHint')}
                                    />
                                )}
                            </>
                        )}
                    </div>
                    
                    <div>
                        <button onClick={() => setIsSpecialOpen(!isSpecialOpen)} className="sticky top-0 z-10 w-full flex justify-between items-center p-3 bg-surface dark:bg-surface border-b border-hairline">
                            <h2 className="font-bold text-sm uppercase text-gray-400">System/Special ({filteredSpecialRows.length})</h2>
                            <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${isSpecialOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isSpecialOpen && (
                            <>
                                {filteredSpecialRows.length > 0 ? (
                                    renderList(filteredSpecialRows)
                                ) : (
                                    <EmptyState
                                        title={searchTerm || activeFilterCount > 0 ? t('queue.empty.search') : t('queue.empty.special')}
                                        hint={searchTerm || activeFilterCount > 0 ? t('queue.empty.searchHint') : t('queue.empty.specialHint')}
                                    />
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
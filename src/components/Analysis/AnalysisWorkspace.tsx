import React, { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';

// --- IMPORTS CORRIGIDOS (NAVIGATION) ---
import VideoPlayer from '../Media/VideoPlayer';
// turbo-web: A/B compare pane is lazy — its module (and WaveformTimeline) only
// downloads when the analyst actually activates compare mode.
const ComparePane = React.lazy(() => import('../Media/ComparePane'));
import DriveFilePicker from '../Media/DriveFilePicker';
import SourceSelector from '../Media/SourceSelector';
import LocalFileHelper from '../Media/LocalFileHelper';

// turbo-web: live monitors are a self-contained island that owns the 15 Hz
// analysis state — playback ticks re-render only the docks, not this tree.
import LiveMonitors from './LiveMonitors';
import OverlayControls from '../Monitors/OverlayControls';

import UserAvatar from '../Auth/UserAvatar';
import Popover from '../Core/Popover';
import ShortcutHelpModal from '../Core/ShortcutHelpModal';
import { SaveIcon, ClipboardCheckIcon, YouTubeIcon, GoogleDriveIcon, XIcon, GridIcon, ClockIcon, PencilIcon, InfoIcon, ColumnsIcon, RowsIcon, RefreshIcon } from '../Core/icons';

// Imports locais (mesma pasta Analysis)
import AnalysisForm from './AnalysisForm';
import { RowData, updateSheetRow, DriveFile } from './AnalysisSheet';

// Imports de Lógica (Hooks/Utils/Config)
// turbo-web: 15 Hz analysis state moved INTO the LiveMonitors island —
// this tree no longer re-renders on playback ticks.
import { useAnalystShortcuts } from '../../hooks/useAnalystShortcuts';
import { useCompareMode } from '../../hooks/useCompareMode';
import { useLicense } from '../../licensing/LicenseContext';
import { OverlaySettings, VideoChoice, UserProfile, Timestamp } from '../../types';
import { useI18n } from '../../i18n/I18nContext';
import { dropdownFields, inconformityToCategoryMap, resultFields, inconformityScores, categoryMaxScores } from '../../utils/constants';
import { getCompareGridClass } from '../../utils/compareMode';
import { getDb, getFirebaseCompat, isFirebaseConfigured, type UnsubscribeFn } from '../../config/firebase';

// Solaris v3: scoring + sheet-sync modules
import { recalculateScoresWithEngine, isScorableHeader, applyScoreUpdates } from '../../config/engineBridge';
import { updateSheetRow as syncUpdateSheetRow } from '../../services/sheetSync';

// Local alias keeps the legacy name space untouched inside this component.
const applyScoreUpdatesLocal = applyScoreUpdates;

// --- SUB-COMPONENTS ---

interface VideoSourceChooserProps {
    choices: VideoChoice[];
    onSelect: (source: string, info: { name: string; isDriveLink?: boolean; isYoutube?: boolean }) => void;
    osIdentifier: string;
}

const VideoSourceChooser: React.FC<VideoSourceChooserProps> = ({ choices, onSelect, osIdentifier }) => {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 p-4">
            <p className="font-bold text-lg mb-4">Multiple videos found for W.O. {osIdentifier}</p>
            <p className="mb-6">Select which video source to analyze:</p>
            <div className="flex flex-col gap-4 w-full max-w-sm">
                {choices.map((choice, index) => (
                    <button
                        key={index}
                        onClick={() => onSelect(choice.url, {
                            name: `W.O. ${osIdentifier} Video (${choice.sourceName})`,
                            isYoutube: choice.type === 'youtube',
                            isDriveLink: choice.type === 'driveFile'
                        })}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg bg-solar-dark-content border border-solar-dark-border hover:bg-solar-accent/20 hover:border-solar-accent transition-colors focus:outline-none focus:ring-2 focus:ring-solar-accent"
                    >
                        {choice.type === 'youtube' && <YouTubeIcon className="w-6 h-6 text-red-500" />}
                        {choice.type === 'driveFile' && <GoogleDriveIcon className="w-6 h-6 text-blue-400" />}
                        <span>Analyze <span className="font-bold">{choice.sourceName}</span></span>
                    </button>
                ))}
            </div>
        </div>
    );
};

const formatTime = (totalSeconds: number): string => {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

interface TimestampModalProps {
    isOpen: boolean;
    onClose: () => void;
    videoRef: React.RefObject<HTMLVideoElement>;
    selectedOsIndex: number;
    userProfile: UserProfile | null;
    currentVideoId: string;
    currentVideoName: string;
}

const TimestampModal: React.FC<TimestampModalProps> = ({ isOpen, onClose, videoRef, selectedOsIndex, userProfile, currentVideoId, currentVideoName }) => {
    const [timestamps, setTimestamps] = useState<Timestamp[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [comment, setComment] = useState('');
    const [sortOrder, setSortOrder] = useState<'time' | 'comment'>('time');
    const [editingTimestampId, setEditingTimestampId] = useState<string | null>(null);
    const [editingComment, setEditingComment] = useState('');
    const listRef = useRef<HTMLUListElement>(null);

    useEffect(() => {
        if (!isOpen || !selectedOsIndex || !currentVideoId) return;

        queueMicrotask(() => setIsLoading(true));
        // turbo-web: subscribe only after the lazy SDK resolves; skip if unmounted first.
        let disposed = false;
        let timestampsRef: ReturnType<Awaited<ReturnType<typeof getDb>>['ref']> | null = null;
        let unsub: UnsubscribeFn | null = null;
        // turbo-web: offline/demo builds have no Firebase config — stay silent.
        if (!isFirebaseConfigured()) { queueMicrotask(() => setIsLoading(false)); return; }
        getDb().then((db) => {
            if (disposed) return;
            timestampsRef = db.ref(`timestamps/${selectedOsIndex}/${currentVideoId}`);
            unsub = timestampsRef.on('value', snapshot => {
                const data = snapshot.val();
                const loadedTimestamps: Timestamp[] = [];
                if (data) {
                    Object.keys(data).forEach(key => {
                        loadedTimestamps.push({ id: key, ...data[key] });
                    });
                }
                setTimestamps(loadedTimestamps);
                setIsLoading(false);
            });
        }).catch((err) => console.error('Failed to load database module:', err));

        return () => {
            disposed = true;
            if (timestampsRef && unsub) timestampsRef.off('value', unsub);
        };
    }, [isOpen, selectedOsIndex, currentVideoId]);
    
    const sortedTimestamps = useMemo(() => {
        const sorted = [...timestamps];
        if (sortOrder === 'time') {
            sorted.sort((a, b) => a.time - b.time);
        } else if (sortOrder === 'comment') {
            sorted.sort((a, b) => a.comment.localeCompare(b.comment));
        }
        return sorted;
    }, [timestamps, sortOrder]);

    const handleAddClick = () => {
        if (videoRef.current) {
            videoRef.current.pause();
            setComment('');
            setEditingTimestampId(null);
        }
    };
    
    const handleSaveNew = async () => {
        if (!comment.trim() || !userProfile || !videoRef.current) return;

        const newTimestamp = {
            time: videoRef.current.currentTime,
            comment: comment.trim(),
            analyst: {
                id: userProfile.id, name: userProfile.name, givenName: userProfile.givenName, picture: userProfile.picture,
            },
            createdAt: (await getFirebaseCompat()).app.database.ServerValue.TIMESTAMP,
            fileId: currentVideoId,
            fileName: currentVideoName,
        };
        
        try {
            await (await getDb()).ref(`timestamps/${selectedOsIndex}/${currentVideoId}`).push(newTimestamp);
            setComment('');
        } catch (error) {
            console.error("Failed to save timestamp:", error);
            alert("Error saving timestamp. Check connection.");
        }
    };
    
    const handleTimestampClick = (time: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            videoRef.current.play();
        }
    };
    
    const handleDelete = (timestampId: string) => {
        if (window.confirm("Are you sure you want to remove this marker?")) {
            void getDb().then((db) => db.ref(`timestamps/${selectedOsIndex}/${currentVideoId}/${timestampId}`).remove());
        }
    };

    const handleStartEdit = (ts: Timestamp) => {
        setEditingTimestampId(ts.id);
        setEditingComment(ts.comment);
        setComment(''); 
    };

    const handleCancelEdit = () => {
        setEditingTimestampId(null);
        setEditingComment('');
    };

    const handleSaveEdit = () => {
        if (!editingTimestampId || !editingComment.trim()) return;
        void getDb().then((db) => db.ref(`timestamps/${selectedOsIndex}/${currentVideoId}/${editingTimestampId}/comment`).set(editingComment.trim()));
        handleCancelEdit();
    };

    if (!isOpen) return null;

    return createPortal(
        <div 
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in-fast" 
            onClick={onClose}
        >
            <div 
                className="bg-solar-dark-content text-white w-full max-w-2xl h-[70vh] rounded-lg shadow-xl flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <header className="flex-shrink-0 flex justify-between items-center p-3 border-b border-solar-dark-border">
                    <div className="min-w-0">
                        <h2 className="font-bold text-lg leading-tight">Time Markers</h2>
                        <p className="text-xs text-gray-400 truncate" title={currentVideoName}>{currentVideoName}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="flex items-center gap-1 text-xs bg-solar-dark-bg px-2 py-1 rounded-md">
                            <span className="text-gray-400">Sort by:</span>
                            <button onClick={() => setSortOrder('time')} className={`px-2 py-0.5 rounded ${sortOrder === 'time' ? 'bg-solar-accent text-solar-dark-bg' : 'hover:bg-gray-500/20'}`}>Time</button>
                            <button onClick={() => setSortOrder('comment')} className={`px-2 py-0.5 rounded ${sortOrder === 'comment' ? 'bg-solar-accent text-solar-dark-bg' : 'hover:bg-gray-500/20'}`}>Comment</button>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-full text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors" aria-label="Close">
                            <XIcon className="w-5 h-5" />
                        </button>
                    </div>
                </header>
                <div className="flex-1 min-h-0 overflow-y-auto p-2">
                     {isLoading && <p className="text-gray-400 text-center p-4">Loading markers...</p>}
                     {!isLoading && sortedTimestamps.length === 0 && (
                        <div className="text-center p-6 text-gray-400">
                           <ClockIcon className="w-12 h-12 mx-auto mb-2 text-gray-500"/>
                           <h3 className="font-bold">No Markers</h3>
                           <p className="text-sm">Use the field below to add the first marker to this video.</p>
                        </div>
                     )}
                     <ul ref={listRef} className="space-y-1 p-2">
                        {sortedTimestamps.map(ts => (
                            <li key={ts.id} className="group bg-solar-dark-bg/50 rounded-lg">
                                {editingTimestampId === ts.id ? (
                                    <div className="p-3 space-y-2">
                                        <textarea value={editingComment} onChange={e => setEditingComment(e.target.value)} rows={2} className="w-full bg-solar-dark-bg border border-solar-dark-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200" autoFocus/>
                                        <div className="flex justify-end gap-2">
                                            <button onClick={handleCancelEdit} className="px-3 py-1 text-sm rounded-md hover:bg-gray-500/20">Cancel</button>
                                            <button onClick={handleSaveEdit} disabled={!editingComment.trim()} className="px-3 py-1 text-sm rounded-md bg-solar-accent text-solar-dark-bg hover:bg-solar-accent-hover disabled:opacity-50">Save</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-start gap-3 p-3">
                                        <div className="font-mono text-sm bg-solar-accent/20 text-solar-accent rounded px-2 py-1 flex-shrink-0 cursor-pointer hover:bg-solar-accent/40" onClick={() => handleTimestampClick(ts.time)}>
                                            {formatTime(ts.time)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center">
                                                <div className="flex items-center gap-2">
                                                    <UserAvatar user={ts.analyst} className="w-5 h-5" />
                                                    <span className="text-xs font-bold">{ts.analyst.givenName}</span>
                                                </div>
                                                {userProfile?.id === ts.analyst.id && (
                                                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={() => handleStartEdit(ts)} className="p-1 rounded-full text-gray-400 hover:bg-gray-500/20 hover:text-white" aria-label="Edit"><PencilIcon className="w-3 h-3" /></button>
                                                        <button onClick={() => handleDelete(ts.id)} className="p-1 rounded-full text-gray-400 hover:bg-red-500/20 hover:text-red-400" aria-label="Remove"><XIcon className="w-3 h-3" /></button>
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-sm mt-1 break-words whitespace-pre-wrap">{ts.comment}</p>
                                        </div>
                                    </div>
                                )}
                            </li>
                        ))}
                     </ul>
                </div>
                <div className="flex-shrink-0 p-3 border-t border-solar-dark-border bg-solar-dark-bg/50">
                    <div className="space-y-2">
                        <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a time marker comment..." rows={2} className="w-full bg-solar-dark-bg border border-solar-dark-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200 dark:placeholder-gray-500" onFocus={handleAddClick}/>
                        <div className="flex justify-end">
                            <button onClick={handleSaveNew} disabled={!comment.trim()} className="px-4 py-2 text-sm font-semibold rounded-md bg-solar-accent text-solar-dark-bg hover:bg-solar-accent-hover disabled:opacity-50">Add Marker</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};


interface AnalysisWorkspaceProps {
  selectedRow: RowData | null;
  headers: string[];
  videoSrc: string | null;
  videoTitle: string;
  currentVideoId: string | null;
  isLocalVideo: boolean;
  videoChoices: VideoChoice[];
  isMediaLoading: boolean;
  isRowLoading: boolean;
  overlaySettings: OverlaySettings;
  setOverlaySettings: React.Dispatch<React.SetStateAction<OverlaySettings>>;
  onLoadMedia: (source: File | string, info?: { name?: string; isDriveLink?: boolean; isYoutube?: boolean }) => void;
  errorMessage: string | null;
  selectedOsIndex: number;
  onSaveSuccess: (savedRow: RowData) => void;
  onRetryLoad: () => void;
  isPickerOpen: boolean;
  pickerFolderId: string | null;
  onOpenPicker: (folderId: string) => void;
  onClosePicker: () => void;
  onFileFromPickerSelected: (file: DriveFile) => void;
  userProfile: UserProfile | null;
  onClose: () => void;
}

const recalculateScores = (currentRowData: RowData, headers: string[]): RowData => {
    const updatedData = [...currentRowData];

    const categoryPenalties: Record<string, number> = {};
    for (const category of resultFields) {
        categoryPenalties[category] = 0;
    }

    // Sum up penalties for each category based on checked inconformities
    for (const inconformityName in inconformityScores) {
        const columnIndex = headers.indexOf(inconformityName);
        if (columnIndex > -1 && updatedData[columnIndex]?.value === 'TRUE') {
            const category = inconformityToCategoryMap[inconformityName];
            const penaltyValue = inconformityScores[inconformityName];
            if (category && typeof penaltyValue === 'number') {
                categoryPenalties[category] = (categoryPenalties[category] || 0) + penaltyValue;
            }
        }
    }

    let totalFinalScore = 0;

    // Calculate final score for each category and update the row data
    for (const category in categoryMaxScores) {
        const maxScore = categoryMaxScores[category];
        const penalty = categoryPenalties[category] || 0;
        const finalCategoryScore = Math.max(0, maxScore - penalty);
        
        const scoreIndex = headers.indexOf(category);
        if (scoreIndex > -1) {
            const existingCell = updatedData[scoreIndex] || {};
            updatedData[scoreIndex] = { ...existingCell, value: finalCategoryScore.toFixed(2).replace('.', ',') };
        }
        totalFinalScore += finalCategoryScore;
    }
    
    // Update the final total score (Updated to English 'FINAL SCORE')
    const finalIndex = headers.indexOf('FINAL SCORE');
    if (finalIndex > -1) {
        const existingCell = updatedData[finalIndex] || {};
        updatedData[finalIndex] = { ...existingCell, value: totalFinalScore.toFixed(2).replace('.', ',') };
    }

    return updatedData;
};

// Memoized: this subtree embeds the video player + 4 canvas monitors. App-level
// state churn (debounced search typing, auth ticks) must not re-render it when
// its own props are unchanged; all callbacks it receives have stable identity.
const AnalysisWorkspace: React.FC<AnalysisWorkspaceProps> = memo(({
  selectedRow,
  headers,
  videoSrc,
  videoTitle,
  currentVideoId,
  isLocalVideo,
  videoChoices,
  isMediaLoading,
  isRowLoading,
  overlaySettings,
  setOverlaySettings,
  onLoadMedia,
  errorMessage,
  selectedOsIndex,
  onSaveSuccess,
  onRetryLoad,
  isPickerOpen,
  pickerFolderId,
  onOpenPicker,
  onClosePicker,
  onFileFromPickerSelected,
  userProfile,
  onClose,
}) => {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [localRowData, setLocalRowData] = useState<RowData | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isTimestampModalOpen, setIsTimestampModalOpen] = useState(false);
  // S5.1: keyboard shortcuts — "?" opens the quick-reference modal.
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);

  // v3 sheet-sync state (idempotent write + local audit trail)
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);

  // S5.2: A/B compare orchestration (state + imperative sync channel).
  const compare = useCompareMode({ hasMedia: !!videoSrc });
  // S6.1: compare mode is a Pro feature — the toggle is flag-gated.
  const { flags } = useLicense();
  const isCompareAllowed = flags.abCompareMode;
  const handleToggleCompare = useCallback(() => {
    if (!videoSrc || !isCompareAllowed) return;
    compare.toggleActive();
  }, [videoSrc, isCompareAllowed, compare]);

  // S5.1: imperative handle registered by VideoPlayer for the global layer.
  const playerControlsRef = useRef<{
    togglePlay: () => void;
    seekBy: (seconds: number) => void;
    seekToStart: () => void;
    changeVolume: (delta: number) => void;
  } | null>(null);
  const registerPlayerControls = useCallback((controls: NonNullable<typeof playerControlsRef.current>) => {
    playerControlsRef.current = controls;
    return () => { playerControlsRef.current = null; };
  }, []);

  // Latest save handler lives in a ref so Ctrl+S always saves current data
  // (assigned right after handleSave below).
  const saveViaShortcutRef = useRef<() => void>(() => {});

  // S5.1: global analyst shortcuts. Player scope only when media exists,
  // workspace scope always (T/S act on the open analysis sheet).
  useAnalystShortcuts({
    enabled: true,
    scopeEnabled: { player: !!videoSrc },
    togglePlay: useCallback(() => playerControlsRef.current?.togglePlay(), []),
    seekBy: useCallback((seconds: number) => playerControlsRef.current?.seekBy(seconds), []),
    seekToStart: useCallback(() => playerControlsRef.current?.seekToStart(), []),
    changeVolume: useCallback((delta: number) => playerControlsRef.current?.changeVolume(delta), []),
    openTimeMarkers: useCallback(() => { if (currentVideoId) setIsTimestampModalOpen(true); }, [currentVideoId]),
    saveAnalysis: useCallback(() => saveViaShortcutRef.current(), []),
    toggleCompare: handleToggleCompare,
  });

  // S5.1: "?" toggles the shortcut reference (Shift+/ produces '?').
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isFormField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey && !isFormField) {
        event.preventDefault();
        setIsShortcutHelpOpen(open => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  // State for local video path sharing
  const [localFilePath, setLocalFilePath] = useState('');
  const [retrievedFilePath, setRetrievedFilePath] = useState<string | null>(null);


  // Fetch stored local file path when OS is selected
  useEffect(() => {
    if (selectedOsIndex) {
      let disposed = false;
      getDb().then((db) => db.ref(`analysisMetadata/${selectedOsIndex}/localFilePath`).get()).then((snapshot) => {
        if (disposed) return;
        if (snapshot.exists()) {
          setRetrievedFilePath(snapshot.val());
        } else {
          setRetrievedFilePath(null);
        }
      }).catch((err) => console.error('Failed to load local file path:', err));
      return () => { disposed = true; };
    }
    queueMicrotask(() => setLocalFilePath(''));
  }, [selectedOsIndex]);


  useEffect(() => {
    if (!selectedRow) {
        queueMicrotask(() => setLocalRowData(null));
        return;
    }
    
    let initialData: RowData;
    if (userProfile && headers.length > 0) {
        const prefillField = (data: RowData, fieldName: string, defaultValue: string) => {
            const fieldIndex = headers.indexOf(fieldName);
            if (fieldIndex > -1) {
                const cell = data[fieldIndex];
                if (!cell || !cell.value) {
                    data[fieldIndex] = { ...(data[fieldIndex] || {}), value: defaultValue };
                }
            }
        };

        initialData = [...selectedRow];
        const analistaIndex = headers.indexOf('ANALYST');
        if (analistaIndex > -1) {
            const analistaCell = initialData[analistaIndex];
            if (!analistaCell || !analistaCell.value) {
                const analystOptions = dropdownFields['ANALYST'] || [];
                // Simple matching for demo purposes
                const matchedAnalyst = analystOptions.find(option =>
                    option.toLowerCase().includes(userProfile.givenName.toLowerCase())
                );
                if (matchedAnalyst) {
                    initialData[analistaIndex] = { ...(initialData[analistaIndex] || {}), value: matchedAnalyst };
                }
            }
        }
        // Example pre-fills
        prefillField(initialData, 'Responsibility', 'GENERAL');
    } else {
        initialData = [...selectedRow];
    }

    const finalIndex = headers.indexOf('FINAL SCORE');
    const finalScoreValue = finalIndex > -1 ? initialData[finalIndex]?.value : '';
    const finalScoreNumber = parseFloat(finalScoreValue?.replace(',', '.') || 'NaN');
    
    if (isNaN(finalScoreNumber)) {
        const recalculatedData = recalculateScores(initialData, headers);
        queueMicrotask(() => setLocalRowData(recalculatedData));
    } else {
        queueMicrotask(() => setLocalRowData(initialData));
    }
  }, [selectedRow, userProfile, headers]);

  const handleDataChange = useCallback((columnIndex: number, value: string) => {
    setLocalRowData(prevData => {
      if (!prevData) return null;

      const newData = [...prevData];
      const newCell = { ...(newData[columnIndex] || {}), value };
      newData[columnIndex] = newCell;

      const fieldName = headers[columnIndex];
      // v3: score via the ScoringEngine (versioned rules) when the field is a
      // known inconformity — covers v2 EN headers and legacy MVP PT-BR ones.
      // Falls back to the legacy hardcoded table for unknown fields.
      if (
        Object.prototype.hasOwnProperty.call(inconformityToCategoryMap, fieldName) ||
        isScorableHeader(fieldName)
      ) {
          const { cellUpdates } = recalculateScoresWithEngine(newData, headers);
          return applyScoreUpdatesLocal(newData, cellUpdates);
      }

      return newData;
    });
  }, [headers]);

  const handleSave = async () => {
    if (!localRowData || selectedOsIndex === null) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveStatus('idle');
    try {
      await updateSheetRow(selectedOsIndex, localRowData);
      onSaveSuccess(localRowData);

      if (isLocalVideo && localFilePath.trim()) {
        await (await getDb()).ref(`analysisMetadata/${selectedOsIndex}/localFilePath`).set(localFilePath.trim());
      }

      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : "Save failed. Check connection.");
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  // S5.1: keep the shortcut layer pointed at the latest save handler.
  // Written in an effect (react-hooks/refs forbids ref writes during render).
  useEffect(() => {
    saveViaShortcutRef.current = () => { void handleSave(); };
  });

  // v3: "Sincronizar com planilha" — resilient idempotent write of the current
  // row through the SheetConnector (retry + backoff + audit log). Uses the same
  // Google access token the app already holds from sign-in.
  const gapiToken = () => {
    try {
      return (window as unknown as { gapi?: { client?: { getToken?: () => { access_token?: string } | null } } })
        .gapi?.client?.getToken?.()?.access_token ?? null;
    } catch { return null; }
  };

  const handleSyncToSheet = async () => {
    if (!localRowData || selectedOsIndex === null) return;
    const token = gapiToken();
    if (!token) {
      setSyncError('Sessão Google expirada. Conecte-se novamente para sincronizar.');
      setSyncStatus('error');
      return;
    }
    setIsSyncing(true);
    setSyncError(null);
    setSyncStatus('idle');
    try {
      await syncUpdateSheetRow(selectedOsIndex, localRowData, { accessToken: token });
      onSaveSuccess(localRowData);
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 2500);
    } catch (error: unknown) {
      setSyncError(error instanceof Error ? error.message : 'Falha na sincronização com a planilha.');
      setSyncStatus('error');
    } finally {
      setIsSyncing(false);
    }
  };

  if (isRowLoading) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-solar-accent border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading Work Order Data...</p>
        </div>
      </div>
    );
  }

  if (!localRowData) {
    return (
        <div className="flex items-center justify-center w-full h-full p-8 text-center">
             <p className="text-gray-400">{errorMessage || "Could not load data for this Work Order."}</p>
        </div>
    );
  }
  
  const renderSaveButton = () => {
    if (saveStatus === 'success') {
      return (
        <div className="flex items-center gap-2 text-green-400">
          <ClipboardCheckIcon className="w-5 h-5" />
          <span>Saved!</span>
        </div>
      );
    }
    return (
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="flex items-center gap-2 px-4 py-2 rounded-md bg-solar-accent text-solar-dark-bg hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent disabled:opacity-50"
      >
        {isSaving ? (
           <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        ) : (
          <SaveIcon className="w-5 h-5" />
        )}
        <span>{isSaving ? 'Saving...' : 'Save Analysis'}</span>
      </button>
    );
  };

  // v3: sync button + inline status, rendered next to the legacy Save button.
  const renderSyncButton = () => (
    <div className="flex items-center gap-2">
      {syncStatus === 'success' && (
        <div className="flex items-center gap-1.5 text-green-400 text-sm">
          <ClipboardCheckIcon className="w-4 h-4" />
          <span>Planilha sincronizada</span>
        </div>
      )}
      {syncStatus === 'error' && syncError && (
        <p className="text-sm text-red-400 max-w-[280px] truncate" title={syncError}>{syncError}</p>
      )}
      <button
        onClick={() => { void handleSyncToSheet(); }}
        disabled={isSyncing || isSaving}
        title="Grava a linha da O.S. na planilha (escrita idempotente com auditoria)"
        className="flex items-center gap-2 px-4 py-2 rounded-md border border-solar-accent/60 text-solar-accent hover:bg-solar-accent/10 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent disabled:opacity-50"
      >
        {isSyncing ? (
          <div className="w-5 h-5 border-2 border-solar-accent border-t-transparent rounded-full animate-spin"></div>
        ) : (
          <RefreshIcon className="w-5 h-5" />
        )}
        <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar com planilha'}</span>
      </button>
    </div>
  );

  const osIdentifier = localRowData ? (localRowData[headers.indexOf('W.O.')]?.value || '') : '';

  return (
    <div className="w-full h-full flex p-4 gap-4 overflow-hidden bg-solar-dark-bg">
        {isPickerOpen && pickerFolderId && (
            <DriveFilePicker
                folderId={pickerFolderId}
                onFileSelected={onFileFromPickerSelected}
                onCancel={onClosePicker}
            />
        )}
      {currentVideoId && (
        <TimestampModal 
            isOpen={isTimestampModalOpen}
            onClose={() => setIsTimestampModalOpen(false)}
            videoRef={videoRef}
            selectedOsIndex={selectedOsIndex}
            userProfile={userProfile}
            currentVideoId={currentVideoId}
            currentVideoName={videoTitle}
        />
      )}
      {/* S5.1: "?" / info button quick reference for analyst shortcuts. */}
      <ShortcutHelpModal
        isOpen={isShortcutHelpOpen}
        onClose={() => setIsShortcutHelpOpen(false)}
      />
      <div className="w-2/3 h-full flex flex-col gap-4">
        <div className="flex-1 min-h-0">
          {compare.isActive ? (
            <div className={getCompareGridClass(compare.layout)}>
              <div className="min-w-0 min-h-0">
                <VideoPlayer
                    ref={videoRef}
                    src={videoSrc}
                    videoId={currentVideoId}
                    title={videoTitle}
                    overlaySettings={overlaySettings}
                    setOverlaySettings={setOverlaySettings}
                    isLoading={isMediaLoading}
                    errorMessage={errorMessage}
                    onRetry={onRetryLoad}
                    onClose={onClose}
                    registerPlayerControls={registerPlayerControls}
                    onTransport={compare.publishTransport}
                >
                    {videoChoices.length > 1 && (
                        <VideoSourceChooser
                            choices={videoChoices}
                            onSelect={onLoadMedia}
                            osIdentifier={osIdentifier}
                        />
                    )}
                    {!videoSrc && retrievedFilePath && (
                         <LocalFileHelper
                            filePath={retrievedFilePath}
                            onLoadMedia={onLoadMedia}
                         />
                    )}
                    {!videoSrc && !retrievedFilePath && videoChoices.length <= 1 && !isPickerOpen && (
                        <div className="flex flex-col items-center justify-center text-center text-gray-400 p-4">
                            <p className="font-bold text-lg mb-2">{videoTitle}</p>
                            <p className="mb-4">Select an option below to start analysis.</p>
                            <div className="w-96">
                                <SourceSelector onSourceSelected={onLoadMedia} />
                            </div>
                            <p className="text-sm mt-4">Or click the <GoogleDriveIcon className="inline-block w-4 h-4 align-text-bottom" /> button next to the "FOLDER" field.</p>
                        </div>
                    )}
                </VideoPlayer>
              </div>
              {compare.isActive && (
                <React.Suspense fallback={<div className="min-w-0 min-h-0 flex items-center justify-center text-xs text-gray-400">Yui…</div>}>
                <ComparePane
                  source={compare.slotBSource}
                  onChangeSource={compare.setSlotBSource}
                  subscribeToLeader={compare.subscribeToLeader}
                  syncNonce={compare.syncNonce}
                />
                </React.Suspense>
              )}
            </div>
          ) : (
            <VideoPlayer
                ref={videoRef}
                src={videoSrc}
                videoId={currentVideoId}
                title={videoTitle}
                overlaySettings={overlaySettings}
                setOverlaySettings={setOverlaySettings}
                isLoading={isMediaLoading}
                errorMessage={errorMessage}
                onRetry={onRetryLoad}
                onClose={onClose}
                registerPlayerControls={registerPlayerControls}
                onTransport={compare.publishTransport}
            >
                {videoChoices.length > 1 && (
                    <VideoSourceChooser
                        choices={videoChoices}
                        onSelect={onLoadMedia}
                        osIdentifier={osIdentifier}
                    />
                )}
                {!videoSrc && retrievedFilePath && (
                     <LocalFileHelper
                        filePath={retrievedFilePath}
                        onLoadMedia={onLoadMedia}
                     />
                )}
                {!videoSrc && !retrievedFilePath && videoChoices.length <= 1 && !isPickerOpen && (
                    <div className="flex flex-col items-center justify-center text-center text-gray-400 p-4">
                        <p className="font-bold text-lg mb-2">{videoTitle}</p>
                        <p className="mb-4">Select an option below to start analysis.</p>
                        <div className="w-96">
                            <SourceSelector onSourceSelected={onLoadMedia} />
                        </div>
                        <p className="text-sm mt-4">Or click the <GoogleDriveIcon className="inline-block w-4 h-4 align-text-bottom" /> button next to the "FOLDER" field.</p>
                    </div>
                )}
            </VideoPlayer>
          )}
        </div>
        {compare.isActive && (
          <div
            className="flex-shrink-0 flex items-center justify-center gap-3 py-1.5 px-4 rounded-lg bg-solar-light-content/80 dark:bg-solar-dark-content/80 backdrop-blur-md border border-solar-light-border dark:border-solar-dark-border text-sm"
            role="toolbar"
            aria-label={t('compare.title')}
          >
            <span className="font-bold text-xs uppercase tracking-wide text-solar-accent">{t('compare.title')}</span>
            <button
              onClick={compare.toggleSyncMode}
              className={`px-2 py-0.5 rounded-md text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent ${compare.syncMode === 'locked' ? 'bg-solar-accent text-solar-dark-bg hover:bg-solar-accent-hover' : 'bg-solar-dark-bg border border-solar-dark-border text-gray-300 hover:bg-gray-500/20'}`}
              title={compare.syncMode === 'locked' ? t('compare.syncLocked') : t('compare.syncFree')}
              aria-label={t('compare.syncMode')}
            >
              {compare.syncMode === 'locked' ? '⇄ ' + t('compare.syncLocked') : '✕ ' + t('compare.syncFree')}
            </button>
            <label className="flex items-center gap-1.5 text-gray-300">
              <span className="text-xs">{t('compare.offsetLabel')}</span>
              <input
                type="number"
                step="0.5"
                value={compare.offsetSeconds}
                onChange={e => compare.setOffset(parseFloat(e.target.value))}
                aria-describedby="compare-offset-hint"
                className="w-20 bg-solar-dark-bg border border-solar-dark-border rounded-md px-2 py-0.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-solar-accent"
              />
            </label>
            <span id="compare-offset-hint" className="text-[11px] text-gray-500 hidden lg:inline">{t('compare.offsetHint')}</span>
            <button
              onClick={compare.resetOffset}
              className="px-2 py-0.5 rounded-md text-xs bg-solar-dark-bg border border-solar-dark-border text-gray-300 hover:bg-gray-500/20 transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
            >
              0
            </button>
            <button
              onClick={compare.toggleLayout}
              className="p-1.5 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
              title={t('compare.layout')}
              aria-label={t('compare.layout')}
            >
              {compare.layout === 'side-by-side' ? <ColumnsIcon className="w-4 h-4" /> : <RowsIcon className="w-4 h-4" />}
            </button>
          </div>
        )}
        <LiveMonitors videoRef={videoRef} videoSrc={videoSrc} />
      </div>
      <div className="w-1/3 h-full flex flex-col bg-solar-light-content/80 dark:bg-solar-dark-content/80 backdrop-blur-md rounded-lg shadow-sm border border-solar-light-border dark:border-solar-dark-border overflow-hidden">
          <header className="flex-shrink-0 flex justify-between items-center p-3 border-b border-solar-light-border dark:border-solar-dark-border">
              <h2 className="font-bold">Analysis Sheet</h2>
              <div className="flex items-center gap-2">
                  {saveStatus === 'error' && <p className="text-sm text-red-400 mr-2">{saveError}</p>}
                  {/* S5.2: enter/exit A/B compare split (also via V). S6.1: Pro-gated — free tier gets the upsell lock. */}
                  {isCompareAllowed ? (
                    <button
                      onClick={handleToggleCompare}
                      disabled={!videoSrc}
                      aria-pressed={compare.isActive}
                      className={`p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent disabled:opacity-50 disabled:cursor-not-allowed ${compare.isActive ? 'bg-solar-accent/30 text-solar-accent hover:bg-solar-accent/40' : 'text-gray-400 hover:bg-gray-500/20 hover:text-white'}`}
                      title={t('compare.open')}
                      aria-label={t('compare.open')}
                    >
                      <ColumnsIcon className="w-5 h-5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('solaris:open-pro-upgrade'))}
                      aria-label={t('pro.lock.openUpgrade', { feature: t('compare.title') })}
                      title={t('pro.lock.description', { feature: t('compare.title') })}
                      className="relative p-2 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent"
                    >
                      <ColumnsIcon className="w-5 h-5" />
                      <svg
                        className="absolute bottom-1 right-1 w-2.5 h-2.5 text-yellow-400"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => setIsTimestampModalOpen(true)}
                    disabled={!currentVideoId}
                    className="p-2 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Time Markers"
                    aria-label="Open time markers"
                  >
                    <ClockIcon className="w-5 h-5" />
                  </button>
                  {/* S5.1: keyboard shortcut reference (also via "?"). */}
                  <button
                    onClick={() => setIsShortcutHelpOpen(true)}
                    className="p-2 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent"
                    title={t('header.shortcutHelp')}
                    aria-label={t('header.shortcutHelp')}
                  >
                    <InfoIcon className="w-5 h-5" />
                  </button>
                  <Popover
                    contentClassName="w-72"
                    trigger={
                      <button
                        className="p-2 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent"
                        title="Overlay Settings"
                        aria-label="Open overlay settings"
                      >
                        <GridIcon className="w-5 h-5" />
                      </button>
                    }
                  >
                    <OverlayControls settings={overlaySettings} setSettings={setOverlaySettings} />
                  </Popover>
                  {pickerFolderId && (
                    <button
                        onClick={() => onOpenPicker(pickerFolderId)}
                        className="p-2 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent"
                        title="Open Drive Picker"
                        aria-label="Open Drive Picker"
                    >
                        <GoogleDriveIcon className="w-5 h-5" />
                    </button>
                  )}
                  {renderSaveButton()}
                  {renderSyncButton()}
              </div>
          </header>
          <div className="flex-1 overflow-y-auto">
             <AnalysisForm
                selectedRow={localRowData}
                headers={headers}
                onDataChange={handleDataChange}
                onOpenPicker={onOpenPicker}
                isLocalVideo={isLocalVideo}
                localFilePath={localFilePath}
                onLocalFilePathChange={setLocalFilePath}
            />
          </div>
      </div>
    </div>
  );
});

export default AnalysisWorkspace;
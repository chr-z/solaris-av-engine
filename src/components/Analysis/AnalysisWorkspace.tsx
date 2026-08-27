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
import CopyMarkingsPopover from './CopyMarkingsPopover';
import type { MarkingsCopyPlan } from '../../features/qol/markingsCopy';
import Tooltip from '../Core/Tooltip';
import ScoreRing from '../Core/ScoreRing';
import ScoreSpark from '../Core/ScoreSpark';

import ShortcutHelpModal from '../Core/ShortcutHelpModal';
import { useShortcutPrefs } from '../../hooks/useShortcutPrefs';
import { SaveIcon, ClipboardCheckIcon, YouTubeIcon, GoogleDriveIcon, XIcon, GridIcon, ClockIcon, PencilIcon, InfoIcon, ColumnsIcon, RowsIcon, RefreshIcon, FocusIcon } from '../Core/icons';

// Imports locais (mesma pasta Analysis)
import AnalysisForm from './AnalysisForm';
import { RowData, updateSheetRow, DriveFile } from './AnalysisSheet';
import { ScratchpadPanel } from './ScratchpadPanel';
import AcousticPanel from './AcousticPanel';

// Imports de Lógica (Hooks/Utils/Config)
import { useAcousticAnalysis } from '../../hooks/useAcousticAnalysis';
// turbo-web: 15 Hz analysis state moved INTO the LiveMonitors island —
// this tree no longer re-renders on playback ticks.

import { useAnalystShortcuts } from '../../hooks/useAnalystShortcuts';
import { useCompareMode } from '../../hooks/useCompareMode';
import { useLicense } from '../../licensing/LicenseContext';
import { OverlaySettings, VideoChoice, UserProfile, Timestamp } from '../../types';
import { useI18n } from '../../i18n/I18nContext';
import { dropdownFields, inconformityToCategoryMap, resultFields, inconformityScores, categoryMaxScores } from '../../utils/constants';
// F2 QoL Core: auto-save/retomada, modo foco e undo global.
import { useAutosaveResume, autosaveKeyFor } from '../../hooks/useAutosaveResume';
import { focusLayout, applyFocusPreferences } from '../../features/qol/focusMode';
import { registerUndoApplier } from '../../features/qol/undoApply';
import { getUndoLog, resetUndoLog } from '../../features/qol/undoStore';
// Troca D #3: horário do auto-save em fuso FIXO (não o do host).
import { formatTimestampInTz } from '../../features/i18n/format';
import { SAO_PAULO_CLOCK } from '../../features/gamification/periods';
import { humanizeSaveError, humanizeMarkerSaveError } from '../../utils/humanErrors';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { parseScore } from '../../utils/scoreFormat';
import { formatScorePtBr } from '../../engine/scoring';

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
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg bg-surface border border-hairline hover:bg-solar-accent/20 hover:border-solar-accent transition-colors focus:outline-none focus:ring-2 focus:ring-solar-accent"
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

// v3 (t15): exportado pra teste de componente — erro humano no save de
// marcadores é contrato da spec e precisa ser travado por teste.
export const TimestampModal: React.FC<TimestampModalProps> = ({ isOpen, onClose, videoRef, selectedOsIndex, userProfile, currentVideoId, currentVideoName }) => {
    const [timestamps, setTimestamps] = useState<Timestamp[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [comment, setComment] = useState('');
    const [sortOrder, setSortOrder] = useState<'time' | 'comment'>('time');
    const [editingTimestampId, setEditingTimestampId] = useState<string | null>(null);
    const [editingComment, setEditingComment] = useState('');
    // v3: falha de save vira mensagem humana (nunca alert cru); o comentário
    // digitado permanece no campo pra re-tentativa (promessa do hint).
    const [markerSaveError, setMarkerSaveError] = useState<string | null>(null);
    const listRef = useRef<HTMLUListElement>(null);

    // v3: mesmo gesto de fechar dos modais irmãos (ESC).
    useEscapeToClose(isOpen, onClose);

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
        setMarkerSaveError(null);
    };
    
    const handleSaveNew = async () => {
        if (!comment.trim() || !userProfile || !videoRef.current) return;
        setMarkerSaveError(null);

        try {
            // Dentro do try: em demo/offline o próprio loadFirebase rejeita —
            // a falha precisa cair na mensagem humana, não num rejection cru.
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
            await (await getDb()).ref(`timestamps/${selectedOsIndex}/${currentVideoId}`).push(newTimestamp);
            setComment('');
        } catch (error) {
            console.error("Failed to save timestamp:", error);
            // v3: mensagem humana inline (spec v3 — nunca raw error/alert);
            // o comentário permanece no campo conforme prometido no hint.
            const raw = error instanceof Error ? error.message : String(error);
            setMarkerSaveError(humanizeMarkerSaveError(raw).title);
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
            role="dialog"
            aria-modal="true"
            aria-label="Time Markers"
        >
            <div 
                className="bg-surface text-white w-full max-w-2xl h-[70vh] rounded-lg shadow-xl flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <header className="flex-shrink-0 flex justify-between items-center p-3 border-b border-hairline">
                    <div className="min-w-0">
                        <h2 className="font-bold text-lg leading-tight">Time Markers</h2>
                        <p className="text-xs text-gray-400 truncate" title={currentVideoName}>{currentVideoName}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="flex items-center gap-1 text-xs bg-bg px-2 py-1 rounded-md">
                            <span className="text-gray-400">Sort by:</span>
                            <button onClick={() => setSortOrder('time')} className={`chip-sort ${sortOrder === 'time' ? 'is-active' : ''}`}>Time</button>
                            <button onClick={() => setSortOrder('comment')} className={`chip-sort ${sortOrder === 'comment' ? 'is-active' : ''}`}>Comment</button>                        </div>
                        <button onClick={onClose} className="icon-btn p-2 rounded-full" aria-label="Close">
                            <XIcon className="w-5 h-5" />
                        </button>
                    </div>
                </header>
                <div className="flex-1 min-h-0 overflow-y-auto p-2">
                     {isLoading && (
                        <div className="p-4 space-y-3" aria-hidden="true">
                            <div className="skeleton skeleton-line w-2/5 mx-auto" />
                            <div className="skeleton skeleton-line" />
                            <div className="skeleton skeleton-line w-4/5" />
                            <div className="skeleton skeleton-line w-3/5" />
                            <span className="sr-only">Loading markers…</span>
                        </div>
                     )}
                     {!isLoading && sortedTimestamps.length === 0 && (
                        <div className="text-center p-6 text-gray-400">
                           <ClockIcon className="w-12 h-12 mx-auto mb-2 text-ink-secondary"/>
                           <h3 className="font-bold">No Markers</h3>
                           <p className="text-sm">Use the field below to add the first marker to this video.</p>
                        </div>
                     )}
                     <ul ref={listRef} className="space-y-1 p-2">
                        {sortedTimestamps.map(ts => (
                            <li key={ts.id} className="group bg-bg/50 rounded-lg">
                                {editingTimestampId === ts.id ? (
                                    <div className="p-3 space-y-2">
                                        <textarea value={editingComment} onChange={e => setEditingComment(e.target.value)} rows={2} className="w-full bg-bg border border-hairline rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200" autoFocus/>
                                        <div className="flex justify-end gap-2">
                                            <button onClick={handleCancelEdit} className="menu-item !w-auto">Cancel</button>
                                            <button onClick={handleSaveEdit} disabled={!editingComment.trim()} className="btn btn-primary px-3 py-1 text-sm disabled:opacity-50">Save</button>                                        </div>
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
                                                        <button onClick={() => handleStartEdit(ts)} className="icon-btn p-1 rounded-full" aria-label="Edit"><PencilIcon className="w-3 h-3" /></button>
                                                        <button onClick={() => handleDelete(ts.id)} className="icon-btn icon-btn-danger p-1 rounded-full" aria-label="Remove"><XIcon className="w-3 h-3" /></button>
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
                <div className="flex-shrink-0 p-3 border-t border-hairline bg-bg/50">
                    <div className="space-y-2">
                        {markerSaveError && (
                            <p role="alert" className="text-sm text-fail flex items-start gap-1.5">
                                <span aria-hidden="true">⚠</span>
                                <span>{markerSaveError} Your comment is still here — check the connection and try again.</span>
                            </p>
                        )}
                        <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a time marker comment..." rows={2} className="input w-full resize-none" onFocus={handleAddClick}/>
                        <div className="flex justify-end">
                            <button onClick={handleSaveNew} disabled={!comment.trim()} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50">Add Marker</button>                        </div>
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
  /** F2: modo foco global (header+lista já escondidos pelo App). */
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onToggleKeepMonitors?: () => void;
  /** F2: preferência do analista de manter monitores no modo foco. */
  focusKeepMonitors?: boolean;
  /**
   * QoL A1 (copiar marcações): pool de linhas carregadas p/ achar aulas
   * gêmeas + callback p/ commit da linha nova no App (persistência viva).
   */
  allRowsForTwins?: readonly { rowIndex: number; row: RowData }[];
  onCommitCopiedRow?: (nextRow: RowData) => void;
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
  isFocusMode = false,
  onToggleFocusMode,
  onToggleKeepMonitors,
  focusKeepMonitors = false,
  allRowsForTwins,
  onCommitCopiedRow,
  onClose,
}) => {
  const { t, locale } = useI18n();
  const lang = locale === 'pt' ? 'pt' : 'en';
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

  // ── F2 QoL Core ──────────────────────────────────────────────────────
  // Identificador estável da OS p/ chave de auto-save (W.O. da linha).
  const woIndex = headers.indexOf('W.O.');
  const osId = localRowData?.[woIndex]?.value || String(selectedOsIndex);

  // Espelho da linha p/ callbacks estáveis (transporte do player).
  const localRowDataRef = useRef<RowData | null>(null);
  useEffect(() => { localRowDataRef.current = localRowData; });

  // Transporte do player: alimenta debounce de auto-save + duração p/ resume.
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  const {
    lastSavedAt,
    scheduleSave,
    flushNow,
    markCleaned,
    planResumeForOs,
  } = useAutosaveResume(osId, videoDuration);

  const handleQolTransport = useCallback((state: { time: number; playing: boolean; duration: number }) => {
    setVideoDuration(state.duration > 0 ? state.duration : null);
    if (localRowDataRef.current) {
      scheduleSave(localRowDataRef.current, state.time);
    }
  }, [scheduleSave]);

  // Transporte combinado: A/B compare segue em lockstep E o QoL salva posição.
  const publishTransportCombined = useCallback((state: { time: number; playing: boolean; duration: number }) => {
    compare.publishTransport(state);
    handleQolTransport(state);
  }, [compare, handleQolTransport]);

  // Retomada: decisão única por OS/mídia; aplicada quando a duração chega.
  const resumeDecision = planResumeForOs();
  const appliedResumeRef = useRef<{ osId: string; src: string | null } | null>(null);
  useEffect(() => {
    if (!resumeDecision.shouldSeek || videoDuration === null) return;
    const alreadyApplied = appliedResumeRef.current?.osId === osId && appliedResumeRef.current?.src === videoSrc;
    if (alreadyApplied) return;
    playerControlsRef.current?.seekTo?.(Math.min(resumeDecision.positionSec, Math.max(0, videoDuration - 0.5)));
    appliedResumeRef.current = { osId, src: videoSrc };
  }, [resumeDecision, videoDuration, osId, videoSrc]);

  // Undo do edit-cell enquanto o workspace está montado (com coalescing).
  const lastEditEventRef = useRef<{ columnIndex: number; eventId: string; at: number } | null>(null);
  useEffect(() => {
    return registerUndoApplier('edit-cell', (event) => {
      const payload = event.payload as { prevData?: RowData };
      if (!payload.prevData) return false;
      queueMicrotask(() => setLocalRowData(payload.prevData!));
      lastEditEventRef.current = null;
      return true;
    });
  }, []);

  // Modo foco: regiões visíveis/ocultas derivadas do núcleo puro.
  const focusRegions = useMemo(
    () => applyFocusPreferences(focusLayout(isFocusMode), { keepMonitors: focusKeepMonitors }),
    [isFocusMode, focusKeepMonitors],
  );
  const hideRegion = (region: string): string =>
    isFocusMode && focusRegions.hidden.includes(region as never) ? 'hidden' : '';

  /** Registra/coalesce a edição de célula no log global de undo. */
  const recordCellEdit = useCallback((columnIndex: number, prevData: RowData) => {
    const log = getUndoLog();
    const now = Date.now();
    const last = lastEditEventRef.current;
    if (last && last.columnIndex === columnIndex && now - last.at < 1500) {
      // Mesma célula em fluxo: substitui o evento mantendo o estado ORIGINAL.
      const originalPrev = (log.undoable.find((e) => e.id === last.eventId)?.payload as { prevData?: RowData } | undefined)?.prevData;
      log.consume(last.eventId);
      const ev = log.record('edit-cell', t('qol.undo.editCell', { column: headers[columnIndex] ?? String(columnIndex) }), { prevData: originalPrev ?? prevData });
      lastEditEventRef.current = { columnIndex, eventId: ev.id, at: now };
      return;
    }
    const ev = log.record('edit-cell', t('qol.undo.editCell', { column: headers[columnIndex] ?? String(columnIndex) }), { prevData });
    lastEditEventRef.current = { columnIndex, eventId: ev.id, at: now };
  }, [headers, t]);

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
    seekTo?: (seconds: number) => void;
    changeVolume: (delta: number) => void;
  } | null>(null);
  const registerPlayerControls = useCallback((controls: NonNullable<typeof playerControlsRef.current>) => {
    playerControlsRef.current = controls;
    return () => { playerControlsRef.current = null; };
  }, []);

  // QoL A1: catálogo EFETIVO de atalhos (remapeamento do analista, hot-reload).
  const { effectiveDefs } = useShortcutPrefs();

  // Latest save handler lives in a ref so Ctrl+S always saves current data
  // (assigned right after handleSave below).
  const saveViaShortcutRef = useRef<() => void>(() => {});

  // S5.1: global analyst shortcuts. Player scope only when media exists,
  // workspace scope always (T/S act on the open analysis sheet).
  useAnalystShortcuts({
    enabled: true,
    scopeEnabled: { player: !!videoSrc },
    defs: effectiveDefs,
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

  // R3 v3: time markers for the redesigned timeline pins. Same Firebase path
  // the TimestampModal reads (`timestamps/<os>/<videoId>`) — a light 'value'
  // listener only for rendering; adding/removing still goes through the modal.
  const [timelineMarkers, setTimelineMarkers] = useState<Timestamp[]>([]);
  useEffect(() => {
    if (!selectedOsIndex || !currentVideoId) {
      queueMicrotask(() => setTimelineMarkers([]));
      return;
    }
    // turbo-web: acesso lazy ao DB — builds offline/demo nao tocam o SDK e
    // ficam sem pins, silenciosamente (mesmo contrato do modal de markers).
    if (!isFirebaseConfigured()) { return; }
    let active = true;
    let ref: ReturnType<Awaited<ReturnType<typeof getDb>>['ref']> | null = null;
    let unsub: UnsubscribeFn | null = null;
    const applySnapshot = (snapshot: any) => {
      const data = snapshot.val();
      if (data) {
        const list: Timestamp[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        list.sort((a: Timestamp, b: Timestamp) => a.time - b.time);
        setTimelineMarkers(list);
      } else {
        setTimelineMarkers([]);
      }
    };
    getDb().then((db) => {
      if (!active) return;
      ref = db.ref(`timestamps/${selectedOsIndex}/${currentVideoId}`);
      unsub = ref.on('value', applySnapshot, () => { /* permission/offline: sem pins */ });
    }).catch(() => { /* offline/demo: sem pins */ });
    return () => {
      active = false;
      if (ref && unsub) ref.off('value', unsub);
    };
  }, [selectedOsIndex, currentVideoId]);

  // R3 v3: clicking a pin seeks the leader video to the marker time.
  const handleMarkerSelect = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.currentTime = time;
    } catch { /* vídeo ainda não pronto */ }
  }, []);

  // R3 v3: nota final atual (memo) pro ScoreRing do cabeçalho.
  const finalScoreForRing = useMemo(() => {
    if (!localRowData || headers.length === 0) return null;
    const idx = headers.indexOf('FINAL SCORE');
    if (idx < 0) return null;
    return parseScore(localRowData[idx]?.value);
  }, [localRowData, headers]);

  // Tick 9: breakdown por categoria pro ScoreSpark (mesma matemática do
  // ScoringEngine usada nas colunas; memo — roda a cada marcação, não por render).
  const categoryBreakdownForSpark = useMemo(() => {
    if (!localRowData || headers.length === 0) return null;
    try {
      const { result } = recalculateScoresWithEngine(localRowData, headers);
      return result.categories;
    } catch {
      return null;
    }
  }, [localRowData, headers]);



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

      // F2: undo global — snapshot ANTES da edição (estado reversível).
      recordCellEdit(columnIndex, prevData);

      // F2: auto-save 200ms — a marcação feita já está a salvo.
      scheduleSave(newData, videoRef.current?.currentTime ?? 0);

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
  }, [headers, recordCellEdit, scheduleSave]);

  // ── QoL A1: copiar marcações de aula gêmea ────────────────────────────
  /** Aplica o plano da gêmea: undo snapshot + score recalculado + auto-save. */
  const handleCopyApplied = useCallback((nextRow: RowData, summary: { sourceLabel: string; plan: MarkingsCopyPlan }) => {
    setLocalRowData(prev => {
      const base = prev ?? nextRow;
      if (base !== nextRow) {
        // Snapshot ANTES da cópia p/ Ctrl+Z reverter (mesmo kind do edit-cell,
        // cujo applier restaura RowData inteira; label conta a história real).
        getUndoLog().record('edit-cell', t('qol.copyMarkings.undo', { os: summary.sourceLabel }), { prevData: base });
      }
      // Marcações mudaram → scores precisam recalcular (mesma via de 1 clique).
      const { cellUpdates } = recalculateScoresWithEngine(nextRow, headers);
      const withScores = applyScoreUpdatesLocal(nextRow, cellUpdates);
      scheduleSave(withScores, videoRef.current?.currentTime ?? 0);
      return withScores;
    });
    onCommitCopiedRow?.(nextRow);
  }, [headers, t, scheduleSave, onCommitCopiedRow]);

  const handleSave = async () => {
    if (!localRowData || selectedOsIndex === null) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveStatus('idle');
    try {
      await updateSheetRow(selectedOsIndex, localRowData);
      onSaveSuccess(localRowData);
      // F2: análise oficial na planilha → rascunho do auto-save sai do storage.
      markCleaned();
      // A1 scratchpad: nota pessoal também sai (mesmo contrato de "oficial").
      window.dispatchEvent(new CustomEvent('solaris:scratch-cleaned'));

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

  // F2: logout/troca de conta zera o undo global (eventos são do próprio usuário).
  useEffect(() => {
    if (!userProfile) resetUndoLog();
  }, [userProfile]);

  // F2: flush de emergência quando o workspace desmonta (troca/fechamento de OS).
  useEffect(() => {
    return () => { flushNow(); };
  }, [flushNow]);

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

  const osIdentifier = localRowData ? (localRowData[headers.indexOf('W.O.')]?.value || '') : '';


  // Solaris v3 P3: acoustic analysis engine (reverb/clip/noise/distortion/echo).
  // PCM getter re-fetches the current media and decodes to mono via
  // AudioContext; cross-origin streams (YouTube/Drive sem CORS) surface the
  // error dentro do painel, nunca derrubam o workspace.
  const acousticPcmGetter = React.useCallback((): Promise<{ samples: Float32Array | Float64Array; sampleRate: number }> => {
    const el = videoRef.current;
    if (!el || !videoSrc) return Promise.reject(new Error('No media loaded'));
    const srcUrl = el.currentSrc || videoSrc;
    return fetch(srcUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`fetch ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const AC: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) throw new Error('AudioContext unavailable');
        const ctx = new AC();
        return ctx.decodeAudioData(buf).then((audio) => {
          void ctx.close?.().catch(() => {});
          if (audio.numberOfChannels > 1) {
            const outL = audio.getChannelData(0);
            const outR = audio.getChannelData(1);
            const mono = new Float32Array(outL.length);
            for (let i = 0; i < outL.length; i++) mono[i] = (outL[i] + outR[i]) / 2;
            return { samples: mono, sampleRate: audio.sampleRate };
          }
          return { samples: audio.getChannelData(0).slice(), sampleRate: audio.sampleRate };
        });
      });
  }, [videoSrc]);
  const studioNameForAcoustics = osIdentifier || undefined;
  const acoustics = useAcousticAnalysis({
    getPcm: videoSrc ? acousticPcmGetter : null,
    mediaKey: videoSrc,
    studioName: studioNameForAcoustics,
  });
  /** Absolute seek usado pela timeline do painel acústico. */
  const seekToAcousticMark = useCallback(
    (tSec: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = tSec;
    },
    []
  );

  // Duração da mídia em estado (ref durante render viola react-hooks/refs).
  const [mediaDurationSec, setMediaDurationSec] = useState(0);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const sync = () => setMediaDurationSec(Number.isFinite(el.duration) ? el.duration : 0);
    sync();
    el.addEventListener('durationchange', sync);
    el.addEventListener('loadedmetadata', sync);
    return () => {
      el.removeEventListener('durationchange', sync);
      el.removeEventListener('loadedmetadata', sync);
    };
  }, []);


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
        className="flex items-center gap-2 px-4 py-2 rounded-md bg-solar-accent text-bg hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-solar-accent disabled:opacity-50"      >
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
        className="flex items-center gap-2 px-4 py-2 rounded-md border border-solar-accent/60 text-solar-accent hover:bg-solar-accent/10 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-solar-accent disabled:opacity-50"
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
    <div className="w-full h-full flex p-4 gap-4 overflow-hidden bg-bg">

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
      <div className={`w-2/3 h-full flex flex-col gap-4 ${hideRegion('monitors')}`}>
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
                    onTransport={publishTransportCombined}
                    onMarkerSelect={handleMarkerSelect}
                    markers={timelineMarkers}

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
                        <div className="flex flex-col items-center justify-center text-center text-ink-secondary p-4">
                            {/* Empty state ilustrado (momento wow #4) */}
                            <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true" className="mb-3 opacity-90">
                                <rect x="10" y="14" width="52" height="36" rx="6" stroke="var(--color-border-strong)" strokeWidth="1.5" />
                                <path d="M30 26l12 7-12 7v-14z" fill="url(#solaris-empty-play)" />
                                <path d="M22 58h28M28 63h16" stroke="var(--color-border-strong)" strokeWidth="1.5" strokeLinecap="round" />
                                <circle cx="57" cy="20" r="8" fill="var(--color-bg)" stroke="var(--color-border-strong)" strokeWidth="1.5" />
                                <path d="M53.5 20l2.4 2.4L60.5 17" stroke="var(--color-ok)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                <defs>
                                    <linearGradient id="solaris-empty-play" x1="30" y1="26" x2="42" y2="40">
                                        <stop stopColor="var(--color-accent-from)" />
                                        <stop offset="1" stopColor="var(--color-accent-to)" />
                                    </linearGradient>
                                </defs>
                            </svg>
                            <p className="font-bold text-lg mb-2 text-ink">{videoTitle}</p>
                            <p className="mb-4">Paste a YouTube link or pick a source below to start.</p>
                            <div className="w-96 max-w-full">
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
                onTransport={publishTransportCombined}
                    onMarkerSelect={handleMarkerSelect}
                    markers={timelineMarkers}

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
                    <div className="flex flex-col items-center justify-center text-center text-ink-secondary p-4">
                        {/* Empty state ilustrado (momento wow #4) */}
                        <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true" className="mb-3 opacity-90">
                            <rect x="10" y="14" width="52" height="36" rx="6" stroke="var(--color-border-strong)" strokeWidth="1.5" />
                            <path d="M30 26l12 7-12 7v-14z" fill="url(#solaris-empty-play2)" />
                            <path d="M22 58h28M28 63h16" stroke="var(--color-border-strong)" strokeWidth="1.5" strokeLinecap="round" />
                            <circle cx="57" cy="20" r="8" fill="var(--color-bg)" stroke="var(--color-border-strong)" strokeWidth="1.5" />
                            <path d="M53.5 20l2.4 2.4L60.5 17" stroke="var(--color-ok)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            <defs>
                                <linearGradient id="solaris-empty-play2" x1="30" y1="26" x2="42" y2="40">
                                    <stop stopColor="var(--color-accent-from)" />
                                    <stop offset="1" stopColor="var(--color-accent-to)" />
                                </linearGradient>
                            </defs>
                        </svg>
                        <p className="font-bold text-lg mb-2 text-ink">{videoTitle}</p>
                        <p className="mb-4">Paste a YouTube link or pick a source below to start.</p>
                        <div className="w-96 max-w-full">
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
            className="flex-shrink-0 flex items-center justify-center gap-3 py-1.5 px-4 rounded-lg bg-surface/80 dark:bg-surface/80 backdrop-blur-md border border-hairline text-sm"
            role="toolbar"
            aria-label={t('compare.title')}
          >
            <span className="font-bold text-xs uppercase tracking-wide text-solar-accent">{t('compare.title')}</span>
            <button
              onClick={compare.toggleSyncMode}
              className={`px-2 py-0.5 rounded-md text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent ${compare.syncMode === 'locked' ? 'bg-solar-accent text-bg hover:bg-solar-accent-hover' : 'bg-bg border border-hairline wash-hover'}`}              title={compare.syncMode === 'locked' ? t('compare.syncLocked') : t('compare.syncFree')}
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
                className="w-20 bg-bg border border-hairline rounded-md px-2 py-0.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-solar-accent"
              />
            </label>
            <span id="compare-offset-hint" className="text-[11px] text-ink-secondary hidden lg:inline">{t('compare.offsetHint')}</span>
            <button
              onClick={compare.resetOffset}
              className="px-2 py-0.5 rounded-md text-xs bg-bg border border-hairline wash-hover focus-visible:ring-2 focus-visible:ring-solar-accent"
            >
              0
            </button>
            <button
              onClick={compare.toggleLayout}
              className="icon-btn p-1.5 rounded-md focus-visible:ring-2 focus-visible:ring-solar-accent"
              title={t('compare.layout')}
              aria-label={t('compare.layout')}
            >
              {compare.layout === 'side-by-side' ? <ColumnsIcon className="w-4 h-4" /> : <RowsIcon className="w-4 h-4" />}
            </button>
          </div>
        )}
        <LiveMonitors videoRef={videoRef} videoSrc={videoSrc} />
{acoustics.status !== 'idle' && (
          <div className="mt-2 flex-shrink-0">
            <AcousticPanel
              status={acoustics.status}
              report={acoustics.report}
              error={acoustics.error}
              baselineInfo={acoustics.baselineInfo}
              durationSec={mediaDurationSec}
              onMarkReference={() => acoustics.markReference()}
              onForgetReference={() => acoustics.forgetReference()}
              onSeek={seekToAcousticMark}
            />
          </div>
        )}

      </div>
      <div className="w-1/3 h-full flex flex-col bg-surface/80 dark:bg-surface/80 backdrop-blur-md rounded-lg shadow-sm border border-hairline overflow-hidden">
          <header className="flex-shrink-0 flex justify-between items-center p-3 border-b border-hairline">
              <div className="flex items-center gap-3 min-w-0">
                  {/* Momento wow #3: anel do score final (0–5), cor semântica */}
                  {localRowData && headers.includes('FINAL SCORE') && (
                      <ScoreRing
                          score={finalScoreForRing}
                          size={44}
                          label={t('workspace.finalScore') || 'FINAL'}
                      />
                  )}
                  {/* Tick 9: micro-sparkline do perfil por categoria (spec v3:
                      "pill com número tabular + micro-sparkline da tendência").
                      Tooltip rico segue o padrão da casa; some junto com o anel. */}
                  {localRowData && headers.includes('FINAL SCORE') && categoryBreakdownForSpark && (
                      <Tooltip
                          content={
                              <div className="space-y-1 text-left">
                                  <p className="font-bold text-white">{t('workspace.scoreSparkTitle')}</p>
                                  {categoryBreakdownForSpark.map((c) => {
                                      const label = c.categoryId; // IDs do seed JÁ são o vocabulário do MVP
                                      return (
                                          <p key={c.categoryId} className="flex justify-between gap-6 text-xs">
                                              <span className="text-gray-400">{label}</span>
                                              <span className="font-mono tnum text-gray-300">
                                                  {formatScorePtBr(c.finalScore)}/{formatScorePtBr(c.maxScore)}
                                              </span>
                                          </p>
                                      );
                                  })}
                              </div>
                          }
                      >
                          <span tabIndex={0} role="img" aria-label={String(t('workspace.scoreSparkTitle'))} className="cursor-help inline-flex">
                              <ScoreSpark categories={categoryBreakdownForSpark} />
                          </span>
                      </Tooltip>
                  )}
                  <h2 className="font-bold">Analysis Sheet</h2>
              </div>
              <div className="flex items-center gap-2">
                  {/* F2 QoL: badge discreto do auto-save (spec A1 "salvo ✓"). */}
                  {lastSavedAt && (
                    <span
                      className="text-[11px] text-emerald-400/90 mr-1"
                      title={formatTimestampInTz(lastSavedAt, lang, SAO_PAULO_CLOCK)}
                      aria-live="polite"
                    >
                        ✓ {t('qol.autosave.saved')}
                    </span>
                  )}
                  {/* F2 QoL: modo foco — esconde tudo exceto player+timeline. */}
                  <button
                    onClick={onToggleFocusMode}
                    aria-pressed={isFocusMode}
                    title={t('qol.focus.toggle')}
                    aria-label={t('qol.focus.toggle')}
                    className={`p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent ${isFocusMode ? 'bg-solar-accent/30 text-solar-accent' : 'text-gray-400 hover:bg-gray-500/20 hover:text-white'}`}
                  >
                      <FocusIcon className="w-5 h-5" />
                  </button>
                  {saveStatus === 'error' && <p className="text-sm text-red-400 mr-2">{saveError}</p>}
                  {saveStatus === 'error' && saveError && (() => {
                      const he = humanizeSaveError(saveError);
                      return (
                          <div className="text-right mr-2 max-w-56" role="alert">
                              <p className="text-sm text-fail leading-tight">{he.title}</p>
                              <p className="text-2xs text-ink-secondary leading-tight">{he.hint}</p>
                          </div>
                      );
                  })()}

                  {/* S5.2: enter/exit A/B compare split (also via V). S6.1: Pro-gated — free tier gets the upsell lock. */}
                  {isCompareAllowed ? (
                    <button
                      onClick={handleToggleCompare}
                      disabled={!videoSrc}
                      aria-pressed={compare.isActive}
                      className={`p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-solar-accent disabled:opacity-50 disabled:cursor-not-allowed ${compare.isActive ? 'bg-solar-accent/30 text-solar-accent hover:bg-solar-accent/40' : 'icon-btn'}`}
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
                      className="relative icon-btn p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-solar-accent"
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
                    className="icon-btn p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-solar-accent disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Time Markers"
                    aria-label="Open time markers"
                  >
                    <ClockIcon className="w-5 h-5" />
                  </button>
                  {/* S5.1: keyboard shortcut reference (also via "?"). */}
                  <button
                    onClick={() => setIsShortcutHelpOpen(true)}
                    className="icon-btn p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-solar-accent"
                    title={t('header.shortcutHelp')}
                    aria-label={t('header.shortcutHelp')}
                  >
                    <InfoIcon className="w-5 h-5" />
                  </button>
                  <Popover
                    contentClassName="w-72"
                    trigger={
                      <button
                        className="icon-btn p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-solar-accent"
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
                        className="icon-btn p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-solar-accent"
                        title="Open Drive Picker"
                        aria-label="Open Drive Picker"
                    >
                        <GoogleDriveIcon className="w-5 h-5" />
                    </button>
                  )}
                  {/* QoL A1: copiar marcações de aula gêmea (só com pool carregado). */}
                  {allRowsForTwins && allRowsForTwins.length > 0 && (
                    <CopyMarkingsPopover
                      headers={headers}
                      targetRow={localRowData ?? selectedRow ?? []}
                      rows={allRowsForTwins}
                      currentRowIndex={selectedOsIndex}
                      onApply={handleCopyApplied}
                    />
                  )}
                  {renderSaveButton()}
                  {renderSyncButton()}
              </div>
          </header>
          {/* F2 QoL A1: scratchpad pessoal por OS — modo foco esconde, estado vive. */}
          <ScratchpadPanel osId={osId} visible={!isFocusMode} />
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
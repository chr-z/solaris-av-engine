import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

// --- IMPORTS CORRIGIDOS (NAVIGATION) ---
import VideoPlayer from '../Media/VideoPlayer';
import DriveFilePicker from '../Media/DriveFilePicker';
import SourceSelector from '../Media/SourceSelector';
import LocalFileHelper from '../Media/LocalFileHelper';

import RgbParade from '../Monitors/RgbParade';
import Waveform from '../Monitors/Waveform';
import VuMeter from '../Monitors/VuMeter';
import Spectrogram from '../Monitors/Spectrogram';
import OverlayControls from '../Monitors/OverlayControls';

import Dock from '../Layout/Dock';
import UserAvatar from '../Auth/UserAvatar';
import Popover from '../Core/Popover';
import { SaveIcon, ClipboardCheckIcon, YouTubeIcon, GoogleDriveIcon, XIcon, GridIcon, ClockIcon, PencilIcon } from '../Core/icons';

// Imports locais (mesma pasta Analysis)
import AnalysisForm from './AnalysisForm';
import { RowData, updateSheetRow, DriveFile } from './AnalysisSheet';

// Imports de Lógica (Hooks/Utils/Config)
import { useAVAnalysis } from '../../hooks/useAVAnalysis';
import { OverlaySettings, VideoChoice, UserProfile, Timestamp } from '../../types';
import { dropdownFields, inconformityToCategoryMap, resultFields, inconformityScores, categoryMaxScores } from '../../utils/constants';
import { database } from '../../config/firebase';
import firebase from 'firebase/compat/app';

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

        setIsLoading(true);
        const timestampsRef = database.ref(`timestamps/${selectedOsIndex}/${currentVideoId}`);
        
        const listener = timestampsRef.on('value', snapshot => {
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

        return () => timestampsRef.off('value', listener);
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
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            fileId: currentVideoId,
            fileName: currentVideoName,
        };
        
        try {
            await database.ref(`timestamps/${selectedOsIndex}/${currentVideoId}`).push(newTimestamp);
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
            database.ref(`timestamps/${selectedOsIndex}/${currentVideoId}/${timestampId}`).remove();
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
        database.ref(`timestamps/${selectedOsIndex}/${currentVideoId}/${editingTimestampId}/comment`).set(editingComment.trim());
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
                            <button onClick={() => setSortOrder('time')} className={`px-2 py-0.5 rounded ${sortOrder === 'time' ? 'bg-solar-accent text-white' : 'hover:bg-gray-500/20'}`}>Time</button>
                            <button onClick={() => setSortOrder('comment')} className={`px-2 py-0.5 rounded ${sortOrder === 'comment' ? 'bg-solar-accent text-white' : 'hover:bg-gray-500/20'}`}>Comment</button>
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
                                            <button onClick={handleSaveEdit} disabled={!editingComment.trim()} className="px-3 py-1 text-sm rounded-md bg-solar-accent text-white hover:bg-solar-accent-hover disabled:opacity-50">Save</button>
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
                        <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={`Add comment at ${formatTime(videoRef.current?.currentTime || 0)}...`} rows={2} className="w-full bg-solar-dark-bg border border-solar-dark-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200 dark:placeholder-gray-500" onFocus={handleAddClick}/>
                        <div className="flex justify-end">
                            <button onClick={handleSaveNew} disabled={!comment.trim()} className="px-4 py-2 text-sm font-semibold rounded-md bg-solar-accent text-white hover:bg-solar-accent-hover disabled:opacity-50">Add Marker</button>
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

const AnalysisWorkspace: React.FC<AnalysisWorkspaceProps> = ({
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const { analysisData, isAudioReady } = useAVAnalysis(videoRef, videoSrc);
  const [localRowData, setLocalRowData] = useState<RowData | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [zoomedDock, setZoomedDock] = useState<string | null>(null);
  const [isTimestampModalOpen, setIsTimestampModalOpen] = useState(false);
  
  // State for local video path sharing
  const [localFilePath, setLocalFilePath] = useState('');
  const [retrievedFilePath, setRetrievedFilePath] = useState<string | null>(null);


  // Fetch stored local file path when OS is selected
  useEffect(() => {
    if (selectedOsIndex) {
      const pathRef = database.ref(`analysisMetadata/${selectedOsIndex}/localFilePath`);
      pathRef.get().then(snapshot => {
        if (snapshot.exists()) {
          setRetrievedFilePath(snapshot.val());
        } else {
          setRetrievedFilePath(null);
        }
      });
    }
    setLocalFilePath('');
  }, [selectedOsIndex]);


  useEffect(() => {
    if (!selectedRow) {
        setLocalRowData(null);
        return;
    }
    
    let initialData = [...selectedRow];
    if (userProfile && headers.length > 0) {
        const prefillField = (fieldName: string, defaultValue: string) => {
            const fieldIndex = headers.indexOf(fieldName);
            if (fieldIndex > -1) {
                const cell = initialData[fieldIndex];
                if (!cell || !cell.value) {
                    initialData[fieldIndex] = { ...(initialData[fieldIndex] || {}), value: defaultValue };
                }
            }
        };
        
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
        prefillField('Responsibility', 'GENERAL');
    }

    const finalIndex = headers.indexOf('FINAL SCORE');
    const finalScoreValue = finalIndex > -1 ? initialData[finalIndex]?.value : '';
    const finalScoreNumber = parseFloat(finalScoreValue?.replace(',', '.') || 'NaN');
    
    if (isNaN(finalScoreNumber)) {
        const recalculatedData = recalculateScores(initialData, headers);
        setLocalRowData(recalculatedData);
    } else {
        setLocalRowData(initialData);
    }
  }, [selectedRow, userProfile, headers]);

  const handleDataChange = useCallback((columnIndex: number, value: string) => {
    setLocalRowData(prevData => {
      if (!prevData) return null;
      
      const newData = [...prevData];
      const newCell = { ...(newData[columnIndex] || {}), value };
      newData[columnIndex] = newCell;

      const fieldName = headers[columnIndex];
      if (inconformityToCategoryMap.hasOwnProperty(fieldName)) {
          return recalculateScores(newData, headers);
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
        await database.ref(`analysisMetadata/${selectedOsIndex}/localFilePath`).set(localFilePath.trim());
      }

      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error: any) {
      setSaveError(error.message || "Save failed. Check connection.");
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
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
        className="flex items-center gap-2 px-4 py-2 rounded-md bg-solar-accent text-white hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent disabled:opacity-50"
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

  const osIdentifier = localRowData ? (localRowData[headers.indexOf('W.O.')]?.value || '') : '';

  const renderZoomedContent = () => {
    switch (zoomedDock) {
      case 'rgbParade':
        return <RgbParade pixelData={analysisData.video} isZoomed />;
      case 'waveform':
        return <Waveform pixelData={analysisData.video} isZoomed />;
      case 'spectrogram':
        return <Spectrogram frequencyData={analysisData.frequency} isReady={isAudioReady} />;
      case 'vuMeter':
        return (
          <div className="w-full h-full flex justify-center items-center p-4">
            <div className="h-full w-40">
              <VuMeter volume={analysisData.volume} isReady={isAudioReady} />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

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
      <div className="w-2/3 h-full flex flex-col gap-4">
        <div className="flex-1 min-h-0">
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
        <div className="h-32 flex-shrink-0 flex gap-4">
            <div className="flex-1">
                <Dock title="RGB Parade" onZoom={() => setZoomedDock('rgbParade')}>
                  <RgbParade pixelData={analysisData.video} />
                </Dock>
            </div>
            <div className="flex-1">
                <Dock title="Waveform" onZoom={() => setZoomedDock('waveform')}>
                  <Waveform pixelData={analysisData.video} />
                </Dock>
            </div>
            <div className="flex-1">
                <Dock title="Spectrogram" onZoom={() => setZoomedDock('spectrogram')}>
                    <Spectrogram frequencyData={analysisData.frequency} isReady={isAudioReady} />
                </Dock>
            </div>
            <VuMeter volume={analysisData.volume} isReady={isAudioReady} onZoom={() => setZoomedDock('vuMeter')} />
        </div>
      </div>
      <div className="w-1/3 h-full flex flex-col bg-solar-light-content/80 dark:bg-solar-dark-content/80 backdrop-blur-md rounded-lg shadow-sm border border-solar-light-border dark:border-solar-dark-border overflow-hidden">
          <header className="flex-shrink-0 flex justify-between items-center p-3 border-b border-solar-light-border dark:border-solar-dark-border">
              <h2 className="font-bold">Analysis Sheet</h2>
              <div className="flex items-center gap-2">
                  {saveStatus === 'error' && <p className="text-sm text-red-400 mr-2">{saveError}</p>}
                  <button
                    onClick={() => setIsTimestampModalOpen(true)}
                    disabled={!currentVideoId}
                    className="p-2 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Time Markers"
                    aria-label="Open time markers"
                  >
                    <ClockIcon className="w-5 h-5" />
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
      {zoomedDock && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8 animate-fade-in-fast" 
          onClick={() => setZoomedDock(null)}
          role="dialog"
          aria-modal="true"
        >
          <div 
            className="relative w-full h-full max-w-5xl bg-solar-dark-bg border border-solar-dark-border rounded-lg shadow-2xl flex flex-col p-4"
            onClick={e => e.stopPropagation()}
          >
            <header className="flex-shrink-0 flex justify-between items-center pb-2 mb-2 border-b border-solar-dark-border">
                <h2 className="text-lg font-bold">
                    {zoomedDock === 'rgbParade' && 'RGB Parade'}
                    {zoomedDock === 'waveform' && 'Waveform'}
                    {zoomedDock === 'spectrogram' && 'Spectrogram'}
                    {zoomedDock === 'vuMeter' && 'VU Meter'}
                </h2>
                <button 
                    onClick={() => setZoomedDock(null)} 
                    className="p-2 rounded-full text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors"
                    aria-label="Close"
                >
                    <XIcon className="w-6 h-6" />
                </button>
            </header>
            <div className="flex-1 min-h-0">
              {renderZoomedContent()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalysisWorkspace;
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import Header from './components/Layout/Header';
import AnalysisSheetList from './components/Analysis/AnalysisSheet';
import { RowWithSheetIndex, DriveFile, RowData } from './components/Analysis/AnalysisSheet';
import LoginScreen from './components/Auth/LoginScreen';
import LoadingIndicator from './components/Core/LoadingIndicator';
import { OverlaySettings, VideoChoice, UserProfile } from './types';
import { DRIVE_FILE_REGEX, YOUTUBE_REGEX, DRIVE_FOLDER_REGEX } from './utils/regex';
import { database, auth } from './config/firebase';
import firebase from 'firebase/compat/app';
import { FilterState } from './components/Analysis/FilterControls';
import { WaveformCacheProvider } from './contexts/WaveformCacheContext';
import { logCaptureService } from './utils/logCapture';
import { DEMO_HEADERS, DEMO_ROWS } from './utils/demoData';
import { useI18n } from './i18n/I18nContext';
import { computeFilteredRows } from './utils/rowFiltering';
import { isAdminHash, isDashboardsHash } from './utils/adminRoute';
import { persistGuestEmail, clearGuestEmail } from './hooks/useAdminRole';
// F2 QoL Core: busca universal, modo foco e undo global 24h.
import { isCommandPaletteCombo, isUndoCombo } from './utils/shortcuts';
import type { IndexedDoc, ScoredResult } from './features/qol/commandPalette';
import {
  FOCUS_PREF_KEY,
  FOCUS_MONITORS_KEY,
  readFocusFlag,
  writeFocusFlag,
} from './features/qol/focusMode';
import { applyUndo, registerUndoApplier, clearUndoAppliers } from './features/qol/undoApply';
import { getUndoLog } from './features/qol/undoStore';

// Code splitting (S3.1): the heavy analysis workspace (player + monitors + form)
// is only fetched when an OS row is opened for the first time.
const AnalysisWorkspace = React.lazy(
  () => import(/* webpackChunkName: "analysis-workspace" */ './components/Analysis/AnalysisWorkspace'),
);

// v3 admin console (#/admin) ships as its own chunk; fetched on first visit only.
const AdminGate = React.lazy(() => import('./components/Admin/AdminGate'));

// F2: Ctrl+K command palette — own lazy chunk (only downloaded on first use).
const CommandPaletteModal = React.lazy(
  () => import(/* webpackChunkName: "command-palette" */ './components/Core/CommandPaletteModal'),
);

// Initialize log capture service
logCaptureService.init();

/* eslint-disable @typescript-eslint/no-explicit-any */
// Global GAPI declarations
declare const gapi: any;
declare const google: any;

// --- CONFIGURATION ---
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest"];
const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/youtube.readonly";

// Column Mapping - Must match English Google Sheet headers
const COLS = {
    WO: 'W.O.',
    EVENT: 'EVENT',
    UNIFORM: 'UNIFORM',
    ANALYST: 'ANALYST',
    OPERATOR: 'OPERATOR',
    ANALYSIS_TIME: 'ANALYSIS TIME',
    INSTRUCTOR: 'INSTRUCTOR',
    STUDIO: 'STUDIO'
};

type AuthStatus = 'initializing' | 'signedOut' | 'signedIn' | 'error';
type MediaSource = { source: File | string; info?: { name?: string; isDriveLink?: boolean; isYoutube?: boolean } };

/** True quando o foco está em campo de texto — undo global não deve roubar o atalho nativo de edição. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

const getInitialDateRange = (): { startDate: string; endDate: string } => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    return {
        startDate: formatDate(startOfMonth),
        endDate: formatDate(today),
    };
};

const App: React.FC = () => {
  const { t } = useI18n();
  // Media State
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState<string | null>(null);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [isLocalVideo, setIsLocalVideo] = useState(false);
  const [overlaySettings, setOverlaySettings] = useState<OverlaySettings>({
    type: 'none',
    opacity: 0.5,
    crosshairPosition: { x: 50, y: 50 },
  });
  const [isMediaLoading, setIsMediaLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastMediaSource, setLastMediaSource] = useState<MediaSource | null>(null);
  
  const videoSrcRef = useRef(videoSrc);
  useEffect(() => { videoSrcRef.current = videoSrc; }, [videoSrc]);

  // Data State
  const [selectedOsIndex, setSelectedOsIndex] = useState<number | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<RowWithSheetIndex[]>([]); 
  const [fullRowData, setFullRowData] = useState<RowData | null>(null); 
  const [isRowLoading, setIsRowLoading] = useState(false);
  const [videoChoices, setVideoChoices] = useState<VideoChoice[]>([]);

  // UI State
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerFolderId, setPickerFolderId] = useState<string | null>(null);

  // v3 admin route (#/admin): hash-driven, survives reload, back-button friendly.
  const [isAdminRoute, setIsAdminRoute] = useState(() => isAdminHash(window.location.hash));
  // P5 dashboards sub-route (#/admin/dashboards) — same RBAC gate, own panel.
  const [isDashboardsRoute, setIsDashboardsRoute] = useState(() => isDashboardsHash(window.location.hash));

  // ── F2 QoL Core ──────────────────────────────────────────────────────
  // Ctrl+K busca universal (modal lazy).
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  // Modo foco: esconde header+lista (workspace esconde monitores/form).
  const [isFocusMode, setIsFocusMode] = useState(() => readFocusFlag(window.localStorage, FOCUS_PREF_KEY));
  const [focusKeepMonitors, setFocusKeepMonitors] = useState(() => readFocusFlag(window.localStorage, FOCUS_MONITORS_KEY));
  const toggleFocusMode = useCallback(() => {
    setIsFocusMode((prev) => {
      writeFocusFlag(window.localStorage, FOCUS_PREF_KEY, !prev);
      return !prev;
    });
  }, []);
  const toggleKeepMonitors = useCallback(() => {
    setFocusKeepMonitors((prev) => {
      writeFocusFlag(window.localStorage, FOCUS_MONITORS_KEY, !prev);
      return !prev;
    });
  }, []);
  // Ctrl+Shift+Z undo global — appliers são registrados pelos donos da ação.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCommandPaletteCombo(event)) {
        event.preventDefault();
        setIsPaletteOpen((open) => !open);
        return;
      }
      if (isUndoCombo(event) && !isEditableTarget(event.target)) {
        event.preventDefault();
        applyUndo(getUndoLog());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);


  useEffect(() => {
    const onHashChange = () => {
      setIsAdminRoute(isAdminHash(window.location.hash));
      setIsDashboardsRoute(isDashboardsHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Auth State
  const [authStatus, setAuthStatus] = useState<AuthStatus>('initializing');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [initialLoadingMessage, setInitialLoadingMessage] = useState(t('loading.initializing'));

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<FilterState>({ ...getInitialDateRange(), inconformities: [], studio: '' });
  
  const selectedOsIndexRef = useRef(selectedOsIndex);
  useEffect(() => { selectedOsIndexRef.current = selectedOsIndex; }, [selectedOsIndex]);

  // --- Filtering Logic (pure pipeline, memoized) ---
  const { pending: filteredPendingRows, completed: filteredCompletedRows, special: filteredSpecialRows } =
    useMemo(
      () => computeFilteredRows(allRows, headers, filters, searchTerm, userProfile?.id === 'guest-reviewer-id'),
      [allRows, headers, filters, searchTerm, userProfile]
    );


  const isWorkspaceOpen = selectedOsIndex !== null;
  const selectedRowPartialData = isWorkspaceOpen ? allRows.find(item => item.rowIndex === selectedOsIndex)?.row : null;

  const handleDataLoaded = useCallback((loadedHeaders: string[], loadedRows: RowWithSheetIndex[]) => {
      // Prevent overwriting demo data with empty API response in guest mode
      if (userProfile?.id !== 'guest-reviewer-id') {
          setHeaders(loadedHeaders);
          setAllRows(loadedRows);
      }
  }, [userProfile]);

  // --- MEDIA HANDLING ---
  const handleSourceSelected = useCallback(async (source: File | string, info?: { name?: string; isDriveLink?: boolean; isYoutube?: boolean }) => {
    setLastMediaSource({ source, info });
    
    if (videoSrcRef.current && (videoSrcRef.current.startsWith('blob:') || videoSrcRef.current.startsWith('/api/'))) {
        if (videoSrcRef.current.startsWith('blob:')) URL.revokeObjectURL(videoSrcRef.current);
    }
    
    setVideoSrc(null);
    setCurrentVideoId(null);
    setErrorMessage(null);
    setIsMediaLoading(true);
    setIsLocalVideo(false);

    try {
        let videoId: string | null = null;
        if (typeof source === 'string') {
            const isYoutubeLink = info?.isYoutube;
            const isDriveLink = info?.isDriveLink;

            if (isYoutubeLink) {
                const match = source.match(YOUTUBE_REGEX);
                videoId = match ? match[1] : null;
            } else if (isDriveLink) {
                const match = source.match(DRIVE_FILE_REGEX);
                videoId = match ? match[1] : source;
            }
            setCurrentVideoId(videoId);

            // GUEST MODE BYPASS: If Guest, do not attempt to set auth cookies or call proxies
            if (userProfile?.id === 'guest-reviewer-id') {
                if (isYoutubeLink) {
                    // For demo, we might just load a mock video or the direct link if embedding is allowed
                    setVideoSrc(source); 
                    setVideoTitle("Demo Video (Guest Mode)");
                } else {
                    setVideoSrc(null);
                    setVideoTitle("Drive Video Unavailable in Guest Mode");
                    setErrorMessage("Secure Drive playback requires Google Authentication.");
                }
                setIsMediaLoading(false);
                return;
            }

            if (isYoutubeLink || isDriveLink) {
                const tokenResponse = gapi.client.getToken();
                const accessToken = tokenResponse?.access_token;
                if (!accessToken) throw new Error('User not authenticated. Please sign in.');
                
                const cookieResponse = await fetch('/api/set-auth-cookie', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: accessToken }),
                });

                if (!cookieResponse.ok) throw new Error('Failed to initialize secure video session.');

                let proxyUrl = '';
                if (isYoutubeLink) {
                    proxyUrl = `/api/youtube-proxy?url=${encodeURIComponent(source)}`;
                } else { 
                    const fileId = source;
                    if (!fileId) throw new Error("Invalid Drive File ID.");
                    proxyUrl = `/api/drive-proxy?fileId=${fileId}`;
                }
                
                setVideoSrc(proxyUrl);
                setVideoTitle(info?.name || (isYoutubeLink ? 'YouTube Video' : 'Google Drive Video'));

            } else { 
                setVideoSrc(source);
                setVideoTitle(info?.name || 'URL Video');
            }
        } else { // Local File
            setIsLocalVideo(true);
            const url = URL.createObjectURL(source);
            // Sanitize filename for Firebase path compatibility
            const safeName = btoa(unescape(encodeURIComponent(source.name)))
                .replace(/\+/g, '-') 
                .replace(/\//g, '_')
                .replace(/=/g, ''); 
            const uniqueLocalId = `local-${safeName}-${source.size}-${source.lastModified}`;
            setVideoSrc(url);
            setVideoTitle(source.name);
            setCurrentVideoId(uniqueLocalId);
        }
    } catch (error: any) {
        console.error('Media Load Error:', error);
        setErrorMessage(error.message || 'Unknown error occurred.');
        setVideoTitle(`Media Load Failed`);
        setVideoSrc(null);
        setCurrentVideoId(null);
    } finally {
        setIsMediaLoading(false);
    }
  }, [userProfile]);

  const findVideoUrlsInData = (rowData: RowData, headers: string[]): VideoChoice[] => {
      const choices: VideoChoice[] = [];
      if (!rowData || !headers || headers.length === 0) return choices;
  
      const checkUrl = (url: string | undefined): Omit<VideoChoice, 'sourceName' | 'url'> | null => {
          if (!url) return null;
          if (YOUTUBE_REGEX.test(url)) return { type: 'youtube' };
          if (DRIVE_FILE_REGEX.test(url)) return { type: 'driveFile' };
          if (DRIVE_FOLDER_REGEX.test(url)) return { type: 'driveFolder' };
          return null;
      };
  
      const processCell = (headerName: string) => {
          const headerIndex = headers.indexOf(headerName);
          if (headerIndex > -1) {
              const cell = rowData[headerIndex];
              const urlInfo = checkUrl(cell?.link);
              if (cell?.link && urlInfo) {
                  choices.push({ url: cell.link, ...urlInfo, sourceName: headerName });
              }
          }
      };
      
      processCell(COLS.WO);
      processCell(COLS.OPERATOR);
  
      return choices;
  };
  
  // --- ROW SELECTION & LOCKING LOGIC ---
  const handleOsSelect = useCallback(async (rowIndex: number, partialRowData: RowData) => {
    const currentSelected = selectedOsIndexRef.current;
    if (currentSelected === rowIndex) return;

    if (!userProfile) {
        alert("Authentication required.");
        return;
    }

    // GUEST MODE: Skip locking and API fetching. Load Mock Data.
    if (userProfile.id === 'guest-reviewer-id') {
        setSelectedOsIndex(rowIndex);
        // Find row in existing demo data instead of fetching
        const demoRow = allRows.find(r => r.rowIndex === rowIndex);
        if (demoRow) {
            setFullRowData(demoRow.row);
            setVideoTitle('Demo Video Mode');
            // Simulate video finding logic for demo
            const choices = findVideoUrlsInData(demoRow.row, headers);
            if (choices.length > 0) {
                 handleSourceSelected(choices[0].url, { 
                     name: "Demo Video", 
                     isYoutube: choices[0].type === 'youtube',
                     isDriveLink: choices[0].type === 'driveFile'
                 });
            }
        }
        return;
    }
    
    // ADMIN MODE: Real Locking Logic
    if (currentSelected !== null) {
        const oldLockRef = database.ref(`locks/${currentSelected}`);
        const snapshot = await oldLockRef.get();
        if (snapshot.exists() && snapshot.val().user.id === userProfile.id) {
            await oldLockRef.set(null);
        }
    }

    const lockRef = database.ref(`locks/${rowIndex}`);
    let lockAcquired = false;

    try {
        const { committed, snapshot } = await lockRef.transaction((currentData) => {
            if (currentData === null) {
                return { user: userProfile, timestamp: firebase.database.ServerValue.TIMESTAMP };
            }
            const staleTime = 15 * 60 * 1000; 
            const isStale = !currentData.timestamp || (Date.now() - currentData.timestamp > staleTime);
            
            if (isStale) return { user: userProfile, timestamp: firebase.database.ServerValue.TIMESTAMP };
            if (currentData.user?.id === userProfile.id) return { ...currentData, timestamp: firebase.database.ServerValue.TIMESTAMP };

            return; // Abort
        });

        if (committed) {
            lockAcquired = true;
        } else if (snapshot.exists()) {
             const lockData = snapshot.val();
             if (lockData && lockData.user?.id === userProfile.id) lockAcquired = true;
             else if (lockData) alert(`${lockData.user?.givenName || 'Another analyst'} is currently editing this W.O.`);
        }
    } catch (error) {
        console.error("Lock transaction failed: ", error);
        alert("System error: Could not verify lock status.");
        return;
    }

    if (!lockAcquired) return;
    
    // Reset Workspace
    setLastMediaSource(null);
    if (videoSrcRef.current && videoSrcRef.current.startsWith('blob:')) URL.revokeObjectURL(videoSrcRef.current);
    
    setVideoSrc(null);
    setCurrentVideoId(null);
    setIsLocalVideo(false);
    setVideoTitle(null);
    setSelectedOsIndex(rowIndex);
    setFullRowData(null);
    setIsRowLoading(true);
    setErrorMessage(null);
    setVideoChoices([]);
    setIsPickerOpen(false);
    setPickerFolderId(null);

    // Fetch Full Row Data (Admin Mode)
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired. Please sign in again.');

      const response = await fetch(`/api/sheet-row?rowIndex=${rowIndex}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
       if (!response.ok) throw new Error('Failed to fetch row data.');
      
      const fullRowData: RowData = await response.json();
      
      if (selectedOsIndexRef.current !== rowIndex) return;
      
      // Integrity Check
      const woIndex = headers.indexOf(COLS.WO);
      if (woIndex === -1) throw new Error(`Column '${COLS.WO}' not found.`);

      const partialWoValue = partialRowData[woIndex]?.value;
      const fullWoValue = fullRowData[woIndex]?.value;

      if (partialWoValue !== fullWoValue) {
        console.error(`Sync Mismatch: List="${partialWoValue}", Fetched="${fullWoValue}".`);
        throw new Error("Data synchronization error. Please refresh.");
      }
      
      setFullRowData(fullRowData);

      // Video Discovery
      const choices = findVideoUrlsInData(fullRowData, headers);
      
      const driveFolderChoice = choices.find(c => c.type === 'driveFolder');
      if (driveFolderChoice) {
          const match = driveFolderChoice.url.match(DRIVE_FOLDER_REGEX);
          if (match && match[1]) {
              setPickerFolderId(match[1]);
              setIsPickerOpen(true);
              setVideoTitle('Select video from Drive folder');
              setIsMediaLoading(false);
              return;
          }
      }

      const fileChoices = choices.filter(c => c.type !== 'driveFolder');

      if (fileChoices.length === 1) {
          const choice = fileChoices[0];
          const woValue = fullRowData[headers.indexOf(COLS.WO)]?.value || 'Video';
          
          let source = choice.url;
          if (choice.type === 'driveFile') {
              const match = choice.url.match(DRIVE_FILE_REGEX);
              source = match ? match[1] : choice.url;
          }
          
          handleSourceSelected(source, {
              name: `W.O. ${woValue} Video (${choice.sourceName})`,
              isYoutube: choice.type === 'youtube',
              isDriveLink: choice.type === 'driveFile'
          });
      } else if (fileChoices.length > 1) {
          setVideoChoices(fileChoices);
          setVideoSrc(null);
          setVideoTitle('Multiple videos found');
          setIsMediaLoading(false);
      } else { 
          setVideoSrc(null);
          setVideoTitle('No video found');
          setIsMediaLoading(false);
      }
    } catch (error: any) {
        console.error(`Row Processing Error:`, error);
        setErrorMessage(`Error: ${error.message}`);
        setVideoTitle('Sync Error');
        setVideoSrc(null);
        setFullRowData(null); 
    } finally {
        setIsRowLoading(false);
    }
  }, [headers, handleSourceSelected, userProfile, allRows]);
  
    const handleRetryLoad = useCallback(() => {
    if (lastMediaSource) handleSourceSelected(lastMediaSource.source, lastMediaSource.info);
  }, [lastMediaSource, handleSourceSelected]);

  const handleSaveSuccess = (savedRow: RowData) => {
    setAllRows(prevRows => {
        const newRows = [...prevRows];
        if (selectedOsIndex !== null) {
            const arrayIndexToUpdate = newRows.findIndex(item => item.rowIndex === selectedOsIndex);
            
            if (arrayIndexToUpdate === -1) return newRows;

            const originalItem = newRows[arrayIndexToUpdate];
            const updatedPartialRow = [...originalItem.row];
            
            savedRow.forEach((cell, index) => {
              if (cell !== undefined && index < updatedPartialRow.length) {
                updatedPartialRow[index] = cell;
              }
            });

            newRows[arrayIndexToUpdate] = { ...originalItem, row: updatedPartialRow };
        }
        return newRows;
    });
  };

  const handleCloseWorkspace = useCallback(() => {
    if (selectedOsIndex !== null && userProfile?.id !== 'guest-reviewer-id') {
        const lockRef = database.ref(`locks/${selectedOsIndex}`);
        lockRef.get().then(snapshot => {
            if (snapshot.exists() && snapshot.val().user.id === userProfile?.id) {
                lockRef.set(null);
            }
        });
    }
    setSelectedOsIndex(null);
    setFullRowData(null);
    setCurrentVideoId(null);
    setVideoSrc(null);
    setIsLocalVideo(false);
  }, [selectedOsIndex, userProfile]);

  const handleUnloadMedia = useCallback(() => {
    if (videoSrcRef.current && videoSrcRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(videoSrcRef.current);
    }
    setVideoSrc(null);
    setCurrentVideoId(null);
    setIsLocalVideo(false);
    setVideoTitle(null);
    setErrorMessage(null);
    setVideoChoices([]);
    setLastMediaSource(null);
    setIsMediaLoading(false);
    setIsPickerOpen(false);
  }, []);

  const handleOpenPicker = useCallback((folderId: string) => {
    setPickerFolderId(folderId);
    setIsPickerOpen(true);
  }, []);

  const handleClosePicker = useCallback(() => setIsPickerOpen(false), []);

  const handleFileSelectedFromPicker = useCallback((file: DriveFile) => {
    handleSourceSelected(file.id, { name: file.name, isDriveLink: true });
    setIsPickerOpen(false);
  }, [handleSourceSelected]);
  
  
  useEffect(() => {
    if (authStatus === 'initializing') {
        const messages = [
            t('loading.step.workspace'),
            t('loading.step.monitors'),
            t('loading.step.vectorscopes'),
            t('loading.step.audio'),
            t('loading.step.pixels'),
            t('loading.step.coffee'),
        ];
        
        let messageIndex = 0;
        const intervalId = setInterval(() => {
            messageIndex = (messageIndex + 1) % messages.length;
            setInitialLoadingMessage(messages[messageIndex]);
        }, 2500);
        return () => clearInterval(intervalId);
    }
  }, [authStatus, t]);

  // Presence System
  useEffect(() => {
    if (authStatus !== 'signedIn' || !userProfile || userProfile.id === 'guest-reviewer-id') {
        if (database) database.goOffline();
        return;
    }
    
    database.goOnline();
    const userStatusRef = database.ref('presence/' + userProfile.id);
    const isOfflineForDatabase = { ...userProfile, status: 'offline', last_changed: firebase.database.ServerValue.TIMESTAMP };
    const isOnlineForDatabase = { ...userProfile, status: 'online', last_changed: firebase.database.ServerValue.TIMESTAMP };
    const connectedRef = database.ref('.info/connected');
    
    const listener = connectedRef.on('value', (snap: firebase.database.DataSnapshot) => {
        if (snap.val() === true) {
            userStatusRef.onDisconnect().set(isOfflineForDatabase).then(() => userStatusRef.set(isOnlineForDatabase));
        }
    });

    return () => {
        connectedRef.off('value', listener);
        userStatusRef.set(isOfflineForDatabase);
        database.goOffline();
    };
  }, [authStatus, userProfile]);

  // Auth & Init Flow
  useEffect(() => {
    const initializeGapiForUser = async (user: firebase.User) => {
        try {
            await new Promise<void>((resolve, reject) => gapi.load('client', { callback: resolve, onerror: reject }));

            const tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: async (tokenResponse: any) => {
                    try {
                        if (tokenResponse && tokenResponse.access_token) {
                            await gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS });
                            gapi.client.setToken({ access_token: tokenResponse.access_token });
                            
                            const profile: UserProfile = {
                                id: user.uid,
                                name: user.displayName || '',
                                givenName: user.displayName?.split(' ')[0] || 'Analyst',
                                picture: user.photoURL || '',
                                email: user.email || ''
                            };
                            setUserProfile(profile);
                            setAuthError(null);
                            setAuthStatus('signedIn');
                        } else {
                            throw new Error("Failed to obtain Google access token.");
                        }
                    } catch (err: any) {
                        console.error("GAPI Init/Token Callback Error:", err);
                        setAuthError(err.details || err.message || 'Failed to initialize Google session.');
                        auth.signOut();
                    }
                },
                error_callback: (error: any) => {
                    console.error("GSI Error:", error);
                    setAuthError('Google session expired. Please sign in again.');
                    auth.signOut();
                }
            });
            tokenClient.requestAccessToken({ prompt: '' });
        } catch (err: any) {
            console.error("GAPI Load Error:", err);
            setAuthError('Failed to load Google libraries.');
            setAuthStatus('error');
        }
    };

    const initializeGapiForSignedOut = async () => {
        try {
            await new Promise<void>((resolve, reject) => gapi.load('client', { callback: resolve, onerror: reject }));
            await gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS });
            setAuthStatus('signedOut');
        } catch (err: any) {
            console.error("GAPI Init Error (Signed Out):", err);
            setAuthError('Failed to initialize Google libraries.');
            setAuthStatus('error');
        }
    };

    const startTime = Date.now();
    const pollForApis = () => {
        if (typeof gapi !== 'undefined' && gapi.load && typeof google !== 'undefined' && google.accounts) {
            const unsubscribe = auth.onAuthStateChanged(user => {
                if (user) initializeGapiForUser(user);
                else {
                    setUserProfile(null);
                    initializeGapiForSignedOut();
                }
            });
            return unsubscribe;
        } else if (Date.now() - startTime > 10000) {
            setAuthError('Timeout loading Google libraries.');
            setAuthStatus('error');
        } else {
            setTimeout(pollForApis, 100);
        }
    };

    const unsubscribe = pollForApis();
    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  const handleLogin = useCallback(async () => {
    setIsAuthLoading(true);
    setAuthError(null);
    const provider = new firebase.auth.GoogleAuthProvider();
    SCOPES.split(' ').forEach(scope => provider.addScope(scope));

    try {
      await auth.signInWithPopup(provider);
    } catch (error: any) {
        console.error("Firebase Auth Error:", error);
        let message = t('auth.loginFailed');
        if (error.code === 'auth/popup-closed-by-user') message = t('auth.popupClosed');
        else if (error.code === 'auth/cancelled-popup-request') { setIsAuthLoading(false); return; }
        setAuthError(message);
        setAuthStatus('signedOut');
    } finally {
        setIsAuthLoading(false);
    }
  }, [t]);

  // Guest Logic (FIXED: Loads demo data)
  const handleGuestLogin = useCallback(() => {
    setIsAuthLoading(true);
    setTimeout(() => {
        setUserProfile({
            id: 'guest-reviewer-id',
            name: 'Guest Reviewer',
            givenName: 'Guest',
            picture: 'https://ui-avatars.com/api/?name=Guest+Reviewer&background=0D8ABC&color=fff', // Added better avatar
            email: 'guest@solaris.demo'
        });
        persistGuestEmail('guest@solaris.demo');

        // --- INJECT DEMO DATA HERE ---
        setHeaders(DEMO_HEADERS);
        setAllRows(DEMO_ROWS);
        
        setAuthError(null);
        setAuthStatus('signedIn');
        setIsAuthLoading(false);
    }, 800);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
        await auth.signOut();
        setSelectedOsIndex(null);
        setVideoSrc(null);
        clearGuestEmail(); // v3: guest identity must not leak into the next session's admin gate
        // Clear data on logout
        setAllRows([]);
        setHeaders([]);
    } catch (error) { console.error("Sign out error", error); }
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // ── F2: busca universal (Ctrl+K) ─────────────────────────────────────
  // Docs derivados das linhas carregadas + settings conhecidos. Memoizado:
  // reconstruir é barato e só ocorre quando os dados mudam.
  const paletteDocs = useMemo<IndexedDoc[]>(() => {
    const osDocs: IndexedDoc[] = allRows.map((r) => ({
      id: `os:${r.rowIndex}`,
      kind: 'os',
      title: `W.O. ${r.row[headers.indexOf(COLS.WO)]?.value ?? r.rowIndex}`,
      subtitle: headers.indexOf(COLS.STUDIO) > -1 ? r.row[headers.indexOf(COLS.STUDIO)]?.value ?? undefined : undefined,
      keywords: [String(r.rowIndex)],
    }));
    const settingDocs: IndexedDoc[] = [
      { id: 'set:focus', kind: 'setting', title: t('qol.focus.toggle'), keywords: ['focus', 'foco'] },
      { id: 'set:focusMonitors', kind: 'setting', title: t('qol.focus.monitors'), keywords: ['monitor', 'waveform'] },
      { id: 'set:shortcuts', kind: 'setting', title: t('header.shortcutHelp'), keywords: ['keyboard', 'atalhos', '?'] },
    ];
    return [...osDocs, ...settingDocs];
  }, [allRows, headers, t]);

  const handlePalettePick = useCallback((result: ScoredResult) => {
    if (result.entry.kind === 'os') {
      const rowIndex = Number(result.entry.id.slice(3));
      const target = allRows.find((r) => r.rowIndex === rowIndex);
      if (target && userProfile) handleOsSelect(rowIndex, target.row);
    } else if (result.entry.id === 'set:focus') {
      toggleFocusMode();
    } else if (result.entry.id === 'set:focusMonitors') {
      toggleKeepMonitors();
    }
  }, [allRows, userProfile, toggleFocusMode, toggleKeepMonitors]);

  // Overlays globais do F2: palette lazy sobre qualquer rota autenticada.
  const f2Overlays = (
    <React.Suspense fallback={null}>
      {isPaletteOpen && (
        <CommandPaletteModal
          isOpen
          onClose={() => setIsPaletteOpen(false)}
          docs={paletteDocs}
          onPick={handlePalettePick}
          kindLabels={{
            palette: t('qol.palette.title'),
            placeholder: t('qol.palette.placeholder'),
            empty: t('qol.palette.empty'),
            os: t('qol.kind.os'),
            analyst: t('qol.kind.analyst'),
            studio: t('qol.kind.studio'),
            setting: t('qol.kind.setting'),
          }}
        />
      )}
    </React.Suspense>
  );

  const renderContent = () => {
    switch(authStatus) {
      case 'initializing':
        return (
          <div className="flex items-center justify-center h-screen bg-solar-dark-bg">
            <LoadingIndicator statusText={initialLoadingMessage} />
          </div>
        );
      case 'signedOut':
      case 'error':
        return (
          <LoginScreen 
            onLogin={handleLogin}
            onGuestLogin={handleGuestLogin}
            isLoading={isAuthLoading}
            error={authError}
          />
        );
      case 'signedIn':
        // v3 admin console: replaces <main> while the app shell (Header) stays mounted.
        if (isAdminRoute) {
          return (
            <WaveformCacheProvider>
              <div className="flex flex-col h-screen font-sans text-sm bg-solar-light-bg dark:bg-solar-dark-bg text-gray-800 dark:text-gray-200 overflow-hidden">
                <a href="#main-workspace" className="skip-link">{t('a11y.skipToContent')}</a>
                {/* F2 modo foco também vale no console admin (esconde o shell). */}
                <div className={`flex-shrink-0 ${isFocusMode ? 'hidden' : ''}`}>
                  <Header
                    onSourceSelected={handleSourceSelected}
                    isWorkspaceOpen={false}
                    onCloseWorkspace={() => { /* no workspace behind the admin route */ }}
                    title="Solaris"
                    userProfile={userProfile}
                    onLogout={handleLogout}
                  />
                </div>
                <React.Suspense fallback={
                  <div className="flex items-center justify-center h-screen bg-solar-dark-bg">
                    <LoadingIndicator statusText={t('loading.generic')} />
                  </div>
                }>
                  <AdminGate dashboards={isDashboardsRoute} />
                </React.Suspense>
                {f2Overlays}
              </div>
            </WaveformCacheProvider>
          );
        }
        return (
          <WaveformCacheProvider>
            <div className="flex flex-col h-screen font-sans text-sm bg-solar-light-bg dark:bg-solar-dark-bg text-gray-800 dark:text-gray-200 overflow-hidden">
              <a
                href="#main-workspace"
                className="skip-link"
              >
                {t('a11y.skipToContent')}
              </a>
              <div className={`flex-shrink-0 ${isFocusMode ? 'hidden' : ''}`}>
                <Header
                  onSourceSelected={handleSourceSelected}
                  isWorkspaceOpen={isWorkspaceOpen}
                  onCloseWorkspace={handleCloseWorkspace}
                  title={isWorkspaceOpen && selectedRowPartialData ? `W.O: ${selectedRowPartialData[headers.indexOf(COLS.WO)]?.value}` : 'Solaris'}
                  userProfile={userProfile}
                  onLogout={handleLogout}
                />
              </div>
              <main id="main-workspace" className="flex-1 relative overflow-hidden bg-solar-light-bg dark:bg-solar-dark-bg">
                <div className={`absolute inset-0 h-full transition-all duration-500 ease-in-out ${isWorkspaceOpen && !isFocusMode ? 'w-[320px]' : 'w-full'} ${isFocusMode ? 'hidden' : ''}`}>
                  <AnalysisSheetList
                    onDataLoaded={handleDataLoaded}
                    onRowSelected={handleOsSelect}
                    selectedOsIndex={selectedOsIndex}
                    userProfile={userProfile}
                    headers={headers}
                    filteredPendingRows={filteredPendingRows}
                    filteredCompletedRows={filteredCompletedRows}
                    filteredSpecialRows={filteredSpecialRows}
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    filters={filters}
                    setFilters={setFilters}
                  />
                </div>
                <div
                  className={`absolute top-0 right-0 h-full bg-solar-light-bg dark:bg-solar-dark-bg transition-transform duration-500 ease-in-out ${isWorkspaceOpen ? 'translate-x-0' : 'translate-x-full'}`}
                  style={{ width: isFocusMode ? '100%' : 'calc(100% - 320px)' }}
                >
                  {isWorkspaceOpen && (
                    <React.Suspense
                      fallback={
                        <div className="w-full h-full flex items-center justify-center">
                          <LoadingIndicator statusText={t('loading.step.monitors')} />
                        </div>
                      }
                    >
                      <AnalysisWorkspace
                        key={selectedOsIndex}
                      selectedRow={fullRowData}
                      headers={headers}
                      videoSrc={videoSrc}
                      videoTitle={videoTitle ?? t('workspace.noVideo')}
                      currentVideoId={currentVideoId}
                      isLocalVideo={isLocalVideo}
                      videoChoices={videoChoices}
                      isMediaLoading={isMediaLoading}
                      isRowLoading={isRowLoading}
                      overlaySettings={overlaySettings}
                      setOverlaySettings={setOverlaySettings}
                      onLoadMedia={handleSourceSelected}
                      errorMessage={errorMessage}
                      selectedOsIndex={selectedOsIndex!}
                      onSaveSuccess={handleSaveSuccess}
                      onRetryLoad={handleRetryLoad}
                      isPickerOpen={isPickerOpen}
                      pickerFolderId={pickerFolderId}
                      onOpenPicker={handleOpenPicker}
                      onClosePicker={handleClosePicker}
                      onFileFromPickerSelected={handleFileSelectedFromPicker}
                      userProfile={userProfile}
                      isFocusMode={isFocusMode}
                      onToggleFocusMode={toggleFocusMode}
                      onToggleKeepMonitors={toggleKeepMonitors}
                      focusKeepMonitors={focusKeepMonitors}
                        onClose={handleUnloadMedia}
                      />
                    </React.Suspense>
                  )}
                </div>
              </main>
              {f2Overlays}
            </div>
          </WaveformCacheProvider>
        );
      default:
        return null;
    }
  }

  return renderContent();
};

export default App;
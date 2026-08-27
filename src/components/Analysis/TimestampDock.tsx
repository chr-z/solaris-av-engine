import React, { useState, useEffect, useRef } from 'react';
import { getDb, getFirebaseCompat, isFirebaseConfigured, type UnsubscribeFn } from '../../config/firebase';
import { Timestamp, UserProfile } from '../../types';
import { XIcon } from '../Core/icons';
import UserAvatar from '../Auth/UserAvatar';
import Dock from '../Layout/Dock';
import { humanizeMarkerSaveError } from '../../utils/humanErrors';

interface TimestampDockProps {
    videoRef: React.RefObject<HTMLVideoElement>;
    selectedOsIndex: number;
    userProfile: UserProfile | null;
    /** Reactive "media loaded" signal from the parent (e.g. !!videoSrc). */
    hasMedia?: boolean;
}

const formatTime = (totalSeconds: number): string => {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const TimestampDock: React.FC<TimestampDockProps> = ({ videoRef, selectedOsIndex, userProfile, hasMedia = false }) => {
    const [timestamps, setTimestamps] = useState<Timestamp[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdding, setIsAdding] = useState(false);
    const [comment, setComment] = useState('');
    // v3: falha de save vira mensagem humana inline (nunca alert cru);
    // o comentário digitado permanece no campo pra re-tentativa.
    const [markerSaveError, setMarkerSaveError] = useState<string | null>(null);
    // turbo-web: videoRef.current must NEVER be read during render (react-hooks/
    // refs) — it is null on first paint and reading it makes render output depend
    // on a mutable ref. The current time and media presence are captured into
    // state at the moment "Add" opens, so renders stay pure.
    const [markerTime, setMarkerTime] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);

    useEffect(() => {
        if (!selectedOsIndex) return;

        // turbo-web: setState deferred to a microtask — synchronous setState
        // inside the effect body triggers cascading renders (react-hooks/
        // set-state-in-effect) and double-renders the dock on every W.O. switch.
        queueMicrotask(() => setIsLoading(true));
        let disposed = false;
        let timestampsRef: ReturnType<Awaited<ReturnType<typeof getDb>>['ref']> | null = null;
        let unsub: UnsubscribeFn | null = null;
        // turbo-web: offline/demo builds have no Firebase config — stay silent.
        if (!isFirebaseConfigured()) { queueMicrotask(() => setIsLoading(false)); return; }
        getDb().then((db) => {
            if (disposed) return;
            timestampsRef = db.ref(`timestamps/${selectedOsIndex}`);
            unsub = timestampsRef.orderByChild('time').on('value', snapshot => {
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
    }, [selectedOsIndex]);

    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [timestamps.length]);

    const handleAddClick = () => {
        if (videoRef.current) {
            videoRef.current.pause();
            setMarkerTime(videoRef.current.currentTime);
        }
        setIsAdding(true);
    };

    const handleCancel = () => {
        setIsAdding(false);
        setComment('');
        setMarkerSaveError(null);
    };

    const handleSave = async () => {
        if (!comment.trim() || !userProfile || !videoRef.current) return;
        setMarkerSaveError(null);

        try {
            // Dentro do try: em demo/offline o próprio loadFirebase rejeita —
            // a falha precisa cair na mensagem humana, não num rejection cru.
            const newTimestamp = {
                time: videoRef.current.currentTime,
                comment: comment.trim(),
                analyst: {
                    id: userProfile.id,
                    name: userProfile.name,
                    givenName: userProfile.givenName,
                    picture: userProfile.picture,
                },
                createdAt: (await getFirebaseCompat()).app.database.ServerValue.TIMESTAMP,
            };
            const db = await getDb();
            await db.ref(`timestamps/${selectedOsIndex}`).push(newTimestamp);
            handleCancel();
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
        if (window.confirm("Delete this timestamp?")) {
            void getDb().then((db) => db.ref(`timestamps/${selectedOsIndex}/${timestampId}`).remove());
        }
    };

    return (
        <Dock title="Time Markers" className="flex flex-col h-full">
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {isLoading && (
                    <div className="p-3 space-y-3" aria-hidden="true">
                        <div className="skeleton skeleton-line w-2/5 mx-auto" />
                        <div className="skeleton skeleton-line" />
                        <div className="skeleton skeleton-line w-4/5" />
                        <span className="sr-only">Loading…</span>
                    </div>
                )}
                {!isLoading && timestamps.length === 0 && !isAdding && (
                    <p className="text-gray-400 text-center text-sm p-4">No markers yet. Add one below.</p>
                )}
                <ul ref={listRef} className="space-y-3">
                    {timestamps.map(ts => (
                        <li key={ts.id} className="group">
                            <div 
                                className="flex items-start gap-3 p-2 rounded-md hover:bg-gray-500/10 cursor-pointer"
                                onClick={() => handleTimestampClick(ts.time)}
                            >
                                <div className="font-mono text-sm bg-solar-accent/20 text-solar-accent rounded px-2 py-1 flex-shrink-0">
                                    {formatTime(ts.time)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <UserAvatar user={ts.analyst} className="w-5 h-5" />
                                            <span className="text-xs font-bold">{ts.analyst.givenName}</span>
                                        </div>
                                        {userProfile?.id === ts.analyst.id && (
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDelete(ts.id); }}
                                                className="p-1 rounded-full text-ink-secondary hover:bg-red-500/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                aria-label="Remove"
                                            >
                                                <XIcon className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-sm mt-1 break-words whitespace-pre-wrap">{ts.comment}</p>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="flex-shrink-0 p-2 border-t border-hairline">
                {isAdding ? (
                    <div className="space-y-2">
                        {markerSaveError && (
                            <p role="alert" className="text-sm text-fail flex items-start gap-1.5">
                                <span aria-hidden="true">⚠</span>
                                <span>{markerSaveError} Your comment is still here — check the connection and try again.</span>
                            </p>
                        )}
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder={`Comment at ${formatTime(markerTime)}...`}
                            rows={2}
                            className="input w-full resize-none"
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={handleCancel} className="btn btn-ghost px-3 py-1 text-sm">Cancel</button>
                            <button onClick={handleSave} disabled={!comment.trim()} className="btn btn-primary px-3 py-1 text-sm disabled:opacity-50">Save</button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={handleAddClick}
                        disabled={!userProfile || !hasMedia}
                        className="w-full px-4 py-2 bg-solar-accent/10 border border-solar-accent/30 text-solar-accent rounded-md hover:bg-solar-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Add Marker
                    </button>
                )}
            </div>
        </Dock>
    );
};

export default TimestampDock;
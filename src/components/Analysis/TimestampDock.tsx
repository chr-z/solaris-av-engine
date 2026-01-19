import React, { useState, useEffect, useRef } from 'react';
import firebase from 'firebase/compat/app';
import { database } from '../../config/firebase';
import { Timestamp, UserProfile } from '../../types';
import { XIcon } from '../Core/icons';
import UserAvatar from '../Auth/UserAvatar';
import Dock from '../Layout/Dock';

interface TimestampDockProps {
    videoRef: React.RefObject<HTMLVideoElement>;
    selectedOsIndex: number;
    userProfile: UserProfile | null;
}

const formatTime = (totalSeconds: number): string => {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const TimestampDock: React.FC<TimestampDockProps> = ({ videoRef, selectedOsIndex, userProfile }) => {
    const [timestamps, setTimestamps] = useState<Timestamp[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdding, setIsAdding] = useState(false);
    const [comment, setComment] = useState('');
    const listRef = useRef<HTMLUListElement>(null);

    useEffect(() => {
        if (!selectedOsIndex) return;

        setIsLoading(true);
        const timestampsRef = database.ref(`timestamps/${selectedOsIndex}`);
        
        const listener = timestampsRef.orderByChild('time').on('value', snapshot => {
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
    }, [selectedOsIndex]);

    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [timestamps.length]);

    const handleAddClick = () => {
        if (videoRef.current) {
            videoRef.current.pause();
        }
        setIsAdding(true);
    };

    const handleCancel = () => {
        setIsAdding(false);
        setComment('');
    };

    const handleSave = async () => {
        if (!comment.trim() || !userProfile || !videoRef.current) return;

        const newTimestamp = {
            time: videoRef.current.currentTime,
            comment: comment.trim(),
            analyst: {
                id: userProfile.id,
                name: userProfile.name,
                givenName: userProfile.givenName,
                picture: userProfile.picture,
            },
            createdAt: firebase.database.ServerValue.TIMESTAMP,
        };
        
        try {
            await database.ref(`timestamps/${selectedOsIndex}`).push(newTimestamp);
            handleCancel();
        } catch (error) {
            console.error("Failed to save timestamp:", error);
            alert("Could not save timestamp. Check connection.");
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
            database.ref(`timestamps/${selectedOsIndex}/${timestampId}`).remove();
        }
    };

    return (
        <Dock title="Time Markers" className="flex flex-col h-full">
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {isLoading && <p className="text-gray-400 text-center p-4">Loading...</p>}
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
                                                className="p-1 rounded-full text-gray-500 hover:bg-red-500/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
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
            <div className="flex-shrink-0 p-2 border-t border-solar-light-border dark:border-solar-dark-border">
                {isAdding ? (
                    <div className="space-y-2">
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder={`Comment at ${formatTime(videoRef.current?.currentTime || 0)}...`}
                            rows={2}
                            className="w-full bg-solar-dark-bg border border-solar-dark-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent"
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={handleCancel} className="px-3 py-1 text-sm rounded-md hover:bg-gray-500/20 transition-colors">Cancel</button>
                            <button onClick={handleSave} disabled={!comment.trim()} className="px-3 py-1 text-sm rounded-md bg-solar-accent text-white hover:bg-solar-accent-hover disabled:opacity-50 transition-colors">Save</button>
                        </div>
                    </div>
                ) : (
                    <button 
                        onClick={handleAddClick}
                        disabled={!userProfile || !videoRef.current?.src}
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
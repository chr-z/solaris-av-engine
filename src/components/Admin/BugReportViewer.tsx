import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from '../Core/icons';
import { UserProfile } from '../../types';
import { getDb, isFirebaseConfigured, type SnapshotLike } from '../../config/firebase';
import { LogEntry } from '../../utils/logCapture';
import UserAvatar from '../Auth/UserAvatar';

interface Report {
    id: string;
    description: string;
    user: UserProfile;
    logs: LogEntry[];
    timestamp: number;
    userAgent: string;
    url: string;
}

interface BugReportViewerProps {
    isOpen: boolean;
    onClose: () => void;
}

const LogLine: React.FC<{ log: LogEntry }> = ({ log }) => {
    const time = new Date(log.timestamp).toLocaleTimeString('en-GB', { hour12: false });
    let color = 'text-gray-400';
    let levelBadge: string;
    let badgeColor: string;

    switch(log.level) {
        case 'error':
            color = 'text-red-400';
            levelBadge = 'ERROR';
            badgeColor = 'bg-red-500/20 text-red-300';
            break;
        case 'warn': 
            color = 'text-yellow-400'; 
            levelBadge = 'WARN';
            badgeColor = 'bg-yellow-500/20 text-yellow-300';
            break;
        case 'info': 
            levelBadge = 'INFO';
            badgeColor = 'bg-blue-500/20 text-blue-300';
            break;
        case 'debug': 
            levelBadge = 'DEBUG';
            badgeColor = 'bg-purple-500/20 text-purple-300';
            break;
        default:
             levelBadge = log.level.toUpperCase();
             badgeColor = 'bg-white/10 text-gray-200';
    }
    return (
        <div className={`font-mono text-xs flex gap-3 ${color} border-b border-white/5 pb-1`}>
            <span className="flex-shrink-0 text-ink-secondary">{time}</span>
            <span className={`px-1.5 py-0.5 text-[10px] rounded-sm font-bold ${badgeColor}`}>{levelBadge}</span>
            <pre className="whitespace-pre-wrap break-all flex-1">{log.message}</pre>
        </div>
    );
};

const BugReportViewer: React.FC<BugReportViewerProps> = ({ isOpen, onClose }) => {
    const [reports, setReports] = useState<Report[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
    // Holds the latest unsubscribe fn; the SDK resolves asynchronously so the
    // effect cleanup can't close over the listener directly.
    const cleanupListenerRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!isOpen) return;

        // Reset loading state via microtask: keeps the effect body free of
        // synchronous setState (cascading-render rule) while preserving behavior.
        const resetTimer = setTimeout(() => { setIsLoading(true); setError(null); }, 0);
        // turbo-web: subscribe only after the lazy SDK resolves; skip if closed/unmounted first.
        let disposed = false;
        // Structural view of an RTDB Query — enough to attach/detach one listener.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let reportsRef: { on: (...args: any[]) => any; off: (...args: any[]) => void } | null = null;
        // turbo-web: offline/demo builds have no Firebase config — stay silent.
        if (isFirebaseConfigured()) getDb().then((db) => {
            if (disposed) return;
            reportsRef = db.ref('bug_reports').orderByChild('timestamp').limitToLast(100);
            const listener = reportsRef.on('value', (snapshot: SnapshotLike) => {
                const data = snapshot.val();
                const loadedReports: Report[] = [];
                if (data) {
                    Object.keys(data).forEach(key => {
                        loadedReports.push({ id: key, ...data[key] });
                    });
                }
                setReports(loadedReports.reverse()); // Show newest first
                setIsLoading(false);
            }, (err: { message?: string }) => {
                setError(err.message || "Connection error or insufficient permissions.");
                setIsLoading(false);
            });
            const activeRef = reportsRef;
            cleanupListenerRef.current = () => activeRef.off('value', listener);
        }).catch((err) => {
            setError(err instanceof Error ? err.message : "Failed to load database module.");
            setIsLoading(false);
        });

        return () => {
            disposed = true;
            clearTimeout(resetTimer);
            cleanupListenerRef.current?.();
            cleanupListenerRef.current = null;
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return createPortal(
         <div 
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in-fast" 
            onClick={onClose}
        >
            <div 
                className="bg-surface text-white w-full max-w-4xl h-[80vh] rounded-lg shadow-pop border border-hairline flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <header className="flex-shrink-0 flex justify-between items-center p-4 border-b border-hairline">
                    <h2 className="font-bold text-lg">System Reports</h2>
                    <button onClick={onClose} className="p-2 rounded-full icon-btn" aria-label="Close">
                        <XIcon className="w-5 h-5" />
                    </button>
                </header>
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {isLoading && <p className="p-4 text-center">Loading reports...</p>}
                    {error && <p className="p-4 text-center text-red-400">{error}</p>}
                    {!isLoading && !error && reports.length === 0 && <p className="p-4 text-center">No reports found.</p>}
                    
                    <ul className="p-2 space-y-2">
                        {reports.map(report => (
                            <li key={report.id} className="bg-surface rounded-lg border border-hairline transition-all duration-150">
                                <button onClick={() => setSelectedReportId(selectedReportId === report.id ? null : report.id)} className="w-full text-left p-3 flex justify-between items-center">
                                    <div className="flex-1 min-w-0">
                                        <p className="truncate font-semibold">{report.description}</p>
                                        <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                                            <UserAvatar user={report.user} className="w-5 h-5"/>
                                            <span>{report.user.name}</span>
                                            <span>•</span>
                                            <span>{new Date(report.timestamp).toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <span className="text-ink-secondary ml-4">{report.logs?.length || 0} logs</span>
                                </button>

                                <div className={`transition-height duration-150 ease-in-out overflow-hidden ${selectedReportId === report.id ? 'h-auto' : 'h-0'}`}>
                                    <div className="border-t border-hairline p-4 space-y-4">
                                        <div>
                                            <h4 className="font-bold text-sm mb-2 text-gray-300">User Description:</h4>
                                            <p className="text-sm whitespace-pre-wrap bg-surface-raised p-3 rounded-md">{report.description}</p>
                                        </div>
                                        
                                        <div>
                                            <h4 className="font-bold text-sm mb-2 text-gray-300">Session Info:</h4>
                                            <div className="text-xs text-gray-400 bg-surface-raised p-3 rounded-md font-mono space-y-1">
                                                <p><span className="font-semibold text-ink-secondary">URL:</span> {report.url}</p>
                                                <p><span className="font-semibold text-ink-secondary">User Agent:</span> {report.userAgent}</p>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="font-bold text-sm mb-2 text-gray-300">Console Logs:</h4>
                                            <div className="bg-surface-raised p-3 rounded-md max-h-80 overflow-y-auto space-y-2">
                                                {report.logs?.length > 0 ? report.logs.map((log, i) => <LogLine key={i} log={log} />) : <p className="text-xs text-ink-secondary">No logs captured.</p>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default BugReportViewer;
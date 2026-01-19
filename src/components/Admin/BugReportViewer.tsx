import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from '../Core/icons';
import { UserProfile } from '../../types';
import { database } from '../../config/firebase';
import { LogEntry } from '../utils/logCapture';
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
    let levelBadge = 'INFO';
    let badgeColor = 'bg-blue-500/20 text-blue-300';

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
             badgeColor = 'bg-gray-500/20 text-gray-300';
    }
    return (
        <div className={`font-mono text-xs flex gap-3 ${color} border-b border-white/5 pb-1`}>
            <span className="flex-shrink-0 text-gray-500">{time}</span>
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

    useEffect(() => {
        if (!isOpen) return;

        setIsLoading(true);
        setError(null);
        const reportsRef = database.ref('bug_reports').orderByChild('timestamp').limitToLast(100);

        const listener = reportsRef.on('value', snapshot => {
            const data = snapshot.val();
            const loadedReports: Report[] = [];
            if (data) {
                Object.keys(data).forEach(key => {
                    loadedReports.push({ id: key, ...data[key] });
                });
            }
            setReports(loadedReports.reverse()); // Show newest first
            setIsLoading(false);
        }, (err: any) => {
            setError(err.message || "Connection error or insufficient permissions.");
            setIsLoading(false);
        });

        return () => reportsRef.off('value', listener);
    }, [isOpen]);

    if (!isOpen) return null;

    return createPortal(
         <div 
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in-fast" 
            onClick={onClose}
        >
            <div 
                className="bg-solar-dark-content text-white w-full max-w-4xl h-[80vh] rounded-lg shadow-xl flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <header className="flex-shrink-0 flex justify-between items-center p-4 border-b border-solar-dark-border">
                    <h2 className="font-bold text-lg">System Reports</h2>
                    <button onClick={onClose} className="p-2 rounded-full text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors" aria-label="Close">
                        <XIcon className="w-5 h-5" />
                    </button>
                </header>
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {isLoading && <p className="p-4 text-center">Loading reports...</p>}
                    {error && <p className="p-4 text-center text-red-400">{error}</p>}
                    {!isLoading && !error && reports.length === 0 && <p className="p-4 text-center">No reports found.</p>}
                    
                    <ul className="p-2 space-y-2">
                        {reports.map(report => (
                            <li key={report.id} className="bg-solar-dark-bg/50 rounded-lg transition-all duration-300">
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
                                    <span className="text-gray-500 ml-4">{report.logs?.length || 0} logs</span>
                                </button>

                                <div className={`transition-height duration-300 ease-in-out overflow-hidden ${selectedReportId === report.id ? 'h-auto' : 'h-0'}`}>
                                    <div className="border-t border-solar-dark-border p-4 space-y-4">
                                        <div>
                                            <h4 className="font-bold text-sm mb-2 text-gray-300">User Description:</h4>
                                            <p className="text-sm whitespace-pre-wrap bg-solar-dark-bg p-3 rounded-md">{report.description}</p>
                                        </div>
                                        
                                        <div>
                                            <h4 className="font-bold text-sm mb-2 text-gray-300">Session Info:</h4>
                                            <div className="text-xs text-gray-400 bg-solar-dark-bg p-3 rounded-md font-mono space-y-1">
                                                <p><span className="font-semibold text-gray-500">URL:</span> {report.url}</p>
                                                <p><span className="font-semibold text-gray-500">User Agent:</span> {report.userAgent}</p>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="font-bold text-sm mb-2 text-gray-300">Console Logs:</h4>
                                            <div className="bg-solar-dark-bg p-3 rounded-md max-h-80 overflow-y-auto space-y-2">
                                                {report.logs?.length > 0 ? report.logs.map((log, i) => <LogLine key={i} log={log} />) : <p className="text-xs text-gray-500">No logs captured.</p>}
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
import React, { useState, useEffect } from 'react';
import { DriveFile } from '../Analysis/AnalysisSheet';
import { useWaveformCache } from '../../contexts/WaveformCacheContext';
import { WaveformIcon } from '../Core/icons';

declare const gapi: any;

interface DriveFilePickerProps {
    folderId: string;
    onFileSelected: (file: DriveFile) => void;
    onCancel: () => void;
}

const DriveFilePicker: React.FC<DriveFilePickerProps> = ({ folderId, onFileSelected, onCancel }) => {
    const [files, setFiles] = useState<DriveFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { cachedVideoIds } = useWaveformCache();

    useEffect(() => {
        const fetchFiles = async () => {
            setIsLoading(true);
            setError(null);
            try {
                // Get token from GAPI client
                const token = gapi.client.getToken()?.access_token;
                if (!token) {
                    throw new Error("User not authenticated. Please sign in again.");
                }
                
                // Call backend proxy
                const response = await fetch(`/api/drive-folder-contents?folderId=${folderId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: "Failed to fetch file list from server." }));
                    throw new Error(errorData.error);
                }
                
                const filesData: DriveFile[] = await response.json();
                
                if (filesData && filesData.length > 0) {
                    setFiles(filesData);
                } else {
                    setError("No video or audio files found in this folder, or you do not have permission.");
                }
            } catch (err: any) {
                console.error("Error fetching files from proxy:", err);
                setError(err.message || "Failed to load files.");
            } finally {
                setIsLoading(false);
            }
        };

        if (gapi.client && gapi.client.getToken()) {
            fetchFiles();
        } else {
             setError("Google Authentication not ready. Please try opening the picker again.");
             setIsLoading(false);
        }
    }, [folderId]);


    const renderContent = () => {
        if (isLoading) {
            return (
                <div className="flex justify-center items-center p-8">
                    <div className="w-8 h-8 border-4 border-solar-accent border-t-transparent rounded-full animate-spin"></div>
                    <span className="ml-4">Scanning Google Drive...</span>
                </div>
            );
        }
        if (error) {
            return <div className="p-8 text-center text-red-400">{error}</div>;
        }
        return (
            <ul className="max-h-96 overflow-y-auto">
                {files.map(file => (
                    <li key={file.id} 
                        onClick={() => onFileSelected(file)}
                        className="flex items-center gap-3 p-3 cursor-pointer rounded-md hover:bg-solar-accent/20 transition-colors"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && onFileSelected(file)}
                    >
                        <img src={file.iconLink} alt="file icon" className="w-6 h-6 flex-shrink-0" />
                        <span className="truncate">{file.name}</span>
                        {cachedVideoIds.has(file.id) && (
                           <WaveformIcon title="Cached Waveform" className="w-4 h-4 text-solar-accent/70 ml-auto flex-shrink-0" />
                        )}
                    </li>
                ))}
            </ul>
        );
    };

    return (
        <div 
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in" 
            onClick={onCancel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="drive-picker-title"
        >
            <div 
                className="bg-solar-dark-content w-full max-w-lg rounded-lg shadow-xl flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <header className="p-4 border-b border-solar-dark-border">
                    <h3 id="drive-picker-title" className="font-bold text-lg">Select Drive Media</h3>
                </header>
                <div className="p-2">
                    {renderContent()}
                </div>
                <footer className="p-4 border-t border-solar-dark-border flex justify-end">
                    <button onClick={onCancel} className="px-4 py-2 rounded-md hover:bg-gray-500/20 transition-colors">
                        Cancel
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default DriveFilePicker;
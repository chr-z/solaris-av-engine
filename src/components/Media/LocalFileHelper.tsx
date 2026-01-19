import React, { useState } from 'react';
import { ClipboardCheckIcon, UploadIcon } from '../Core/icons';
import SourceSelector from './SourceSelector';

interface LocalFileHelperProps {
  filePath: string;
  onLoadMedia: (source: File | string, info?: { name?: string; isDriveLink?: boolean; isYoutube?: boolean }) => void;
}

const LocalFileHelper: React.FC<LocalFileHelperProps> = ({ filePath, onLoadMedia }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(filePath).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            alert('Failed to copy path.');
        });
    };

    return (
        <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 p-8 bg-solar-dark-bg/20">
            <h3 className="font-bold text-lg text-white mb-2">Local Source File</h3>
            <p className="max-w-md mb-4">This analysis references a file stored on the local network. Copy the path below to locate it on the server.</p>
            
            <div className="w-full max-w-xl bg-solar-dark-bg p-3 rounded-md border border-solar-dark-border mb-4">
                <p className="text-xs text-gray-500 text-left mb-1">Network Path:</p>
                <div className="flex items-center gap-2">
                    <input 
                        type="text"
                        value={filePath}
                        readOnly
                        className="w-full flex-grow bg-transparent text-white font-mono text-sm truncate"
                    />
                    <button 
                        onClick={handleCopy}
                        className="flex-shrink-0 px-3 py-1.5 rounded-md bg-solar-accent text-white text-sm hover:bg-solar-accent-hover transition-colors flex items-center gap-2"
                    >
                        {copied ? (
                           <>
                             <ClipboardCheckIcon className="w-4 h-4" />
                             Copied!
                           </>
                        ) : (
                            "Copy Path"
                        )}
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-4 text-gray-500 my-4 w-full max-w-md">
                <div className="flex-grow h-px bg-solar-dark-border"></div>
                <span>OR</span>
                <div className="flex-grow h-px bg-solar-dark-border"></div>
            </div>
            
            <p className="mb-4">Manually select the file from your computer:</p>
            <div className="w-96">
               <SourceSelector onSourceSelected={onLoadMedia} />
            </div>
        </div>
    );
};

export default LocalFileHelper;
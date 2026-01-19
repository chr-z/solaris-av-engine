import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { XIcon, ClipboardCheckIcon } from '../Core/icons';
import { logCaptureService } from '../utils/logCapture';
import { UserProfile } from '../../types';
import { database } from '../../config/firebase';
import firebase from 'firebase/compat/app';

interface BugReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    userProfile: UserProfile | null;
}

const BugReportModal: React.FC<BugReportModalProps> = ({ isOpen, onClose, userProfile }) => {
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [error, setError] = useState('');

    const handleSubmit = async () => {
        if (!description.trim() || !userProfile) return;

        setIsSubmitting(true);
        setSubmitStatus('idle');
        setError('');

        try {
            const report = {
                description: description.trim(),
                user: userProfile,
                logs: logCaptureService.getLogs(),
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                userAgent: navigator.userAgent,
                url: window.location.href,
            };

            await database.ref('bug_reports').push(report);

            setSubmitStatus('success');
            setDescription('');
            setTimeout(() => {
                onClose();
                setSubmitStatus('idle');
            }, 2000);

        } catch (err: any) {
            setError(err.message || 'Failed to submit report. Please try again.');
            setSubmitStatus('error');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;
    
    return createPortal(
        <div 
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in-fast" 
            onClick={onClose}
        >
            <div 
                className="bg-solar-dark-content text-white w-full max-w-lg rounded-lg shadow-xl flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <header className="flex-shrink-0 flex justify-between items-center p-4 border-b border-solar-dark-border">
                    <h2 className="font-bold text-lg">Report an Issue</h2>
                    <button onClick={onClose} className="p-2 rounded-full text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors" aria-label="Close">
                        <XIcon className="w-5 h-5" />
                    </button>
                </header>
                <div className="flex-1 min-h-0 p-4 space-y-4">
                    <p className="text-sm text-gray-400">
                        Please describe the issue you encountered. Console logs will be automatically attached to help us diagnose the problem.
                    </p>
                    <div>
                        <label htmlFor="bug-description" className="block text-xs font-medium text-gray-300 mb-1">
                            Issue Description
                        </label>
                        <textarea
                            id="bug-description"
                            rows={6}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Ex: When clicking button X, the screen went blank..."
                            className="w-full bg-solar-dark-bg border border-solar-dark-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent"
                            autoFocus
                        />
                    </div>
                     {submitStatus === 'error' && <p className="text-sm text-red-400">{error}</p>}
                </div>
                <footer className="flex-shrink-0 p-4 border-t border-solar-dark-border flex justify-end">
                     {submitStatus === 'success' ? (
                        <div className="flex items-center gap-2 text-green-400">
                            <ClipboardCheckIcon className="w-5 h-5" />
                            <span>Report Sent Successfully!</span>
                        </div>
                    ) : (
                        <button 
                            onClick={handleSubmit} 
                            disabled={isSubmitting || !description.trim()}
                            className="px-4 py-2 text-sm font-semibold rounded-md bg-solar-accent text-white hover:bg-solar-accent-hover disabled:opacity-50 flex items-center gap-2"
                        >
                            {isSubmitting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                            {isSubmitting ? 'Sending...' : 'Send Report'}
                        </button>
                    )}
                </footer>
            </div>
        </div>,
        document.body
    );
};

export default BugReportModal;
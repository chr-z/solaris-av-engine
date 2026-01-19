import React, { useState } from 'react';
import { XIcon, BugIcon, PaperAirplaneIcon, CheckIcon, AlertIcon } from '../Core/icons';
// CORREÇÃO AQUI: Adicionado mais um "../" para chegar na raiz src
import { logCaptureService } from '../../utils/logCapture';
import { UserProfile } from '../../types';

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile | null;
}

const BugReportModal: React.FC<BugReportModalProps> = ({ isOpen, onClose, userProfile }) => {
  const [description, setDescription] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<'idle' | 'success' | 'error'>('idle');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setIsSending(true);
    setSendStatus('idle');

    try {
      // Coleta os logs e envia
      const report = logCaptureService.generateReport(description, userProfile || undefined);
      
      // Aqui você conectaria com seu backend ou Firebase para salvar o JSON
      // Por enquanto, vamos simular um delay e logar no console
      console.log('Bug Report Generated:', report);
      
      // Simulação de envio
      await new Promise(resolve => setTimeout(resolve, 1500));

      setSendStatus('success');
      setTimeout(() => {
        onClose();
        setDescription('');
        setSendStatus('idle');
      }, 2000);
    } catch (error) {
      console.error("Failed to send report", error);
      setSendStatus('error');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-solar-dark-content border border-solar-dark-border rounded-lg shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        <header className="bg-solar-dark-bg p-4 border-b border-solar-dark-border flex justify-between items-center">
          <div className="flex items-center gap-2 text-red-400">
            <BugIcon className="w-5 h-5" />
            <h2 className="font-bold text-gray-100">Report an Issue</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <XIcon className="w-5 h-5" />
          </button>
        </header>
        
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-4">
          <div className="bg-blue-900/20 border border-blue-800 rounded p-3">
            <p className="text-xs text-blue-200">
              This will capture the current application state, recent logs, and your user info to help us fix the problem.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Describe what happened:
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="I clicked on X and Y happened..."
              className="w-full h-32 bg-solar-dark-bg border border-solar-dark-border rounded-md p-3 text-sm text-gray-200 focus:ring-2 focus:ring-solar-accent focus:outline-none resize-none"
              required
            />
          </div>

          {sendStatus === 'error' && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertIcon className="w-4 h-4" />
              <span>Failed to send report. Please try again.</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              disabled={isSending}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSending || !description.trim() || sendStatus === 'success'}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold text-white transition-all ${
                sendStatus === 'success' 
                  ? 'bg-green-600 hover:bg-green-700' 
                  : 'bg-solar-accent hover:bg-solar-accent-hover'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isSending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Sending...</span>
                </>
              ) : sendStatus === 'success' ? (
                <>
                  <CheckIcon className="w-4 h-4" />
                  <span>Sent!</span>
                </>
              ) : (
                <>
                  <PaperAirplaneIcon className="w-4 h-4" />
                  <span>Send Report</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BugReportModal;
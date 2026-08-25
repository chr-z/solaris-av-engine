import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { LinkIcon, CheckIcon } from '../Core/icons';
import {
  SyncCommand,
  resolveCompareSrc,
  describeCompareSource,
} from '../../utils/compareMode';

interface ComparePaneProps {
  /** Challenger media source (raw user input). Null → setup state. */
  source: string | null;
  onChangeSource: (source: string | null) => void;
  /** Subscribes to transport commands derived from the main player. */
  subscribeToLeader: (callback: (command: SyncCommand) => void) => () => void;
  /** Bumped whenever the offset changes so the pane re-applies sync. */
  syncNonce: number;
}

/**
 * S5.2: challenger pane of the A/B compare mode.
 *
 * Renders side B of the comparison: any YouTube/Drive/direct source the
 * main pipeline accepts, kept in transport lockstep with the main player
 * through imperative commands (no React re-render per timeupdate).
 * Audio is intentionally muted — the main player owns the room.
 */
const ComparePane: React.FC<ComparePaneProps> = ({
  source,
  onChangeSource,
  subscribeToLeader,
  syncNonce,
}) => {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastCommandRef = useRef<SyncCommand | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [hasError, setHasError] = useState(false);

  // Derived: the error flag only makes sense for the current source.
  // Keying by source resets it without any setState-in-effect.
  const [errorSource, setErrorSource] = useState<string | null>(null);
  const showLoadError = hasError && errorSource === source;

  // Transport lockstep: apply every command from the leader imperatively.
  useEffect(() => {
    const applyCommand = (command: SyncCommand) => {
      lastCommandRef.current = command;
      const video = videoRef.current;
      if (!video || video.readyState === 0) return;
      if (Math.abs(video.currentTime - command.time) > 0.05) {
        video.currentTime = command.time;
      }
      if (command.playing && video.paused) {
        void video.play().catch(() => { /* autoplay guard — resumes on next command */ });
      } else if (!command.playing && !video.paused) {
        video.pause();
      }
    };
    return subscribeToLeader(applyCommand);
  }, [subscribeToLeader]);

  // Offset edits bump the nonce: re-apply the latest command right away
  // (works while paused, where no timeupdate events are flowing).
  useEffect(() => {
    const command = lastCommandRef.current;
    const video = videoRef.current;
    if (!command || !video || video.readyState === 0) return;
    if (Math.abs(video.currentTime - command.time) > 0.05) {
      video.currentTime = command.time;
    }
  }, [syncNonce]);

  const handleSubmitDraft = useCallback(() => {
    const trimmed = urlDraft.trim();
    if (trimmed.length > 0) onChangeSource(trimmed);
  }, [urlDraft, onChangeSource]);

  const resolvedSrc = source ? resolveCompareSrc(source) : null;

  return (
    <div className="w-full h-full flex flex-col bg-solar-dark-content/80 backdrop-blur-md rounded-lg border border-solar-dark-border overflow-hidden">
      <header className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-solar-dark-border">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="flex-shrink-0 font-mono text-xs font-bold bg-solar-accent/20 text-solar-accent rounded px-1.5 py-0.5"
            aria-hidden="true"
          >
            B
          </span>
          <p className="text-xs text-gray-400 truncate" title={source ?? undefined}>
            {source ? describeCompareSource(source) : t('compare.empty')}
          </p>
        </div>
        {source && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => { onChangeSource(null); setUrlDraft(''); }}
              className="p-1.5 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
              title={t('compare.changeSource')}
              aria-label={t('compare.changeSource')}
            >
              <LinkIcon className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 relative bg-black">
        {!resolvedSrc && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <p className="text-sm text-gray-400">{t('compare.empty')}</p>
            <div className="flex w-full max-w-sm items-center gap-2">
              <input
                type="url"
                value={urlDraft}
                onChange={e => setUrlDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmitDraft(); }}
                placeholder={t('compare.sourcePlaceholder')}
                aria-label={t('compare.sourcePlaceholder')}
                className="flex-1 min-w-0 bg-solar-dark-bg border border-solar-dark-border rounded-md px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-solar-accent"
              />
              <button
                onClick={handleSubmitDraft}
                disabled={!urlDraft.trim()}
                className="flex-shrink-0 p-2 rounded-md bg-solar-accent text-bg hover:bg-solar-accent-hover disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
                aria-label={t('compare.load')}
                title={t('compare.load')}
              >
                <CheckIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {resolvedSrc && !showLoadError && (
          <video
            key={resolvedSrc}
            ref={videoRef}
            src={resolvedSrc}
            crossOrigin="anonymous"
            muted
            playsInline
            controls
            className="w-full h-full object-contain"
            onError={() => { setHasError(true); setErrorSource(source); }}
          />
        )}

        {resolvedSrc && showLoadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-red-400">{t('compare.loadFailed')}</p>
            <button
              onClick={() => { onChangeSource(null); setUrlDraft(source ?? ''); }}
              className="px-3 py-1.5 text-sm rounded-md bg-solar-dark-bg border border-solar-dark-border text-gray-300 hover:bg-gray-500/20 transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
            >
              {t('compare.changeSource')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ComparePane;

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n/I18nContext';
import { useLicense } from '../../licensing/LicenseContext';
import { XIcon } from '../Core/icons';

interface ProUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * S6.1: local-first Pro activation. The analyst pastes a signed license key
 * (delivered after purchase); validation is HMAC-SHA256 via WebCrypto, fully
 * offline. No account, no network call.
 */
const ProUpgradeModal: React.FC<ProUpgradeModalProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const { isPro, source, activate, deactivate, lastError } = useLicense();

  const [keyInput, setKeyInput] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleActivate = async () => {
    if (!keyInput.trim()) return;
    setIsActivating(true);
    try {
      await activate(keyInput);
      setKeyInput('');
    } finally {
      setIsActivating(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in-fast"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('solaris.pro.modalTitle')}
    >
      <div
        className="bg-solar-dark-content text-white w-full max-w-md rounded-lg shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex-shrink-0 flex justify-between items-center p-3 border-b border-solar-dark-border">
          <h2 className="font-bold">{t('solaris.pro.modalTitle')}</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            className="p-2 rounded-full text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
            aria-label={t('solaris.pro.close')}
          >
            <XIcon className="w-5 h-5" />
          </button>
        </header>
        <div className="p-4 space-y-4">
          {isPro ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold">
                <span aria-hidden="true">✦</span>
                <span>{t('solaris.pro.activeTitle')}</span>
              </div>
              <p className="text-sm text-gray-400">{t('solaris.pro.activeDescription')}</p>
              <button
                onClick={() => deactivate()}
                className="text-sm text-red-400 hover:text-red-300 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-solar-accent rounded-sm"
              >
                {t('solaris.pro.deactivate')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-300">{t('solaris.pro.pitch')}</p>
              <ul className="text-sm text-gray-400 space-y-1 list-disc list-inside" role="list">
                <li>{t('solaris.pro.benefitCompare')}</li>
                <li>{t('solaris.pro.benefitPresets')}</li>
                <li>{t('solaris.pro.benefitFuture')}</li>
              </ul>
              <label className="block text-sm font-medium" htmlFor="solaris-license-input">
                {t('solaris.pro.keyLabel')}
              </label>
              <input
                id="solaris-license-input"
                type="text"
                value={keyInput}
                onChange={event => setKeyInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') handleActivate();
                }}
                placeholder={t('solaris.pro.keyPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                className="w-full px-3 py-2 rounded-md bg-solar-dark-bg border border-solar-dark-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-solar-accent"
                aria-describedby="solaris-license-error"
              />
              {!!lastError && (
                <p id="solaris-license-error" role="alert" className="text-sm text-red-400">
                  {t(lastError as never)}
                </p>
              )}
              <button
                onClick={handleActivate}
                disabled={!keyInput.trim() || isActivating}
                className="w-full px-3 py-2 rounded-md bg-solar-accent text-white font-medium hover:bg-solar-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-solar-accent"
              >
                {isActivating ? t('solaris.pro.activating') : t('solaris.pro.activate')}
              </button>
              {source === 'env-override' && (
                <p className="text-xs text-gray-500">{t('solaris.pro.envOverrideNote')}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ProUpgradeModal;

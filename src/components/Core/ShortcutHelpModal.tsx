import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { groupShortcutsByScope, SHORTCUT_HELP_KEY } from '../../utils/shortcuts';
import { useI18n } from '../../i18n/I18nContext';
import { XIcon } from '../Core/icons';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * S5.1: "?" opens a quick-reference of every analyst shortcut.
 * Rendered through a portal; Escape closes it (same contract as Popover).
 */
const ShortcutHelpModal: React.FC<ShortcutHelpModalProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const groups = groupShortcutsByScope();

  const renderGroup = (
    titleKey: 'shortcuts.playerGroup' | 'shortcuts.workspaceGroup',
    defs: ReturnType<typeof groupShortcutsByScope>['player'],
  ) =>
    defs.length > 0 && (
      <section aria-label={t(titleKey)}>
        <h3 className="text-xs font-bold uppercase text-solar-accent mb-2">{t(titleKey)}</h3>
        <ul className="space-y-1 mb-4">
          {defs.map(def => (
            <li key={def.id} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-gray-300">{t(def.descriptionKey as never)}</span>
              <kbd className="flex-shrink-0 font-mono text-xs bg-bg border border-hairline rounded px-1.5 py-0.5 text-gray-200">
                {def.display ?? def.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </section>
    );

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in-fast"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcuts.modalTitle')}
    >
      <div
        className="bg-surface text-ink w-full max-w-md rounded-lg shadow-pop flex flex-col max-h-[80vh]"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex-shrink-0 flex justify-between items-center p-3 border-b border-hairline">
          <h2 className="font-bold">{t(SHORTCUT_HELP_KEY as never)}</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            className="p-2 rounded-full text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
            aria-label="Close"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </header>
        <div className="overflow-y-auto p-4">
          {renderGroup('shortcuts.playerGroup', groups.player)}
          {renderGroup('shortcuts.workspaceGroup', groups.workspace)}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ShortcutHelpModal;

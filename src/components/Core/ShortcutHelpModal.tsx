import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { groupShortcutsByScope, SHORTCUT_HELP_KEY, ANALYST_SHORTCUTS, type ShortcutDef } from '../../utils/shortcuts';
import { useI18n } from '../../i18n/I18nContext';
import { XIcon } from '../Core/icons';
import { useShortcutPrefs, persistBinding, keyForId } from '../../hooks/useShortcutPrefs';
import {
  validateBinding,
  clearBinding,
  saveShortcutMap,
  type BindingVerdict,
} from '../../features/qol/shortcutPrefs';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type GroupTitleKey =
  | 'shortcuts.playerGroup'
  | 'shortcuts.workspaceGroup'
  | 'shortcuts.dashboardGroup';

/**
 * S5.1 + QoL A1: "?" opens the quick-reference of every analyst shortcut —
 * and doubles as the REMAPPING PANEL ("atalhos configuráveis"). Each
 * non-native row offers change/reset; capture binds the NEXT physical key
 * via a CAPTURE-phase listener (stopPropagation keeps the global analyst
 * layer and the player from acting on the captured keystroke). Native
 * player keys (Space/←/→/F/M) stay reserved and are rejected with reason.
 */
const ShortcutHelpModal: React.FC<ShortcutHelpModalProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { map, effectiveDefs } = useShortcutPrefs();
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Captura da próxima tecla p/ remapeamento (fase de captura: ninguém age antes).
  useEffect(() => {
    if (!isOpen || !capturingId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setCapturingId(null);
        setErrorText(null);
        return;
      }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return; // espera a tecla de verdade
      const id = capturingId;
      const verdict: BindingVerdict = validateBinding(id, event.key, map);
      if (!verdict.ok) {
        setErrorText(
          verdict.reason === 'conflict' && verdict.ownerId
            ? t('shortcuts.remap.conflict', { label: labelOfId(verdict.ownerId, t) })
            : t(verdict.reason === 'reserved' ? 'shortcuts.remap.reserved' : 'shortcuts.remap.invalid'),
        );
        return;
      }
      persistBinding(map, id, event.key);
      setCapturingId(null);
      setErrorText(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, capturingId, map, t]);

  if (!isOpen) return null;

  const groups = groupShortcutsByScope(effectiveDefs);

  const handleResetAll = () => {
    let next = { ...map };
    for (const id of Object.keys(map)) next = clearBinding(next, id);
    saveShortcutMap(window.localStorage, next);
    setErrorText(null);
  };

  const renderRow = (def: ShortcutDef) => {
    const isCustom = !def.native && def.id in map;
    const isCapturing = capturingId === def.id;
    return (
      <li key={def.id} className="flex items-center justify-between gap-4 text-sm">
        <span className="text-gray-300">{t(def.descriptionKey as never)}</span>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {!def.native && (
            <>
              {isCustom && (
                <span
                  className="text-[10px] uppercase tracking-wide text-solar-accent"
                  title={keyForId(map, def.id)}
                >
                  {t('shortcuts.remap.custom')}
                </span>
              )}
              <button
                type="button"
                onClick={() => { setCapturingId(def.id); setErrorText(null); }}
                className="px-2 py-0.5 rounded text-xs border border-solar-dark-border text-gray-300 hover:bg-gray-500/20 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
                aria-label={`${t('shortcuts.remap.edit')} — ${t(def.descriptionKey as never)}`}
              >
                {t('shortcuts.remap.edit')}
              </button>
              {isCustom && (
                <button
                  type="button"
                  onClick={() => { saveShortcutMap(window.localStorage, clearBinding(map, def.id)); setErrorText(null); }}
                  className="px-1.5 py-0.5 rounded text-xs text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
                  aria-label={`${t('shortcuts.remap.reset')} — ${t(def.descriptionKey as never)}`}
                >
                  ↺
                </button>
              )}
            </>
          )}
          {isCapturing ? (
            <kbd
              className="font-mono text-xs bg-solar-dark-bg border border-solar-accent rounded px-1.5 py-0.5 text-solar-accent animate-pulse"
              role="status"
              aria-live="polite"
            >
              {t('shortcuts.remap.captureHint')}
            </kbd>
          ) : (
            <kbd className="flex-shrink-0 font-mono text-xs bg-solar-dark-bg border border-solar-dark-border rounded px-1.5 py-0.5 text-gray-200">
              {(def.display ?? def.keys).toUpperCase()}
            </kbd>
          )}
        </span>
      </li>
    );
  };

  const renderGroup = (
    titleKey: GroupTitleKey,
    defs: ReturnType<typeof groupShortcutsByScope>['player'],
  ) =>
    defs.length > 0 && (
      <section aria-label={t(titleKey)}>
        <h3 className="text-xs font-bold uppercase text-solar-accent mb-2">{t(titleKey)}</h3>
        <ul className="space-y-1 mb-4">
          {defs.map(renderRow)}

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
          <p className="text-xs text-gray-400 mb-3">{t('shortcuts.remap.hint')}</p>
          {renderGroup('shortcuts.playerGroup', groups.player)}
          {renderGroup('shortcuts.workspaceGroup', groups.workspace)}
          {renderGroup('shortcuts.dashboardGroup', groups.dashboard)}
          {Object.keys(map).length > 0 && (
            <div className="pt-2 mt-1 border-t border-solar-dark-border">
              <button
                type="button"
                onClick={handleResetAll}
                className="text-xs text-gray-400 underline hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent"
              >
                {t('shortcuts.remap.resetAll')}
              </button>
            </div>
          )}
          <p className="min-h-[1.25rem] mt-2 text-xs text-red-400" role="alert" aria-live="polite">
            {errorText ?? ''}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
};

function labelOfId(id: string, t: (key: never) => string): string {
  const def = ANALYST_SHORTCUTS.find(d => d.id === id);
  return def ? t(def.descriptionKey as never) : id;
}

export default ShortcutHelpModal;

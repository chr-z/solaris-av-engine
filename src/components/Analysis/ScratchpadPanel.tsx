// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core (A1 notas rápidas).
//
// Painel do scratchpad por OS: casca fina sobre o hook useScratchpad.
// Rascunho PESSOAL (spec A1): não vai pra planilha nem pro dashboard.
//
// Padrão anti-cascata (react-hooks v7): o componente externo só decide
// visibilidade e RE-MONTA o interno por `key={osId}` — assim a carga da nota
// acontece uma única vez no inicializador de estado (puro, sem ref em render
// nem setState em efeito), e o "nasce aberto quando há nota" é derivado do
// mesmo valor inicial. Flush do pendente na troca de OS fica no cleanup do
// unmount do interno (controller captura a chave antiga — sem vazamento).

import React, { useCallback, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import { ChevronDownIcon } from '../Core/icons';
import { useScratchpad } from '../../hooks/useScratchpad';

interface ScratchpadPanelProps {
  /** Identificador estável da OS (W.O.). null = guest/sem OS (painel oculto). */
  osId: string | null;
  /** Modo foco esconde o painel mas mantém o estado vivo (flush no unmount). */
  visible?: boolean;
  /** Disparado quando a análise oficial limpa a nota (telemetria/testes). */
  onCleaned?: () => void;
}

export function ScratchpadPanel({ osId, visible = true, onCleaned }: ScratchpadPanelProps) {
  if (!visible || osId === null) return null;
  return <ScratchpadOpen key={osId} osId={osId} onCleaned={onCleaned} />;
}

function ScratchpadOpen({ osId, onCleaned }: { osId: string; onCleaned?: () => void }) {
  const { t } = useI18n();
  const scratch = useScratchpad(osId, true, onCleaned);

  // Carga inicial ÚNICA por OS: inicializador puro, roda uma vez na montagem.
  const [initialText] = useState<string>(() => scratch.loadOnce());
  const [text, setText] = useState(initialText);
  // Nota persistida existe → painel nasce aberto (retomada de contexto).
  const [isOpen, setIsOpen] = useState(initialText.length > 0);

  const handleChange = useCallback(
    (next: string) => {
      setText(next);
      scratch.scheduleSave(next);
    },
    [scratch],
  );

  return (
    <section
      className="flex-shrink-0 border-b border-solar-light-border dark:border-solar-dark-border"
      aria-label={t('qol.scratch.title')}
    >
      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-solar-accent rounded-md"
      >
        <span>{t('qol.scratch.title')}</span>
        <span className="flex items-center gap-2">
          {scratch.lastSavedAt !== null && (
            <span className="text-[10px] normal-case text-emerald-400/90" aria-live="polite">
              ✓ {t('qol.autosave.saved')}
            </span>
          )}
          <ChevronDownIcon
            className={`w-4 h-4 transition-transform ${isOpen ? '' : '-rotate-90'}`}
          />
        </span>
      </button>
      {isOpen && (
        <div className="px-3 pb-2">
          <textarea
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={t('qol.scratch.placeholder')}
            rows={3}
            maxLength={25_000}
            aria-label={t('qol.scratch.title')}
            className="w-full resize-y rounded-md bg-solar-light-content/60 dark:bg-solar-dark-bg/60 border border-solar-light-border dark:border-solar-dark-border p-2 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            {t('qol.scratch.hint')}
            {scratch.truncated && (
              <span className="ml-1 text-amber-400" role="status">
                {t('qol.scratch.truncated')}
              </span>
            )}
          </p>
        </div>
      )}
    </section>
  );
}

/** Chaves i18n do painel — afirmadas nos testes (paridade EN/PT). */
export const SCRATCH_I18N_KEYS: readonly TranslationKey[] = [
  'qol.scratch.title',
  'qol.scratch.placeholder',
  'qol.scratch.hint',
  'qol.scratch.truncated',
];

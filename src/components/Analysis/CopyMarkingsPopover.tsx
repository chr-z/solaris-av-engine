// Solaris v3 — Feature Pack "Analista Feliz" — QoL A1.
//
// Duplicar marcações de outra OS (aulas gêmeas): popover com candidatas
// rankeadas por findTwinRows (mesmo professor/estúdio/dia), prévia do plano
// e aplicação sobre a linha viva. Componente é CASCA PURA: recebe headers,
// linha atual e candidatos por props — nada de rede/firebase aqui (o wiring
// fica no AnalysisWorkspace). Undo e auto-save são responsabilidade do
// chamador, que recebe a linha nova pronta + o plano p/ telemetria.

import React, { useMemo, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import Popover from '../Core/Popover';
import { ClipboardCheckIcon } from '../Core/icons';
import {
  findTwinRows,
  planMarkingsCopy,
  applyMarkingsPlan,
  describePlan,
  type MarkingsCopyPlan,
} from '../../features/qol/markingsCopy';
import type { RowData } from '../../services/sheetSync';

export interface TwinEntry {
  rowIndex: number;
  row: RowData;
}

export interface AppliedCopySummary {
  /** Rótulo da OS copiada (W.O.). */
  sourceLabel: string;
  plan: MarkingsCopyPlan;
}

interface CopyMarkingsPopoverProps {
  headers: string[];
  /** Linha VIVA do destino (estado local do workspace, não a bruta). */
  targetRow: RowData;
  /** Todas as linhas carregadas (pool de gêmeas). */
  rows: readonly TwinEntry[];
  currentRowIndex: number | null;
  /** Recebe a linha nova já construída + resumo. Chamar só se nextRow ≠ atual. */
  onApply: (nextRow: RowData, summary: AppliedCopySummary) => void;
}

const MAX_CANDIDATES = 5;

export function CopyMarkingsPopover({
  headers,
  targetRow,
  rows,
  currentRowIndex,
  onApply,
}: CopyMarkingsPopoverProps) {
  const { t } = useI18n();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [includeFreeText, setIncludeFreeText] = useState(false);

  const twins = useMemo(
    () => findTwinRows(headers, targetRow, rows, currentRowIndex ?? undefined),
    [headers, targetRow, rows, currentRowIndex],
  );

  const selected = selectedIdx !== null ? twins[selectedIdx] : null;
  const preview = useMemo(() => {
    if (!selected) return null;
    return planMarkingsCopy(headers, selected.row.row, targetRow, { includeFreeText });
  }, [selected, headers, targetRow, includeFreeText]);

  const reset = () => { setSelectedIdx(null); setIncludeFreeText(false); };

  const reasonLabel = (reason: string): string => {
    if (reason === 'same instructor') return t('qol.copyMarkings.reasonInstructor');
    if (reason === 'same studio') return t('qol.copyMarkings.reasonStudio');
    if (reason === 'same date') return t('qol.copyMarkings.reasonDate');
    return reason;
  };

  return (
    <Popover
      contentClassName="w-80"
      trigger={
        <button
          type="button"
          className="p-2 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent"
          title={t('qol.copyMarkings.title')}
          aria-label={t('qol.copyMarkings.title')}
        >
          <ClipboardCheckIcon className="w-5 h-5" />
        </button>
      }
    >
      {(close) => (
        <div className="p-3" data-testid="copy-markings-popover">
          <h3 className="text-sm font-bold mb-1">{t('qol.copyMarkings.title')}</h3>
          <p className="text-xs text-gray-400 mb-2">{t('qol.copyMarkings.subtitle')}</p>

          {twins.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">{t('qol.copyMarkings.noTwins')}</p>
          ) : !selected ? (
            <ul className="space-y-1 max-h-56 overflow-y-auto">
              {twins.slice(0, MAX_CANDIDATES).map((candidate, index) => (
                <li key={candidate.row.rowIndex}>
                  <button
                    type="button"
                    onClick={() => setSelectedIdx(index)}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-500/20 focus-visible:ring-2 focus-visible:ring-solar-accent transition-colors"
                  >
                    <span className="text-sm font-semibold">{candidate.label}</span>
                    <span className="block text-xs text-gray-400">
                      {candidate.reasons.map(reasonLabel).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div>
              <p className="text-xs text-gray-300 mb-2">
                {t('qol.copyMarkings.from', { os: selected.label })}
              </p>
              <p className="text-xs text-gray-400 mb-2" aria-live="polite">
                {preview && describePlan(preview)}
              </p>
              {preview && preview.compatibleRules === 0 && (
                <p className="text-xs text-yellow-500 mb-2">{t('qol.copyMarkings.incompatible')}</p>
              )}
              {preview && preview.skippedFreeText.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-gray-300 mb-2">
                  <input
                    type="checkbox"
                    checked={includeFreeText}
                    onChange={(e) => setIncludeFreeText(e.target.checked)}
                  />
                  {t('qol.copyMarkings.includeText')}
                </label>
              )}
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-1 text-xs rounded-md hover:bg-gray-500/20 transition-colors"
                >
                  {t('qol.copyMarkings.back')}
                </button>
                <button
                  type="button"
                  disabled={!preview || preview.updates.length === 0}
                  onClick={() => {
                    if (!preview || preview.updates.length === 0) return;
                    onApply(applyMarkingsPlan(targetRow, preview), {
                      sourceLabel: selected.label,
                      plan: preview,
                    });
                    reset();
                    close();
                  }}
                  className="px-3 py-1 text-xs font-semibold rounded-md bg-solar-accent text-white hover:bg-solar-accent-hover disabled:opacity-50 transition-opacity"
                >
                  {t('qol.copyMarkings.apply')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

export default CopyMarkingsPopover;

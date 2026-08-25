// Bridges the pure ScoringEngine to v2 row state (RowData arrays + EN headers).
// The UI keeps working on its existing English-named columns; this module
// translates markings → engine input and engine output → row cells.

import {
  calculateOsScore,
  type RulesConfig,
  type Marcacao,
  type OsScoreResult,
} from '../engine/scoring';
import { SEED_RULES_CONFIG, DEFAULT_SCORING_YEAR } from './scoringRules';
import { SCORE_COLUMN_TO_CATEGORY, FINAL_SCORE_COLUMN, RULE_ALIASES } from './ruleAliases';
import { formatScorePtBr } from '../engine/scoring';

export interface EngineBridgeResult {
  result: OsScoreResult;
  /** Cell updates keyed by column index (EN score columns). */
  cellUpdates: Array<{ colIndex: number; value: string }>;
}

const CATEGORY_TO_COLUMN = new Map(
  Object.entries(SCORE_COLUMN_TO_CATEGORY).map(([col, cat]) => [cat, col]),
);

/**
 * Recalculates scores for a row using the ScoringEngine instead of the legacy
 * hardcoded recalculateScores. Read-only: returns cell updates for the five
 * category columns + FINAL; the caller merges them into localRowData.
 *
 * Markings are detected by header name (v2 EN names resolve through aliases;
 * legacy PT-BR names resolve natively in the seed).
 */
export function recalculateScoresWithEngine(
  rowData: Array<{ value?: string } | undefined>,
  headers: string[],
  config: RulesConfig = SEED_RULES_CONFIG,
  year: string | number = DEFAULT_SCORING_YEAR,
): EngineBridgeResult {
  const marcacoes: Marcacao[] = [];
  headers.forEach((header, idx) => {
    const cell = rowData[idx];
    if (cell?.value !== 'TRUE') return;
    // Skip score/result columns even if a header ever collided with a rule name.
    if (SCORE_COLUMN_TO_CATEGORY[header] || header === FINAL_SCORE_COLUMN) return;
    // v2 EN header → seed rule id; PT-BR MVP names resolve natively by name.
    marcacoes.push({ ruleId: RULE_ALIASES[header], ruleName: RULE_ALIASES[header] ? undefined : header });
  });

  const result = calculateOsScore(marcacoes, config, { year });

  const cellUpdates: Array<{ colIndex: number; value: string }> = [];
  for (const category of result.categories) {
    const column = CATEGORY_TO_COLUMN.get(category.categoryId);
    if (!column) continue;
    const colIndex = headers.indexOf(column);
    if (colIndex > -1) {
      cellUpdates.push({ colIndex, value: formatScorePtBr(category.finalScore) });
    }
  }
  const finalColIndex = headers.indexOf(FINAL_SCORE_COLUMN);
  if (finalColIndex > -1) {
    cellUpdates.push({ colIndex: finalColIndex, value: formatScorePtBr(result.finalScore) });
  }

  return { result, cellUpdates };
}

/** Convenience: apply engine cell updates onto a copy of the row data.
 *  Genérico: preserva o tipo de célula do chamador (ex.: RowData/CellData),
 *  sem degradar para elemento possivelmente undefined. */
export function applyScoreUpdates<T extends { value?: string; link?: string }>(
  rowData: T[],
  cellUpdates: Array<{ colIndex: number; value: string }>,
): T[] {
  const next = [...rowData];
  for (const { colIndex, value } of cellUpdates) {
    const existing = next[colIndex] ?? ({} as T);
    next[colIndex] = { ...existing, value };
  }
  return next;
}

/**
 * True when a header is a markable inconformity field: v2 EN names resolve via
 * aliases; legacy MVP PT-BR names exist natively in the seed.
 */
export function isScorableHeader(header: string, config: RulesConfig = SEED_RULES_CONFIG): boolean {
  if (!header) return false;
  if (SCORE_COLUMN_TO_CATEGORY[header] || header === FINAL_SCORE_COLUMN) return false;
  if (RULE_ALIASES[header]) return true;
  return config.rules.some((r) => r.active && r.name === header);
}

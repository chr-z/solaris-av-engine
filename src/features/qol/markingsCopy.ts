// Solaris v3 — Feature Pack "Analista Feliz" — QoL A1.
//
// Duplicar análise similar (spec A1): botão "copiar marcações de outra OS"
// para aulas gêmeas (mesmo professor/estúdio/dia). Núcleo PURO e injetável:
// recebe headers + células fonte/destino, devolve um PLANO imutável de
// atualizações — nada de DOM, rede ou storage aqui.
//
// Regras honestas (nada silencioso):
//   * Só marcações de INCONFORMIDADE são copiadas por padrão (checkboxes
//     TRUE/FALSE). O analista decide o resto — notas de texto nunca vazam
//     sem opt-in explícito.
//   * ANALYST/W.O./DATE não participam por construção: quem assina a
//     análise gêmea é QUEM ESTÁ analisando agora, não quem fez a original.
//   * Célula vazia/desmarcada na origem NÃO apaga marcação do destino —
//     cópia adiciona contexto, nunca destrói trabalho já feito.
//   * Valor idêntico no destino vira "unchanged" (sem regravar por hábito).
//   * Coluna do catálogo que não existe na planilha não pode ser lida nem
//     gravada: entra só na contagem estrutural `compatibleRules`; com zero
//     regras compatíveis a UI comunica "nada compatível" em vez de mentir
//     com um botão que copia 0 marcações.

import { ALL_INCONFORMITY_OPTIONS } from '../../utils/constants';
import type { RowData } from '../../services/sheetSync';

export interface MarkingUpdate {
  colIndex: number;
  header: string;
  value: string;
}

export interface MarkingsCopyPlan {
  /** Marcações que vão mudar o destino (valor difere). */
  updates: readonly MarkingUpdate[];
  /** Inconformidades marcadas na origem mas já idênticas no destino. */
  unchanged: readonly string[];
  /** Campos de texto livre pulados por padrão (visibilidade no toast/UI). */
  skippedFreeText: readonly string[];
  /**
   * Quantas regras do catálogo têm coluna real nesta planilha. Zero =
   * estrutura incompatível (ex.: planilha legada fora do catálogo EN).
   */
  compatibleRules: number;
}

export interface MarkingsCopyOptions {
  /**
   * Copiar também campos de texto livre (comentários/notas)? Padrão NO:
   * rascunho de outro contexto não deve virar lição copiada às cegas.
   */
  includeFreeText?: boolean;
}

const FREE_TEXT_HEADERS = [
  'OPERATOR COMMENTS',
  'INTERNAL NOTES',
  'TECHNICAL FEEDBACK',
] as const;

function cellValue(cells: RowData | null | undefined, index: number): string {
  const cell = index >= 0 ? cells?.[index] : undefined;
  return typeof cell?.value === 'string' ? cell.value : '';
}

/**
 * Constrói o plano de cópia das marcações de `sourceCells` sobre `targetCells`.
 * Puro: mesmos inputs → mesmo plano. `headers` é a verdade absoluta de colunas.
 */
export function planMarkingsCopy(
  headers: readonly string[],
  sourceCells: RowData | null | undefined,
  targetCells: RowData | null | undefined,
  options: MarkingsCopyOptions = {},
): MarkingsCopyPlan {
  const updates: MarkingUpdate[] = [];
  const unchanged: string[] = [];
  const skippedFreeText: string[] = [];

  if (!sourceCells || !targetCells) {
    return { updates, unchanged, skippedFreeText, compatibleRules: 0 };
  }

  let compatibleRules = 0;
  for (const header of ALL_INCONFORMITY_OPTIONS) {
    const colIndex = headers.indexOf(header);
    if (colIndex < 0) continue; // sem coluna não há leitura nem escrita
    compatibleRules += 1;

    const sourceValue = cellValue(sourceCells, colIndex);
    if (sourceValue !== 'TRUE') continue; // desmarcada/vazia na origem

    const targetValue = cellValue(targetCells, colIndex);
    if (targetValue === 'TRUE') {
      unchanged.push(header);
      continue;
    }
    updates.push({ colIndex, header, value: 'TRUE' });
  }

  for (const header of FREE_TEXT_HEADERS) {
    const colIndex = headers.indexOf(header);
    if (colIndex < 0) continue;
    if (options.includeFreeText) {
      const sourceValue = cellValue(sourceCells, colIndex).trim();
      const targetValue = cellValue(targetCells, colIndex).trim();
      if (sourceValue && sourceValue !== targetValue) {
        updates.push({ colIndex, header, value: sourceValue });
      }
    } else if (cellValue(sourceCells, colIndex).trim()) {
      skippedFreeText.push(header);
    }
  }

  return { updates, unchanged, skippedFreeText, compatibleRules };
}

/**
 * Aplica o plano sobre as células atuais preservando objetos CellData
 * (links etc.) — mesmo contrato de espalhamento do handleDataChange.
 * Retorna NOVA array; nunca muta `cells`.
 */
export function applyMarkingsPlan(cells: RowData, plan: MarkingsCopyPlan): RowData {
  const next = [...cells];
  for (const update of plan.updates) {
    next[update.colIndex] = { ...(next[update.colIndex] || {}), value: update.value };
  }
  return next;
}

/** Resumo legível p/ aria-live/toast: "8 marcações · 2 já existiam". */
export function describePlan(plan: MarkingsCopyPlan): string {
  const parts = [`${plan.updates.length} marking(s)`];
  if (plan.unchanged.length) parts.push(`${plan.unchanged.length} already equal`);
  if (plan.skippedFreeText.length) parts.push(`text skipped (${plan.skippedFreeText.length})`);
  return parts.join(' · ');
}

// ---------- Gêmeos: candidatas a "aula similar" (mesmo professor/estúdio/dia) ----------

export interface TwinCandidate<TRow> {
  row: TRow;
  /** Rótulo legível da OS (W.O. quando existir, senão índice). */
  label: string;
  /** Pontuação de similaridade (maior = mais gêmea). */
  score: number;
  /** Motivos legíveis ("same instructor", "same studio", "same date"). */
  reasons: readonly string[];
}

interface TwinRowInput {
  rowIndex: number;
  row: RowData;
}

const HEADER_ALIASES = {
  instructor: ['INSTRUCTOR', 'PROFESSOR'],
  studio: ['STUDIO', 'ESTÚDIO', 'ESTUDIO'],
  date: ['DATE', 'DATA'],
  wo: ['W.O.', 'OS', 'WO'],
} as const;

function firstColumn(headers: readonly string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

function norm(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Rankeia linhas candidatas a "aula gêmea" da OS atual: mesmo professor
 * (peso 2), mesmo estúdio (+1), mesmo dia (+1). Exige score mínimo 2
 * (compartilha o professor OU estúdio+junto no dia) — nada de sugerir
 * análise aleatória. Puro e determinístico; empate mantém ordem de entrada.
 */
export function findTwinRows<TRow extends TwinRowInput>(
  headers: readonly string[],
  currentRow: RowData | null | undefined,
  rows: readonly TRow[],
  currentRowIndex?: number,
): Array<TwinCandidate<TRow>> {
  if (!currentRow) return [];
  const instructorIdx = firstColumn(headers, HEADER_ALIASES.instructor);
  const studioIdx = firstColumn(headers, HEADER_ALIASES.studio);
  const dateIdx = firstColumn(headers, HEADER_ALIASES.date);
  const woIdx = firstColumn(headers, HEADER_ALIASES.wo);

  const curInstructor = norm(cellValue(currentRow, instructorIdx));
  const curStudio = norm(cellValue(currentRow, studioIdx));
  const curDate = norm(cellValue(currentRow, dateIdx));
  if (!curInstructor && !curStudio && !curDate) return [];

  const candidates: Array<TwinCandidate<TRow>> = [];
  for (const entry of rows) {
    if (typeof currentRowIndex === 'number' && entry.rowIndex === currentRowIndex) continue;
    const reasons: string[] = [];
    let score = 0;
    const instructor = norm(cellValue(entry.row, instructorIdx));
    const studio = norm(cellValue(entry.row, studioIdx));
    const date = norm(cellValue(entry.row, dateIdx));
    if (curInstructor && instructor === curInstructor) { score += 2; reasons.push('same instructor'); }
    if (curStudio && studio === curStudio) { score += 1; reasons.push('same studio'); }
    if (curDate && date === curDate) { score += 1; reasons.push('same date'); }
    if (score < 2) continue;
    const woRaw = cellValue(entry.row, woIdx).trim();
    const label = woRaw || `#${entry.rowIndex}`;
    candidates.push({ row: entry, label, score, reasons });
  }

  // Mais gêmea primeiro; empate mantém a ordem original (estável).
  return candidates.sort((a, b) => b.score - a.score);
}

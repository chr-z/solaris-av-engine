// Solaris v3 P13 — recurring inconformity ranking (pitch item D).
//
// Aggregates the marks extracted by buildDashboardDataset into a ranked list
// of recurring inconformities: occurrences, impact rate over the period's
// O.S. count and penalty weight from the versioned seed rules. Pure data —
// the React panel only renders what these functions return.

import type { Dataset } from './dashboard';
import {
  DEFAULT_MARKABLE_RULES,
  ruleUnitScore,
} from './ruleMarks';

/** Ranked row of the inconformity ranking table. */
export interface InconformityStat {
  /** Stable machine id (seed slug). */
  ruleId: string;
  /** English display name shown in the table. */
  name: string;
  /** Seed category id (ENQUADRAMENTO, ÁUDIO, ...). */
  categoryId: string;
  /** Rows carrying this marking in the analyzed dataset. */
  count: number;
  /**
   * count / totalRecords (0 when there are no records) — "in how many O.S.
   * did this happen", independent of how big the period is.
   */
  rate: number;
  /** Penalty points per occurrence for the ranking year (0 = unknown). */
  unitScore: number;
  /** count × unitScore, rounded to 2 decimals like every Solaris score. */
  impact: number;
}

const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Builds the ranked inconformity list for a dataset (usually the
 * period-filtered one). Deterministic order:
 *   1. impact desc (heavier problems first),
 *   2. count desc,
 *   3. name asc (localeCompare).
 * Rules never marked in the period stay out of the table; unknown/legacy ids
 * degrade gracefully with name 'unknown' and zero penalty instead of lying.
 */
export function inconformityRanking(dataset: Dataset, year: string | number = 2025): InconformityStat[] {
  const rules = DEFAULT_MARKABLE_RULES;
  const totalRecords = dataset.records.length;
  const counts = new Map<string, number>();
  for (const rec of dataset.records) {
    const marks = Array.isArray(rec.marks) ? rec.marks : [];
    // A rule is counted once per row regardless of legacy repeat columns.
    for (const id of new Set(marks)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const stats: InconformityStat[] = [];
  for (const [ruleId, count] of counts.entries()) {
    const meta = rules.find((r) => r.ruleId === ruleId);
    const unitScore = ruleUnitScore(ruleId, year);
    stats.push({
      ruleId,
      name: meta?.nameEn ?? 'unknown',
      categoryId: meta?.categoryId ?? '',
      count,
      rate: totalRecords > 0 ? round2((count / totalRecords) * 100) / 100 : 0,
      unitScore,
      impact: round2(count * unitScore),
    });
  }
  return stats.sort(
    (a, b) =>
      b.impact - a.impact ||
      b.count - a.count ||
      a.name.localeCompare(b.name),
  );
}

/** KPI cards above the ranking table. */
export interface RankingSummary {
  markedRows: number;
  distinctRules: number;
  totalOccurrences: number;
}

export function rankingSummary(dataset: Dataset): RankingSummary {
  let markedRows = 0;
  let totalOccurrences = 0;
  const distinct = new Set<string>();
  for (const rec of dataset.records) {
    const marks = Array.isArray(rec.marks) ? rec.marks : [];
    if (marks.length > 0) markedRows += 1;
    for (const id of new Set(marks)) distinct.add(id);
    totalOccurrences += new Set(marks).size;
  }
  return { markedRows, distinctRules: distinct.size, totalOccurrences };
}

/** Category rollup of the ranking (Σ impact per category), same ordering. */
export function categoryImpact(
  ranking: InconformityStat[],
): Array<{ categoryId: string; occurrences: number; impact: number }> {
  const buckets = new Map<string, { occurrences: number; impact: number }>();
  for (const stat of ranking) {
    const bucket = buckets.get(stat.categoryId) ?? { occurrences: 0, impact: 0 };
    bucket.occurrences += stat.count;
    bucket.impact = round2(bucket.impact + stat.impact);
    buckets.set(stat.categoryId, bucket);
  }
  return [...buckets.entries()]
    .map(([categoryId, b]) => ({ categoryId, ...b }))
    .sort((a, b) => b.impact - a.impact || a.categoryId.localeCompare(b.categoryId));
}

// ---------- CSV export ----------

import type { PeriodRange } from './dashboardExport';
import { normalizeBound } from './dashboardExport';

/** Stable filename; carries the range when one is active (csvFilename parity). */
export function rankingFilename(range: PeriodRange = {}): string {
  const from = normalizeBound(range.from);
  const to = normalizeBound(range.to);
  if (!from && !to) return 'solaris-inconformity-ranking.csv';
  return `solaris-inconformity-ranking_${from ?? 'start'}_${to ?? 'latest'}.csv`;
}

/** Escapes a field only when required (comma/quote/newline/padding). */
function escapeCsvField(value: string): string {
  const text = value ?? '';
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * CSV of the current ranking view: rank, rule, category, occurrences, rate
 * (% with dot decimal), unit penalty, impact. Deterministic sheet-order-free
 * layout — mirrors exactly what the table renders.
 */
export function buildRankingCsv(ranking: InconformityStat[]): string {
  const header = ['rank', 'rule', 'rule_id', 'category', 'occurrences', 'rate', 'unit_score', 'impact'];
  const lines = [header.join(',')];
  ranking.forEach((stat, index) => {
    lines.push(
      [
        String(index + 1),
        escapeCsvField(stat.name),
        escapeCsvField(stat.ruleId),
        escapeCsvField(stat.categoryId),
        String(stat.count),
        (stat.rate * 100).toFixed(2),
        stat.unitScore.toFixed(2),
        stat.impact.toFixed(2),
      ].join(','),
    );
  });
  return lines.join('\r\n');
}

// ---------- Excel export (v3 P14 — twin of the CSV above) ----------

import {
  buildSingleSheetXlsx,
  columnIndexToLetter,
  escapeXmlText,
} from './dashboardXlsx';

/**
 * Same column set/order as `buildRankingCsv` — one source of truth per row
 * shape. Counts land as numeric cells; rate/unit/impact as percent-style
 * numbers with dot decimal (2.00 → 2) so Excel can sort and aggregate them.
 */
const RANKING_XLSX_COLUMNS: Array<{ header: string; pick: (stat: InconformityStat, rank: number) => string | null }> = [
  { header: 'rank', pick: (_s, rank) => String(rank) },
  { header: 'rule', pick: (s) => s.name },
  { header: 'rule_id', pick: (s) => s.ruleId },
  { header: 'category', pick: (s) => s.categoryId },
  { header: 'occurrences', pick: (s) => String(s.count) },
  { header: 'rate', pick: (s) => (s.rate * 100).toFixed(2) },
  { header: 'unit_score', pick: (s) => s.unitScore.toFixed(2) },
  { header: 'impact', pick: (s) => s.impact.toFixed(2) },
];

function rankingCellXml(ref: string, value: string | null): string {
  if (value === null || value === '') return '';
  // Numbers (rank/counts/percentages) become true numeric cells; everything
  // else is an inline string. Mirrors the P12 cell emitter exactly.
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`;
}

/** Worksheet XML for the ranking table: header row + one row per stat, in rank order. */
export function buildRankingSheetXml(ranking: InconformityStat[]): string {
  const rows: string[] = [];
  const headerCells = RANKING_XLSX_COLUMNS.map((c, i) =>
    `<c r="${columnIndexToLetter(i)}1" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(c.header)}</t></is></c>`,
  ).join('');
  rows.push(`<row r="1">${headerCells}</row>`);

  ranking.forEach((stat, idx) => {
    const rowNumber = idx + 2;
    const cells = RANKING_XLSX_COLUMNS.map((col, i) => {
      const ref = `${columnIndexToLetter(i)}${rowNumber}`;
      return rankingCellXml(ref, col.pick(stat, idx + 1));
    })
      .filter(Boolean)
      .join('');
    rows.push(`<row r="${rowNumber}">${cells}</row>`);
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>${rows.join('')}</sheetData></worksheet>`
  );
}

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/**
 * Complete .xlsx package of the current ranking view ('Ranking' sheet).
 * Deterministic for equal inputs; same ZIP/OOXML conventions as the P12
 * scores workbook.
 */
export function buildRankingXlsx(ranking: InconformityStat[], timestamp: Date = new Date()): Uint8Array {
  return buildSingleSheetXlsx('Ranking', buildRankingSheetXml(ranking), timestamp);
}

/**
 * Stable filename mirroring `rankingFilename` — the extension is the only
 * difference, so paired CSV/XLSX downloads always share the name stem.
 */
export function rankingXlsxFilename(range: PeriodRange = {}): string {
  return rankingFilename(range).replace(/\.csv$/, '.xlsx');
}

// Solaris v3 P15 — monthly heatmap of scoring-rule markings.
//
// The ranking (P13) answers "which inconformities dominate the period"; the
// heatmap answers "WHEN do they happen": one row per rule, one column per
// month ('YYYY-MM'), each cell holding that month's marking count. Pure data
// — the React panel only renders what these functions return, exactly like
// the rest of the dashboard core.
//
// Conventions shared with dashboard.ts / dashboardInconformities.ts:
//   - records without a date never leak into any month bucket;
//   - unknown/legacy rule ids degrade gracefully (name 'unknown');
//   - every output is deterministic (localeCompare ties, stable sorts).

import type { Dataset } from './dashboard';
import { DEFAULT_MARKABLE_RULES } from './ruleMarks';
import { normalizeBound } from './dashboardExport';
import type { PeriodRange } from './dashboardExport';

/** One heatmap row: a rule plus its counts for EVERY column of the matrix. */
export interface HeatmapRow {
  ruleId: string;
  name: string;
  categoryId: string;
  /** Total occurrences across all columns (row sum). */
  total: number;
  /** Parallel to `months`: always present, 0 when the rule missed the month. */
  cells: number[];
}

export interface MarkHeatmap {
  /** Chronologically sorted distinct 'YYYY-MM' keys with ≥1 marking. */
  months: string[];
  rows: HeatmapRow[];
}

/**
 * Builds the rule×month matrix from a dataset (usually period-filtered).
 * Rows are ordered by total desc, then name asc (ranking parity); columns are
 * chronological. Datasets without dated markings yield an empty matrix.
 */
export function buildMarkHeatmap(dataset: Dataset): MarkHeatmap {
  const byRule = new Map<string, Map<string, number>>();
  const monthsSet = new Set<string>();
  for (const rec of dataset.records) {
    if (!rec.month) continue;
    const marks = Array.isArray(rec.marks) ? rec.marks : [];
    if (marks.length === 0) continue;
    monthsSet.add(rec.month);
    for (const id of new Set(marks)) {
      let months = byRule.get(id);
      if (!months) {
        months = new Map();
        byRule.set(id, months);
      }
      months.set(rec.month, (months.get(rec.month) ?? 0) + 1);
    }
  }
  if (byRule.size === 0) return { months: [], rows: [] };

  const months = [...monthsSet].sort((a, b) => a.localeCompare(b));
  const rules = DEFAULT_MARKABLE_RULES;
  const rows: HeatmapRow[] = [];
  for (const [ruleId, monthCounts] of byRule.entries()) {
    const meta = rules.find((r) => r.ruleId === ruleId);
    let total = 0;
    const cells = months.map((m) => {
      const value = monthCounts.get(m) ?? 0;
      total += value;
      return value;
    });
    rows.push({
      ruleId,
      name: meta?.nameEn ?? 'unknown',
      categoryId: meta?.categoryId ?? '',
      total,
      cells,
    });
  }
  rows.sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );
  return { months, rows };
}

/**
 * Peak intensity of the whole matrix (max cell). Returns null only when the
 * matrix is empty — zero is a real peak ("nothing was marked anywhere").
 */
export function heatmapPeak(heatmap: MarkHeatmap): number | null {
  let peak = 0;
  for (const row of heatmap.rows) {
    for (const cell of row.cells) {
      if (cell > peak) peak = cell;
    }
  }
  return heatmap.rows.length === 0 ? null : peak;
}

/**
 * Opacity tier of a cell for the color scale, normalized against the peak:
 *   0 → 0 (no tint), then ceil(count / maxPerTier) tiers from 1..`tiers`.
 * A non-finite or negative peak degrades every non-zero cell to the top
 * tier instead of lying with NaN. Same count → same tier, always.
 */
export function heatmapTier(
  count: number,
  peak: number | null,
  tiers = 4,
): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(peak) || peak === null || peak <= 0) return tiers;
  const safeTiers = Number.isFinite(tiers) && tiers >= 1 ? Math.floor(tiers) : 4;
  const step = peak / safeTiers;
  return Math.min(safeTiers, Math.ceil(count / step));
}

/** Stable filename mirroring `rankingFilename` — heat variant. */
export function heatmapFilename(range: PeriodRange = {}): string {
  const from = normalizeBound(range.from);
  const to = normalizeBound(range.to);
  if (!from && !to) return 'solaris-mark-heatmap.csv';
  return `solaris-mark-heatmap_${from ?? 'start'}_${to ?? 'latest'}.csv`;
}

/** Escapes a CSV field only when required (same policy as the ranking CSV). */
function escapeCsvField(value: string): string {
  const text = value ?? '';
  if (/[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  if (text.includes(',') || text.includes('"') || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * CSV twin of the on-screen matrix: header row (rule + one ISO month column
 * per bucket) + one line per row, in the SAME order as `heatmap.rows`.
 */
export function buildHeatmapCsv(heatmap: MarkHeatmap): string {
  const header = ['rule', ...heatmap.months];
  const lines = [header.map(escapeCsvField).join(',')];
  for (const row of heatmap.rows) {
    lines.push(
      [escapeCsvField(row.name), ...row.cells.map(String)].join(','),
    );
  }
  return lines.join('\r\n');
}

/**
 * Compact textual summary for aria labels / titles: "3 in 2024-02, 1 in
 * 2024-03" following the matrix's column order; empty string when the row
 * has no markings at all.
 */
export function summarizeRowMonths(row: HeatmapRow, months: string[]): string {
  const parts: string[] = [];
  row.cells.forEach((count, index) => {
    if (count > 0 && months[index]) parts.push(`${count} in ${months[index]}`);
  });
  return parts.join(', ');
}

// ---------- Excel export (v3 P16 — twin of the CSV above) ----------

import {
  buildSingleSheetXlsx,
  escapeXmlText,
} from './dashboardXlsx';

/**
 * Spreadsheet column reference for a 0-based index using Excel's bijective
 * base-26 (0→A … 25→Z, 26→AA, 27→AB…). Unlike the single-letter helper in
 * dashboardXlsx.ts this stays valid for wide heatmaps (24+ month columns).
 */
function columnRef(index: number): string {
  let n = Math.floor(index);
  let ref = '';
  do {
    ref = String.fromCharCode(65 + (n % 26)) + ref;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return ref;
}

/** Emits one cell; counts are numeric, everything else an escaped inlineStr. */
function heatmapCellXml(ref: string, value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`;
}

/** Worksheet XML of the matrix: header row + one row per rule, same order as the CSV. */
export function buildHeatmapSheetXml(heatmap: MarkHeatmap): string {
  // Column contract ('rule' + one ISO month per bucket) lives in
  // buildHeatmapCsv — the XLSX is its byte-twin with numeric cells.
  const headerValues = ['rule', ...heatmap.months];
  const rows: string[] = [];
  const headerCells = headerValues
    .map((value, i) => heatmapCellXml(`${columnRef(i)}1`, value))
    .join('');
  rows.push(`<row r="1">${headerCells}</row>`);

  heatmap.rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const values = [row.name, ...row.cells.map(String)];
    const cells = values
      .map((value, i) => heatmapCellXml(`${columnRef(i)}${rowNumber}`, value))
      .join('');
    rows.push(`<row r="${rowNumber}">${cells}</row>`);
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`
  );
}

/**
 * Complete .xlsx package of the current matrix ('Heatmap' sheet).
 * Deterministic for equal inputs; same ZIP/OOXML conventions as the P12/P14
 * workbooks.
 */
export function buildHeatmapXlsx(heatmap: MarkHeatmap, timestamp: Date = new Date()): Uint8Array {
  return buildSingleSheetXlsx('Heatmap', buildHeatmapSheetXml(heatmap), timestamp);
}

/**
 * Stable filename mirroring `heatmapFilename` — the extension is the only
 * difference, so paired CSV/XLSX downloads always share the name stem.
 */
export function heatmapXlsxFilename(range: PeriodRange = {}): string {
  return heatmapFilename(range).replace(/\.csv$/, '.xlsx');
}

// Solaris v3 P5 — Scoring dashboards core.
//
// Pure, framework-free aggregation over O.S. rows (sheet or demo). The React
// panel only renders what these functions return; every rule of math here is
// unit-testable without DOM or localStorage.
//
// Data model mirrors the Gran sheet: dynamic header mapping (columns move,
// dashboards keep working) plus tolerant score parsing (both decimal comma
// and dot are accepted — the sheet mixes locales over time).

import type { RowData } from '../services/sheetSync';
import {
  collectMarkings,
  DEFAULT_MARKABLE_RULES,
} from './ruleMarks';

// ---------- Types ----------

export interface DashboardEntryInput {
  /** 1-based sheet row (row 1 = headers; data starts at 2). */
  rowIndex: number;
  headers: string[];
  cells: RowData;
}

export interface OsRecord {
  rowIndex: number;
  /** ISO-ish date string when parseable ('YYYY-MM-DD'), else null. */
  date: string | null;
  /** 'YYYY-MM' month key derived from date, else null. */
  month: string | null;
  wo: string;
  event: string;
  studio: string;
  instructor: string;
  analyst: string;
  /** Parsed FINAL score (finite, >= 0) or null when absent/unparseable. */
  finalScore: number | null;
  /**
   * v3 P13: scoring rules marked 'TRUE' on this row (rule ids, seed order).
   * Empty for datasets built before mark extraction existed.
   */
  marks?: string[];
}

export interface Dataset {
  records: OsRecord[];
}

export interface SummaryStats {
  total: number;
  scored: number;
  unscored: number;
  average: number | null;
  min: number | null;
  max: number | null;
}

export interface GroupStat {
  label: string;
  count: number;
  average: number | null;
  min: number | null;
  max: number | null;
}

export interface TrendPoint {
  month: string; // 'YYYY-MM'
  count: number;
  average: number | null;
}

// ---------- Column resolution (aliases, normalized like sheetSync) ----------

const normalizeHeader = (h: string): string =>
  (h ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();

const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['DATE', 'DATA'],
  wo: ['W.O.', 'WO', 'O.S.', 'OS', 'ORDEM DE SERVIÇO'],
  event: ['EVENT', 'EVENTO'],
  studio: ['STUDIO', 'ESTÚDIO', 'ESTUDIO'],
  instructor: ['INSTRUCTOR', 'INSTRUTOR'],
  analyst: ['ANALYST', 'ANALISTA'],
  finalScore: ['FINAL SCORE', 'FINAL', 'NOTA FINAL'],
};

/** Resolves each logical column to an index (-1 = column absent). */
export function resolveColumns(headers: string[]): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const resolved: Record<string, number> = {};
  for (const [logical, aliases] of Object.entries(COLUMN_ALIASES)) {
    resolved[logical] = -1;
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx !== -1) {
        resolved[logical] = idx;
        break;
      }
    }
  }
  return resolved;
}

// ---------- Parsing ----------

/**
 * Parses a FINAL score cell. Accepts '5,00' / '5.00' / ' 4,33 ' / '5'.
 * Returns null for empty text or anything that is not a finite number >= 0.
 */
export function parseFinalScore(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  // Decimal comma → dot; then strip any remaining non-numeric decoration.
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Extracts an ISO date ('YYYY-MM-DD') from common sheet formats:
 * ISO ('2024-03-10', with optional time) or BR ('10/03/2024').
 * Returns null for anything else — never guesses.
 */
export function parseIsoDate(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) {
    const day = br[1].padStart(2, '0');
    const month = br[2].padStart(2, '0');
    return `${br[3]}-${month}-${day}`;
  }
  return null;
}

/** Month bucket of an ISO date; null when the date itself is null/malformed. */
export function monthKeyOf(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const m = isoDate.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

const cellValue = (cells: RowData, idx: number): string =>
  idx >= 0 && cells && cells[idx] && typeof cells[idx].value === 'string'
    ? (cells[idx].value as string)
    : '';

// ---------- Dataset ----------

/**
 * Converts raw entries into typed records, skipping malformed rows.
 * v3 P13: also extracts the row's marked scoring rules ('TRUE' cells in
 * markable rule columns) so the inconformity ranking consumes one dataset.
 */
export function buildDashboardDataset(entries: DashboardEntryInput[]): Dataset {
  const records: OsRecord[] = [];
  for (const entry of entries ?? []) {
    if (!entry || !Array.isArray(entry.cells)) continue;
    const cols = resolveColumns(entry.headers ?? []);
    const date = parseIsoDate(cellValue(entry.cells, cols.date));
    records.push({
      rowIndex: entry.rowIndex,
      date,
      month: monthKeyOf(date),
      wo: cellValue(entry.cells, cols.wo).trim(),
      event: cellValue(entry.cells, cols.event).trim(),
      studio: cellValue(entry.cells, cols.studio).trim(),
      instructor: cellValue(entry.cells, cols.instructor).trim(),
      analyst: cellValue(entry.cells, cols.analyst).trim(),
      finalScore: parseFinalScore(cellValue(entry.cells, cols.finalScore)),
      ...(Array.isArray(entry.headers)
        ? { marks: collectMarkings(entry.headers, entry.cells, DEFAULT_MARKABLE_RULES) }
        : {}),
    });
  }
  return { records };
}

// ---------- Aggregations ----------

const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

function statsOf(values: number[]): { average: number | null; min: number | null; max: number | null } {
  if (values.length === 0) return { average: null, min: null, max: null };
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    average: round2(sum / values.length),
    min: round2(Math.min(...values)),
    max: round2(Math.max(...values)),
  };
}

/** Overall KPIs: totals, scored/unscored split and score stats. */
export function overallSummary(dataset: Dataset): SummaryStats {
  const scores = dataset.records
    .map((r) => r.finalScore)
    .filter((v): v is number => v !== null);
  return {
    total: dataset.records.length,
    scored: scores.length,
    unscored: dataset.records.length - scores.length,
    ...statsOf(scores),
  };
}

export type GroupDimension = 'studio' | 'instructor' | 'analyst';

/**
 * Groups scored+unscored records by a dimension and returns stats sorted by
 * average desc (nulls last), then by count desc, then label asc — stable and
 * deterministic for tests and rendering. Empty labels collapse into '(sem
 * valor)' so unnamed studios still appear exactly once.
 */
export function groupAverageBy(dataset: Dataset, dimension: GroupDimension): GroupStat[] {
  const buckets = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const rec of dataset.records) {
    const raw = rec[dimension];
    const label = raw ? raw : '(sem valor)';
    const scores = buckets.get(label) ?? [];
    const total = counts.get(label) ?? 0;
    if (rec.finalScore !== null) scores.push(rec.finalScore);
    buckets.set(label, scores);
    counts.set(label, total + 1);
  }
  const stats: GroupStat[] = [];
  for (const [label, scores] of buckets.entries()) {
    stats.push({ label, count: counts.get(label) ?? 0, ...statsOf(scores) });
  }
  return sortGroupStats(stats);
}

/** Deterministic ordering: average desc (null last), count desc, label asc. */
export function sortGroupStats(stats: GroupStat[]): GroupStat[] {
  return [...stats].sort((a, b) => {
    if (a.average === null && b.average !== null) return 1;
    if (b.average === null && a.average !== null) return -1;
    if (a.average !== null && b.average !== null && a.average !== b.average) {
      return b.average - a.average;
    }
    if (a.count !== b.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });
}

/** Chronologically sorted monthly trend (only months with at least one record). */
export function trendByMonth(dataset: Dataset): TrendPoint[] {
  const buckets = new Map<string, number[]>();
  for (const rec of dataset.records) {
    if (!rec.month) continue;
    const scores = buckets.get(rec.month) ?? [];
    if (rec.finalScore !== null) scores.push(rec.finalScore);
    buckets.set(rec.month, scores);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, scores]) => ({ month, count: scores.length, ...statsOf(scores) }));
}

/**
 * Percent change between two consecutive trend points (average basis).
 * Returns null when either side has no average or the base is zero.
 */
export function deltaPercent(previous: TrendPoint | undefined, current: TrendPoint | undefined): number | null {
  if (!previous || !current) return null;
  if (previous.average === null || current.average === null) return null;
  if (previous.average === 0) return null;
  return round2(((current.average - previous.average) / previous.average) * 100);
}

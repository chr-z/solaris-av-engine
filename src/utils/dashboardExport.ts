// Solaris v3 P6 — Dashboard CSV export + period filtering.
//
// Pure, framework-free helpers consumed by DashboardPanel:
//   • filterByPeriod — inclusive range filter over ISO dates ('YYYY-MM-DD'
//     records against 'YYYY-MM' or 'YYYY-MM-DD' bounds; lexicographic ISO
//     comparison keeps it timezone-free). Undated records are dropped only
//     while a bound is active — they cannot prove membership in a period.
//   • buildDashboardCsv — RFC 4180-ish CSV (quote-when-needed, doubled
//     quotes) of the filtered records, deterministic order (sheet order).
//   • csvFilename — stable download name carrying the applied range.
//
// Everything here is unit-testable without DOM, Blob or fetch.

import type { OsRecord } from './dashboard';

// ---------- Period filtering ----------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH_RE = /^\d{4}-\d{2}$/;

/** A period bound accepts a full date ('2024-03-10') or a month ('2024-03'). */
export type PeriodBound = string | undefined | null;

export interface PeriodRange {
  /** Inclusive lower bound (date or month). */
  from?: PeriodBound;
  /** Inclusive upper bound (date or month). */
  to?: PeriodBound;
}

const isBoundShape = (v: string): boolean => ISO_DATE_RE.test(v) || ISO_MONTH_RE.test(v);

/** Valid bounds pass through; anything else (garbage/empty) counts as unset. */
export const normalizeBound = (bound: PeriodBound): string | null => {
  if (typeof bound !== 'string') return null;
  const trimmed = bound.trim();
  return isBoundShape(trimmed) ? trimmed : null;
};

export const hasActiveBounds = (range: PeriodRange): boolean =>
  normalizeBound(range.from) !== null || normalizeBound(range.to) !== null;

/**
 * Inclusive period filter. Month bounds match the whole month ('2024-03'
 * covers '2024-03-01'..'2024-03-31'); date bounds match exactly. Comparison
 * is lexicographic on ISO strings after aligning lengths, so no Date object,
 * timezone or locale ever touches the math. Records without a parseable date
 * are kept only when no bound is active.
 */
export function filterByPeriod<T extends OsRecord>(records: T[], range: PeriodRange): T[] {
  const from = normalizeBound(range.from);
  const to = normalizeBound(range.to);
  if (!hasActiveBounds(range)) return [...records];
  return records.filter((rec) => {
    if (!rec.date) return false;
    if (from !== null && rec.date.slice(0, from.length) < from) return false;
    if (to !== null && rec.date.slice(0, to.length) > to) return false;
    return true;
  });
}

// ---------- CSV ----------

/**
 * Quotes a field only when required (comma, quote, CR/LF or leading/trailing
 * whitespace); embedded quotes are doubled per RFC 4180.
 */
export function escapeCsvField(value: string): string {
  const text = value ?? '';
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CSV_COLUMNS: Array<{ header: string; pick: (r: OsRecord) => string }> = [
  { header: 'row', pick: (r) => String(r.rowIndex) },
  { header: 'date', pick: (r) => r.date ?? '' },
  { header: 'month', pick: (r) => r.month ?? '' },
  { header: 'wo', pick: (r) => r.wo },
  { header: 'event', pick: (r) => r.event },
  { header: 'studio', pick: (r) => r.studio },
  { header: 'instructor', pick: (r) => r.instructor },
  { header: 'analyst', pick: (r) => r.analyst },
  { header: 'final_score', pick: (r) => (r.finalScore === null ? '' : String(r.finalScore)) },
];

/**
 * Builds the full CSV text (header + one row per record). Score uses a dot
 * decimal separator so spreadsheet tools never misparse PT-BR commas as
 * column breaks; ordering follows input order (= sheet order).
 */
export function buildDashboardCsv(records: OsRecord[]): string {
  const lines: string[] = [CSV_COLUMNS.map((c) => escapeCsvField(c.header)).join(',')];
  for (const rec of records) {
    lines.push(CSV_COLUMNS.map((c) => escapeCsvField(c.pick(rec))).join(','));
  }
  return lines.join('\r\n');
}

/** Stable filename; carries the range when one is active. */
export function csvFilename(range: PeriodRange = {}): string {
  const from = normalizeBound(range.from);
  const to = normalizeBound(range.to);
  if (!from && !to) return 'solaris-dashboard.csv';
  const span = `${from ?? 'start'}_${to ?? 'latest'}`;
  return `solaris-dashboard_${span}.csv`;
}

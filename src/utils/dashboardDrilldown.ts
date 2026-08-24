// Solaris v3 P7 — Dashboard group drill-down core.
//
// Pure, framework-free helpers consumed by DashboardPanel: selecting one
// group's records (studio / instructor / analyst bucket, including the
// '(sem valor)' bucket shared with groupAverageBy), sorting them in a
// deterministic reading order and picking a single month out of the trend.
//
// Everything here is unit-testable without DOM or fetch; the React panel
// only renders what these functions return.

import type { Dataset, GroupDimension, GroupStat, OsRecord } from './dashboard';
import { groupAverageBy } from './dashboard';
import { csvFilename } from './dashboardExport';

/** Sentinel label used by groupAverageBy for records missing the dimension. */
export const UNGROUPED_LABEL = '(sem valor)';

export interface DrillDownSelection {
  dimension: GroupDimension;
  /** Exact group label as shown in the table (sentinel included). */
  label: string;
  /** Member records in deterministic reading order (date asc, undated last, rowIndex asc). */
  records: OsRecord[];
  /** Total member records (scored + unscored). */
  count: number;
  scoredCount: number;
  average: number | null;
  min: number | null;
  max: number | null;
}

const EMPTY_SELECTION = (dimension: GroupDimension, label: string): DrillDownSelection => ({
  dimension,
  label,
  records: [],
  count: 0,
  scoredCount: 0,
  average: null,
  min: null,
  max: null,
});

const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Selects every record of `dataset` whose dimension value equals `label`.
 * The sentinel label (same one rendered by groupAverageBy) matches records
 * with an empty/raw-missing value, so unnamed studios remain reachable.
 * Unknown labels yield an empty selection — never an error.
 */
export function selectGroup(
  dataset: Dataset,
  dimension: GroupDimension,
  label: string,
): DrillDownSelection {
  const members: OsRecord[] = [];
  for (const rec of dataset?.records ?? []) {
    const raw = rec[dimension];
    const belongs = label === UNGROUPED_LABEL ? !raw : raw === label;
    if (belongs) members.push(rec);
  }
  if (members.length === 0) return EMPTY_SELECTION(dimension, label);

  const scores = members.map((r) => r.finalScore).filter((v): v is number => v !== null);
  const sorted = sortDrillDownRecords(members);
  return {
    dimension,
    label,
    records: sorted,
    count: members.length,
    scoredCount: scores.length,
    average: scores.length > 0 ? round2(scores.reduce((acc, v) => acc + v, 0) / scores.length) : null,
    min: scores.length > 0 ? round2(Math.min(...scores)) : null,
    max: scores.length > 0 ? round2(Math.max(...scores)) : null,
  };
}

/**
 * Deterministic reading order: dated records first, chronological ascending;
 * undated records go last ordered by sheet row (never interleaved by guess).
 */
export function sortDrillDownRecords(records: OsRecord[]): OsRecord[] {
  return [...records].sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.rowIndex - b.rowIndex;
  });
}

/**
 * Records of a single 'YYYY-MM' month bucket (as plotted by the trend chart),
 * in the same deterministic order. Unknown months return [].
 */
export function selectMonth(dataset: Dataset, month: string): OsRecord[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  return sortDrillDownRecords((dataset?.records ?? []).filter((rec) => rec.month === month));
}

// ---------- Export naming ----------

/** Lowercase ASCII slug for filenames ('Estúdio Águia' → 'estudio-aguia'). */
export function slugifyLabel(label: string): string {
  const slug = (label ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'grupo';
}

/**
 * Download filename for a drill-down export: the standard dashboard name
 * (with period range when active) plus the group/month slug, e.g.
 * 'solaris-dashboard_2024-02_2024-03_estudio-aguia.csv'.
 */
export function drilldownFilename(
  range: { from?: string | null; to?: string | null },
  label: string,
): string {
  return csvFilename(range).replace(/\.csv$/, `_${slugifyLabel(label)}.csv`);
}

// ---------- v3 P10 — Second-level drill-down (month → group) ----------

/** Active second-level target inside a month bucket. */
export interface MonthDrillDown {
  dimension: GroupDimension;
  label: string;
}

/**
 * Group stats restricted to one 'YYYY-MM' month bucket, in the same
 * deterministic order as the dashboard tables (average desc, count desc,
 * label asc). Malformed/unknown months yield [] — never an error — so a
 * stale selection degrades to an empty view instead of lying.
 */
export function groupAverageByMonth(
  dataset: Dataset,
  month: string,
  dimension: GroupDimension,
): GroupStat[] {
  return groupAverageBy({ records: selectMonth(dataset, month) }, dimension);
}

/**
 * Records of ONE group INSIDE one 'YYYY-MM' bucket (second-level leaf),
 * same sentinel and deterministic reading order as the first-level
 * selection. Unknown labels/months yield an empty selection.
 */
export function selectGroupInMonth(
  dataset: Dataset,
  month: string,
  dimension: GroupDimension,
  label: string,
): DrillDownSelection {
  const sel = selectGroup({ records: selectMonth(dataset, month) }, dimension, label);
  return { ...sel, dimension, label };
}

/**
 * Whole-month bucket (header cards + record list of the first-level month
 * view) in the shared DrillDownSelection shape. Malformed/unknown months
 * yield an empty selection — never an error.
 */
export function selectMonthSummary(
  dataset: Dataset,
  month: string,
): DrillDownSelection {
  const members = selectMonth(dataset, month);
  if (members.length === 0) return EMPTY_SELECTION('studio', month);
  const scores = members.map((r) => r.finalScore).filter((v): v is number => v !== null);
  return {
    dimension: 'studio',
    label: month,
    records: members,
    count: members.length,
    scoredCount: scores.length,
    average: scores.length > 0 ? round2(scores.reduce((acc, v) => acc + v, 0) / scores.length) : null,
    min: scores.length > 0 ? round2(Math.min(...scores)) : null,
    max: scores.length > 0 ? round2(Math.max(...scores)) : null,
  };
}

/** Download filename for the second-level leaf: month + group slugs. */
export function monthGroupFilename(
  range: { from?: string | null; to?: string | null },
  month: string,
  label: string,
): string {
  return csvFilename(range).replace(
    /\.csv$/,
    `_${slugifyLabel(month)}_${slugifyLabel(label)}.csv`,
  );
}

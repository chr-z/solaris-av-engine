// Solaris v3 P11 — Dashboard group A/B comparison core.
//
// Pure, framework-free helpers consumed by DashboardPanel: pinning two
// groups (A/B) of ONE dimension, computing per-side stats over the SAME
// filtered dataset as every other view, classifying the average delta and
// building a scoped, deterministic CSV export.
//
// Everything here is unit-testable without DOM, Blob or fetch; the React
// panel only renders what these functions return.

import type { Dataset, GroupDimension, OsRecord } from "./dashboard";
import {
  selectGroup,
  slugifyLabel,
  UNGROUPED_LABEL,
} from "./dashboardDrilldown";
import { csvFilename, escapeCsvField } from "./dashboardExport";

/** One pinned side of a comparison (exact table label, sentinel included). */
export interface CompareSide {
  dimension: GroupDimension;
  label: string;
}

/** Stats + member records of one comparison side. */
export interface CompareSideStats {
  side: CompareSide;
  /** Total member records (scored + unscored). */
  count: number;
  scoredCount: number;
  average: number | null;
  min: number | null;
  max: number | null;
  /** Members in the shared deterministic reading order (never mutated). */
  records: OsRecord[];
}

/** Result of comparing two groups of the same dimension. */
export interface ComparisonResult {
  dimension: GroupDimension;
  a: CompareSideStats;
  b: CompareSideStats;
  /**
   * Average difference B−A rounded like every other dashboard stat.
   * null unless BOTH sides have scored records — a missing average never
   * becomes a fake 0.
   */
  avgDelta: number | null;
}

const round2 = (v: number): number =>
  Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Stats of one pinned side. Delegates to selectGroup so the '(sem valor)'
 * bucket and reading order stay byte-compatible with the drill-down views.
 * Unknown labels yield an empty side — never an error.
 */
export function selectCompareSide(
  dataset: Dataset,
  side: CompareSide,
): CompareSideStats {
  const sel = selectGroup(dataset, side.dimension, side.label);
  return {
    side,
    count: sel.count,
    scoredCount: sel.scoredCount,
    average: sel.average,
    min: sel.min,
    max: sel.max,
    records: sel.records,
  };
}

/**
 * Builds the A/B comparison over one dataset. Returns null while either
 * side is unpinned or when the sides do not share a dimension — the panel
 * simply hides the comparison instead of rendering nonsense.
 */
export function buildComparison(
  dataset: Dataset,
  a: CompareSide | null,
  b: CompareSide | null,
): ComparisonResult | null {
  if (!a || !b) return null;
  if (a.dimension !== b.dimension) return null;

  const statsA = selectCompareSide(dataset, a);
  const statsB = selectCompareSide(dataset, b);
  return {
    dimension: a.dimension,
    a: statsA,
    b: statsB,
    avgDelta:
      statsA.average !== null && statsB.average !== null
        ? round2(statsB.average - statsA.average)
        : null,
  };
}

/** Verdict of an average delta from the perspective of side B vs side A. */
export type DeltaDirection = "better" | "worse" | "tie" | "unknown";

/**
 * Classifies the delta. `higherIsBetter` lets future metrics flip the
 * scale (defaults to scores, where higher wins). Unknown deltas never
 * pretend to be ties.
 */
export function deltaDirection(
  avgDelta: number | null,
  higherIsBetter = true,
): DeltaDirection {
  if (avgDelta === null) return "unknown";
  if (avgDelta === 0) return "tie";
  const bWins = avgDelta > 0;
  if (higherIsBetter) return bWins ? "better" : "worse";
  return bWins ? "worse" : "better";
}

/**
 * Signed display form of a delta: explicit '+' on positives, '-' kept on
 * negatives, decimal separator chosen by locale (comma for PT-BR).
 * null passes through as null — callers render their own placeholder.
 */
export function formatSignedDelta(
  value: number | null,
  decimalComma: boolean,
): string | null {
  if (value === null) return null;
  const text = Math.abs(value).toFixed(2);
  const body = decimalComma ? text.replace(".", ",") : text;
  // Zero carries no sign (and -0 must not render as "-0…").
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${body}`;
}

/** Download filename for the comparison export, range-aware. */
export function compareFilename(
  range: { from?: string | null; to?: string | null },
  dimension: GroupDimension,
): string {
  return csvFilename(range).replace(
    /\.csv$/,
    `_ab-${slugifyLabel(dimension)}.csv`,
  );
}

const METRIC_ROWS: Array<{
  metric: string;
  pick: (s: CompareSideStats) => string;
}> = [
  { metric: "total", pick: (s) => String(s.count) },
  { metric: "scored", pick: (s) => String(s.scoredCount) },
  {
    metric: "average",
    pick: (s) => (s.average === null ? "" : String(s.average)),
  },
  { metric: "min", pick: (s) => (s.min === null ? "" : String(s.min)) },
  { metric: "max", pick: (s) => (s.max === null ? "" : String(s.max)) },
];

/**
 * Builds the comparison CSV: a metric block (A vs B columns) followed by
 * the union of both sides' records prefixed with their side, so the sheet
 * stays filterable. Fixed English tokens like every other Solaris CSV;
 * fields are RFC 4180 quoted only when required.
 */
export function buildCompareCsv(result: ComparisonResult): string {
  const dimHeader = escapeCsvField(result.dimension);
  const lines: string[] = ["metric," + dimHeader + "," + dimHeader];
  for (const row of METRIC_ROWS) {
    lines.push(
      [
        row.metric,
        row.pick(result.a),
        row.pick(result.b),
      ]
        .map(escapeCsvField)
        .join(","),
    );
  }
  const pushRecords = (
    which: "A" | "B",
    stats: CompareSideStats,
  ): void => {
    for (const rec of stats.records) {
      lines.push(
        [
          which,
          rec.date ?? "",
          rec.month ?? "",
          rec.wo,
          rec.event,
          rec.studio,
          rec.instructor,
          rec.analyst,
          rec.finalScore === null ? "" : String(rec.finalScore),
        ]
          .map(escapeCsvField)
          .join(","),
      );
    }
  };
  pushRecords("A", result.a);
  pushRecords("B", result.b);
  return lines.join("\r\n");
}

/** Re-exported so the panel imports one module for the whole feature. */
export { UNGROUPED_LABEL };

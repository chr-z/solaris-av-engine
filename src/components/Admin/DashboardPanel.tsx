// Solaris v3 P5 — Scoring dashboards panel (#/admin/dashboards).
//
// Renders KPI cards, grouped tables and a monthly trend bar chart from the
// pure core in utils/dashboard.ts. All math lives in utils; this component
// only orchestrates loading, dimension switching and rendering.

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  buildDashboardDataset,
  overallSummary,
  groupAverageBy,
  trendByMonth,
  deltaPercent,
  type Dataset,
  type GroupDimension,
  type GroupStat,
  type TrendPoint,
  type OsRecord,
} from "../../utils/dashboard";
import {
  selectGroup,
  selectMonth,
  selectMonthSummary,
  groupAverageByMonth,
  selectGroupInMonth,
  drilldownFilename,
  monthGroupFilename,
  type MonthDrillDown,
} from "../../utils/dashboardDrilldown";
import {
  filterByPeriod,
  buildDashboardCsv,
  csvFilename,
  hasActiveBounds,
} from "../../utils/dashboardExport";
import {
  buildDashboardXlsx,
  xlsxFilename,
  xlsxDrilldownFilename,
  xlsxMonthGroupFilename,
} from "../../utils/dashboardXlsx";
import {
  loadDashboardEntries,
  barHeightRatio,
  formatScoreDisplay,
  type DashboardEntryInput,
} from "../../utils/dashboardData";
import {
  DASHBOARD_SECTIONS,
  nextDashboardSection,
  prevDashboardSection,
} from "../../utils/shortcuts";
import {
  buildQcBatchReport,
  withQcPeriod,
  qcBatchFilename,
  renderQcBatchHtml,
} from "../../utils/qcBatch";
// v3 P13: recurring-inconformity ranking (pitch item D).
import {
  inconformityRanking,
  rankingSummary,
  buildRankingCsv,
  rankingFilename,
  buildRankingXlsx,
  rankingXlsxFilename,
  availableCategories,
  filterByCategory,
} from "../../utils/dashboardInconformities";
// v3 P15: monthly heatmap of markings (rule × month matrix).
import {
  buildMarkHeatmap,
  heatmapPeak,
  heatmapTier,
  buildHeatmapCsv,
  heatmapFilename,
  buildHeatmapXlsx,
  heatmapXlsxFilename,
} from "../../utils/markHeatmap";
import { useAnalystShortcuts } from "../../hooks/useAnalystShortcuts";
import {
  buildComparison,
  deltaDirection,
  formatSignedDelta,
  compareFilename,
  buildCompareCsv,
  type CompareSide,
} from "../../utils/dashboardCompare";
import ShortcutHelpModal from "../Core/ShortcutHelpModal";
import { useI18n } from "../../i18n/I18nContext";
import type { TranslationKey } from "../../i18n/translations";

/**
 * Section ids come from the canonical cycle in utils/shortcuts.ts so the
 * keyboard navigation (N/P) can never drift from the rendered tab order.
 */
type Section = (typeof DASHBOARD_SECTIONS)[number];

/** Active drill-down target: one table group or one trend month bucket. */
interface DrillDown {
  kind: "group" | "month";
  dimension: GroupDimension;
  /** Group label, or the month key when kind === 'month'. */
  label: string;
  /**
   * v3 P10 second level: group target INSIDE the month bucket. An empty
   * `label` means the month hub is open without a leaf selected yet.
   */
  month?: MonthDrillDown;
}

interface SectionDef {
  id: Section;
  labelKey: TranslationKey;
  testId: string;
}

const SECTIONS: SectionDef[] = [
  {
    id: "summary",
    labelKey: "dash.section.summary",
    testId: "dash-section-summary",
  },
  {
    id: "studios",
    labelKey: "dash.section.studios",
    testId: "dash-section-studios",
  },
  {
    id: "instructors",
    labelKey: "dash.section.instructors",
    testId: "dash-section-instructors",
  },
  {
    id: "analysts",
    labelKey: "dash.section.analysts",
    testId: "dash-section-analysts",
  },
  {
    id: "inconformities",
    labelKey: "dash.section.inconformities",
    testId: "dash-section-inconformities",
  },
  { id: "trend", labelKey: "dash.section.trend", testId: "dash-section-trend" },
];

const DIMENSION_BY_SECTION: Partial<Record<Section, GroupDimension>> = {
  studios: "studio",
  instructors: "instructor",
  analysts: "analyst",
};

/** v3 P11: dimension picker options for the A/B comparison bar. */
const DIMENSIONS: GroupDimension[] = ["studio", "instructor", "analyst"];

/**
 * v3 P15: cell background per heatmap tier — 0 keeps the plain surface,
 * tiers 1..4 deepen the solar accent. Same count → same tint, always.
 */
const HEAT_TIER_CLASS = [
  "bg-gray-800/40 text-gray-500 border border-gray-600/40",
  "bg-solar-accent/15 text-orange-100",
  "bg-solar-accent/35 text-white",
  "bg-solar-accent/60 text-white",
  "bg-solar-accent text-gray-900 font-bold",
] as const;

/** Dimension id → i18n key (table headers reuse the section labels). */
const DIMENSION_LABEL_KEY: Record<
  GroupDimension,
  TranslationKey
> = {
  studio: "dash.section.studios",
  instructor: "dash.section.instructors",
  analyst: "dash.section.analysts",
};

/** v3 P11: human verdict for the delta card, localized via t(). */
const verdictText = (
  direction: ReturnType<typeof deltaDirection>,
  t: (key: TranslationKey) => string,
): string => {
  if (direction === "better") return t("dash.compare.better");
  if (direction === "worse") return t("dash.compare.worse");
  if (direction === "tie") return t("dash.compare.tie");
  return "";
};

/**
 * v3 P11: one side of the A/B comparison — dimension + group pickers.
 * Presentational; selection state lives in the panel so both sides stay
 * in sync while switching dimensions.
 */
const CompareSidePicker: React.FC<{
  side: "A" | "B";
  dimension: GroupDimension;
  label: string;
  labels: string[];
  onDimensionChange: (dimension: GroupDimension) => void;
  onLabelChange: (label: string) => void;
}> = ({
  side,
  dimension,
  label,
  labels,
  onDimensionChange,
  onLabelChange,
}) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5">
      <span
        data-testid={`dash-compare-side-${side.toLowerCase()}`}
        className="text-xs font-bold uppercase text-solar-accent"
      >
        {t("dash.compare.side", { side })}
      </span>
      <select
        aria-label={`${t("dash.compare.side", { side })}: ${t(
          DIMENSION_LABEL_KEY[dimension],
        )}`}
        value={dimension}
        onChange={(e) => onDimensionChange(e.target.value as GroupDimension)}
        className="rounded-md border border-gray-600/60 bg-gray-900/70 px-1.5 py-1 text-xs text-gray-100 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
      >
        {DIMENSIONS.map((d) => (
          <option key={d} value={d}>
            {t(DIMENSION_LABEL_KEY[d])}
          </option>
        ))}
      </select>
      <select
        aria-label={t("dash.compare.side", { side })}
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        className="max-w-[12rem] rounded-md border border-gray-600/60 bg-gray-900/70 px-1.5 py-1 text-xs text-gray-100 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
      >
        <option value="">{t("dash.compare.placeholder")}</option>
        {labels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
};

/** KPI card — presentational only. */
const Card: React.FC<{
  label: string;
  value: string;
  sub?: string;
  testId?: string;
}> = ({ label, value, sub, testId }) => (
  <div
    data-testid={testId ?? "dash-card"}
    className="rounded-lg border border-gray-600/60 bg-gray-800/50 px-4 py-3 min-w-[9rem]"
  >
    <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
    <p className="text-2xl font-semibold text-gray-100 mt-1">{value}</p>
    {sub !== undefined && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
  </div>
);

const TrendChart: React.FC<{
  points: TrendPoint[];
  onSelect: (month: string) => void;
}> = ({ points, onSelect }) => {
  const { t } = useI18n();
  const maxValue = points.reduce(
    (acc, p) => (p.average !== null ? Math.max(acc, p.average) : acc),
    0,
  );
  if (points.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-6" data-testid="dash-trend-empty">
        {t("dash.empty")}
      </p>
    );
  }
  // Interactive bars: no role="img" here (it would hide the buttons from
  // assistive tech); each bar carries its own label and the monthly table
  // below remains the fully accessible representation of the same data.
  return (
    <div data-testid="dash-trend-chart">
      <div className="flex items-end gap-4 h-40 pl-1">
        {points.map((p) => (
          <button
            key={p.month}
            type="button"
            data-testid={`dash-drill-month-${p.month}`}
            onClick={() => onSelect(p.month)}
            title={t("dash.drill.title", { group: p.month })}
            className="flex flex-col items-center justify-end h-full cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
          >
            <span className="text-[10px] text-gray-300 mb-1">
              {formatScoreDisplay(p.average)}
            </span>
            <span
              className="block w-8 rounded-t bg-gradient-to-t from-orange-700 to-orange-400 transition-opacity hover:opacity-75"
              style={{
                height: `${Math.round(barHeightRatio(p.average ?? 0, maxValue) * 100)}%`,
              }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-4 pl-1 mt-1">
        {points.map((p) => (
          <span
            key={p.month}
            className="w-8 text-center text-[10px] text-gray-500"
          >
            {p.month.slice(5)}/{p.month.slice(2, 4)}
          </span>
        ))}
      </div>
    </div>
  );
};

const GroupTable: React.FC<{
  stats: GroupStat[];
  emptyText: string;
  onSelect: (label: string) => void;
  /** v3 P11: renders an inline "A/B" pin per row when provided. */
  onPinCompare?: (label: string) => void;
}> = ({ stats, emptyText, onSelect, onPinCompare }) => {
  const { t } = useI18n();
  if (stats.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-6" data-testid="dash-group-empty">
        {emptyText}
      </p>
    );
  }
  return (
    <table
      data-testid="dash-group-table"
      className="w-full text-sm border-collapse"
    >
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-600/60">
          <th scope="col" className="py-2 pr-4">
            {t("dash.table.group")}
          </th>
          <th scope="col" className="py-2 pr-4 text-right">
            {t("dash.table.count")}
          </th>
          <th scope="col" className="py-2 pr-4 text-right">
            {t("dash.table.avg")}
          </th>
          <th scope="col" className="py-2 pr-4 text-right">
            {t("dash.table.min")}
          </th>
          <th scope="col" className="py-2 text-right">
            {t("dash.table.max")}
          </th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr
            key={s.label}
            className="border-b border-gray-700/40 last:border-b-0"
          >
            <td className="py-2 pr-4 font-medium text-gray-200">
              <button
                type="button"
                data-testid={`dash-drill-${s.label}`}
                onClick={() => onSelect(s.label)}
                title={t("dash.drill.title", { group: s.label })}
                className="text-left underline decoration-dotted underline-offset-4 decoration-gray-500 hover:text-solar-accent hover:decoration-solar-accent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent rounded-sm cursor-pointer"
              >
                {s.label}
              </button>
              {onPinCompare && (
                <button
                  type="button"
                  data-testid={`dash-pin-${s.label}`}
                  onClick={() => onPinCompare(s.label)}
                  title={t("dash.compare.title")}
                  aria-label={t("dash.compare.title")}
                  className="ml-2 px-1.5 py-0.5 rounded border border-gray-600/60 font-mono text-[10px] uppercase text-gray-400 hover:text-solar-accent hover:border-solar-accent transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
                >
                  A/B
                </button>
              )}
            </td>
            <td className="py-2 pr-4 text-right tabular-nums text-gray-300">
              {s.count}
            </td>
            <td className="py-2 pr-4 text-right tabular-nums text-orange-300 font-semibold">
              {formatScoreDisplay(s.average)}
            </td>
            <td className="py-2 pr-4 text-right tabular-nums text-gray-400">
              {formatScoreDisplay(s.min)}
            </td>
            <td className="py-2 text-right tabular-nums text-gray-400">
              {formatScoreDisplay(s.max)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/**
 * v3 P10 second-level hub: the month bucket broken down by one dimension.
 * Group rows drill into a leaf view; back returns to the trend section.
 * Pure data comes from utils/dashboardDrilldown.ts; this only renders.
 */
const MonthHubView: React.FC<{
  month: string;
  stats: GroupStat[];
  summary: {
    count: number;
    scoredCount: number;
    average: number | null;
    min: number | null;
    max: number | null;
  };
  onBack: () => void;
  onSelectGroup: (label: string) => void;
  onExport: () => void;
  /** v3 P11: inline A/B pin per row when the comparison bar is open. */
  onPinCompare?: (label: string) => void;
}> = ({ month, stats, summary, onBack, onSelectGroup, onExport, onPinCompare }) => {
  const { t } = useI18n();
  return (
    <div data-testid="dash-month-hub">
      <button
        type="button"
        data-testid="dash-month-hub-back"
        onClick={onBack}
        className="mb-3 px-3 py-1.5 rounded-md text-sm border border-gray-600/60 text-gray-300 hover:bg-gray-500/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
      >
        ← {t("dash.drill.back")}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400">
            {t("dash.section.trend")}
          </p>
          <h2
            className="text-lg font-bold text-gray-100"
            data-testid="dash-month-hub-title"
          >
            {t("dash.drill.monthScope", { month })}
          </h2>
          <p
            className="text-xs text-gray-500 mt-0.5"
            data-testid="dash-month-hub-count"
          >
            {t("dash.drill.count", {
              scored: summary.scoredCount,
              count: summary.count,
            })}
          </p>
        </div>
        <button
          type="button"
          data-testid="dash-month-hub-export"
          onClick={onExport}
          title={t("dash.export.title")}
          className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
        >
          {t("dash.export")}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4" data-testid="dash-month-hub-cards">
        <Card label={t("dash.kpi.total")} value={String(summary.count)} />
        <Card
          label={t("dash.table.avg")}
          value={formatScoreDisplay(summary.average)}
        />
        <Card
          label={t("dash.table.min")}
          value={formatScoreDisplay(summary.min)}
        />
        <Card
          label={t("dash.table.max")}
          value={formatScoreDisplay(summary.max)}
        />
      </div>

      {stats.length === 0 ? (
        <p
          className="text-sm text-gray-400 py-6"
          data-testid="dash-month-hub-empty"
        >
          {t("dash.empty")}
        </p>
      ) : (
        <table
          data-testid="dash-month-hub-table"
          className="w-full text-sm border-collapse"
        >
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-600/60">
              <th scope="col" className="py-2 pr-4">
                {t("dash.table.group")}
              </th>
              <th scope="col" className="py-2 pr-4 text-right">
                {t("dash.table.count")}
              </th>
              <th scope="col" className="py-2 pr-4 text-right">
                {t("dash.table.avg")}
              </th>
              <th scope="col" className="py-2 pr-4 text-right">
                {t("dash.table.min")}
              </th>
              <th scope="col" className="py-2 text-right">
                {t("dash.table.max")}
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr
                key={s.label}
                className="border-b border-gray-700/40 last:border-b-0"
              >
                <td className="py-2 pr-4 font-medium text-gray-200">
                  <button
                    type="button"
                    data-testid={`dash-drill-month-${month}-group-${s.label}`}
                    onClick={() => onSelectGroup(s.label)}
                    title={t("dash.drill.title", { group: s.label })}
                    className="text-left underline decoration-dotted underline-offset-4 decoration-gray-500 hover:text-solar-accent hover:decoration-solar-accent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent rounded-sm cursor-pointer"
                  >
                    {s.label}
                  </button>
                  {onPinCompare && (
                    <button
                      type="button"
                      data-testid={`dash-pin-${month}-${s.label}`}
                      onClick={() => onPinCompare(s.label)}
                      title={t("dash.compare.title")}
                      aria-label={t("dash.compare.title")}
                      className="ml-2 px-1.5 py-0.5 rounded border border-gray-600/60 font-mono text-[10px] uppercase text-gray-400 hover:text-solar-accent hover:border-solar-accent transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
                    >
                      A/B
                    </button>
                  )}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-gray-300">
                  {s.count}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-orange-300 font-semibold">
                  {formatScoreDisplay(s.average)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-gray-400">
                  {formatScoreDisplay(s.min)}
                </td>
                <td className="py-2 text-right tabular-nums text-gray-400">
                  {formatScoreDisplay(s.max)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

/**
 * Drill-down detail: every O.S. of one group/month bucket, with its own
 * summary header and a scoped CSV export. Pure data comes from
 * utils/dashboardDrilldown.ts; this component only renders.
 */
const DrillDownView: React.FC<{
  dimension: GroupDimension;
  label: string;
  /** v3 P10: month context line above the dimension label (month leaf). */
  monthScope?: string | null;
  /** v3 P10: swaps the back button target ('Back to month' vs overview). */
  backLabel?: string;
  selection: {
    count: number;
    scoredCount: number;
    average: number | null;
    min: number | null;
    max: number | null;
  };
  records: OsRecord[];
  onBack: () => void;
  onExport: () => void;
  /** v3 P12: Excel (.xlsx) export scoped to this bucket. */
  onExportXlsx: () => void;
  /** v3 P9: printable QC report scoped to this bucket. */
  onExportQc: () => void;
}> = ({ dimension, label, monthScope, backLabel, selection, records, onBack, onExport, onExportXlsx, onExportQc }) => {
  const { t } = useI18n();
  const dimensionLabel =
    dimension === "studio"
      ? t("dash.section.studios")
      : dimension === "instructor"
        ? t("dash.section.instructors")
        : t("dash.section.analysts");
  return (
    <div data-testid="dash-drilldown">
      <button
        type="button"
        data-testid="dash-drill-back"
        onClick={onBack}
        className="mb-3 px-3 py-1.5 rounded-md text-sm border border-gray-600/60 text-gray-300 hover:bg-gray-500/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
      >
        ← {backLabel ?? t("dash.drill.back")}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          {monthScope && (
            <p
              className="text-xs uppercase tracking-wide text-solar-accent mb-0.5"
              data-testid="dash-drill-month-scope"
            >
              {monthScope}
            </p>
          )}
          <p className="text-xs uppercase tracking-wide text-gray-400">
            {dimensionLabel}
          </p>
          <h2
            className="text-lg font-bold text-gray-100"
            data-testid="dash-drill-title"
          >
            {t("dash.drill.title", { group: label })}
          </h2>
          <p
            className="text-xs text-gray-500 mt-0.5"
            data-testid="dash-drill-count"
          >
            {t("dash.drill.count", {
              scored: selection.scoredCount,
              count: selection.count,
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="dash-drill-qc-report"
            onClick={onExportQc}
            title={t("dash.qcReport.title")}
            className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
          >
            {t("dash.qcReport")}
          </button>
          <button
            type="button"
            data-testid="dash-drill-export"
            onClick={onExport}
            title={t("dash.export.title")}
            className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
          >
            {t("dash.export")}
          </button>
          <button
            type="button"
            data-testid="dash-drill-export-xlsx"
            onClick={onExportXlsx}
            title={t("dash.exportXlsx.title")}
            className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
          >
            {t("dash.exportXlsx")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4" data-testid="dash-drill-cards">
        <Card label={t("dash.kpi.total")} value={String(selection.count)} />
        <Card
          label={t("dash.table.avg")}
          value={formatScoreDisplay(selection.average)}
        />
        <Card
          label={t("dash.table.min")}
          value={formatScoreDisplay(selection.min)}
        />
        <Card
          label={t("dash.table.max")}
          value={formatScoreDisplay(selection.max)}
        />
      </div>

      {records.length === 0 ? (
        <p
          className="text-sm text-gray-400 py-6"
          data-testid="dash-drill-empty"
        >
          {t("dash.empty")}
        </p>
      ) : (
        <table
          data-testid="dash-drill-table"
          className="w-full text-sm border-collapse"
        >
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-600/60">
              <th scope="col" className="py-2 pr-4">
                {t("drill.table.date")}
              </th>
              <th scope="col" className="py-2 pr-4">
                {t("drill.table.wo")}
              </th>
              <th scope="col" className="py-2 pr-4">
                {t("drill.table.event")}
              </th>
              <th scope="col" className="py-2 text-right">
                {t("drill.table.score")}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => (
              <tr
                key={`${rec.rowIndex}-${rec.wo}`}
                className="border-b border-gray-700/40 last:border-b-0"
              >
                <td className="py-2 pr-4 tabular-nums text-gray-300">
                  {rec.date ?? "—"}
                </td>
                <td className="py-2 pr-4 font-medium text-gray-200">
                  {rec.wo || "—"}
                </td>
                <td className="py-2 pr-4 text-gray-300">{rec.event || "—"}</td>
                <td className="py-2 text-right tabular-nums font-semibold text-orange-300">
                  {formatScoreDisplay(rec.finalScore)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

/**
 * The dashboards console body. Rendered inside the admin gate for
 * #/admin/dashboards (RBAC already enforced upstream).
 */
const DashboardPanel: React.FC = () => {
  const { t, locale } = useI18n();
  const [section, setSection] = useState<Section>("summary");
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);
  const [entries, setEntries] = useState<DashboardEntryInput[] | null>(null);
  const [source, setSource] = useState<"live" | "demo" | null>(null);
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  // v3 P9: one-shot confirmation after a QC report download.
  const [qcToastVisible, setQcToastVisible] = useState(false);
  // v3 P11: A/B group comparison — null label means the side is unpinned.
  const [compareOpen, setCompareOpen] = useState(false);
  // v3 P17: active scoring-rule category over the Recurring Issues view
  // ('' = whole checklist). Applied AFTER the period, BEFORE aggregations.
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sideA, setSideA] = useState<CompareSide>({
    dimension: "studio",
    label: "",
  });
  const [sideB, setSideB] = useState<CompareSide>({
    dimension: "studio",
    label: "",
  });

  useEffect(() => {
    let cancelled = false;
    loadDashboardEntries()
      .then((result) => {
        if (!cancelled) {
          setEntries(result.entries);
          setSource(result.source);
        }
      })
      .catch(() => {
        /* loader never rejects (demo fallback), but stay safe */
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dataset = useMemo(
    () => buildDashboardDataset(entries ?? []),
    [entries],
  );

  // P6: period filter — garbage input is ignored by the core (normalizeBound),
  // so the whole dashboard degrades to "no bounds" instead of lying.
  const filtered: Dataset = useMemo(
    () => ({
      records: filterByPeriod(dataset.records, {
        from: fromInput,
        to: toInput,
      }),
    }),
    [dataset, fromInput, toInput],
  );
  const periodActive = hasActiveBounds({ from: fromInput, to: toInput });

  // v3 P17: category scope of the Recurring Issues view — records carrying at
  // least one marking of the active family. Derived like the period filter;
  // every aggregation below reads THIS dataset, so the ranking table, KPI
  // cards, heatmap and all exports always tell the same story.
  const categories = useMemo(() => availableCategories(dataset), [dataset]);
  const categoryFiltered: Dataset = useMemo(
    () =>
      section === "inconformities" && categoryFilter
        ? { records: filterByCategory(filtered.records, categoryFilter) }
        : filtered,
    [filtered, categoryFilter, section],
  );
  const categoryActive = section === "inconformities" && categoryFilter !== "";

  const summary = useMemo(() => overallSummary(categoryFiltered), [categoryFiltered]);
  const trend = useMemo(() => trendByMonth(filtered), [filtered]);
  const lastDelta = useMemo(() => {
    if (trend.length < 2) return null;
    return deltaPercent(trend[trend.length - 2], trend[trend.length - 1]);
  }, [trend]);

  const dimension = DIMENSION_BY_SECTION[section];
  const groupStats = useMemo(
    () => (dimension ? groupAverageBy(filtered, dimension) : []),
    [filtered, dimension],
  );

  // v3 P11: available labels per dimension (same order as the tables),
  // feeding the A/B pickers.
  const labelsByDimension = useMemo(
    () => ({
      studio: groupAverageBy(filtered, "studio").map((s) => s.label),
      instructor: groupAverageBy(filtered, "instructor").map((s) => s.label),
      analyst: groupAverageBy(filtered, "analyst").map((s) => s.label),
    }),
    [filtered],
  );

  // v3 P13: recurring-inconformity ranking over the SAME filtered dataset —
  // period edits update it live like every other section.
  const ranking = useMemo(
    () =>
      section === "inconformities"
        ? inconformityRanking(categoryFiltered)
        : [],
    [categoryFiltered, section],
  );
  const rankSummary = useMemo(
    () =>
      section === "inconformities"
        ? rankingSummary(categoryFiltered)
        : { markedRows: 0, distinctRules: 0, totalOccurrences: 0 },
    [categoryFiltered, section],
  );

  // v3 P15: rule × month marking matrix over the SAME filtered dataset.
  // Derived like every other section view; empty until the tab is open so
  // the other sections never pay for it.
  const markHeatmap = useMemo(
    () =>
      section === "inconformities"
        ? buildMarkHeatmap(categoryFiltered)
        : { months: [], rows: [] },
    [categoryFiltered, section],
  );
  const heatPeak = useMemo(() => heatmapPeak(markHeatmap), [markHeatmap]);

  const downloadCsv = (records: OsRecord[], filename: string) => {
    const csvText = buildDashboardCsv(records);
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportCsv = () =>
    downloadCsv(
      filtered.records,
      csvFilename({ from: fromInput, to: toInput }),
    );

  // v3 P12: same records/order as the CSV export, packaged as a real Excel
  // spreadsheet (numeric scores) — zero-dependency OOXML writer in utils.
  const saveXlsxBytes = (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  const downloadXlsx = (records: OsRecord[], filename: string) =>
    saveXlsxBytes(buildDashboardXlsx(records), filename);
  const exportXlsx = () =>
    downloadXlsx(filtered.records, xlsxFilename({ from: fromInput, to: toInput }));

  // v3 P8: latest export handler for the E shortcut — assigned after render
  // so the shortcut always exports against current filter state.
  const exportCsvRef = useRef<() => void>(() => {});
  useEffect(() => {
    exportCsvRef.current = exportCsv;
  });

  // v3 P12: latest XLSX handler for the X shortcut (same pattern).
  const exportXlsxRef = useRef<() => void>(() => {});
  useEffect(() => {
    exportXlsxRef.current = exportXlsx;
  });

  // P7/P10 drill-down: selecting a table group or a trend month shows every
  // O.S. of that bucket (still honoring the period filter above). The
  // selection is derived — never stored — so period edits update it live.
  // v3 P10: inside a month, an empty month.label means the second-level HUB
  // (whole month); a filled one is the group LEAF.
  const range = useMemo(
    () => ({ from: fromInput, to: toInput }),
    [fromInput, toInput],
  );
  const drillSelection = useMemo(() => {
    if (!drillDown) return null;
    if (drillDown.kind === "month") {
      return selectMonthSummary(filtered, drillDown.label);
    }
    return selectGroup(filtered, drillDown.dimension, drillDown.label);
  }, [drillDown, filtered]);
  const drillRecords = useMemo(() => {
    if (!drillDown) return [];
    return drillDown.kind === "month"
      ? selectMonth(filtered, drillDown.label)
      : (drillSelection?.records ?? []);
  }, [drillDown, filtered, drillSelection]);

  // v3 P10: second-level state derived from the same single drillDown source.
  const inMonthHub = drillDown?.kind === "month" && !drillDown.month;
  const monthLeaf = drillDown?.kind === "month" ? (drillDown.month ?? null) : null;
  const monthGroupStats = useMemo(() => {
    if (drillDown?.kind !== "month") return [];
    return groupAverageByMonth(filtered, drillDown.label, drillDown.dimension);
  }, [drillDown, filtered]);
  const monthLeafSelection = useMemo(() => {
    if (drillDown?.kind !== "month" || !drillDown.month) return null;
    return selectGroupInMonth(
      filtered,
      drillDown.label,
      drillDown.month.dimension,
      drillDown.month.label,
    );
  }, [drillDown, filtered]);

  const exportDrillCsv = () => {
    if (!drillDown) return;
    if (drillDown.kind === "group") {
      downloadCsv(drillRecords, drilldownFilename(range, drillDown.label));
    } else if (!drillDown.month) {
      downloadCsv(drillRecords, drilldownFilename(range, drillDown.label));
    } else {
      downloadCsv(
        drillRecords,
        monthGroupFilename(range, drillDown.label, drillDown.month.label),
      );
    }
  };

  // v3 P12: Excel twin of every drill-down CSV export.
  const exportDrillXlsx = () => {
    if (!drillDown) return;
    if (drillDown.kind === "group") {
      downloadXlsx(drillRecords, xlsxDrilldownFilename(range, drillDown.label));
    } else if (!drillDown.month) {
      downloadXlsx(drillRecords, xlsxDrilldownFilename(range, drillDown.label));
    } else {
      downloadXlsx(
        drillRecords,
        xlsxMonthGroupFilename(range, drillDown.label, drillDown.month.label),
      );
    }
  };

  // v3 P9: printable QC report of the CURRENT view — the whole filtered
  // dataset on the overview, or exactly the open drill-down bucket. Same
  // records as on screen, period bounds carried into header and filename.
  const exportQcReport = useCallback(() => {
    const report = withQcPeriod(
      buildQcBatchReport(categoryFiltered, {
        kind: drillDown?.kind ?? "overview",
        dimension: drillDown?.dimension ?? "studio",
        label: drillDown?.label ?? "",
        // v3 P17: the active category is part of the deliverable's context.
        category: categoryActive ? categoryFilter : undefined,
      }),
      range,
    );
    const html = renderQcBatchHtml(
      report,
      locale === "pt" ? "pt" : "en",
    );
    const blob = new Blob(["\ufeff", html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = qcBatchFilename(report);
    a.click();
    URL.revokeObjectURL(url);
    setQcToastVisible(true);
  }, [categoryFiltered, categoryActive, categoryFilter, drillDown, range, locale]);

  // v3 P11: A/B comparison derived from the SAME filtered dataset as every
  // other view — period edits update it live; null while either side is
  // unpinned or the sides diverge in dimension (bar shows the hint instead).
  const pinned =
    sideA.label !== "" &&
    sideB.label !== "" &&
    sideA.dimension === sideB.dimension;
  const comparison = useMemo(
    () =>
      pinned
        ? buildComparison(filtered, sideA, sideB)
        : null,
    [pinned, filtered, sideA, sideB],
  );

  // v3 P8: keyboard shortcuts. Latest handlers live in refs so the global
  // keydown listener (bound once) always dispatches against current state.
  const clearPeriod = useCallback(() => {
    setFromInput("");
    setToInput("");
  }, []);
  const exitDrillDown = useCallback(() => setDrillDown(null), []);
  const selectSection = useCallback((next: Section) => {
    setSection(next);
    setDrillDown(null);
  }, []);
  // v3 P17: category scope follows the section — leaving Recurring Issues
  // (click or N/P) resets it, so other views never inherit a hidden scope.
  const selectSectionWithCategoryReset = useCallback((next: Section) => {
    selectSection(next);
    setCategoryFilter("");
  }, [selectSection]);
  const clearCategoryFilter = useCallback(() => setCategoryFilter(""), []);

  // v3 P11: comparison export + toggle (B shortcut). Handlers are plain
  // functions re-registered every render via the existing refs pattern.
  const exportCompareCsv = () => {
    if (!comparison) return;
    const csvText = buildCompareCsv(comparison);
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = compareFilename(range, comparison.dimension);
    a.click();
    URL.revokeObjectURL(url);
  };
  const toggleCompareBar = useCallback(
    () => setCompareOpen((open) => !open),
    [],
  );

  // v3 P13: ranking CSV export (I shortcut). Latest handler via the same
  // refs pattern so the keydown listener always exports current state.
  const exportRanking = () => {
    if (section !== "inconformities") return;
    const csvText = buildRankingCsv(ranking);
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = rankingFilename(range);
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportRankingRef = useRef<() => void>(() => {});
  useEffect(() => {
    exportRankingRef.current = exportRanking;
  });

  // v3 P14: Excel twin of the ranking export — same ranked rows as the CSV
  // (rule/category/occurrences/rate/impact as numeric cells), 'Ranking' tab.
  const exportRankingXlsx = () => {
    if (section !== "inconformities") return;
    saveXlsxBytes(buildRankingXlsx(ranking), rankingXlsxFilename(range));
  };
  const exportRankingXlsxRef = useRef<() => void>(() => {});
  useEffect(() => {
    exportRankingXlsxRef.current = exportRankingXlsx;
  });

  // v3 P15: heatmap CSV export — same records/period as the visible matrix.
  const exportHeatmapCsv = () => {
    if (section !== "inconformities") return;
    const csvText = buildHeatmapCsv(markHeatmap);
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = heatmapFilename(range);
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportHeatmapRef = useRef<() => void>(() => {});
  useEffect(() => {
    exportHeatmapRef.current = exportHeatmapCsv;
  });

  // v3 P16: Excel twin of the heatmap CSV export — same rule × month matrix
  // as the visible table ('Heatmap' tab, counts as numeric cells).
  const exportHeatmapXlsx = () => {
    if (section !== "inconformities") return;
    saveXlsxBytes(buildHeatmapXlsx(markHeatmap), heatmapXlsxFilename(range));
  };
  const exportHeatmapXlsxRef = useRef<() => void>(() => {});
  useEffect(() => {
    exportHeatmapXlsxRef.current = exportHeatmapXlsx;
  });

  // v3 P14: the X shortcut follows the visible section — scores workbook on
  // every dashboard view, ranking workbook inside Recurring Issues.
  const dispatchXlsxExport = useCallback(() => {
    if (section === "inconformities") exportRankingXlsxRef.current();
    else exportXlsxRef.current();
  }, [section]);

  // v3 P11: pinning from a table row opens the bar and fills the first
  // free slot of the SAME dimension; a dimension switch restarts the pair,
  // and a click with both slots filled replaces B (last click wins).
  const pinCompareGroup = (dim: GroupDimension, label: string) => {
    setCompareOpen(true);
    if (sideA.label === "") {
      setSideA({ dimension: dim, label });
      return;
    }
    if (sideB.label === "") {
      if (sideB.dimension === dim) {
        setSideB({ dimension: dim, label });
      } else {
        setSideA({ dimension: dim, label });
        setSideB({ dimension: dim, label: "" });
      }
      return;
    }
    setSideB({ dimension: dim, label });
  };

  useAnalystShortcuts({
    enabled: true,
    scopeEnabled: { player: false, workspace: false, dashboard: true },
    nextDashSection: useCallback(() => {
      // v3 P17: leaving Recurring Issues resets the category scope.
      if (section === "inconformities") setCategoryFilter("");
      setSection(nextDashboardSection(section));
    }, [section]),
    prevDashSection: useCallback(() => {
      if (section === "inconformities") setCategoryFilter("");
      setSection(prevDashboardSection(section));
    }, [section]),
    exportDashCsv: useCallback(() => exportCsvRef.current(), []),
    clearDashPeriod: clearPeriod,
    exitDashDrillDown: exitDrillDown,
    exportDashQcReport: exportQcReport,
    dashToggleCompare: toggleCompareBar,
    exportDashXlsx: dispatchXlsxExport,
    exportDashInconformities: useCallback(() => exportRankingRef.current(), []),
    exportDashHeatmap: useCallback(() => exportHeatmapRef.current(), []),
  });

  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);

  // S5.1 parity: "?" toggles the shortcut reference (Shift+/ produces '?').
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isFormField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (
        event.key === "?" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isFormField
      ) {
        event.preventDefault();
        setIsShortcutHelpOpen(open => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const deltaDisplay =
    lastDelta === null
      ? "—"
      : `${lastDelta > 0 ? "+" : ""}${lastDelta.toFixed(1).replace(".", ",")}%`;

  if (entries === null) {
    return (
      <p
        className="text-sm text-gray-400 p-6"
        data-testid="dash-loading"
        role="status"
        aria-live="polite"
      >
        {t("admin.checkingRole")}
      </p>
    );
  }

  return (
    <section
      aria-labelledby="dash-title"
      data-testid="dashboard-panel"
      className="max-w-5xl mx-auto p-4 pb-10"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 id="dash-title" className="text-xl font-bold text-gray-100">
          {t("dash.title")}
        </h1>
        {source === "demo" && (
          <span
            data-testid="dash-source-demo"
            title={t("dash.demoSourceTitle")}
            className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30"
          >
            {t("dash.demoSource")}
          </span>
        )}
        {source === "live" && (
          <span
            data-testid="dash-source-live"
            className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
          >
            {t("dash.liveSource")}
          </span>
        )}
        {compareOpen && (
          <button
            type="button"
            data-testid="dash-compare-export"
            onClick={exportCompareCsv}
            disabled={!comparison}
            title={t("dash.export.title")}
            className={`ml-auto px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent enabled:hover:bg-solar-accent/10 transition-colors enabled:cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent`}
          >
            {t("dash.export")}
          </button>
        )}
        <button
          type="button"
          data-testid="dash-compare-toggle"
          aria-pressed={compareOpen}
          onClick={() => setCompareOpen((open) => !open)}
          title={t("dash.compare.title")}
          className={`${compareOpen ? "" : "ml-auto "}px-3 py-1.5 rounded-md text-sm font-medium border transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent ${
            compareOpen
              ? "bg-solar-accent/20 border-solar-accent text-solar-accent"
              : "border-gray-600/60 text-gray-300 hover:bg-gray-500/10"
          }`}
        >
          {t("dash.compare")}
        </button>
        <button
          type="button"
          data-testid="dash-shortcut-help"
          onClick={() => setIsShortcutHelpOpen(true)}
          title={t("header.shortcutHelp")}
          aria-label={t("header.shortcutHelp")}
          className="ml-auto px-2 py-1 rounded-md text-xs font-mono border border-gray-600/60 text-gray-300 hover:bg-gray-500/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
        >
          ?
        </button>
      </div>

      <div
        data-testid="dash-period-bar"
        className="flex flex-wrap items-center gap-2 mb-5 rounded-lg border border-gray-600/60 bg-gray-800/50 px-3 py-2"
      >
        <span className="text-xs uppercase tracking-wide text-gray-400">
          {t("dash.period.title")}
        </span>
        <label className="flex items-center gap-1 text-xs text-gray-300">
          {t("dash.period.from")}
          <input
            type="text"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            placeholder={t("dash.period.placeholder")}
            aria-label={`${t("dash.period.title")}: ${t("dash.period.from")}`}
            data-testid="dash-period-from"
            className="w-32 rounded-md border border-gray-600/60 bg-gray-900/70 px-2 py-1 text-sm text-gray-100"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-300">
          {t("dash.period.to")}
          <input
            type="text"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            placeholder={t("dash.period.placeholder")}
            aria-label={`${t("dash.period.title")}: ${t("dash.period.to")}`}
            data-testid="dash-period-to"
            className="w-32 rounded-md border border-gray-600/60 bg-gray-900/70 px-2 py-1 text-sm text-gray-100"
          />
        </label>
        {periodActive && (
          <button
            type="button"
            data-testid="dash-period-clear"
            onClick={() => {
              setFromInput("");
              setToInput("");
            }}
            className="px-2 py-1 rounded-md text-xs border border-gray-600/60 text-gray-300 hover:bg-gray-500/10 transition-colors"
          >
            {t("dash.period.clear")}
          </button>
        )}
        <button
          type="button"
          data-testid="dash-export-qc-report"
          onClick={exportQcReport}
          title={t("dash.qcReport.title")}
          className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors"
        >
          {t("dash.qcReport")}
        </button>
        <button
          type="button"
          data-testid="dash-export-csv"
          onClick={exportCsv}
          title={t("dash.export.title")}
          className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors"
        >
          {t("dash.export")}
        </button>
        <button
          type="button"
          data-testid="dash-export-xlsx"
          onClick={exportXlsx}
          title={t("dash.exportXlsx.title")}
          className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors"
        >
          {t("dash.exportXlsx")}
        </button>
      </div>

      <nav aria-label={t("dash.title")} className="flex flex-wrap gap-2 mb-5">
        {SECTIONS.map((s) => {
          const selected = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              data-testid={s.testId}
              aria-pressed={selected}
              onClick={() => {
                selectSectionWithCategoryReset(s.id);
              }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border ${
                selected
                  ? "bg-solar-accent/20 border-solar-accent text-solar-accent"
                  : "border-gray-600/60 text-gray-300 hover:bg-gray-500/10"
              }`}
            >
              {t(s.labelKey)}
            </button>
          );
        })}
      </nav>

      {compareOpen && (
        <div
          data-testid="dash-compare-bar"
          className="mb-5 rounded-lg border border-gray-600/60 bg-gray-800/50 px-3 py-3"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs uppercase tracking-wide text-gray-400">
              {t("dash.compare")}
            </span>
            <CompareSidePicker
              side="A"
              dimension={sideA.dimension}
              label={sideA.label}
              labels={labelsByDimension[sideA.dimension]}
              onDimensionChange={(d) => setSideA({ dimension: d, label: "" })}
              onLabelChange={(label) =>
                setSideA((cur) => ({ ...cur, label }))
              }
            />
            <CompareSidePicker
              side="B"
              dimension={sideB.dimension}
              label={sideB.label}
              labels={labelsByDimension[sideB.dimension]}
              onDimensionChange={(d) => setSideB({ dimension: d, label: "" })}
              onLabelChange={(label) =>
                setSideB((cur) => ({ ...cur, label }))
              }
            />
            <button
              type="button"
              data-testid="dash-compare-clear"
              onClick={() => {
                setSideA({ dimension: sideA.dimension, label: "" });
                setSideB({ dimension: sideB.dimension, label: "" });
              }}
              className="px-2 py-1 rounded-md text-xs border border-gray-600/60 text-gray-300 hover:bg-gray-500/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
            >
              {t("dash.compare.clear")}
            </button>
          </div>

          {!pinned ? (
            <p
              className="mt-2 text-xs text-gray-500"
              data-testid="dash-compare-empty"
            >
              {sideA.dimension !== sideB.dimension &&
              sideA.label !== "" &&
              sideB.label !== ""
                ? t("dash.compare.dimMismatch")
                : t("dash.compare.empty", {
                    side: sideA.label === "" ? "A" : "B",
                  })}
            </p>
          ) : comparison === null ? (
            <p className="mt-2 text-xs text-gray-500" data-testid="dash-compare-empty">
              {t("dash.empty")}
            </p>
          ) : (
            <div
              className="flex flex-wrap gap-3 mt-3"
              data-testid="dash-compare-result"
            >
              <Card
                label={`${sideA.label} · ${t("dash.table.avg")}`}
                value={formatScoreDisplay(comparison.a.average)}
                sub={t("dash.drill.count", {
                  scored: comparison.a.scoredCount,
                  count: comparison.a.count,
                })}
                testId="dash-compare-card-a"
              />
              <Card
                label={`${sideB.label} · ${t("dash.table.avg")}`}
                value={formatScoreDisplay(comparison.b.average)}
                sub={t("dash.drill.count", {
                  scored: comparison.b.scoredCount,
                  count: comparison.b.count,
                })}
                testId="dash-compare-card-b"
              />
              <Card
                label={t("dash.compare.delta")}
                value={
                  formatSignedDelta(
                    comparison.avgDelta,
                    locale === "pt",
                  ) ?? "—"
                }
                sub={verdictText(
                  deltaDirection(comparison.avgDelta),
                  t,
                )}
                testId="dash-compare-delta"
              />
            </div>
          )}
        </div>
      )}

      {inMonthHub && drillDown && (
        <MonthHubView
          month={drillDown.label}
          stats={monthGroupStats}
          summary={{
            count: drillSelection?.count ?? 0,
            scoredCount: drillSelection?.scoredCount ?? 0,
            average: drillSelection?.average ?? null,
            min: drillSelection?.min ?? null,
            max: drillSelection?.max ?? null,
          }}
          onBack={() => setDrillDown(null)}
          onSelectGroup={(label) =>
            setDrillDown((cur) =>
              cur && cur.kind === "month"
                ? { ...cur, month: { dimension: cur.dimension, label } }
                : cur,
            )
          }
          onExport={exportDrillCsv}
          onPinCompare={
            compareOpen
              ? (label) => pinCompareGroup(drillDown.dimension, label)
              : undefined
          }
        />
      )}

      {drillDown && !inMonthHub && (
        <DrillDownView
          dimension={monthLeaf ? monthLeaf.dimension : drillDown.dimension}
          label={monthLeaf ? monthLeaf.label : drillDown.label}
          monthScope={monthLeaf ? t("dash.drill.monthScope", { month: drillDown.label }) : null}
          backLabel={
            monthLeaf
              ? t("dash.drill.monthBack")
              : undefined
          }
          selection={
            (monthLeaf ? monthLeafSelection : drillSelection) ?? {
              count: 0,
              scoredCount: 0,
              average: null,
              min: null,
              max: null,
            }
          }
          records={monthLeaf ? (monthLeafSelection?.records ?? []) : drillRecords}
          onBack={() =>
            monthLeaf
              ? setDrillDown({ kind: "month", dimension: drillDown.dimension, label: drillDown.label })
              : setDrillDown(null)
          }
          onExport={exportDrillCsv}
          onExportXlsx={exportDrillXlsx}
          onExportQc={exportQcReport}
        />
      )}

      {!drillDown && (
        <>
          {section === "summary" && (
            <div
              className="flex flex-wrap gap-3"
              data-testid="dash-summary-cards"
            >
              <Card label={t("dash.kpi.total")} value={String(summary.total)} />
              <Card
                label={t("dash.kpi.scored")}
                value={String(summary.scored)}
              />
              <Card
                label={t("dash.kpi.unscored")}
                value={String(summary.unscored)}
                testId="dash-card-unscored"
              />
              <Card
                label={t("dash.kpi.avg")}
                value={formatScoreDisplay(summary.average)}
                sub={
                  lastDelta !== null
                    ? `${deltaDisplay} ${t("dash.kpi.vsPrevMonth")}`
                    : undefined
                }
                testId="dash-card-average"
              />
              <Card
                label={t("dash.kpi.best")}
                value={formatScoreDisplay(summary.max)}
              />
              <Card
                label={t("dash.kpi.worst")}
                value={formatScoreDisplay(summary.min)}
              />
            </div>
          )}

          {dimension !== undefined && (
            <GroupTable
              stats={groupStats}
              emptyText={t("dash.empty")}
              onSelect={(label) =>
                setDrillDown({ kind: "group", dimension, label })
              }
              onPinCompare={
                compareOpen
                  ? (label) => pinCompareGroup(dimension, label)
                  : undefined
              }
            />
          )}

          {/* v3 P13: recurring-inconformity ranking (pitch item D). */}
          {section === "inconformities" && (
            <div data-testid="dash-ranking">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-bold text-gray-100">
                  {t("dash.rank.title")}
                </h2>
                <button
                  type="button"
                  data-testid="dash-export-ranking"
                  onClick={exportRanking}
                  title={t("dash.exportRanking.title")}
                  className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
                >
                  {t("dash.exportRanking")}
                </button>
                <button
                  type="button"
                  data-testid="dash-export-ranking-xlsx"
                  onClick={exportRankingXlsx}
                  title={t("dash.exportRanking.xlsxTitle")}
                  className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
                >
                  {t("dash.exportRanking.xlsx")}
                </button>
              </div>

              {/* v3 P17: category scope of the whole Recurring Issues view —
                  chips narrow KPIs, table, heatmap and every export. */}
              <div
                data-testid="dash-cat-filter"
                className="flex flex-wrap items-center gap-2 mb-4"
              >
                <span className="text-xs uppercase tracking-wide text-gray-400">
                  {t("dash.cat.label")}
                </span>
                <button
                  type="button"
                  aria-pressed={!categoryActive}
                  onClick={clearCategoryFilter}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent ${
                    !categoryActive
                      ? "bg-solar-accent/20 border-solar-accent text-solar-accent"
                      : "border-gray-600/60 text-gray-300 hover:bg-gray-500/10"
                  }`}
                >
                  {t("dash.cat.all")}
                </button>
                {categories.map((cat) => {
                  const selected = categoryFilter === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setCategoryFilter(selected ? "" : cat)}
                      title={
                        selected ? t("dash.cat.clear") : undefined
                      }
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent ${
                        selected
                          ? "bg-solar-accent/20 border-solar-accent text-solar-accent"
                          : "border-gray-600/60 text-gray-300 hover:bg-gray-500/10"
                      }`}
                    >
                      {cat === "unknown" ? `(${cat})` : cat}
                    </button>
                  );
                })}
                {categoryActive && (
                  <button
                    type="button"
                    data-testid="dash-cat-clear"
                    onClick={clearCategoryFilter}
                    title={t("dash.cat.clear")}
                    aria-label={t("dash.cat.clear")}
                    className="px-2 py-1 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
                  >
                    ✕
                  </button>
                )}
              </div>
              {categoryActive && (
                <p
                  data-testid="dash-cat-hint"
                  className="text-xs text-orange-300/90 mb-3"
                  role="status"
                >
                  {t("dash.rank.filteredHint", { category: categoryFilter })}
                </p>
              )}

              <div
                className="flex flex-wrap gap-3 mb-4"
                data-testid="dash-ranking-cards"
              >
                <Card
                  label={t("dash.rank.kpi.marked")}
                  value={String(rankSummary.markedRows)}
                  testId="dash-card-marked"
                />
                <Card
                  label={t("dash.rank.kpi.distinct")}
                  value={String(rankSummary.distinctRules)}
                />
                <Card
                  label={t("dash.rank.kpi.occurrences")}
                  value={String(rankSummary.totalOccurrences)}
                />
              </div>

              {ranking.length === 0 ? (
                <p
                  className="text-sm text-gray-400 py-6"
                  data-testid="dash-ranking-empty"
                >
                  {t("dash.rank.empty")}
                </p>
              ) : (
                <>
                  <table
                    data-testid="dash-ranking-table"
                    className="w-full text-sm border-collapse"
                  >
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-600/60">
                        <th scope="col" className="py-2 pr-4">
                          #
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          {t("dash.rank.table.rule")}
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          {t("dash.rank.table.category")}
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right">
                          {t("dash.rank.table.count")}
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right">
                          {t("dash.rank.table.rate")}
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right">
                          {t("dash.rank.table.unit")}
                        </th>
                        <th scope="col" className="py-2 text-right">
                          {t("dash.rank.table.impact")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((stat, index) => (
                        <tr
                          key={stat.ruleId}
                          className="border-b border-gray-700/40 last:border-b-0"
                        >
                          <td className="py-2 pr-4 tabular-nums text-gray-500">
                            {index + 1}
                          </td>
                          <td className="py-2 pr-4 font-medium text-gray-200">
                            {stat.name}
                          </td>
                          <td className="py-2 pr-4 text-gray-300">
                            {stat.categoryId || "—"}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-300">
                            {stat.count}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-300">
                            {formatScoreDisplay(stat.rate * 100)}%
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-400">
                            {formatScoreDisplay(stat.unitScore)}
                          </td>
                          <td className="py-2 text-right tabular-nums font-semibold text-orange-300">
                            {formatScoreDisplay(stat.impact)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p
                    className="text-xs text-gray-500 mt-2"
                    data-testid="dash-ranking-hint"
                  >
                    {t("dash.rank.hint")}
                  </p>

                  {/* v3 P15: monthly heatmap of markings — same filtered
                      dataset as the ranking above; cells drill into the
                      month bucket (P10 hub) for the O.S. behind the number.
                  */}
                  {markHeatmap.months.length > 0 && (
                    <div
                      className="mt-6 pt-4 border-t border-gray-700/40"
                      data-testid="dash-heatmap"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <h3 className="text-base font-bold text-gray-100">
                          {t("dash.heat.title")}
                        </h3>
                        <button
                          type="button"
                          data-testid="dash-export-heatmap"
                          onClick={() => exportHeatmapRef.current()}
                          title={t("dash.exportHeatmap.title")}
                          className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
                        >
                          {t("dash.exportHeatmap")}
                        </button>
                        <button
                          type="button"
                          data-testid="dash-export-heatmap-xlsx"
                          onClick={() => exportHeatmapXlsxRef.current()}
                          title={t("dash.exportHeatmap.xlsxTitle")}
                          className="px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
                        >
                          {t("dash.exportHeatmap.xlsx")}
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table
                          className="w-full text-sm border-collapse"
                          data-testid="dash-heatmap-table"
                        >
                          <thead>
                            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-600/60">
                              <th scope="col" className="py-2 pr-4">
                                {t("dash.rank.table.rule")}
                              </th>
                              {markHeatmap.months.map((m) => (
                                <th
                                  key={m}
                                  scope="col"
                                  className="py-2 px-2 text-center whitespace-nowrap tabular-nums"
                                >
                                  {m}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {markHeatmap.rows.map((row) => {
                              const peak = heatPeak;
                              return (
                                <tr
                                  key={row.ruleId}
                                  className="border-b border-gray-700/40 last:border-b-0"
                                >
                                  <td className="py-1.5 pr-4 text-gray-200">
                                    {row.name}
                                  </td>
                                  {row.cells.map((count, colIndex) => {
                                    const tier = heatmapTier(count, peak);
                                    const month =
                                      markHeatmap.months[colIndex] ?? "";
                                    return (
                                      <td
                                        key={month}
                                        className="py-1.5 px-1 text-center"
                                      >
                                        <button
                                          type="button"
                                          data-testid={`dash-heat-cell-${month}-${row.ruleId}`}
                                          onClick={() =>
                                            setDrillDown({
                                              kind: "month",
                                              dimension: "studio",
                                              label: month,
                                            })
                                          }
                                          title={t("dash.heat.cellLabel", {
                                            rule: row.name,
                                            count,
                                            month,
                                          })}
                                          aria-label={t("dash.heat.cellLabel", {
                                            rule: row.name,
                                            count,
                                            month,
                                          })}
                                          className={`w-full min-w-[2.75rem] rounded py-1 text-xs font-medium tabular-nums transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent ${HEAT_TIER_CLASS[tier]}`}
                                        >
                                          {count}
                                        </button>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p
                        className="text-xs text-gray-500 mt-2"
                        data-testid="dash-heatmap-hint"
                      >
                        {t("dash.heat.hint")}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {section === "trend" && (
            <>
              <TrendChart
                points={trend}
                onSelect={(month) =>
                  setDrillDown({
                    kind: "month",
                    dimension: "studio",
                    label: month,
                  })
                }
              />
              <table
                data-testid="dash-trend-table"
                className="mt-4 w-full text-sm border-collapse"
              >
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-600/60">
                    <th scope="col" className="py-2 pr-4">
                      {t("dash.trend.month")}
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right">
                      {t("dash.table.count")}
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right">
                      {t("dash.table.avg")}
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Δ%
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trend.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-sm text-gray-400">
                        {t("dash.empty")}
                      </td>
                    </tr>
                  )}
                  {trend.map((p, i) => {
                    const delta = i > 0 ? deltaPercent(trend[i - 1], p) : null;
                    return (
                      <tr
                        key={p.month}
                        className="border-b border-gray-700/40 last:border-b-0"
                      >
                        <td className="py-2 pr-4 tabular-nums text-gray-200">
                          {p.month}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-300">
                          {p.count}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-orange-300 font-semibold">
                          {formatScoreDisplay(p.average)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-gray-400">
                          {delta === null
                            ? "—"
                            : `${delta > 0 ? "+" : ""}${delta.toFixed(1).replace(".", ",")}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {/* v3 P10: trend month buttons open the second-level hub now. */}
      {section === "trend" && !drillDown && (
        <p className="text-xs text-gray-500 mt-2" data-testid="dash-trend-hint">
          {t("dash.drill.monthHint")}
        </p>
      )}

      {/* v3 P9: download confirmation — polite live region, auto-dismisses. */}
      {qcToastVisible && (
        <div
          data-testid="dash-qc-toast"
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg border border-emerald-500/40 bg-gray-900/95 px-4 py-3 text-sm text-emerald-200 shadow-xl"
        >
          <p className="mb-2">{t("dash.qcReport.done")}</p>
          <button
            type="button"
            data-testid="dash-qc-toast-close"
            onClick={() => setQcToastVisible(false)}
            className="rounded-md border border-gray-600/60 px-2 py-1 text-xs text-gray-300 hover:bg-gray-500/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-accent"
          >
            OK
          </button>
        </div>
      )}

      <ShortcutHelpModal
        isOpen={isShortcutHelpOpen}
        onClose={() => setIsShortcutHelpOpen(false)}
      />
    </section>
  );
};

export default DashboardPanel;

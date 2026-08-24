// Solaris v3 P5 — Scoring dashboards panel (#/admin/dashboards).
//
// Renders KPI cards, grouped tables and a monthly trend bar chart from the
// pure core in utils/dashboard.ts. All math lives in utils; this component
// only orchestrates loading, dimension switching and rendering.

import React, { useState, useEffect, useMemo } from 'react';
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
} from '../../utils/dashboard';
import {
  filterByPeriod,
  buildDashboardCsv,
  csvFilename,
  hasActiveBounds,
} from '../../utils/dashboardExport';
import {
  loadDashboardEntries,
  barHeightRatio,
  formatScoreDisplay,
  type DashboardEntryInput,
} from '../../utils/dashboardData';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';

type Section = 'summary' | 'studios' | 'instructors' | 'analysts' | 'trend';

interface SectionDef {
  id: Section;
  labelKey: TranslationKey;
  testId: string;
}

const SECTIONS: SectionDef[] = [
  { id: 'summary', labelKey: 'dash.section.summary', testId: 'dash-section-summary' },
  { id: 'studios', labelKey: 'dash.section.studios', testId: 'dash-section-studios' },
  { id: 'instructors', labelKey: 'dash.section.instructors', testId: 'dash-section-instructors' },
  { id: 'analysts', labelKey: 'dash.section.analysts', testId: 'dash-section-analysts' },
  { id: 'trend', labelKey: 'dash.section.trend', testId: 'dash-section-trend' },
];

const DIMENSION_BY_SECTION: Partial<Record<Section, GroupDimension>> = {
  studios: 'studio',
  instructors: 'instructor',
  analysts: 'analyst',
};

/** KPI card — presentational only. */
const Card: React.FC<{ label: string; value: string; sub?: string; testId?: string }> = ({
  label,
  value,
  sub,
  testId,
}) => (
  <div
    data-testid={testId ?? 'dash-card'}
    className="rounded-lg border border-gray-600/60 bg-gray-800/50 px-4 py-3 min-w-[9rem]"
  >
    <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
    <p className="text-2xl font-semibold text-gray-100 mt-1">{value}</p>
    {sub !== undefined && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
  </div>
);

const TrendChart: React.FC<{ points: TrendPoint[] }> = ({ points }) => {
  const { t } = useI18n();
  const maxValue = points.reduce((acc, p) => (p.average !== null ? Math.max(acc, p.average) : acc), 0);
  if (points.length === 0) {
    return <p className="text-sm text-gray-400 py-6" data-testid="dash-trend-empty">{t('dash.empty')}</p>;
  }
  return (
    <div role="img" aria-label={t('dash.trend.chartLabel')} data-testid="dash-trend-chart">
      <div className="flex items-end gap-4 h-40 pl-1">
        {points.map((p) => (
          <div key={p.month} className="flex flex-col items-center justify-end h-full">
            <span className="text-[10px] text-gray-300 mb-1">{formatScoreDisplay(p.average)}</span>
            <div
              className="w-8 rounded-t bg-gradient-to-t from-orange-700 to-orange-400"
              style={{ height: `${Math.round(barHeightRatio(p.average ?? 0, maxValue) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-4 pl-1 mt-1">
        {points.map((p) => (
          <span key={p.month} className="w-8 text-center text-[10px] text-gray-500">
            {p.month.slice(5)}/{p.month.slice(2, 4)}
          </span>
        ))}
      </div>
    </div>
  );
};

const GroupTable: React.FC<{ stats: GroupStat[]; emptyText: string }> = ({ stats, emptyText }) => {
  const { t } = useI18n();
  if (stats.length === 0) {
    return <p className="text-sm text-gray-400 py-6" data-testid="dash-group-empty">{emptyText}</p>;
  }
  return (
    <table data-testid="dash-group-table" className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-600/60">
          <th scope="col" className="py-2 pr-4">{t('dash.table.group')}</th>
          <th scope="col" className="py-2 pr-4 text-right">{t('dash.table.count')}</th>
          <th scope="col" className="py-2 pr-4 text-right">{t('dash.table.avg')}</th>
          <th scope="col" className="py-2 pr-4 text-right">{t('dash.table.min')}</th>
          <th scope="col" className="py-2 text-right">{t('dash.table.max')}</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr key={s.label} className="border-b border-gray-700/40 last:border-b-0">
            <td className="py-2 pr-4 font-medium text-gray-200">{s.label}</td>
            <td className="py-2 pr-4 text-right tabular-nums text-gray-300">{s.count}</td>
            <td className="py-2 pr-4 text-right tabular-nums text-orange-300 font-semibold">
              {formatScoreDisplay(s.average)}
            </td>
            <td className="py-2 pr-4 text-right tabular-nums text-gray-400">{formatScoreDisplay(s.min)}</td>
            <td className="py-2 text-right tabular-nums text-gray-400">{formatScoreDisplay(s.max)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/**
 * The dashboards console body. Rendered inside the admin gate for
 * #/admin/dashboards (RBAC already enforced upstream).
 */
const DashboardPanel: React.FC = () => {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>('summary');
  const [entries, setEntries] = useState<DashboardEntryInput[] | null>(null);
  const [source, setSource] = useState<'live' | 'demo' | null>(null);
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');

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
    () => ({ records: filterByPeriod(dataset.records, { from: fromInput, to: toInput }) }),
    [dataset, fromInput, toInput],
  );
  const periodActive = hasActiveBounds({ from: fromInput, to: toInput });

  const summary = useMemo(() => overallSummary(filtered), [filtered]);
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

  const exportCsv = () => {
    const csvText = buildDashboardCsv(filtered.records);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename({ from: fromInput, to: toInput });
    a.click();
    URL.revokeObjectURL(url);
  };

  const deltaDisplay =
    lastDelta === null
      ? '—'
      : `${lastDelta > 0 ? '+' : ''}${lastDelta.toFixed(1).replace('.', ',')}%`;

  if (entries === null) {
    return (
      <p className="text-sm text-gray-400 p-6" data-testid="dash-loading" role="status" aria-live="polite">
        {t('admin.checkingRole')}
      </p>
    );
  }

  return (
    <section aria-labelledby="dash-title" data-testid="dashboard-panel" className="max-w-5xl mx-auto p-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 id="dash-title" className="text-xl font-bold text-gray-100">{t('dash.title')}</h1>
        {source === 'demo' && (
          <span
            data-testid="dash-source-demo"
            title={t('dash.demoSourceTitle')}
            className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30"
          >
            {t('dash.demoSource')}
          </span>
        )}
        {source === 'live' && (
          <span
            data-testid="dash-source-live"
            className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
          >
            {t('dash.liveSource')}
          </span>
        )}
      </div>

      <div
        data-testid="dash-period-bar"
        className="flex flex-wrap items-center gap-2 mb-5 rounded-lg border border-gray-600/60 bg-gray-800/50 px-3 py-2"
      >
        <span className="text-xs uppercase tracking-wide text-gray-400">{t('dash.period.title')}</span>
        <label className="flex items-center gap-1 text-xs text-gray-300">
          {t('dash.period.from')}
          <input
            type="text"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            placeholder={t('dash.period.placeholder')}
            aria-label={`${t('dash.period.title')}: ${t('dash.period.from')}`}
            data-testid="dash-period-from"
            className="w-32 rounded-md border border-gray-600/60 bg-gray-900/70 px-2 py-1 text-sm text-gray-100"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-300">
          {t('dash.period.to')}
          <input
            type="text"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            placeholder={t('dash.period.placeholder')}
            aria-label={`${t('dash.period.title')}: ${t('dash.period.to')}`}
            data-testid="dash-period-to"
            className="w-32 rounded-md border border-gray-600/60 bg-gray-900/70 px-2 py-1 text-sm text-gray-100"
          />
        </label>
        {periodActive && (
          <button
            type="button"
            data-testid="dash-period-clear"
            onClick={() => {
              setFromInput('');
              setToInput('');
            }}
            className="px-2 py-1 rounded-md text-xs border border-gray-600/60 text-gray-300 hover:bg-gray-500/10 transition-colors"
          >
            {t('dash.period.clear')}
          </button>
        )}
        <button
          type="button"
          data-testid="dash-export-csv"
          onClick={exportCsv}
          title={t('dash.export.title')}
          className="ml-auto px-3 py-1.5 rounded-md text-sm font-medium border border-solar-accent text-solar-accent hover:bg-solar-accent/10 transition-colors"
        >
          {t('dash.export')}
        </button>
      </div>

      <nav aria-label={t('dash.title')} className="flex flex-wrap gap-2 mb-5">
        {SECTIONS.map((s) => {
          const selected = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              data-testid={s.testId}
              aria-pressed={selected}
              onClick={() => setSection(s.id)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border ${
                selected
                  ? 'bg-solar-accent/20 border-solar-accent text-solar-accent'
                  : 'border-gray-600/60 text-gray-300 hover:bg-gray-500/10'
              }`}
            >
              {t(s.labelKey)}
            </button>
          );
        })}
      </nav>

      {section === 'summary' && (
        <div className="flex flex-wrap gap-3" data-testid="dash-summary-cards">
          <Card label={t('dash.kpi.total')} value={String(summary.total)} />
          <Card label={t('dash.kpi.scored')} value={String(summary.scored)} />
          <Card
            label={t('dash.kpi.unscored')}
            value={String(summary.unscored)}
            testId="dash-card-unscored"
          />
          <Card
            label={t('dash.kpi.avg')}
            value={formatScoreDisplay(summary.average)}
            sub={lastDelta !== null ? `${deltaDisplay} ${t('dash.kpi.vsPrevMonth')}` : undefined}
            testId="dash-card-average"
          />
          <Card label={t('dash.kpi.best')} value={formatScoreDisplay(summary.max)} />
          <Card label={t('dash.kpi.worst')} value={formatScoreDisplay(summary.min)} />
        </div>
      )}

      {(section === 'studios' || section === 'instructors' || section === 'analysts') && (
        <GroupTable stats={groupStats} emptyText={t('dash.empty')} />
      )}

      {section === 'trend' && (
        <>
          <TrendChart points={trend} />
          <table data-testid="dash-trend-table" className="mt-4 w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-600/60">
                <th scope="col" className="py-2 pr-4">{t('dash.trend.month')}</th>
                <th scope="col" className="py-2 pr-4 text-right">{t('dash.table.count')}</th>
                <th scope="col" className="py-2 pr-4 text-right">{t('dash.table.avg')}</th>
                <th scope="col" className="py-2 text-right">Δ%</th>
              </tr>
            </thead>
            <tbody>
              {trend.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-sm text-gray-400">{t('dash.empty')}</td>
                </tr>
              )}
              {trend.map((p, i) => {
                const delta = i > 0 ? deltaPercent(trend[i - 1], p) : null;
                return (
                  <tr key={p.month} className="border-b border-gray-700/40 last:border-b-0">
                    <td className="py-2 pr-4 tabular-nums text-gray-200">{p.month}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-gray-300">{p.count}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-orange-300 font-semibold">
                      {formatScoreDisplay(p.average)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-400">
                      {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1).replace('.', ',')}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
};

export default DashboardPanel;

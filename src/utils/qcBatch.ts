// Solaris v3 P9 — Batch QC report over the real dataset (dashboards console).
//
// The legacy S4.1 report (utils/qcReport.ts) renders only the embedded demo
// rows. This core generates a full, printable, self-contained HTML QC report
// from the SAME records that feed the dashboards (live sheet or demo
// fallback), honoring the period filter and drill-down selection already on
// screen. Everything here is pure and framework-free; the panel only wires a
// Blob download around it.

import type { Dataset, GroupDimension, OsRecord } from './dashboard';
import {
  selectGroup,
  selectMonth,
  sortDrillDownRecords,
  slugifyLabel,
} from './dashboardDrilldown';
import { normalizeBound, type PeriodRange } from './dashboardExport';

// ---------- Report model ----------

export interface QcBatchRow {
  rowIndex: number;
  date: string | null;
  wo: string;
  event: string;
  studio: string;
  instructor: string;
  analyst: string;
  finalScore: number | null;
}

export interface QcBatchReportData {
  /** 'overview' = whole filtered dataset; 'group' | 'month' = drill-down scope. */
  kind: 'overview' | 'group' | 'month';
  dimension: GroupDimension;
  label: string;
  generatedAtIso: string;
  period: { from: string | null; to: string | null };
  count: number;
  scoredCount: number;
  average: number | null;
  min: number | null;
  max: number | null;
  records: QcBatchRow[];
}

export interface BuildQcBatchOptions {
  kind?: 'overview' | 'group' | 'month';
  dimension?: GroupDimension;
  label?: string;
  nowIso?: string;
}

const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/** Dataset → typed report payload (deterministic record order via drilldown sort). */
export function buildQcBatchReport(
  dataset: Dataset,
  options: BuildQcBatchOptions = {},
): QcBatchReportData {
  const kind = options.kind ?? 'overview';
  const dimension = options.dimension ?? 'studio';
  const label = options.label ?? '';

  let records: OsRecord[];
  if (kind === 'month') {
    records = selectMonth(dataset, label);
  } else if (kind === 'group') {
    const sel = selectGroup(dataset, dimension, label);
    records = sel.records;
  } else {
    records = sortDrillDownRecords(dataset?.records ?? []);
  }

  const scores = records.map((r) => r.finalScore).filter((v): v is number => v !== null);
  return {
    kind,
    dimension,
    label,
    generatedAtIso: options.nowIso ?? new Date().toISOString(),
    period: { from: null, to: null },
    count: records.length,
    scoredCount: scores.length,
    average: scores.length > 0 ? round2(scores.reduce((a, v) => a + v, 0) / scores.length) : null,
    min: scores.length > 0 ? round2(Math.min(...scores)) : null,
    max: scores.length > 0 ? round2(Math.max(...scores)) : null,
    records: records.map((r) => ({
      rowIndex: r.rowIndex,
      date: r.date,
      wo: r.wo,
      event: r.event,
      studio: r.studio,
      instructor: r.instructor,
      analyst: r.analyst,
      finalScore: r.finalScore,
    })),
  };
}

/** Attaches the applied period bounds to an existing report payload. */
export function withQcPeriod(
  report: QcBatchReportData,
  range: PeriodRange,
): QcBatchReportData {
  return { ...report, period: { from: normalizeBound(range.from), to: normalizeBound(range.to) } };
}

// ---------- Filename ----------

/**
 * 'solaris-qc-report_2024-02_2024-03_estudio-aguia.html' — reuses the CSV
 * naming base so every export of the same view shares one prefix.
 */
export function qcBatchFilename(report: QcBatchReportData): string {
  const span =
    report.period.from || report.period.to
      ? `_${report.period.from ?? 'start'}_${report.period.to ?? 'latest'}`
      : '';
  const scope =
    report.kind === 'overview' ? '' : `_${slugifyLabel(report.label || report.dimension)}`;
  return `solaris-qc-report${span}${scope}.html`;
}

// ---------- Printable HTML ----------

/** Escapes text for safe interpolation into HTML body/attributes. */
export function escapeQcHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const fmtScore = (v: number | null): string =>
  v === null ? '—' : v.toFixed(2).replace('.', ',');

const fmtDate = (iso: string): string => iso.split('T')[0];

const DIMENSION_LABELS: Record<GroupDimension, { en: string; pt: string }> = {
  studio: { en: 'Studio', pt: 'Estúdio' },
  instructor: { en: 'Instructor', pt: 'Instrutor' },
  analyst: { en: 'Analyst', pt: 'Analista' },
};

/**
 * Self-contained printable document: inline CSS tuned for A4 print (the
 * browser's "Save as PDF" turns this into the PDF deliverable), light theme,
 * solar accent #f97316, score table with all O.S. of the scoped view.
 */
export function renderQcBatchHtml(
  report: QcBatchReportData,
  locale: 'en' | 'pt' = 'en',
): string {
  const isPt = locale === 'pt';
  const dict = {
    title: isPt ? 'Relatório QC Solaris' : 'Solaris QC Report',
    subtitle: isPt ? 'Motor de Análise A/V' : 'A/V Analysis Engine',
    generated: isPt ? 'Gerado em' : 'Generated at',
    scopeOverview: isPt ? 'Visão geral (todas as O.S. filtradas)' : 'Overview (all filtered O.S.)',
    scopeGroup: (l: string) =>
      isPt ? `Escopo: ${DIMENSION_LABELS[report.dimension][locale]} ${l}` : `Scope: ${DIMENSION_LABELS[report.dimension][locale]} ${l}`,
    scopeMonth: (m: string) => (isPt ? `Escopo: mês ${m}` : `Scope: month ${m}`),
    period: isPt ? 'Período aplicado' : 'Applied period',
    periodAll: isPt ? 'todos' : 'all',
    kpiTotal: isPt ? 'O.S. no escopo' : 'O.S. in scope',
    kpiScored: isPt ? 'Pontuadas' : 'Scored',
    kpiAvg: isPt ? 'Média' : 'Average',
    kpiMin: isPt ? 'Mínima' : 'Minimum',
    kpiMax: isPt ? 'Máxima' : 'Maximum',
    thDate: isPt ? 'Data' : 'Date',
    thWo: isPt ? 'W.O.' : 'W.O.',
    thEvent: isPt ? 'Evento' : 'Event',
    thStudio: isPt ? 'Estúdio' : 'Studio',
    thInstructor: isPt ? 'Instrutor' : 'Instructor',
    thAnalyst: isPt ? 'Analista' : 'Analyst',
    thScore: isPt ? 'Nota final' : 'Final score',
    empty: isPt ? 'Nenhuma O.S. neste escopo.' : 'No O.S. in this scope.',
    footer: isPt
      ? 'Relatório gerado automaticamente pelo Solaris AV Analysis Engine.'
      : 'Report auto-generated by the Solaris AV Analysis Engine.',
  };

  const scopeLine =
    report.kind === 'overview'
      ? dict.scopeOverview
      : report.kind === 'month'
        ? dict.scopeMonth(report.label)
        : dict.scopeGroup(report.label);

  const periodText =
    report.period.from || report.period.to
      ? `${report.period.from ?? '…'} → ${report.period.to ?? '…'}`
      : dict.periodAll;

  const rows = report.records
    .map(
      (r) => `
      <tr>
        <td>${escapeQcHtml(r.date ?? '')}</td>
        <td>${escapeQcHtml(r.wo)}</td>
        <td>${escapeQcHtml(r.event)}</td>
        <td>${escapeQcHtml(r.studio)}</td>
        <td>${escapeQcHtml(r.instructor)}</td>
        <td>${escapeQcHtml(r.analyst)}</td>
        <td class="num">${fmtScore(r.finalScore)}</td>
      </tr>`,
    )
    .join('');

  const tableSection = `
  <section class="card">
    <h2>${isPt ? 'Ordens de Serviço' : 'Work Orders'}</h2>
    ${
      report.records.length === 0
        ? `<p class="empty">${dict.empty}</p>`
        : `<table>
    <thead>
      <tr>
        <th>${dict.thDate}</th><th>${dict.thWo}</th><th>${dict.thEvent}</th>
        <th>${dict.thStudio}</th><th>${dict.thInstructor}</th><th>${dict.thAnalyst}</th>
        <th class="num">${dict.thScore}</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>`
    }
  </section>`;

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeQcHtml(dict.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 28px; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111827; background: #f9fafb; }
  main { max-width: 860px; margin: 0 auto; }
  header.report-head { border-bottom: 3px solid #f97316; padding-bottom: 14px; margin-bottom: 22px; }
  header.report-head h1 { margin: 0 0 2px; font-size: 24px; letter-spacing: -0.01em; }
  header.report-head .sub { color: #6b7280; font-size: 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-top: 10px; font-size: 12px; color: #374151; }
  .meta strong { color: #111827; }
  section.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px 20px; margin-bottom: 18px; page-break-inside: avoid; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 0 0 12px; }
  dl.kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 0; }
  dl.kpis div { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; }
  dl.kpis dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin: 0 0 4px; }
  dl.kpis dd { margin: 0; font-size: 20px; font-weight: 700; color: #111827; }
  dl.kpis dd.accent { color: #ea580c; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; border-bottom: 2px solid #d1d5db; padding: 6px 8px; }
  td { border-bottom: 1px solid #f3f4f6; padding: 6px 8px; vertical-align: top; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: none; }
  td.num { font-weight: 600; color: #c2410c; }
  p.empty { color: #6b7280; font-style: italic; margin: 4px 0; }
  footer { margin-top: 18px; font-size: 11px; color: #9ca3af; }
  @media print {
    body { background: #fff; padding: 0; }
    main { max-width: none; }
    section.card { border: none; padding: 0 0 10px; }
    @page { size: A4; margin: 16mm 14mm; }
  }
</style>
</head>
<body>
<main>
  <header class="report-head">
    <h1>${escapeQcHtml(dict.title)}</h1>
    <p class="sub">${escapeQcHtml(dict.subtitle)}</p>
    <div class="meta">
      <span><strong>${dict.generated}:</strong> ${escapeQcHtml(fmtDate(report.generatedAtIso))}</span>
      <span><strong>${scopeLine}</strong></span>
      <span><strong>${dict.period}:</strong> ${escapeQcHtml(periodText)}</span>
    </div>
  </header>

  <section class="card">
    <h2>KPIs</h2>
    <dl class="kpis">
      <div><dt>${dict.kpiTotal}</dt><dd>${report.count}</dd></div>
      <div><dt>${dict.kpiScored}</dt><dd>${report.scoredCount}</dd></div>
      <div><dt>${dict.kpiAvg}</dt><dd class="accent">${fmtScore(report.average)}</dd></div>
      <div><dt>${dict.kpiMin}</dt><dd>${fmtScore(report.min)}</dd></div>
      <div><dt>${dict.kpiMax}</dt><dd>${fmtScore(report.max)}</dd></div>
    </dl>
  </section>
${tableSection}
  <footer>${escapeQcHtml(dict.footer)}</footer>
</main>
</body>
</html>`;
}

/** Download filename base shared with CSV exports ('solaris-dashboard'). */
export function qcCsvAlignedBase(): string {
  return 'solaris-dashboard';
}

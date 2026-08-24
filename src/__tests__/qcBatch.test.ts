// Solaris v3 P9 — Batch QC report core coverage.
//
// The batch report must be a faithful, printable mirror of what the
// dashboards show: same records as the drill-down/period-filtered dataset,
// deterministic order, escaped HTML and stable filenames.

import { describe, it, expect } from 'vitest';
import {
  buildQcBatchReport,
  withQcPeriod,
  qcBatchFilename,
  escapeQcHtml,
  renderQcBatchHtml,
} from '../utils/qcBatch';
import { buildDashboardDataset, type DashboardEntryInput } from '../utils/dashboard';

const HEADERS = [
  'DATE', 'W.O.', 'EVENT', 'STUDIO', 'INSTRUCTOR', 'ANALYST',
  'AUDIO SCORE', 'VIDEO SCORE', 'FINAL SCORE',
];

const cell = (value: string) => ({ value });
const entry = (rowIndex: number, values: string[]): DashboardEntryInput => ({
  rowIndex,
  headers: HEADERS,
  cells: values.map(cell),
});

// 3 records: two dated in different months (Studio A / Studio B), one undated.
const ENTRIES: DashboardEntryInput[] = [
  entry(2, ['2024-02-10', 'WO-1', 'Live A', 'Studio A', 'Jane', 'Op. Mike', '0.9', '1.1', '4,50']),
  entry(3, ['2024-03-11', 'WO-2', 'Live B', 'Studio B', 'Alan', 'Op. John', '0.8', '0.9', '5,00']),
  entry(4, ['', 'WO-3', 'Live C', 'Studio A', 'Jane', 'Op. Mike', '0.7', '0.8', '']),
];

const DATASET = buildDashboardDataset(ENTRIES);

describe('QC batch report — P9 core', () => {
  it('builds an overview report from real dataset records (not demo data)', () => {
    const report = buildQcBatchReport(DATASET, { nowIso: '2026-08-24T10:00:00.000Z' });
    expect(report.kind).toBe('overview');
    expect(report.count).toBe(3);
    expect(report.scoredCount).toBe(2);
    expect(report.average).toBeCloseTo((4.5 + 5.0) / 2, 5);
    expect(report.min).toBe(4.5);
    expect(report.max).toBe(5);
    // Deterministic order: dated first chronological, undated last by sheet row.
    expect(report.records.map(r => r.rowIndex)).toEqual([2, 3, 4]);
    expect(report.generatedAtIso).toBe('2026-08-24T10:00:00.000Z');
  });

  it('scopes to a studio group using the shared drill-down selection', () => {
    const report = buildQcBatchReport(DATASET, { kind: 'group', dimension: 'studio', label: 'Studio A' });
    expect(report.records.map(r => r.rowIndex)).toEqual([2, 4]); // dated first, undated last
    expect(report.count).toBe(2);
    expect(report.scoredCount).toBe(1);
    expect(report.average).toBe(4.5);
  });

  it('scopes to a trend month bucket and rejects malformed months', () => {
    const march = buildQcBatchReport(DATASET, { kind: 'month', label: '2024-03' });
    expect(march.records.map(r => r.rowIndex)).toEqual([3]);
    expect(march.max).toBe(5);
    const bad = buildQcBatchReport(DATASET, { kind: 'month', label: 'marco-24' });
    expect(bad.count).toBe(0);
    expect(bad.records).toEqual([]);
  });

  it('withQcPeriod normalizes bounds exactly like the dashboard filter', () => {
    const base = buildQcBatchReport(DATASET);
    const clean = withQcPeriod(base, { from: ' 2024-02 ', to: null });
    expect(clean.period).toEqual({ from: '2024-02', to: null });
    // Free-text garbage never becomes a bound (shape-validated like the dashboard filter);
    // '2024-13' is well-shaped so it passes through — same tolerance the panel already has.
    const garbage = withQcPeriod(base, { from: 'ontem', to: '' });
    expect(garbage.period).toEqual({ from: null, to: null });
    expect(qcBatchFilename(garbage)).toBe('solaris-qc-report.html');
  });

  it('filenames carry period span and slugified scope deterministically', () => {
    const base = buildQcBatchReport(DATASET);
    const scoped = withQcPeriod(buildQcBatchReport(DATASET, {
      kind: 'group', dimension: 'studio', label: 'Estúdio Águia',
    }), { from: '2024-02', to: '2024-03' });
    expect(qcBatchFilename(scoped)).toBe('solaris-qc-report_2024-02_2024-03_estudio-aguia.html');
    const monthScoped = withQcPeriod(
      buildQcBatchReport(DATASET, { kind: 'month', label: '2024-03' }),
      { from: '2024-02', to: '' },
    );
    expect(monthScoped.period.to).toBeNull();
    expect(qcBatchFilename(monthScoped)).toBe('solaris-qc-report_2024-02_latest_2024-03.html');
    expect(qcBatchFilename({ ...base, kind: 'overview' })).toBe('solaris-qc-report.html');
  });

  it('escapes HTML-sensitive text before interpolation', () => {
    expect(escapeQcHtml('<script>&"')).toBe('&lt;script&gt;&amp;&quot;');
    const hostile = buildDashboardDataset([
      entry(2, ['2024-02-10', 'WO<1>', '"Event" & Co', 'A<b>', 'J', 'M', '0', '0', '3,25']),
    ]);
    const html = renderQcBatchHtml(buildQcBatchReport(hostile), 'en');
    expect(html).not.toContain('WO<1>');
    expect(html).toContain('WO&lt;1&gt;');
    expect(html).not.toContain('"Event" & Co</td>');
    expect(html).toContain('&quot;Event&quot; &amp; Co');
    expect(html).not.toContain('A<b>');
  });

  it('renders complete printable documents in both locales', () => {
    for (const locale of ['en', 'pt'] as const) {
      const html = renderQcBatchHtml(withQcPeriod(buildQcBatchReport(DATASET), { from: '2024-02' }), locale);
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain('@media print');
      expect(html).toContain('@page'); // real print/PDF setup
      expect(html).toContain('#f97316'); // solar identity kept in the doc
      expect(html).toContain(locale === 'pt' ? 'Relatório QC Solaris' : 'Solaris QC Report');
      expect(html).toContain(locale === 'pt' ? 'Nota final' : 'Final score');
      // PT-BR decimal comma in scores, never a bare dot:
      expect(html).toContain('4,50');
      expect(html).toContain('5,00');
      expect(html).not.toMatch(/>\s*4\.50\s*</);
    }
  });

  it('renders empty scopes without breaking the document', () => {
    const html = renderQcBatchHtml(buildQcBatchReport(DATASET, { kind: 'month', label: '1999-01' }), 'en');
    expect(html).toContain('No O.S. in this scope.');
    expect(html).toContain('<dt>Scored</dt><dd>0</dd>');
  });
});

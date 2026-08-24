// Tests for the P5 scoring dashboards: tolerant score/date parsing, dynamic
// column mapping, aggregations (summary/groups/trend), the loader fallback and
// the dashboards hash sub-route.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseFinalScore,
  parseIsoDate,
  monthKeyOf,
  resolveColumns,
  buildDashboardDataset,
  overallSummary,
  groupAverageBy,
  sortGroupStats,
  trendByMonth,
  deltaPercent,
} from '../utils/dashboard';
import {
  loadDashboardEntries,
  isEmptyRow,
  barHeightRatio,
  formatScoreDisplay,
} from '../utils/dashboardData';
import { isDashboardsHash, DASHBOARDS_ROUTE } from '../utils/adminRoute';

const H = ['DATE', 'W.O.', 'EVENT', 'STUDIO', 'INSTRUCTOR', 'ANALYST', 'FINAL SCORE'];
const cell = (value: string) => ({ value });
const entry = (rowIndex: number, values: string[]) => ({
  rowIndex,
  headers: H,
  cells: values.map(cell),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseFinalScore', () => {
  it('accepts decimal comma, dot, integer and padded text', () => {
    expect(parseFinalScore('5,00')).toBe(5);
    expect(parseFinalScore('4.33')).toBeCloseTo(4.33, 10);
    expect(parseFinalScore('5')).toBe(5);
    expect(parseFinalScore(' 4,33 ')).toBeCloseTo(4.33, 10);
  });

  it('returns null for empty, garbage or negative input', () => {
    expect(parseFinalScore('')).toBeNull();
    expect(parseFinalScore('   ')).toBeNull();
    expect(parseFinalScore(undefined)).toBeNull();
    expect(parseFinalScore(null)).toBeNull();
    expect(parseFinalScore('n/a')).toBeNull();
    expect(parseFinalScore('-1,2')).toBeNull();
  });
});

describe('parseIsoDate / monthKeyOf', () => {
  it('parses ISO with optional time and BR dd/mm/yyyy', () => {
    expect(parseIsoDate('2024-03-10')).toBe('2024-03-10');
    expect(parseIsoDate('2024-03-10T14:30:00Z')).toBe('2024-03-10');
    expect(parseIsoDate('10/3/2024')).toBe('2024-03-10');
    expect(parseIsoDate('01/12/2025')).toBe('2025-12-01');
  });

  it('never guesses unparseable dates', () => {
    expect(parseIsoDate('march 10')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
    expect(monthKeyOf(parseIsoDate('mar/2024'))).toBeNull();
  });

  it('derives YYYY-MM buckets from valid dates only', () => {
    expect(monthKeyOf('2024-03-10')).toBe('2024-03');
    expect(monthKeyOf(null)).toBeNull();
    expect(monthKeyOf('bad')).toBeNull();
  });
});

describe('resolveColumns (dynamic header mapping)', () => {
  it('maps canonical headers and PT aliases case-insensitively', () => {
    const cols = resolveColumns(['Data', 'O.S.', 'Evento', 'Estúdio', 'Instrutor', 'Analista', 'Nota Final']);
    expect(cols.date).toBe(0);
    expect(cols.wo).toBe(1);
    expect(cols.studio).toBe(3);
    expect(cols.finalScore).toBe(6);
  });

  it('returns -1 for absent columns without throwing', () => {
    const cols = resolveColumns(['W.O.', 'FINAL']);
    expect(cols.date).toBe(-1);
    expect(cols.analyst).toBe(-1);
    expect(cols.finalScore).toBeGreaterThanOrEqual(0);
  });

  it('is robust against moved columns (Gran reorganizes the sheet)', () => {
    const cols = resolveColumns(['FINAL SCORE', 'STUDIO', 'DATE']);
    expect(cols.finalScore).toBe(0);
    expect(cols.studio).toBe(1);
    expect(cols.date).toBe(2);
  });
});

describe('buildDashboardDataset', () => {
  it('builds typed records skipping malformed entries', () => {
    const dataset = buildDashboardDataset([
      entry(2, ['2024-03-10', 'WO-1', 'Ev A', 'Studio A', 'Dr. Smith', 'Guest', '5,00']),
      entry(3, ['11/03/2024', 'WO-2', 'Ev B', '', 'Jane Doe', 'Guest', '']),
      null as never,
      { rowIndex: 99 } as never,
    ]);
    expect(dataset.records).toHaveLength(2);
    expect(dataset.records[0]).toMatchObject({
      rowIndex: 2,
      date: '2024-03-10',
      month: '2024-03',
      studio: 'Studio A',
      finalScore: 5,
    });
    expect(dataset.records[1].date).toBe('2024-03-11');
    expect(dataset.records[1].finalScore).toBeNull();
    expect(dataset.records[1].studio).toBe('');
  });
});

describe('overallSummary', () => {
  it('computes totals, scored split and stats', () => {
    const dataset = buildDashboardDataset([
      entry(2, ['2024-03-10', '', '', 'A', '', '', '5,00']),
      entry(3, ['2024-03-11', '', '', 'B', '', '', '4,00']),
      entry(4, ['2024-04-01', '', '', 'A', '', '', '']),
    ]);
    const summary = overallSummary(dataset);
    expect(summary.total).toBe(3);
    expect(summary.scored).toBe(2);
    expect(summary.unscored).toBe(1);
    expect(summary.average).toBe(4.5);
    expect(summary.min).toBe(4);
    expect(summary.max).toBe(5);
  });

  it('handles empty datasets with null stats', () => {
    const summary = overallSummary(buildDashboardDataset([]));
    expect(summary.total).toBe(0);
    expect(summary.average).toBeNull();
    expect(summary.min).toBeNull();
    expect(summary.max).toBeNull();
  });
});

describe('groupAverageBy', () => {
  const dataset = buildDashboardDataset([
    entry(2, ['', '', '', 'Studio A', 'Jane', 'Op X', '5,00']),
    entry(3, ['', '', '', 'Studio A', 'Jane', 'Op Y', '4,00']),
    entry(4, ['', '', '', 'Studio B', 'Alan', 'Op X', '3,00']),
    entry(5, ['', '', '', '', '', '', '']), // unscored → '(sem valor)' bucket
  ]);

  it('aggregates by studio sorted by average desc', () => {
    const stats = groupAverageBy(dataset, 'studio');
    expect(stats.map((s) => s.label)).toEqual(['Studio A', 'Studio B', '(sem valor)']);
    expect(stats[0]).toMatchObject({ count: 2, average: 4.5, min: 4, max: 5 });
    expect(stats[1]).toMatchObject({ count: 1, average: 3 });
    expect(stats[2]).toMatchObject({ count: 1, average: null });
  });

  it('aggregates by instructor and analyst consistently', () => {
    const byInstructor = groupAverageBy(dataset, 'instructor');
    expect(byInstructor[0].label).toBe('Jane');
    expect(byInstructor[0].average).toBe(4.5);
    const byAnalyst = groupAverageBy(dataset, 'analyst');
    expect(byAnalyst.find((s) => s.label === 'Op X')?.average).toBe(4); // (5+3)/2
  });

  it('sort deterministically: null averages last, then count desc, then label', () => {
    const ordered = sortGroupStats([
      { label: 'b', count: 1, average: null, min: null, max: null },
      { label: 'z', count: 5, average: null, min: null, max: null },
      { label: 'a', count: 2, average: 4, min: 3, max: 5 },
      { label: 'c', count: 9, average: 4, min: 4, max: 4 },
    ]);
    expect(ordered.map((s) => s.label)).toEqual(['c', 'a', 'z', 'b']);
  });
});

describe('trendByMonth / deltaPercent', () => {
  it('buckets by month chronologically with stats', () => {
    const trend = trendByMonth(
      buildDashboardDataset([
        entry(2, ['2024-03-02', '', '', '', '', '', '4,00']),
        entry(3, ['2024-03-20', '', '', '', '', '', '5,00']),
        entry(4, ['2024-04-05', '', '', '', '', '', '4,50']),
      ]),
    );
    expect(trend).toHaveLength(2);
    expect(trend[0]).toEqual({ month: '2024-03', count: 2, average: 4.5, min: 4, max: 5 });
    expect(trend[1].month).toBe('2024-04');
    expect(trend[1].average).toBe(4.5);
  });

  it('skips records without dates', () => {
    const trend = trendByMonth(buildDashboardDataset([entry(2, ['', '', '', '', '', '', '5,00'])]));
    expect(trend).toHaveLength(0);
  });

  it('computes percent deltas between consecutive months', () => {
    const mk = (month: string, average: number | null): { month: string; count: 1; average: number | null; min: number | null; max: number | null } =>
      ({ month, count: 1, average, min: average, max: average });
    expect(deltaPercent(mk('2024-01', 4), mk('2024-02', 5))).toBe(25);
    expect(deltaPercent(mk('2024-01', 4), mk('2024-02', 3))).toBe(-25);
    expect(deltaPercent(mk('2024-01', 4), mk('2024-02', null))).toBeNull();
    expect(deltaPercent(mk('2024-01', 0), mk('2024-02', 5))).toBeNull(); // zero base
    expect(deltaPercent(undefined, mk('2024-02', 5))).toBeNull();
  });
});

describe('isEmptyRow', () => {
  it('detects fully-empty rows that terminate the queue region', () => {
    expect(isEmptyRow(undefined)).toBe(true);
    expect(isEmptyRow([])).toBe(true);
    expect(isEmptyRow([{ value: '' }, { value: '' }])).toBe(true);
    expect(isEmptyRow([{ value: 'x' }, null as never])).toBe(false);
  });
});

describe('loadDashboardEntries (loader fallback)', () => {
  it('falls back to demo rows when the headers endpoint fails', async () => {
    const failing = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const result = await loadDashboardEntries({ fetchFn: failing as unknown as typeof fetch });
    expect(result.source).toBe('demo');
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].headers).toContain('FINAL SCORE');
    // Demo FINAL SCORE column parses cleanly through the same core.
    const parsed = buildDashboardDataset(result.entries);
    expect(parsed.records.every((r) => r.finalScore !== null)).toBe(true);
  });

  it('reads live rows sequentially until an empty row terminates the queue', async () => {
    const responses = new Map<string, unknown>([
      ['/api/sheet-headers', { ok: true, json: async () => ({ headers: H }) } as Response],
      ['/api/sheet-row?rowIndex=2', { ok: true, json: async () => [cell('2024-03-10'), cell('W'), cell('E'), cell('S'), cell('I'), cell('A'), cell('5,00')] } as Response],
      ['/api/sheet-row?rowIndex=3', { ok: true, json: async () => [] } as Response],
    ]);
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const key = String(url);
      if (!responses.has(key)) throw new Error(`unexpected url ${key}`);
      return responses.get(key) as Response;
    }) as unknown as typeof fetch;
    const result = await loadDashboardEntries({ fetchFn });
    expect(result.source).toBe('live');
    expect(result.entries).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(3); // headers + row2 + row3(stop)
  });
});

describe('bar geometry + display formatting', () => {
  it('normalizes ratios into [0.04, 1] with a visible floor', () => {
    expect(barHeightRatio(5, 5)).toBe(1);
    expect(barHeightRatio(2.5, 5)).toBe(0.5);
    expect(barHeightRatio(0, 5)).toBe(0.04); // zero bars stay visible
    expect(barHeightRatio(NaN, 5)).toBe(0.04);
    expect(barHeightRatio(-1, 5)).toBe(0.04);
    expect(barHeightRatio(7, 5)).toBe(1); // clamped
  });

  it('guards against non-positive maxima', () => {
    expect(barHeightRatio(3, 0)).toBe(0.04);
    expect(barHeightRatio(3, NaN)).toBe(0.04);
  });

  it('formats scores with PT-BR comma and dashes for nulls', () => {
    expect(formatScoreDisplay(4.333)).toBe('4,33');
    expect(formatScoreDisplay(5)).toBe('5,00');
    expect(formatScoreDisplay(null)).toBe('—');
    expect(formatScoreDisplay(NaN)).toBe('—');
  });
});

describe('dashboards hash route', () => {
  it('matches #/admin/dashboards including subpath/query', () => {
    expect(isDashboardsHash('#/admin/dashboards')).toBe(true);
    expect(isDashboardsHash('#/admin/dashboards/')).toBe(true);
    expect(isDashboardsHash('#/admin/dashboards?section=trend')).toBe(true);
  });

  it('keeps plain rules console and lookalikes out of the dashboard route', () => {
    expect(isDashboardsHash('#/admin')).toBe(false);
    expect(isDashboardsHash('#/administrator/dashboards')).toBe(false);
    expect(isDashboardsHash('#')).toBe(false);
    expect(DASHBOARDS_ROUTE).toBe('#/admin/dashboards');
  });
});

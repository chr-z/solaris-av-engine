// Solaris v3 P10 — Second-level drill-down (month → group) core coverage.
//
// The hub (whole month broken down by one dimension) and the leaf (one group
// inside one month) must behave exactly like their first-level counterparts:
// shared sentinel, deterministic ordering, tolerant of garbage months, and
// pure over the input dataset.

import { describe, it, expect } from 'vitest';
import {
  UNGROUPED_LABEL,
  groupAverageByMonth,
  selectGroupInMonth,
  selectMonthSummary,
  monthGroupFilename,
} from '../utils/dashboardDrilldown';
import type { OsRecord } from '../utils/dashboard';

// ---------- Fixtures ----------

const rec = (over: Partial<OsRecord>): OsRecord => ({
  rowIndex: 2,
  date: null,
  month: null,
  wo: '',
  event: '',
  studio: '',
  instructor: '',
  analyst: '',
  finalScore: null,
  ...over,
});

const DATASET = {
  records: [
    rec({ rowIndex: 2, date: '2024-03-10', month: '2024-03', wo: 'WO-A', studio: 'Studio A', instructor: 'Jane', analyst: 'Op1', finalScore: 5.0 }),
    rec({ rowIndex: 3, date: '2024-02-01', month: '2024-02', wo: 'WO-B', studio: 'Studio A', instructor: 'Alan', analyst: 'Op2', finalScore: 3.0 }),
    // Undated Studio A row must NEVER leak into a month bucket.
    rec({ rowIndex: 4, wo: 'WO-C', studio: 'Studio A', instructor: 'Jane', analyst: 'Op1', finalScore: 4.5 }),
    rec({ rowIndex: 5, date: '2024-03-11', month: '2024-03', wo: 'WO-D', instructor: 'Jane', analyst: 'Op2', finalScore: 2.0 }),
    rec({ rowIndex: 6, date: '2024-04-01', month: '2024-04', wo: 'WO-E', finalScore: null }),
    rec({ rowIndex: 7, date: '2024-03-05', month: '2024-03', wo: 'WO-F', studio: 'Studio B', finalScore: 4.0 }),
  ],
};

// ---------- Hub: groupAverageByMonth ----------

describe('P10 month drill-down — hub breakdown (groupAverageByMonth)', () => {
  it('scopes group stats to one month in the canonical table order', () => {
    const stats = groupAverageByMonth(DATASET, '2024-03', 'studio');
    expect(stats.map((s) => s.label)).toEqual(['Studio A', 'Studio B', UNGROUPED_LABEL]);
    expect(stats.map((s) => s.average)).toEqual([5.0, 4.0, 2.0]); // avg desc
    expect(stats.every((s) => s.count === 1)).toBe(true);
  });

  it('excludes other months and undated rows from every bucket', () => {
    const feb = groupAverageByMonth(DATASET, '2024-02', 'instructor');
    // February has exactly one record (WO-B, instructor Alan); WO-C is undated.
    expect(feb).toHaveLength(1);
    expect(feb[0]).toMatchObject({ label: 'Alan', count: 1, average: 3.0 });
  });

  it('malformed and unknown months degrade to an empty list, never throw', () => {
    expect(groupAverageByMonth(DATASET, 'march', 'studio')).toEqual([]);
    expect(groupAverageByMonth(DATASET, '2024-3', 'studio')).toEqual([]);
    expect(groupAverageByMonth(DATASET, '', 'analyst')).toEqual([]);
    expect(groupAverageByMonth(DATASET, '1999-01', 'studio')).toEqual([]);
  });
});

// ---------- Leaf: selectGroupInMonth ----------

describe('P10 month drill-down — leaf selection (selectGroupInMonth)', () => {
  it('picks only the named group inside the bucket with correct stats', () => {
    const sel = selectGroupInMonth(DATASET, '2024-03', 'studio', 'Studio A');
    expect(sel.records.map((r) => r.wo)).toEqual(['WO-A']); // WO-C is undated → excluded
    expect(sel.count).toBe(1);
    expect(sel.scoredCount).toBe(1);
    expect(sel.average).toBe(5.0);
    expect(sel.min).toBe(5.0);
    expect(sel.max).toBe(5.0);
    expect(sel.dimension).toBe('studio');
    expect(sel.label).toBe('Studio A');
  });

  it('keeps the shared sentinel reachable inside the month', () => {
    const sel = selectGroupInMonth(DATASET, '2024-03', 'studio', UNGROUPED_LABEL);
    expect(sel.records.map((r) => r.wo)).toEqual(['WO-D']);
    expect(sel.average).toBe(2.0);
  });

  it('unknown labels yield an empty selection instead of erroring', () => {
    const sel = selectGroupInMonth(DATASET, '2024-03', 'studio', 'No Such Studio');
    expect(sel.count).toBe(0);
    expect(sel.records).toEqual([]);
    expect(sel.average).toBeNull();
  });

  it('is deterministic regardless of input row order', () => {
    const shuffled = { records: [...DATASET.records].reverse() };
    const a = selectGroupInMonth(shuffled, '2024-03', 'studio', 'Studio A');
    const b = selectGroupInMonth(DATASET, '2024-03', 'studio', 'Studio A');
    expect(a.records.map((r) => r.wo)).toEqual(b.records.map((r) => r.wo));
  });
});

// ---------- Month summary (hub header cards) ----------

describe('P10 month drill-down — whole-month summary (selectMonthSummary)', () => {
  it('returns the full bucket stats and chronological reading order', () => {
    const sel = selectMonthSummary(DATASET, '2024-03');
    expect(sel.records.map((r) => r.wo)).toEqual(['WO-F', 'WO-A', 'WO-D']); // date asc
    expect(sel.count).toBe(3);
    expect(sel.scoredCount).toBe(3);
    expect(sel.average).toBe(3.67); // (5 + 2 + 4) / 3, rounded like everywhere else
    expect(sel.min).toBe(2.0);
    expect(sel.max).toBe(5.0);
  });

  it('malformed months return the empty-selection shape, never throw', () => {
    const sel = selectMonthSummary(DATASET, 'not-a-month');
    expect(sel.count).toBe(0);
    expect(sel.scoredCount).toBe(0);
    expect(sel.records).toEqual([]);
    expect(sel.average).toBeNull();
  });

  it('bucket partition holds: hub counts add up to the whole-month count', () => {
    const total = selectMonthSummary(DATASET, '2024-03').count;
    const sum = groupAverageByMonth(DATASET, '2024-03', 'studio').reduce(
      (acc, s) => acc + s.count,
      0,
    );
    expect(sum).toBe(total);
  });
});

// ---------- Filenames & purity ----------

describe('P10 month drill-down — export naming and purity', () => {
  it('composes leaf filenames from period range + month + group slugs', () => {
    expect(monthGroupFilename({}, '2024-03', 'Estúdio Águia')).toBe(
      'solaris-dashboard_2024-03_estudio-aguia.csv',
    );
    expect(
      monthGroupFilename({ from: '2024-02', to: '2024-03' }, '2024-03', 'Studio A'),
    ).toBe('solaris-dashboard_2024-02_2024-03_2024-03_studio-a.csv');
  });

  it('never mutates the input dataset', () => {
    const snapshot = JSON.stringify(DATASET);
    groupAverageByMonth(DATASET, '2024-03', 'studio');
    selectGroupInMonth(DATASET, '2024-03', 'analyst', 'Op1');
    selectMonthSummary(DATASET, '2024-02');
    expect(JSON.stringify(DATASET)).toBe(snapshot);
  });
});

import { describe, it, expect } from 'vitest';
import {
  UNGROUPED_LABEL,
  selectGroup,
  selectMonth,
  sortDrillDownRecords,
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
    rec({ rowIndex: 2, date: '2024-03-10', month: '2024-03', wo: 'WO-A', studio: 'Studio A', finalScore: 5.0 }),
    rec({ rowIndex: 3, date: '2024-02-01', month: '2024-02', wo: 'WO-B', studio: 'Studio A', finalScore: 3.0 }),
    rec({ rowIndex: 4, date: null, month: null, wo: 'WO-C', studio: 'Studio A', finalScore: 4.5 }),
    rec({ rowIndex: 5, date: '2024-03-11', month: '2024-03', wo: 'WO-D', studio: '', instructor: 'Jane', finalScore: 2.0 }),
    rec({ rowIndex: 6, date: '2024-04-01', month: '2024-04', wo: 'WO-E', studio: '' }),
  ],
};

// ---------- Tests ----------

describe('P7 dashboard drill-down — group selection', () => {
  it('selects all member records of a labeled group with correct stats', () => {
    const sel = selectGroup(DATASET, 'studio', 'Studio A');
    expect(sel.count).toBe(3);
    expect(sel.scoredCount).toBe(3);
    expect(sel.average).toBe(4.17); // (5 + 3 + 4.5) / 3
    expect(sel.min).toBe(3.0);
    expect(sel.max).toBe(5.0);
    expect(sel.records.map((r) => r.wo)).toEqual(['WO-B', 'WO-A', 'WO-C']); // date asc, undated last
    expect(sel.dimension).toBe('studio');
    expect(sel.label).toBe('Studio A');
  });

  it('sentinel label reaches the ungrouped bucket shared with groupAverageBy', () => {
    const sel = selectGroup(DATASET, 'studio', UNGROUPED_LABEL);
    expect(sel.count).toBe(2); // WO-D + WO-E
    expect(sel.scoredCount).toBe(1);
    expect(sel.average).toBe(2.0);
    expect(sel.records.map((r) => r.wo)).toEqual(['WO-D', 'WO-E']);
  });

  it('empty dimension values do not leak into a real empty-string label match', () => {
    // No studio is literally named '(sem valor)' in the data; a label that
    // exists nowhere yields an empty selection instead of guessing.
    const sel = selectGroup(DATASET, 'studio', 'No Such Studio');
    expect(sel.count).toBe(0);
    expect(sel.records).toEqual([]);
    expect(sel.average).toBeNull();
  });

  it('works across every dimension and keeps unscored rows in the count', () => {
    const byInstructor = selectGroup(DATASET, 'instructor', 'Jane');
    expect(byInstructor.count).toBe(1);
    expect(byInstructor.scoredCount).toBe(1);

    const byAnalystUngrouped = selectGroup(DATASET, 'analyst', UNGROUPED_LABEL);
    expect(byAnalystUngrouped.count).toBe(5);
    expect(byAnalystUngrouped.scoredCount).toBe(4);
  });
});

describe('P7 dashboard drill-down — deterministic ordering', () => {
  it('sorts dated first chronological, undated last by sheet row', () => {
    const shuffled = [
      rec({ rowIndex: 9, date: null }),
      rec({ rowIndex: 7, date: '2024-05-01' }),
      rec({ rowIndex: 8, date: null }),
      rec({ rowIndex: 6, date: '2024-01-01' }),
      rec({ rowIndex: 5, date: '2024-03-03' }),
    ];
    // Jan(6) → Mar(5) → May(7), then undated rows last in sheet order (8 before 9)
    expect(sortDrillDownRecords(shuffled).map((r) => r.rowIndex)).toEqual([6, 5, 7, 8, 9]);
  });

  it('same-day records fall back to sheet order and input array is never mutated', () => {
    const input = [
      rec({ rowIndex: 12, date: '2024-03-10' }),
      rec({ rowIndex: 10, date: '2024-03-10' }),
      rec({ rowIndex: 11, date: '2024-03-09' }),
    ];
    const snapshot = [...input];
    const sorted = sortDrillDownRecords(input);
    expect(sorted.map((r) => r.rowIndex)).toEqual([11, 10, 12]);
    expect(input).toEqual(snapshot); // pure — no in-place sort
  });
});

describe('P7 dashboard drill-down — month selection', () => {
  it('picks exactly the trend bucket records of one month', () => {
    const march = selectMonth(DATASET, '2024-03');
    expect(march.map((r) => r.wo)).toEqual(['WO-A', 'WO-D']);
  });

  it('rejects malformed months and unknown months without throwing', () => {
    expect(selectMonth(DATASET, 'march')).toEqual([]);
    expect(selectMonth(DATASET, '2024-3')).toEqual([]);
    expect(selectMonth(DATASET, '')).toEqual([]);
    expect(selectMonth(DATASET, '1999-01')).toEqual([]);
  });
});

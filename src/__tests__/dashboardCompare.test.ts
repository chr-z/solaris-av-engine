import { describe, it, expect } from 'vitest';
import {
  buildComparison,
  selectCompareSide,
  deltaDirection,
  formatSignedDelta,
  compareFilename,
  buildCompareCsv,
} from '../utils/dashboardCompare';
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
    rec({ rowIndex: 7, date: '2024-03-12', month: '2024-03', wo: 'WO-F', instructor: 'John', studio: 'Studio B', finalScore: 4.0 }),
  ],
};

const snapshot = JSON.stringify(DATASET.records);

// ---------- Tests ----------

describe('P11 dashboard group comparison — side selection', () => {
  it('computes one side with the same stats shape as drill-down', () => {
    const stats = selectCompareSide(DATASET, { dimension: 'studio', label: 'Studio A' });
    expect(stats.count).toBe(3);
    expect(stats.scoredCount).toBe(3);
    expect(stats.average).toBe(4.17); // (5 + 3 + 4.5) / 3, rounded like drill-down
    expect(stats.min).toBe(3.0);
    expect(stats.max).toBe(5.0);
    expect(stats.records.map((r) => r.wo)).toEqual(['WO-B', 'WO-A', 'WO-C']); // shared reading order
  });

  it('sentinel label reaches the ungrouped bucket exactly like the tables', () => {
    const stats = selectCompareSide(DATASET, { dimension: 'studio', label: '(sem valor)' });
    expect(stats.count).toBe(2); // WO-D + WO-E
    expect(stats.scoredCount).toBe(1);
    expect(stats.average).toBe(2.0);
  });

  it('unknown labels yield an empty side instead of throwing', () => {
    const stats = selectCompareSide(DATASET, { dimension: 'studio', label: 'Ghost Studio' });
    expect(stats.count).toBe(0);
    expect(stats.records).toEqual([]);
    expect(stats.average).toBeNull();
  });
});

describe('P11 dashboard group comparison — buildComparison', () => {
  it('builds A/B stats and the rounded B−A delta over one dataset', () => {
    const cmp = buildComparison(
      DATASET,
      { dimension: 'studio', label: 'Studio A' },
      { dimension: 'studio', label: 'Studio B' },
    );
    expect(cmp).not.toBeNull();
    expect(cmp!.a.average).toBe(4.17);
    expect(cmp!.b.average).toBe(4.0);
    expect(cmp!.b.count).toBe(1);
    expect(cmp!.avgDelta).toBe(-0.17); // 4.00 − 4.17
    expect(cmp!.dimension).toBe('studio');
  });

  it('null while either side is unpinned or dimensions diverge', () => {
    const onlyA = buildComparison(DATASET, { dimension: 'studio', label: 'Studio A' }, null);
    expect(onlyA).toBeNull();
    const mixedDim = buildComparison(
      DATASET,
      { dimension: 'studio', label: 'Studio A' },
      { dimension: 'analyst', label: 'Jane' },
    );
    expect(mixedDim).toBeNull();
  });

  it('delta is null when either average is null — no fake zeros', () => {
    const cmp = buildComparison(
      DATASET,
      { dimension: 'studio', label: '(sem valor)' }, // avg 2.0
      { dimension: 'studio', label: 'Ghost' }, // no scored records
    );
    expect(cmp).not.toBeNull();
    expect(cmp!.a.average).not.toBeNull();
    expect(cmp!.b.average).toBeNull();
    expect(cmp!.avgDelta).toBeNull();
  });

  it('never mutates the input dataset', () => {
    buildComparison(
      DATASET,
      { dimension: 'instructor', label: 'Jane' },
      { dimension: 'instructor', label: 'John' },
    );
    expect(JSON.stringify(DATASET.records)).toBe(snapshot);
  });

  it('respects the period filter because selection happens on the passed dataset', () => {
    // Same behavior as the panel: filter first, then compare.
    const marchOnly = {
      records: DATASET.records.filter((r) => r.month === '2024-03'),
    };
    const cmp = buildComparison(
      marchOnly,
      { dimension: 'studio', label: 'Studio A' },
      { dimension: 'studio', label: 'Studio B' },
    );
    expect(cmp).not.toBeNull();
    expect(cmp!.a.count).toBe(1);
    expect(cmp!.b.count).toBe(1);
    expect(cmp!.avgDelta).toBe(-1.0);
  });
});

describe('P11 dashboard group comparison — direction + formatting', () => {
  it('classifies direction from B vs A perspective; ties are explicit', () => {
    expect(deltaDirection(1.5)).toBe('better');
    expect(deltaDirection(-0.01)).toBe('worse');
    expect(deltaDirection(0)).toBe('tie');
    expect(deltaDirection(null)).toBe('unknown');
  });

  it('higherIsBetter=false flips the verdict without touching the sign', () => {
    expect(deltaDirection(1.5, false)).toBe('worse');
    expect(deltaDirection(-1.5, false)).toBe('better');
  });

  it('formats signed deltas for both locales, including zero and -0', () => {
    expect(formatSignedDelta(1.25, false)).toBe('+1.25');
    expect(formatSignedDelta(-1.25, true)).toBe('-1,25');
    expect(formatSignedDelta(0, true)).toBe('0,00');
    expect(formatSignedDelta(-0, false)).toBe('0.00');
    expect(formatSignedDelta(null, true)).toBeNull();
  });

  it('filename carries range bounds and a slugged dimension', () => {
    expect(compareFilename({}, 'instructor')).toBe('solaris-dashboard_ab-instructor.csv');
    const named = compareFilename({ from: '2024-02', to: '2024-03' }, 'analyst');
    expect(named.startsWith('solaris-dashboard_2024-02_2024-03_')).toBe(true);
    expect(named.endsWith('_ab-analyst.csv')).toBe(true);
  });
});

describe('P11 dashboard group comparison — CSV export', () => {
  it('emits a metric block plus side-prefixed record rows deterministically', () => {
    const cmp = buildComparison(
      DATASET,
      { dimension: 'studio', label: 'Studio A' },
      { dimension: 'studio', label: '(sem valor)' },
    )!;
    const csv = buildCompareCsv(cmp);
    const lines = csv.split('\r\n');
    // Header row repeats the dynamic dimension (unquoted — no special chars).
    expect(lines[0]).toBe('metric,studio,studio');
    expect(lines[1]).toBe('total,3,2');
    expect(lines[2]).toBe('scored,3,1');
    expect(lines[3]).toBe('average,4.17,2');
    expect(lines[4]).toBe('min,3,2');
    expect(lines[5]).toBe('max,5,2');
    // Records block: every A record then every B record, side-tagged.
    const tags = lines.slice(6).map((l) => l.split(',')[0]);
    expect(tags).toEqual(['A', 'A', 'A', 'B', 'B']);
    expect(lines[6].endsWith(',WO-B')).toBe(false);
    expect(lines.filter((l) => l.includes('WO-A'))).toHaveLength(1);
  });

  it('escapes hostile values per RFC 4180 in both blocks', () => {
    const hostile: { records: OsRecord[] } = {
      records: [
        rec({ rowIndex: 9, wo: 'W,O "X"', studio: 'Evil\nStudio', finalScore: 1.0 }),
        rec({ rowIndex: 10, wo: 'OK', studio: 'Plain', finalScore: 2.0 }),
      ],
    };
    const cmp = buildComparison(
      hostile,
      { dimension: 'studio', label: 'Evil\nStudio' },
      { dimension: 'studio', label: 'Plain' },
    )!;
    const csv = buildCompareCsv(cmp);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('metric,studio,studio');
    // The hostile record line keeps its commas inside quoted fields.
    expect(csv).toContain('"Evil\nStudio"');
    expect(csv).toContain('"W,O ""X"""');
    // Union order preserved: A records first.
    expect(lines[lines.length - 2]).toContain('"W,O ""X"""');
    expect(lines[lines.length - 1]).toContain(',OK');
  });

  it('empty sides produce empty metric cells, never NaN', () => {
    const cmp = buildComparison(
      DATASET,
      { dimension: 'studio', label: 'Ghost A' },
      { dimension: 'studio', label: 'Ghost B' },
    )!;
    const csv = buildCompareCsv(cmp);
    expect(csv).toContain('total,0,0');
    expect(csv).toContain('average,,');
    expect(csv).not.toContain('NaN');
  });
});

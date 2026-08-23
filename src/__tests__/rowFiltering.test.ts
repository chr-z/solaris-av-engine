import { describe, it, expect } from 'vitest';
import {
  computeFilteredRows,
  classifyRow,
  applyRowFilters,
} from '../utils/rowFiltering';
import type { RowWithSheetIndex } from '../components/Analysis/AnalysisSheet';
import type { FilterState } from '../components/Analysis/FilterControls';

const HEADERS = [
  'W.O.', 'EVENT', 'UNIFORM', 'ANALYST', 'OPERATOR', 'ANALYSIS TIME',
  'INSTRUCTOR', 'STUDIO', 'AUDIO OUT OF SYNC',
];

const makeRow = (values: (string | null)[], rowIndex: number): RowWithSheetIndex => ({
  rowIndex,
  row: HEADERS.map((_, i) => ({ value: values[i] ?? '' })),
});

const baseFilters: FilterState = {
  startDate: '2026-08-01',
  endDate: '2026-08-23',
  inconformities: [],
  studio: '',
};

const completeValues = (wo: string, extra: Partial<Record<string, string>> = {}): (string | null)[] =>
  HEADERS.map((h) => {
    if (h in extra) return extra[h] ?? '';
    if (h === 'W.O.') return wo;
    if (h === 'OPERATOR') return 'Op';
    if (h === 'ANALYSIS TIME') return '00:10:00';
    return 'x';
  });

describe('classifyRow', () => {
  const colIndex = {
    WO: 0, EVENT: 1, UNIFORM: 2, ANALYST: 3,
    OPERATOR: 4, ANALYSIS_TIME: 5, INSTRUCTOR: 6, STUDIO: 7,
  };

  it('classifies a fully filled row as completed', () => {
    const row = makeRow(completeValues('1001'), 0);
    expect(classifyRow(row, colIndex)).toBe('completed');
  });

  it('classifies a row missing EVENT as pending', () => {
    const values = completeValues('1002');
    values[HEADERS.indexOf('EVENT')] = '';
    expect(classifyRow(makeRow(values, 0), colIndex)).toBe('pending');
  });

  it('classifies a row without operator as special', () => {
    const values = completeValues('1003');
    values[HEADERS.indexOf('OPERATOR')] = '';
    expect(classifyRow(makeRow(values, 0), colIndex)).toBe('special');
  });

  it('treats zero analysis time as special (system work order)', () => {
    const values = completeValues('1004');
    values[HEADERS.indexOf('ANALYSIS TIME')] = '00:00:00';
    expect(classifyRow(makeRow(values, 0), colIndex)).toBe('special');
  });

  it('ignores rows without a W.O. number', () => {
    expect(classifyRow(makeRow(completeValues(''), 0), colIndex)).toBeNull();
  });
});

describe('applyRowFilters', () => {
  it('filters by search term matching W.O. or instructor', () => {
    const rows = [
      makeRow(completeValues('1001', { INSTRUCTOR: 'Ana' }), 0),
      makeRow(completeValues('2002', { INSTRUCTOR: 'Bruno' }), 1),
    ];
    expect(applyRowFilters(rows, HEADERS, baseFilters, 'bruno')).toHaveLength(1);
    expect(applyRowFilters(rows, HEADERS, baseFilters, '1001')[0].rowIndex).toBe(0);
  });

  it('filters by exact studio match', () => {
    const rows = [
      makeRow(completeValues('1001', { STUDIO: 'Studio A' }), 0),
      makeRow(completeValues('2002', { STUDIO: 'Studio B' }), 1),
    ];
    const result = applyRowFilters(rows, HEADERS, { ...baseFilters, studio: 'Studio B' }, '');
    expect(result).toHaveLength(1);
    expect(result[0].rowIndex).toBe(1);
  });

  it('requires at least one selected inconformity column to be TRUE/Noncompliant', () => {
    const rows = [
      makeRow(completeValues('1001', { 'AUDIO OUT OF SYNC': 'TRUE' }), 0),
      makeRow(completeValues('2002', { 'AUDIO OUT OF SYNC': 'FALSE' }), 1),
    ];
    const filters = { ...baseFilters, inconformities: ['AUDIO OUT OF SYNC'] };
    const result = applyRowFilters(rows, HEADERS, filters, '');
    expect(result).toHaveLength(1);
    expect(result[0].rowIndex).toBe(0);
  });
});

describe('computeFilteredRows', () => {
  const rows: RowWithSheetIndex[] = [
    makeRow(completeValues('1001'), 0), // completed
    makeRow(completeValues('1002', { EVENT: '' }), 1), // pending
    makeRow(completeValues('1003', { OPERATOR: '' }), 2), // special
    makeRow(completeValues('', {}), 3), // no W.O. → ignored
  ];

  it('splits rows into the three buckets and drops W.O.-less rows', () => {
    const result = computeFilteredRows(rows, HEADERS, baseFilters, '', false);
    expect(result.pending.map(r => r.rowIndex)).toEqual([1]);
    expect(result.completed.map(r => r.rowIndex)).toEqual([0]);
    expect(result.special.map(r => r.rowIndex)).toEqual([2]);
  });

  it('guest mode collapses all rows into one searchable list', () => {
    const result = computeFilteredRows(rows, HEADERS, baseFilters, '1002', true);
    expect(result.pending.map(r => r.rowIndex)).toEqual([1]);
    expect(result.completed).toEqual([]);
    expect(result.special).toEqual([]);
  });

  it('returns empty buckets when there is no data or no headers', () => {
    const empty = computeFilteredRows([], [], baseFilters, '', false);
    expect(empty.pending).toEqual([]);
    expect(empty.completed).toEqual([]);
    expect(empty.special).toEqual([]);
  });

  it('applies search filter on top of classification in normal mode', () => {
    const result = computeFilteredRows(rows, HEADERS, baseFilters, '1001', false);
    expect(result.completed.map(r => r.rowIndex)).toEqual([0]);
    expect(result.pending).toEqual([]);
  });
});

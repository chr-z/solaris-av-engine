import { describe, it, expect } from 'vitest';
import {
  filterByPeriod,
  hasActiveBounds,
  normalizeBound,
  escapeCsvField,
  buildDashboardCsv,
  csvFilename,
} from '../utils/dashboardExport';
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

const RECORDS: OsRecord[] = [
  rec({ rowIndex: 2, date: '2024-02-28', month: '2024-02', wo: 'WO-001', studio: 'Studio A', analyst: 'Guest', finalScore: 5.0 }),
  rec({ rowIndex: 3, date: '2024-03-01', month: '2024-03', wo: 'WO-002', studio: 'Studio B', instructor: 'Jane Doe', event: 'Intro, part 1', finalScore: 4.33 }),
  rec({ rowIndex: 4, date: '2024-03-31', month: '2024-03', wo: 'WO-003' }),
  rec({ rowIndex: 5, date: '2024-04-15', month: '2024-04', wo: 'WO-004', finalScore: 3.8 }),
  rec({ rowIndex: 6 }), // undated — no parseable date
];

describe('P6 dashboard export — period filtering', () => {
  it('normalizes bounds and detects active ranges (garbage counts as unset)', () => {
    expect(normalizeBound('2024-03')).toBe('2024-03');
    expect(normalizeBound(' 2024-03-10 ')).toBe('2024-03-10');
    expect(normalizeBound('march')).toBeNull();
    expect(normalizeBound(undefined)).toBeNull();
    expect(hasActiveBounds({ from: 'x', to: '' })).toBe(false);
    expect(hasActiveBounds({ from: '2024-03' })).toBe(true);
    expect(hasActiveBounds({})).toBe(false);
  });

  it('returns all records untouched when no bound is active', () => {
    const out = filterByPeriod(RECORDS, {});
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(RECORDS[0]);
    const out2 = filterByPeriod(RECORDS, { from: 'nonsense' });
    expect(out2).toHaveLength(5);
  });

  it('month bounds are inclusive on both edges', () => {
    const march = filterByPeriod(RECORDS, { from: '2024-03', to: '2024-03' });
    expect(march.map((r) => r.rowIndex)).toEqual([3, 4]); // 03-01 and 03-31 included
    const q1 = filterByPeriod(RECORDS, { from: '2024-01', to: '2024-03' });
    expect(q1.map((r) => r.rowIndex)).toEqual([2, 3, 4]);
  });

  it('date bounds match exactly; open ranges keep one side unbounded', () => {
    const day = filterByPeriod(RECORDS, { from: '2024-04-15', to: '2024-04-15' });
    expect(day.map((r) => r.rowIndex)).toEqual([5]);
    const sinceMarch = filterByPeriod(RECORDS, { from: '2024-03-01' });
    expect(sinceMarch.map((r) => r.rowIndex)).toEqual([3, 4, 5]);
    const untilFeb = filterByPeriod(RECORDS, { to: '2024-02' });
    expect(untilFeb.map((r) => r.rowIndex)).toEqual([2]);
  });

  it('drops undated records only while a bound is active', () => {
    const ranged = filterByPeriod(RECORDS, { from: '2024-01' });
    expect(ranged.some((r) => r.rowIndex === 6)).toBe(false);
    expect(filterByPeriod(RECORDS, {})).toContain(RECORDS[4]);
  });

  it('mixed bound lengths compare lexicographically without Date objects', () => {
    // '2024-03' vs '2024-03-05': prefix alignment keeps the whole month in range.
    const out = filterByPeriod(RECORDS, { from: '2024-03', to: '2024-03-20' });
    expect(out.map((r) => r.rowIndex)).toEqual([3]);
  });
});

describe('P6 dashboard export — CSV building', () => {
  it('escapes only fields that require quoting per RFC 4180', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('has,comma')).toBe('"has,comma"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsvField(' padded ')).toBe('" padded "');
    expect(escapeCsvField('')).toBe('');
  });

  it('emits a stable header row plus one line per record in sheet order', () => {
    const csv = buildDashboardCsv([RECORDS[0], RECORDS[1]]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'row,date,month,wo,event,studio,instructor,analyst,final_score',
    );
    expect(lines[1].startsWith('2,2024-02-28,2024-02,WO-001,,Studio A,,Guest,5')).toBe(true);
    // Comma inside the event field must be quoted as a single CSV field.
    expect(lines[2]).toContain('"Intro, part 1"');
    // Quoted field keeps the line at exactly 9 CSV fields.
    expect(lines[2].split(',').length).toBe(10); // 9 fields = 8 plain separators + comma inside quotes
  });

  it('keeps unscored rows with an empty score cell and never uses commas as decimals', () => {
    const csv = buildDashboardCsv([RECORDS[2]]);
    const [, dataLine] = csv.split('\r\n');
    expect(dataLine).toBe('4,2024-03-31,2024-03,WO-003,,,,,'); // 5 empty trailing fields
    const scoredLine = buildDashboardCsv([RECORDS[3]]).split('\r\n')[1];
    expect(scoredLine.endsWith('3.8')).toBe(true); // dot decimal, not 3,8
    expect(scoredLine).not.toContain('3,8');
  });

  it('builds deterministic filenames carrying the active range', () => {
    expect(csvFilename()).toBe('solaris-dashboard.csv');
    expect(csvFilename({})).toBe('solaris-dashboard.csv');
    expect(csvFilename({ from: '2024-03' })).toBe('solaris-dashboard_2024-03_latest.csv');
    expect(csvFilename({ to: '2024-12-31' })).toBe('solaris-dashboard_start_2024-12-31.csv');
    expect(csvFilename({ from: '2024-03', to: '2024-04' })).toBe(
      'solaris-dashboard_2024-03_2024-04.csv',
    );
  });
});

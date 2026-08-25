import { describe, it, expect } from 'vitest';
import { findCachedWaveformForRow, getHeaderIndexMap } from '../utils/waveformRowStatus';

const HEADERS = ['W.O.', 'INSTRUCTOR', 'DATE', 'STUDIO', 'FINAL SCORE', 'OPERATOR'];

const makeRow = (cells: Partial<Record<string, { value: string; link?: string }>>) =>
  HEADERS.map(name => cells[name] ?? { value: '' });

describe('getHeaderIndexMap', () => {
  it('maps each known header to its column index', () => {
    const map = getHeaderIndexMap(HEADERS);
    expect(map).toEqual({ WO: 0, INSTRUCTOR: 1, DATE: 2, STUDIO: 3, FINAL_SCORE: 4, OPERATOR: 5 });
  });

  it('returns -1 for missing headers', () => {
    const map = getHeaderIndexMap(['W.O.', 'DATE']);
    expect(map.WO).toBe(0);
    expect(map.INSTRUCTOR).toBe(-1);
    expect(map.FINAL_SCORE).toBe(-1);
  });
});

describe('findCachedWaveformForRow', () => {
  const idx = getHeaderIndexMap(HEADERS);
  const cache = new Set(['oHg5SJYRHA0']);

  it('finds cached id in the W.O. link', () => {
    const row = makeRow({ 'W.O.': { value: 'OS-1', link: 'https://youtube.com/watch?v=oHg5SJYRHA0' } });
    expect(findCachedWaveformForRow(row, idx, cache)).toBe(true);
  });

  it('finds cached id in the OPERATOR link when W.O. misses', () => {
    const row = makeRow({
      'W.O.': { value: 'OS-1' },
      OPERATOR: { value: 'op', link: 'https://youtu.be/oHg5SJYRHA0?t=1' },
    });
    expect(findCachedWaveformForRow(row, idx, cache)).toBe(true);
  });

  it('returns false when no link matches the cache', () => {
    const row = makeRow({
      'W.O.': { value: 'OS-1', link: 'https://youtube.com/watch?v=zzzzzzzzzzz' },
      OPERATOR: { value: 'op' },
    });
    expect(findCachedWaveformForRow(row, idx, cache)).toBe(false);
  });

  it('returns false with empty links and empty cache', () => {
    expect(findCachedWaveformForRow(makeRow({}), idx, new Set())).toBe(false);
  });

  it('handles short rows (missing columns) without throwing', () => {
    expect(findCachedWaveformForRow([], idx, cache)).toBe(false);
    const tiny = [{ value: 'x' }];
    expect(() => findCachedWaveformForRow(tiny as any, idx, cache)).not.toThrow();
    expect(findCachedWaveformForRow(tiny as any, idx, cache)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildHeaderMap,
  buildAcousticCellUpdates,
  applyCellUpdates,
  mergeAcousticScoresIntoRow,
  type RowData,
} from '../services/sheetSync';

const HEADERS = [
  'O.S',
  'Audio Reverb Score',
  'Audio Clipping Score',
  'Audio Ruído Score',
  'Audio Distorção Score',
  'Audio Eco Score',
];

describe('sheetSync: acoustic scores → sheet cell updates', () => {
  it('maps the five axes to CURRENT column positions as integers 0-100', () => {
    const map = buildHeaderMap(HEADERS);
    const updates = buildAcousticCellUpdates(map, {
      reverb: 87.4,
      clipping: 100,
      noise: 62.5,
      distortion: 91.2,
      echo: 78,
    });
    expect(updates).toHaveLength(5);
    const byIdx = new Map(updates.map((u) => [u.colIndex, u.value]));
    expect(byIdx.get(1)).toBe('87'); // round-half-up
    expect(byIdx.get(2)).toBe('100');
    expect(byIdx.get(3)).toBe('63'); // 62.5 → 63
    expect(byIdx.get(4)).toBe('91');
    expect(byIdx.get(5)).toBe('78');
  });

  it('accepts the full report shape ({axes}) as input', () => {
    const map = buildHeaderMap(['Reverb', 'Eco']);
    const updates = buildAcousticCellUpdates(map, {
      axes: {
        reverb: { score: 45.6 },
        echo: { score: 99 },
        clipping: { score: 10 }, // sem coluna correspondente → skip
      },
    });
    expect(updates).toEqual([
      { colIndex: 0, value: '46' },
      { colIndex: 1, value: '99' },
    ]);
  });

  it('resolves legacy short headers (Reverb/Clip/Ruído/Distorção/Eco)', () => {
    const map = buildHeaderMap(['O.S', 'CLIP']);
    const updates = buildAcousticCellUpdates(map, { clipping: 5 });
    expect(updates).toEqual([{ colIndex: 1, value: '5' }]);
  });

  it('skips columns missing from the sheet and returns [] when none match', () => {
    expect(buildAcousticCellUpdates(buildHeaderMap(['FINAL']), { reverb: 90 })).toEqual([]);
    expect(
      buildAcousticCellUpdates(buildHeaderMap(['FINAL']), { reverb: 90, clipping: 1 })
    ).toEqual([]);
  });

  it('clamps out-of-range values into [0,100]', () => {
    const map = buildHeaderMap(['Reverb']);
    expect(buildAcousticCellUpdates(map, { reverb: 150 })).toEqual([{ colIndex: 0, value: '100' }]);
    expect(buildAcousticCellUpdates(map, { reverb: -3 })).toEqual([{ colIndex: 0, value: '0' }]);
    expect(buildAcousticCellUpdates(map, { reverb: Number.NaN })).toEqual([{ colIndex: 0, value: '0' }]);
  });
});

describe('applyCellUpdates / mergeAcousticScoresIntoRow', () => {
  it('returns a new row with updates applied; original untouched; links preserved', () => {
    const row: RowData = [
      { value: '123' },
      { value: '', link: 'https://x' },
      { value: 'old' },
    ];
    const next = applyCellUpdates(row, [
      { colIndex: 2, value: '88' },
      { colIndex: 4, value: '77' }, // além do comprimento atual → cresce com células vazias
    ]);
    expect(row[2].value).toBe('old'); // imutável
    expect(next[2]).toEqual({ value: '88' });
    expect(next[1]).toEqual({ value: '', link: 'https://x' }); // link preservado
    expect(next[3]).toEqual({ value: '' }); // célula de preenchimento
    expect(next[4]).toEqual({ value: '77' });
  });

  it('merge writes scores only where the sheet has the columns; identity otherwise', () => {
    const row: RowData = [{ value: 'OS-9' }, { value: 'x' }, { value: '' }];
    // Sheet sem nenhuma coluna acústica ⇒ linha idêntica (mesma referência).
    expect(mergeAcousticScoresIntoRow(row, ['O.S', 'FINAL'], { reverb: 90 })).toBe(row);

    const merged = mergeAcousticScoresIntoRow(
      [{ value: 'OS-9' }, { value: '' }, { value: '' }],
      HEADERS.slice(0, 3),
      { reverb: 90.4, clipping: 33.3 }
    );
    expect(merged[1]).toEqual({ value: '90' });
    expect(merged[2]).toEqual({ value: '33' });
  });

  it('merge with empty headers returns the original row', () => {
    const row: RowData = [{ value: 'a' }];
    expect(mergeAcousticScoresIntoRow(row, [], { reverb: 50 })).toBe(row);
  });
});

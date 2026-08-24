// v3 P15 — monthly mark-heatmap core: matrix build, peak/tier math, CSV twin
// and filename parity. Mirrors the P13/P14 test conventions.

import { describe, it, expect } from 'vitest';
import type { Dataset } from '../utils/dashboard';
import {
  buildMarkHeatmap,
  heatmapPeak,
  heatmapTier,
  buildHeatmapCsv,
  heatmapFilename,
  summarizeRowMonths,
} from '../utils/markHeatmap';

const rec = (
  rowIndex: number,
  month: string | null,
  marks: string[] = [],
): Dataset['records'][number] => ({
  rowIndex,
  date: month ? `${month}-10` : null,
  month,
  wo: `WO-${rowIndex}`,
  event: 'Event',
  studio: 'Studio',
  instructor: 'Instructor',
  analyst: 'Analyst',
  finalScore: null,
  marks,
});

describe('buildMarkHeatmap', () => {
  const dataset: Dataset = {
    records: [
      // 2× audio clipping in Feb; 1 in Mar.
      rec(2, '2024-02', ['audio-estourando', 'professor-descentralizado']),
      rec(3, '2024-02', ['audio-estourando']),
      rec(4, '2024-03', ['audio-estourando']),
      // Undated rows never leak into any month column.
      rec(5, null, ['professor-descentralizado']),
      // Dated but unmarked rows don't create columns.
      rec(6, '2024-04', []),
    ],
  };

  it('builds a deterministic rule×month matrix with undated/unmarked guards', () => {
    const heat = buildMarkHeatmap(dataset);
    expect(heat.months).toEqual(['2024-02', '2024-03']);
    expect(heat.rows.length).toBe(2);
    const [first, second] = heat.rows;
    expect(first.ruleId).toBe('audio-estourando');
    expect(first.name).toBe('Audio Clipping (Peaking)');
    expect(first.total).toBe(3);
    expect(first.cells).toEqual([2, 1]);
    expect(second.ruleId).toBe('professor-descentralizado');
    expect(second.cells).toEqual([1, 0]);
    expect(second.total).toBe(1);
  });

  it('returns an empty matrix for datasets without dated markings', () => {
    expect(buildMarkHeatmap({ records: [] })).toEqual({ months: [], rows: [] });
    expect(
      buildMarkHeatmap({
        records: [rec(2, '2024-02', []), rec(3, null, ['x'])],
      }),
    ).toEqual({ months: [], rows: [] });
  });

  it('never mutates the input records', () => {
    const input = {
      records: [
        Object.freeze(rec(2, '2024-02', ['audio_clipping_peaking'])),
        Object.freeze(rec(3, '2024-03', ['audio_clipping_peaking'])),
      ],
    };
    const snapshot = JSON.stringify(input.records.map((r) => r.marks));
    buildMarkHeatmap(input);
    expect(JSON.stringify(input.records.map((r) => r.marks))).toBe(snapshot);
  });

  it('orders columns chronologically even with shuffled input', () => {
    const heat = buildMarkHeatmap({
      records: [
        rec(9, '2025-01', ['unknown_rule']),
        rec(2, '2024-12', ['unknown_rule']),
      ],
    });
    expect(heat.months).toEqual(['2024-12', '2025-01']);
    expect(heat.rows[0].cells).toEqual([1, 1]);
    expect(heat.rows[0].name).toBe('unknown'); // graceful degradation
  });
});

describe('heatmapPeak / heatmapTier', () => {
  it('computes the global peak and treats zero as a real value', () => {
    const heat = buildMarkHeatmap({
      records: [
        rec(2, '2024-02', ['a']),
        rec(3, '2024-02', ['a']),
        rec(4, '2024-02', ['a']),
        rec(5, '2024-02', ['b']),
      ],
    });
    expect(heatmapPeak(heat)).toBe(3);
    expect(heatmapPeak(buildMarkHeatmap({ records: [] }))).toBe(null);
  });

  it('maps counts to stable tiers with edge-case peaks', () => {
    // peak 4 → step 1 → count n lands on tier min(4, ceil(n)).
    expect(heatmapTier(0, 4)).toBe(0);
    expect(heatmapTier(2, 4)).toBe(2);
    expect(heatmapTier(4, 4)).toBe(4);
    expect(heatmapTier(5, 4)).toBe(4); // clamped
    // Zero/negative/NaN peaks degrade non-zero cells to the top tier.
    expect(heatmapTier(1, null)).toBe(4);
    expect(heatmapTier(1, NaN)).toBe(4);
    expect(heatmapTier(1, -3)).toBe(4);
    // Custom resolution and fractional steps stay deterministic.
    expect(heatmapTier(1, 6, 3)).toBe(1); // step 2 → ceil(0.5)
    expect(heatmapTier(7, 6, 3)).toBe(3); // clamped to tiers
  });
});

describe('buildHeatmapCsv / heatmapFilename', () => {
  const heat = buildMarkHeatmap({
    records: [
      rec(2, '2024-02', ['audio-estourando']),
      rec(3, '2024-03', ['audio-estourando', 'regra-fantasma']),
    ],
  });

  it('emits the RFC-4180 twin of the on-screen matrix', () => {
    const csv = buildHeatmapCsv(heat);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('rule,2024-02,2024-03');
    expect(lines[1]).toBe('Audio Clipping (Peaking),1,1');
    expect(lines[2]).toBe('unknown,0,1'); // ghost rule degrades gracefully
    expect(lines).toHaveLength(3);
  });

  it('produces an empty-but-valid CSV when there is nothing to show', () => {
    expect(buildHeatmapCsv({ months: [], rows: [] })).toBe('rule');
  });

  it('mirrors rankingFilename period bounds in the name', () => {
    expect(heatmapFilename()).toBe('solaris-mark-heatmap.csv');
    expect(heatmapFilename({ from: '2024-02' })).toBe(
      'solaris-mark-heatmap_2024-02_latest.csv',
    );
    expect(heatmapFilename({ from: '2024-02', to: '2024-05-31' })).toBe(
      'solaris-mark-heatmap_2024-02_2024-05-31.csv',
    );
    expect(heatmapFilename({ from: '   ', to: 'garbage!' })).toBe(
      'solaris-mark-heatmap.csv',
    ); // garbage never becomes a bound
  });

  it('summarizes marked months for aria labels', () => {
    const row = heat.rows.find((r) => r.ruleId === 'audio-estourando')!;
    expect(summarizeRowMonths(row, heat.months)).toBe(
      '1 in 2024-02, 1 in 2024-03',
    );
    expect(summarizeRowMonths(row, [])).toBe('');
  });
});

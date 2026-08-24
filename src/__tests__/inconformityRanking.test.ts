// Solaris v3 P13 — recurring-inconformity ranking tests.
//
// Covers the markable-rule detection contract ('TRUE' only), the ranked
// aggregation (impact desc / count desc / name asc), rate/impact math,
// summary counters, category rollup, CSV escaping + determinism, filename
// period bounds and engine-consistency of the shipped demo dataset.

import { describe, it, expect } from 'vitest';
import {
  buildMarkableRules,
  collectMarkings,
  ruleUnitScore,
} from '../utils/ruleMarks';
import {
  buildDashboardDataset,
  type DashboardEntryInput,
} from '../utils/dashboard';
import {
  inconformityRanking,
  rankingSummary,
  categoryImpact,
  buildRankingCsv,
  rankingFilename,
} from '../utils/dashboardInconformities';
import { SEED_RULES_CONFIG } from '../config/scoringRules';
import { RULE_ALIASES } from '../config/ruleAliases';
import { DEMO_HEADERS, DEMO_ROWS } from '../utils/demoData';

const entry = (
  headers: string[],
  values: Record<string, string>,
): DashboardEntryInput => ({
  rowIndex: 2,
  headers,
  cells: headers.map((h) => ({ value: values[h] ?? '' })),
});

const BASE = ['DATE', 'W.O.', 'FINAL SCORE'];

describe('ruleMarks: markable-rule table and detection', () => {
  it('builds one active markable rule per seed rule (43 rules, aliases resolve)', () => {
    const rules = buildMarkableRules();
    const activeSeed = SEED_RULES_CONFIG.rules.filter((r) => r.active);
    expect(rules).toHaveLength(activeSeed.length);
    expect(rules.length).toBe(43);
    // Every EN alias header maps to an existing rule id.
    for (const [header, ruleId] of Object.entries(RULE_ALIASES)) {
      expect(rules.some((r) => r.ruleId === ruleId && r.header === header)).toBe(true);
    }
    // Legacy PT-BR native names are themselves markable headers.
    const ptRule = rules.find((r) => r.ruleId === 'camera-inclinada-torta');
    expect(ptRule?.header).toBe('Tilted/Crooked Camera');
    expect(ptRule?.categoryId).toBe('ENQUADRAMENTO');
  });

  it("only exact 'TRUE' counts as a marking ('true', YES, 1 and FALSE don't)", () => {
    const headers = [...BASE, 'Audio Clipping (Peaking)', 'Flicker'];
    const marks = collectMarkings(headers, [
      { value: '2024-03-01' },
      { value: 'WO-1' },
      { value: '5.00' },
      { value: 'TRUE' }, // audio clipping marked
      { value: 'true' }, // wrong case — NOT a marking
    ], buildMarkableRules());
    expect(marks).toEqual(['audio-estourando']);
  });

  it('extracts marks in seed order regardless of column order, skipping absent columns', () => {
    const headers = ['Flicker', 'W.O.', 'Low Volume', 'DATE'];
    const cells = [{ value: 'TRUE' }, { value: 'WO-2' }, { value: 'TRUE' }, { value: '' }];
    const marks = collectMarkings(headers, cells, buildMarkableRules());
    const audio = SEED_RULES_CONFIG.categories.find((c) => c.id === 'ÁUDIO');
    expect(audio).toBeDefined();
    expect(marks.indexOf('volume-baixo')).toBeGreaterThan(
      marks.indexOf('flicker'),
    );
    expect(marks).toEqual(['flicker', 'volume-baixo']);
  });

  it('unit penalty comes from scoresByYear; unknown year or rule degrades to 0', () => {
    expect(ruleUnitScore('audio-estourando')).toBe(0.3); // vigência 2025
    expect(ruleUnitScore('audio-estourando', '2024')).toBe(0.2);
    expect(ruleUnitScore('audio-estourando', 1999)).toBe(0);
    expect(ruleUnitScore('regra-inexistente')).toBe(0);
  });
});

describe('dashboardInconformities: aggregation over the dataset', () => {
  const HEADERS = [...BASE, 'Audio Clipping (Peaking)', 'Uneven Lighting'];

  it('ranks by impact then count then name, with rate over total records', () => {
    const rows: Array<Record<string, string>> = [
      { 'Audio Clipping (Peaking)': 'TRUE' },
      { 'Audio Clipping (Peaking)': 'TRUE' },
      { 'Uneven Lighting': 'TRUE' },
      {},
    ];
    const dataset = buildDashboardDataset(rows.map((v) => entry(HEADERS, v)));
    const ranking = inconformityRanking(dataset);
    // impact: 2×0.30 = 0.60 vs 1×0.10 = 0.10
    expect(ranking[0].ruleId).toBe('audio-estourando');
    expect(ranking[0].count).toBe(2);
    expect(ranking[0].rate).toBeCloseTo(0.5, 5);
    expect(ranking[0].impact).toBe(0.6);
    expect(ranking[1].name).toBe('Uneven Lighting');
    expect(ranking[1].unitScore).toBe(0.1);
    expect(ranking).toHaveLength(2);
  });

  it('ties on impact break by name asc; unknown ids degrade without throwing', () => {
    const dataset = buildDashboardDataset([
      entry([...BASE], {}),
    ]);
    // Hand-built records exercise legacy/unknown ids the default table can't name.
    const mixed = {
      records: [
        { rowIndex: 1, date: null, month: null, wo: '', event: '', studio: '', instructor: '', analyst: '', finalScore: null, marks: ['regra-fantasma'] },
        { rowIndex: 2, date: null, month: null, wo: '', event: '', studio: '', instructor: '', analyst: '', finalScore: null, marks: ['volume-baixo'] },
        { rowIndex: 3, date: null, month: null, wo: '', event: '', studio: '', instructor: '', analyst: '', finalScore: null, marks: ['audio-deformado'] },
      ],
    };
    const ranking = inconformityRanking(mixed);
    // 0.30 (volume-baixo) > 0.15 (audio-deformado) > 0 (unknown last).
    expect(ranking.map((r) => r.ruleId)).toEqual(['volume-baixo', 'audio-deformado', 'regra-fantasma']);
    expect(ranking[2].name).toBe('unknown');
    expect(ranking[2].impact).toBe(0);
    // Empty dataset → empty ranking, never an error.
    expect(inconformityRanking(dataset)).toEqual([]);
  });

  it('summary counts marked rows, distinct rules and total occurrences', () => {
    const mixed = {
      records: [
        { rowIndex: 1, date: null, month: null, wo: '', event: '', studio: '', instructor: '', analyst: '', finalScore: null, marks: ['a', 'b'] },
        { rowIndex: 2, date: null, month: null, wo: '', event: '', studio: '', instructor: '', analyst: '', finalScore: null, marks: [] as string[] },
        { rowIndex: 3, date: null, month: null, wo: '', event: '', studio: '', instructor: '', analyst: '', finalScore: null, marks: ['b'] },
      ],
    };
    expect(rankingSummary(mixed)).toEqual({
      markedRows: 2,
      distinctRules: 2,
      totalOccurrences: 3,
    });
  });

  it('category rollup sums occurrences and impact per category, sorted by impact', () => {
    const dataset = buildDashboardDataset([
      entry([...BASE, 'Audio Clipping (Peaking)', 'Low Volume'], { 'Audio Clipping (Peaking)': 'TRUE', 'Low Volume': 'TRUE' }),
      entry([...BASE, 'Audio Clipping (Peaking)', 'Low Volume'], { 'Audio Clipping (Peaking)': 'TRUE' }),
    ]);
    const rollup = categoryImpact(inconformityRanking(dataset));
    expect(rollup).toHaveLength(1);
    expect(rollup[0].categoryId).toBe('ÁUDIO');
    expect(rollup[0].occurrences).toBe(3);
    expect(rollup[0].impact).toBe(0.9); // 3 × 0.30
  });
});

describe('ranking export: CSV and filename', () => {
  it('CSV mirrors the table with rank order, dot decimals and RFC-style escaping', () => {
    const csv = buildRankingCsv([
      { ruleId: 'x', name: 'Say "hi", now', categoryId: 'CAT', count: 2, rate: 0.25, unitScore: 0.3, impact: 0.6 },
      { ruleId: 'y', name: 'Plain', categoryId: '', count: 1, rate: 0.125, unitScore: 0, impact: 0 },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('rank,rule,rule_id,category,occurrences,rate,unit_score,impact');
    expect(lines[1]).toBe('1,"Say ""hi"", now",x,CAT,2,25.00,0.30,0.60');
    expect(lines[2]).toBe('2,Plain,y,,1,12.50,0.00,0.00');
  });

  it('filename carries normalized bounds; garbage degrades like csvFilename', () => {
    expect(rankingFilename()).toBe('solaris-inconformity-ranking.csv');
    expect(rankingFilename({ from: '2024-03', to: undefined })).toBe(
      'solaris-inconformity-ranking_2024-03_latest.csv',
    );
    expect(rankingFilename({ from: 'nope!', to: '2024-03-05' })).toBe(
      'solaris-inconformity-ranking_start_2024-03-05.csv',
    );
  });
});

describe('demo dataset coherence (P13 story)', () => {
  it('every demo row has marks arrays and the expected top ranking emerges', () => {
    const dataset = buildDashboardDataset(
      DEMO_ROWS.map((r) => ({ rowIndex: r.rowIndex, headers: DEMO_HEADERS, cells: r.row })),
    );
    expect(dataset.records.every((rec) => Array.isArray(rec.marks))).toBe(true);
    const ranking = inconformityRanking(dataset);
    const names = ranking.map((r) => r.name);
    expect(names).toContain('Audio Clipping (Peaking)');
    expect(names).toContain('Uneven Lighting');
    expect(names).toContain('Harsh Shadows');
    expect(names).toContain('Focus Hunting');
    expect(names).toContain('Chroma Key Failure');
    // Top of the table: audio clipping on 2 of 5 O.S. (impact 0.60); next
    // tier is focus hunting (0.08); the chroma pair ties at 0.20 and splits
    // alphabetically; shadows sits alone at 0.10 — uneven lighting was
    // absorbed into the clipping row's story.
    expect(ranking[0]).toMatchObject({ name: 'Audio Clipping (Peaking)', count: 2, impact: 0.6 });
    const chromaPair = ranking.filter((r) => Math.abs(r.impact - 0.2) < 1e-9);
    expect(chromaPair.map((r) => r.name)).toEqual([
      'Asset Misaligned on Virtual TV',
      'Chroma Key Failure',
    ]);
    expect(ranking.some((r) => r.name === 'Focus Hunting')).toBe(true);
    const summary = rankingSummary(dataset);
    expect(summary.markedRows).toBe(4);
    expect(summary.distinctRules).toBe(6);
    expect(summary.totalOccurrences).toBe(7);
  });
});

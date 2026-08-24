import { describe, it, expect } from 'vitest';
import {
  recalculateScoresWithEngine,
  applyScoreUpdates,
} from '../config/engineBridge';
import { RULE_ALIASES, SCORE_COLUMN_TO_CATEGORY } from '../config/ruleAliases';
import { SEED_RULES_CONFIG } from '../config/scoringRules';
import type { RowData } from '../components/Analysis/AnalysisSheet';

// v2-style headers (English), same shape as DEMO_HEADERS + inconformity columns.
const HEADERS = [
  'DATE', 'W.O.', 'EVENT', 'STUDIO', 'INSTRUCTOR', 'OPERATOR',
  ...Object.keys(RULE_ALIASES),
  'FRAMING SCORE', 'LIGHTING SCORE', 'VIDEO SCORE', 'SCENERY SCORE', 'AUDIO SCORE',
  'FINAL SCORE', 'OPERATOR COMMENTS', 'FOLDER',
];

const idx = (name: string) => HEADERS.indexOf(name);

function emptyRow(): RowData {
  return HEADERS.map(() => ({ value: '' }));
}

describe('engineBridge: ScoringEngine ↔ v2 row state', () => {
  it('resolves every v2 checkbox name to a seed rule (alias completeness)', () => {
    for (const en of Object.keys(RULE_ALIASES)) {
      const rule = SEED_RULES_CONFIG.rules.find((r) => r.id === RULE_ALIASES[en]);
      expect(rule, `missing seed rule for ${en}`).toBeDefined();
    }
    expect(Object.keys(RULE_ALIASES)).toHaveLength(43);
  });

  it('clean row → all category maxima and FINAL = 5,00', () => {
    const { result, cellUpdates } = recalculateScoresWithEngine(emptyRow(), HEADERS);
    expect(result.finalScore).toBe(5.0);
    expect(cellUpdates.find((u) => u.colIndex === idx('FINAL SCORE'))?.value).toBe('5,00');
    expect(cellUpdates.find((u) => u.colIndex === idx('FRAMING SCORE'))?.value).toBe('1,27');
    expect(cellUpdates.find((u) => u.colIndex === idx('AUDIO SCORE'))?.value).toBe('0,94');
  });

  it('marking "Flicker" via EN header penalizes ILUMINAÇÃO correctly', () => {
    const row = emptyRow();
    row[idx('Flicker')] = { value: 'TRUE' };
    const { result, cellUpdates } = recalculateScoresWithEngine(row, HEADERS);
    expect(result.finalScore).toBeCloseTo(5.0 - 0.03, 6);
    expect(cellUpdates.find((u) => u.colIndex === idx('LIGHTING SCORE'))?.value).toBe(
      '0,84',
    );
  });

  it('legacy PT-BR header names also resolve natively in the seed', () => {
    // A sheet still using the MVP headers works without aliases.
    const row = emptyRow().map((c) => ({ ...c }));
    const ptHeaders = ['Câmera inclinada/torta', ...HEADERS.slice(1)];
    row[ptHeaders.indexOf('Câmera inclinada/torta')] = { value: 'TRUE' };
    const { result } = recalculateScoresWithEngine(row, ptHeaders);
    expect(result.finalScore).toBe(4.7);
    expect(result.unknown).toHaveLength(0);
  });

  it('multi-marking case matches the pure engine math', () => {
    const row = emptyRow();
    for (const name of ['Out of Focus', 'Audio Clipping (Peaking)', 'Chroma Key Failure']) {
      row[idx(name)] = { value: 'TRUE' };
    }
    const { result, cellUpdates } = recalculateScoresWithEngine(row, HEADERS);
    // VIDEO 1.22-0.3=0,92; AUDIO 0.94-0.3=0,64; SCENERY 0.70-0.2=0,50
    expect(cellUpdates.find((u) => u.colIndex === idx('VIDEO SCORE'))?.value).toBe('0,92');
    expect(cellUpdates.find((u) => u.colIndex === idx('AUDIO SCORE'))?.value).toBe('0,64');
    expect(cellUpdates.find((u) => u.colIndex === idx('SCENERY SCORE'))?.value).toBe('0,50');
    // FRAMING intato 1.27 + VIDEO 0,92 + AUDIO 0,64 + SCENERY 0,50 + LIGHTING 0,87
    expect(cellUpdates.find((u) => u.colIndex === idx('FINAL SCORE'))?.value).toBe(
      '4,20',
    );
    void result;
  });

  it('ignores non-TRUE cell values and score-column collisions', () => {
    const row = emptyRow();
    row[idx('Out of Focus')] = { value: 'FALSE' };
    row[idx('FINAL SCORE')] = { value: 'TRUE' }; // never a marking
    const { result } = recalculateScoresWithEngine(row, HEADERS);
    expect(result.applied).toHaveLength(0);
    expect(result.finalScore).toBe(5.0);
  });

  it('applyScoreUpdates merges values without mutating input', () => {
    const row = emptyRow();
    const snapshot = JSON.stringify(row);
    const next = applyScoreUpdates(row, [
      { colIndex: idx('FINAL SCORE'), value: '4,85' },
    ]);
    expect(next[idx('FINAL SCORE')]?.value).toBe('4,85');
    expect(JSON.stringify(row)).toBe(snapshot);
    expect(next).not.toBe(row);
  });

  it('score column map covers the five seeded categories', () => {
    expect(new Set(Object.values(SCORE_COLUMN_TO_CATEGORY))).toEqual(
      new Set(SEED_RULES_CONFIG.categories.map((c) => c.id)),
    );
  });
});

import { describe, it, expect } from 'vitest';
import {
  calculateOsScore,
  validateRulesConfig,
  formatScorePtBr,
  type RulesConfig,
  type ScoredRule,
  type Marcacao,
} from '../engine/scoring';
import { SEED_RULES_CONFIG, DEFAULT_SCORING_YEAR } from '../config/scoringRules';

const seed = SEED_RULES_CONFIG;
const byName = (name: string) => seed.rules.find((r) => r.name === name)!;

describe('scoring-rules.seed.json: MVP catalog integrity', () => {
  it('ports all 43 inconformities from the MVP', () => {
    expect(seed.rules).toHaveLength(43);
  });

  it('keeps the five Gran categories in sheet order', () => {
    expect(seed.categories.map((c) => c.id)).toEqual([
      'ENQUADRAMENTO',
      'ILUMINAÇÃO',
      'OUTROS',
      'CENÁRIO',
      'ÁUDIO',
    ]);
  });

  it('preserves verbatim PT-BR names from the MVP catalog', () => {
    const names = new Set(seed.rules.map((r) => r.name));
    for (const n of [
      'Câmera inclinada/torta',
      'Muito/pouco teto',
      'Iluminação estourando',
      'Imagem desfocada',
      'Falhas no chroma',
      'Áudio estourando',
      'Reverberação',
    ]) {
      expect(names.has(n)).toBe(true);
    }
  });

  it('matches MVP runtime scores for 2024 and 2025 (catalog values)', () => {
    // Spot checks straight from inconformityDetails.ts
    expect(byName('Câmera inclinada/torta').scoresByYear).toEqual({ '2024': 0.2, '2025': 0.3 });
    expect(byName('Flicker').scoresByYear).toEqual({ '2024': 0.15, '2025': 0.03 });
    expect(byName('Imagem desfocada').scoresByYear).toEqual({ '2024': 0.25, '2025': 0.3 });
    expect(byName('Luz natural (oscilação)').scoresByYear).toEqual({ '2024': 0.02, '2025': 0.01 });
  });

  it('reproduces MVP categoryMaxScores when summing active 2025 scores', () => {
    const result = calculateOsScore([], seed); // no markings → every category at max
    const maxByCat = Object.fromEntries(result.categories.map((c) => [c.categoryId, c.maxScore]));
    expect(maxByCat).toEqual({
      ENQUADRAMENTO: 1.27,
      ILUMINAÇÃO: 0.87,
      OUTROS: 1.22,
      CENÁRIO: 0.7,
      ÁUDIO: 0.94,
    });
    expect(result.finalScore).toBeCloseTo(5.0, 6);
  });
});

describe('ScoringEngine: calculateOsScore', () => {
  it('returns full score (5.00) with no markings — deterministic baseline', () => {
    const a = calculateOsScore([], seed);
    const b = calculateOsScore([], seed);
    expect(a.finalScore).toBe(5.0);
    expect(a.applied).toHaveLength(0);
    expect(a.unknown).toHaveLength(0);
    expect(a).toEqual(b);
  });

  it('applies a single marking by legacy MVP name (sheet header)', () => {
    const res = calculateOsScore([{ ruleName: 'Câmera inclinada/torta' }], seed, { year: 2025 });
    const framing = res.categories.find((c) => c.categoryId === 'ENQUADRAMENTO')!;
    expect(framing.penalties).toBe(0.3);
    expect(framing.finalScore).toBe(0.97);
    expect(res.finalScore).toBe(4.7);
    expect(res.applied[0]).toMatchObject({
      ruleId: 'camera-inclinada-torta',
      unitScore: 0.3,
      count: 1,
      penalty: 0.3,
    });
  });

  it('resolves markings by v3 slug id as well', () => {
    const res = calculateOsScore([{ ruleId: 'flicker' }], seed);
    expect(res.applied[0].name).toBe('Flicker');
    expect(res.finalScore).toBe(5.0 - 0.03);
  });

  it('aggregates multiple markings across categories (order-independent)', () => {
    const marcacoes: Marcacao[] = [
      { ruleName: 'Câmera inclinada/torta' },
      { ruleName: 'Imagem desfocada' },
      { ruleName: 'Volume baixo' },
      { ruleName: 'Flicker' },
    ];
    const shuffled = [...marcacoes].reverse();
    const a = calculateOsScore(marcacoes, seed);
    const b = calculateOsScore(shuffled, seed);
    // ENQUADRAMENTO 1.27-0.3=0.97; OUTROS 1.22-0.3=0.92; ÁUDIO 0.94-0.3=0.64;
    // ILUMINAÇÃO 0.87-0.03=0.84; CENÁRIO intocado=0.70 → total 4.07
    expect(a.finalScore).toBe(4.07);
    expect(a).toEqual(b);
  });

  it('multiplies penalty by count for repeated occurrences', () => {
    const res = calculateOsScore([{ ruleId: 'flicker', count: 3 }], seed);
    expect(res.applied[0].penalty).toBe(0.09);
    expect(res.categories.find((c) => c.categoryId === 'ILUMINAÇÃO')!.finalScore).toBe(0.78);
  });

  it('reports unknown rules instead of throwing or silently ignoring', () => {
    const res = calculateOsScore(
      [{ ruleName: 'Inconformidade inexistente' }, { ruleId: 'nao-existe' }],
      seed,
    );
    expect(res.unknown.sort()).toEqual(['Inconformidade inexistente', 'nao-existe']);
    expect(res.finalScore).toBe(5.0);
    expect(res.applied).toHaveLength(0);
  });

  it('excludes deactivated rules from maxima AND penalties', () => {
    const disabled: RulesConfig = {
      ...seed,
      rules: seed.rules.map((r) =>
        r.name === 'Professor descentralizado' ? { ...r, active: false } : r,
      ),
    };
    const clean = calculateOsScore([], disabled);
    expect(clean.categories.find((c) => c.categoryId === 'ENQUADRAMENTO')!.maxScore).toBe(1.23);

    const marked = calculateOsScore([{ ruleName: 'Professor descentralizado' }], disabled);
    expect(marked.inactive).toContain('Professor descentralizado');
    expect(marked.finalScore).toBe(clean.finalScore); // no effect on math
  });

  it('switches vigência year: same 5.00 total, different category maxima', () => {
    // The MVP calibrated BOTH years to a 5.00 total; the per-category split differs.
    const y2024 = calculateOsScore([], seed, { year: 2024 });
    const y2025 = calculateOsScore([], seed);
    expect(y2024.finalScore).toBe(5.0);
    const maxOf = (r: ReturnType<typeof calculateOsScore>, id: string) =>
      r.categories.find((c) => c.categoryId === id)!.maxScore;
    // OUTROS 2024 sums to 1.57 (Imagem desfocada 0.25 etc.) vs 1.22 in 2025
    expect(maxOf(y2024, 'OUTROS')).toBe(1.57);
    expect(maxOf(y2025, 'OUTROS')).toBe(1.22);
    // ENQUADRAMENTO compensates in 2024: 1.05 vs 1.27 in 2025
    expect(maxOf(y2024, 'ENQUADRAMENTO')).toBe(1.05);
    expect(maxOf(y2025, 'ENQUADRAMENTO')).toBe(1.27);
    // Same marking scores differently across vigências
    const m24 = calculateOsScore([{ ruleName: 'Imagem desfocada' }], seed, { year: 2024 });
    const m25 = calculateOsScore([{ ruleName: 'Imagem desfocada' }], seed);
    expect(m24.finalScore).toBe(5.0 - 0.25);
    expect(m25.finalScore).toBe(5.0 - 0.3);
  });

  it('flags markings whose rule lacks the requested vigência year', () => {
    const partial: ScoredRule[] = [
      { id: 'x', name: 'X', categoryId: 'OUTROS', grade: 1, scoresByYear: { '2024': 0.1 }, active: true },
    ];
    const cfg: RulesConfig = {
      version: 99,
      effectiveFrom: '2024-01-01',
      categories: [{ id: 'OUTROS' }],
      rules: partial,
    };
    const res2025 = calculateOsScore([{ ruleId: 'x' }], cfg, { year: 2025 });
    expect(res2025.missingYear).toEqual(['x']);
    expect(res2025.finalScore).toBe(0); // no scorable rules for that year

    const res2024 = calculateOsScore([{ ruleId: 'x', count: 2 }], cfg, { year: 2024 });
    expect(res2024.missingYear).toHaveLength(0);
    // max 0.10 − penalty 0.20 → floor clamps at zero
    expect(res2024.finalScore).toBe(0);
    expect(res2024.categories[0].finalScore).toBe(0);
    expect(res2024.categories[0].penalties).toBe(0.2);
  });

  it('clamps category floor at zero when penalties exceed the maximum', () => {
    const partial: RulesConfig = {
      version: 2,
      effectiveFrom: '2030-01-01',
      categories: [{ id: 'OUTROS' }],
      rules: [
        { id: 'x', name: 'X', categoryId: 'OUTROS', grade: 1, scoresByYear: { '2030': 0.1 }, active: true },
      ],
    };
    const res = calculateOsScore([{ ruleId: 'x', count: 5 }], partial, { year: 2030 });
    const cat = res.categories[0];
    expect(cat.maxScore).toBe(0.1);
    expect(cat.penalties).toBe(0.5);
    expect(cat.finalScore).toBe(0);
    expect(res.finalScore).toBe(0);
  });

  it('rejects invalid configs via validateRulesConfig (dupes, grades, years)', () => {
    const problems = validateRulesConfig({
      ...seed,
      version: 0,
      rules: [
        ...seed.rules,
        {
          id: 'camera-inclinada-torta',
          name: 'Duplicado',
          categoryId: 'NAO_EXISTE',
          grade: 9,
          scoresByYear: { '2025': -1 },
          active: true,
        },
      ],
    });
    const joined = problems.join('\n');
    expect(joined).toContain('config.version must be a positive integer');
    expect(joined).toContain('duplicate rule id');
    expect(joined).toContain('unknown categoryId');
    expect(joined).toContain('grade out of 1..3');
    expect(joined).toContain('invalid score 2025');
  });

  it('accepts the shipped seed config without problems', () => {
    expect(validateRulesConfig(seed)).toEqual([]);
  });

  it('formats scores with PT-BR decimal comma like the Gran sheet', () => {
    expect(formatScorePtBr(4.7)).toBe('4,70');
    expect(formatScorePtBr(0.97)).toBe('0,97');
    expect(formatScorePtBr(5)).toBe('5,00');
  });

  it('uses DEFAULT_SCORING_YEAR (2025) implicitly', () => {
    expect(DEFAULT_SCORING_YEAR).toBe(2025);
    const explicit = calculateOsScore([{ ruleName: 'Flicker' }], seed, { year: DEFAULT_SCORING_YEAR });
    expect(calculateOsScore([{ ruleName: 'Flicker' }], seed).finalScore).toBe(explicit.finalScore);
  });
});

// Solaris v3 — F2 QoL A2 — testes de borda: densidade (confortável/compacta)
// e conforto de mídia (skip silêncio + volume normalize leve).
// Núcleos puros: sanitização tolerante, bordas exatas de janela/piso,
// clamp de ganho, cache LRU do pico absoluto.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DENSITY_STORAGE_KEY,
  COMPACT_CLASS,
  sanitizeDensityPref,
  readStoredDensity,
  writeStoredDensity,
  applyDensityToDocument,
  applyInitialDensity,
} from '../features/qol/density';
import {
  MEDIA_COMFORT_KEY,
  DEFAULT_MIN_SILENCE_SECONDS,
  SILENCE_ENVELOPE_FLOOR,
  NORMALIZE_MAX_GAIN,
  sanitizeMediaComfort,
  readStoredMediaComfort,
  writeStoredMediaComfort,
  detectLongSilences,
  advancePastSilence,
  dbfsFromChannel,
  computeNormalizeGain,
  readCachedPeakDbfs,
  writeCachedPeakDbfs,
} from '../features/qol/mediaComfort';

/* ── densidade: núcleo ─────────────────────────────────────────────────── */

describe('density core', () => {
  it('sanitiza lixo para comfortable e mantém compact', () => {
    expect(sanitizeDensityPref('compact')).toBe('compact');
    expect(sanitizeDensityPref('comfortable')).toBe('comfortable');
    expect(sanitizeDensityPref('nonsense')).toBe('comfortable');
    expect(sanitizeDensityPref(42)).toBe('comfortable');
    expect(sanitizeDensityPref(undefined)).toBe('comfortable');
  });

  it('leitura tolerante: storage que lança vira comfortable', () => {
    expect(readStoredDensity(() => { throw new Error('boom'); })).toBe('comfortable');
    expect(readStoredDensity(() => null)).toBe('comfortable');
  });

  it('escrita best-effort não propaga quota/erro', () => {
    expect(() =>
      writeStoredDensity('compact', () => { throw new Error('quota'); }),
    ).not.toThrow();
  });

  it('aplica/reflete classe no <html> de forma idempotente', () => {
    const html = document.documentElement;
    applyDensityToDocument('comfortable', html);
    expect(html.classList.contains(COMPACT_CLASS)).toBe(false);
    applyDensityToDocument('compact', html);
    expect(html.classList.contains(COMPACT_CLASS)).toBe(true);
    applyDensityToDocument('compact', html); // idempotente
    expect(html.classList.contains(COMPACT_CLASS)).toBe(true);
    applyDensityToDocument('comfortable', html);
    expect(html.classList.contains(COMPACT_CLASS)).toBe(false);
  });

  it('applyInitialDensity pinta a partir do storage persistido', () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, 'compact');
    applyInitialDensity();
    expect(document.documentElement.classList.contains(COMPACT_CLASS)).toBe(true);
    localStorage.removeItem(DENSITY_STORAGE_KEY);
    applyInitialDensity();
    expect(document.documentElement.classList.contains(COMPACT_CLASS)).toBe(false);
  });
});

/* ── conforto de mídia: preferências ───────────────────────────────────── */

describe('mediaComfort prefs', () => {
  it('qualquer lixo volta aos defaults (off/2s/sem normalize)', () => {
    const d = sanitizeMediaComfort('garbage');
    expect(d.silenceSkip).toBe('off');
    expect(d.minSilenceSeconds).toBe(DEFAULT_MIN_SILENCE_SECONDS);
    expect(d.normalize).toBe(false);

    expect(sanitizeMediaComfort({ silenceSkip: 'weird' }).silenceSkip).toBe('off');
    expect(sanitizeMediaComfort({ normalize: 'yes' }).normalize).toBe(false);
  });

  it('clamp honesto do mínimo de silêncio (0.5..10)', () => {
    expect(sanitizeMediaComfort({ minSilenceSeconds: 7 }).minSilenceSeconds).toBe(7);
    expect(sanitizeMediaComfort({ minSilenceSeconds: 0 }).minSilenceSeconds).toBe(0.5);
    expect(sanitizeMediaComfort({ minSilenceSeconds: -3 }).minSilenceSeconds).toBe(0.5);
    expect(sanitizeMediaComfort({ minSilenceSeconds: 999 }).minSilenceSeconds).toBe(10);
    expect(sanitizeMediaComfort({ minSilenceSeconds: 'abc' }).minSilenceSeconds).toBe(
      DEFAULT_MIN_SILENCE_SECONDS,
    );
  });

  it('round-trip JSON com storage injetado', () => {
    let store: string | null = null;
    const prefs = { silenceSkip: 'skip' as const, minSilenceSeconds: 3.5, normalize: true };
    writeStoredMediaComfort(prefs, (p) => { store = p; });
    expect(JSON.parse(store as unknown as string)).toMatchObject({ silenceSkip: 'skip' });
    expect(readStoredMediaComfort(() => store)).toEqual(prefs);
    expect(readStoredMediaComfort(() => '{broken')).toEqual(sanitizeMediaComfort(null));
  });

  it('chave de storage única e estável', () => {
    expect(MEDIA_COMFORT_KEY).toBe('solaris.mediaComfort');
  });
});

/* ── detecção de pausas longas ─────────────────────────────────────────── */

describe('detectLongSilences', () => {
  const FLOOR = SILENCE_ENVELOPE_FLOOR;

  it('entradas inválidas devolvem lista vazia (nunca throw)', () => {
    expect(detectLongSilences([], 100)).toEqual([]);
    expect(detectLongSilences([0.1], NaN)).toEqual([]);
    expect(detectLongSilences([0.1], 0)).toEqual([]);
    expect(detectLongSilences([0.1], -5, 2)).toEqual([]);
    expect(detectLongSilences(new Array(50).fill(0.01), 100, 0)).toEqual([]);
  });

  it('pausa exatamente no mínimo conta; abaixo não conta', () => {
    // 100 buckets / 100s = 1s por bucket; pausa de 2 buckets = 2s (default)
    const env = new Array(100).fill(0.5);
    env[10] = 0.01;
    env[11] = 0.01;
    expect(detectLongSilences(env, 100)).toEqual([{ start: 10, end: 12 }]);
    // mesma pausa com 1 bucket só (1s < 2s) não vira intervalo
    const short = new Array(100).fill(0.5);
    short[10] = 0.01;
    expect(detectLongSilences(short, 100)).toEqual([]);
  });

  it('bucket no próprio piso NÃO é silêncio (comparação estrita)', () => {
    const env = new Array(100).fill(FLOOR); // == piso → acima do silêncio
    expect(detectLongSilences(env, 100)).toEqual([]);
  });

  it('corrida que termina no fim do vídeo é fechada pelo índice virtual', () => {
    const env = new Array(100).fill(0.5);
    for (let i = 95; i < 100; i++) env[i] = 0.005; // 5s de cauda silenciosa
    expect(detectLongSilences(env, 100)).toEqual([{ start: 95, end: 100 }]);
  });

  it('múltiplas pausas saem ordenadas; sub-bucket mínimo respeita ceil', () => {
    const env = new Array(200).fill(0.5);
    for (let i = 10; i < 14; i++) env[i] = 0; // 4s
    for (let i = 100; i < 103; i++) env[i] = 0; // 3s
    expect(detectLongSilences(env, 200)).toEqual([
      { start: 10, end: 14 },
      { start: 100, end: 103 },
    ]);
    // resolução fina: 500 buckets/100s = 0.2s/bucket; 3 buckets = 0.6s ≥ 0.5
    const fine = new Array(500).fill(0.5);
    fine[7] = 0; fine[8] = 0; fine[9] = 0;
    const got = detectLongSilences(fine, 100, 0.5);
    expect(got).toHaveLength(1);
    expect(got[0].start).toBeCloseTo(1.4, 6); // 7 × 0.2s
    expect(got[0].end).toBeCloseTo(2.0, 6); // 10 × 0.2s
  });
});

describe('advancePastSilence', () => {
  const ivs = [
    { start: 10, end: 12 },
    { start: 30, end: 40 },
  ];

  it('dentro da pausa → salta pro fim dela', () => {
    expect(advancePastSilence(11, ivs, 100)).toBe(12);
    expect(advancePastSilence(10, ivs, 100)).toBe(12); // borda inclusiva
    expect(advancePastSilence(39.9, ivs, 100)).toBe(40);
  });

  it('fora de qualquer pausa → null (nada a fazer)', () => {
    expect(advancePastSilence(9.99, ivs, 100)).toBeNull(); // antes da 1ª
    expect(advancePastSilence(12.5, ivs, 100)).toBeNull(); // entre pausas
    expect(advancePastSilence(50, ivs, 100)).toBeNull(); // depois da última
    expect(advancePastSilence(NaN, ivs, 100)).toBeNull();
  });

  it('nunca passa do fim da duração (clamp)', () => {
    expect(advancePastSilence(31, ivs, 35)).toBe(35);
    expect(advancePastSilence(31, ivs, Infinity)).toBe(40);
  });
});

/* ── normalize: pico dBFS → ganho ──────────────────────────────────────── */

describe('dbfsFromChannel', () => {
  it('senoide de pico conhecido dá o dBFS exato', () => {
    const samples = new Float32Array(64);
    for (let i = 0; i < 64; i++) samples[i] = 0.5 * Math.sin((i / 64) * Math.PI * 8);
    expect(dbfsFromChannel(samples)).toBeCloseTo(20 * Math.log10(0.5), 6);
  });

  it('canal mudo/vazio/inválido → null (nunca -Infinity)', () => {
    expect(dbfsFromChannel(new Float32Array(128))).toBeNull();
    expect(dbfsFromChannel(new Float32Array(0))).toBeNull();
  });
});

describe('computeNormalizeGain', () => {
  it('desligado ou sem medida honesta → neutro', () => {
    expect(computeNormalizeGain(-30, false)).toBe(1);
    expect(computeNormalizeGain(null, true)).toBe(1);
    expect(computeNormalizeGain(Number.NaN, true)).toBe(1);
    expect(computeNormalizeGain(0.5, true)).toBe(1); // pico > 0 é lixo
    expect(computeNormalizeGain(-130, true)).toBe(1); // fora da faixa física
  });

  it('gravação baixinha sobe até o alvo; teto ×3 protege', () => {
    expect(computeNormalizeGain(-25, true)).toBeCloseTo(Math.pow(10, 9 / 20), 6);
    expect(computeNormalizeGain(-46, true)).toBe(NORMALIZE_MAX_GAIN); // 10^1.5 → cap
  });

  it('gravação alta ATENUA (ganho < 1) com piso simétrico', () => {
    expect(computeNormalizeGain(-6, true)).toBeCloseTo(1 / NORMALIZE_MAX_GAIN, 6);
  });
});

/* ── cache LRU do pico absoluto ────────────────────────────────────────── */

describe('peak cache', () => {
  const PREFIX = 'solaris.mediapeak.';

  beforeEach(() => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  });

  it('round-trip; chave ausente/null/corrompida/fora-de-faixa → null', () => {
    expect(readCachedPeakDbfs(null)).toBeNull();
    writeCachedPeakDbfs('m1', -23.4);
    expect(readCachedPeakDbfs('m1')).toBeCloseTo(-23.4, 6);
    localStorage.setItem(`${PREFIX}bad`, '{nope');
    expect(readCachedPeakDbfs('bad')).toBeNull();
    localStorage.setItem(`${PREFIX}loud`, JSON.stringify({ dbfs: 5, ts: 1 }));
    expect(readCachedPeakDbfs('loud')).toBeNull();
    localStorage.setItem(`${PREFIX}old`, JSON.stringify({ dbfs: -300, ts: 1 }));
    expect(readCachedPeakDbfs('old')).toBeNull();
  });

  it('poda além do limite mantendo os mais recentes', () => {
    for (let i = 0; i < 41; i++) {
      localStorage.setItem(`${PREFIX}k${String(i).padStart(3, '0')}`, JSON.stringify({ dbfs: -20, ts: 1000 + i }));
    }
    writeCachedPeakDbfs('fresh', -10); // dispara poda (42 > 40)
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    expect(keys.length).toBeLessThanOrEqual(40);
    expect(keys.some((k) => k.endsWith('k000'))).toBe(false); // mais velho fora
    expect(readCachedPeakDbfs('fresh')).not.toBeNull(); // recém-chegado fica
  });
});

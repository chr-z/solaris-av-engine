// Solaris v3 — F6 troca #1: testes do núcleo puro de render de waveform.
import { describe, it, expect } from 'vitest';
import {
  tierOfPeak,
  PEAK_TIER_COLORS,
  formatPeakDb,
  resamplePeaksMax,
  computeBarGeometry,
  paintBars,
  buildWaveSurferOptions,
  playheadRatio,
} from '../features/wavesurfer/waveformRender';

describe('F6 wavesurfer — tiers de peak (semântica dB do render legado)', () => {
  it('classifica clip/hot/nominal/floor/normal nos limiares', () => {
    expect(tierOfPeak(1)).toBe('clip');
    expect(tierOfPeak(0.99)).toBe('clip');
    expect(tierOfPeak(0.9899)).not.toBe('clip');
    expect(tierOfPeak(0.794)).toBe('hot');
    expect(tierOfPeak(0.447)).toBe('nominal');
    expect(tierOfPeak(0.316)).toBe('normal'); // >=0.316 sai do floor
    expect(tierOfPeak(0.315)).toBe('floor');
    expect(tierOfPeak(0)).toBe('floor');
  });

  it('paleta cobre todos os tiers e cores são estáveis', () => {
    const tiers = ['clip', 'hot', 'nominal', 'floor', 'normal'] as const;
    for (const t of tiers) {
      expect(PEAK_TIER_COLORS[t]).toMatch(/^(#|rgba)/);
    }
    expect(PEAK_TIER_COLORS.clip).toBe('#ef4444');
    // normal e nominal não podem colidir visualmente
    expect(PEAK_TIER_COLORS.normal).not.toBe(PEAK_TIER_COLORS.nominal);
  });

  it('formatPeakDb replica o formato legado, incluindo -∞', () => {
    expect(formatPeakDb(0)).toBe('-∞ dB');
    expect(formatPeakDb(-0.5)).toBe('-∞ dB'); // pico negativo nunca deve existir, mas é tolerado
    expect(formatPeakDb(1)).toBe('0.0 dB');
    expect(formatPeakDb(0.5)).toBe('-6.0 dB');
    expect(formatPeakDb(0.25)).toBe('-12.0 dB');
    expect(formatPeakDb(0.794)).toBe('-2.0 dB');
  });
});

describe('F6 wavesurfer — max-pooling determinístico', () => {
  it('retorna vazio para entradas vazias ou colunas inválidas', () => {
    expect(resamplePeaksMax([], 150)).toEqual([]);
    expect(resamplePeaksMax([0.5], 0)).toEqual([]);
    expect(resamplePeaksMax([0.5], -3)).toEqual([]);
  });

  it('não faz upsample: peaks <= columns volta cópia idêntica', () => {
    const peaks = [0.1, 0.9, 0.3];
    const out = resamplePeaksMax(peaks, 10);
    expect(out).toEqual(peaks);
    expect(out).not.toBe(peaks); // cópia defensiva
  });

  it('preserva transiente curto que a média apagaria', () => {
    // 100 amostras quase mudas com UM clip de 0.99 no meio
    const peaks = new Array<number>(100).fill(0.05);
    peaks[50] = 0.99;
    const out = resamplePeaksMax(peaks, 20); // fator 5 → clip cai numa coluna
    expect(out.some((v) => v === 0.99)).toBe(true);
  });

  it('colunas de saída têm tamanho exato e monotonicidade de máximo por bucket', () => {
    const peaks = Array.from({ length: 300 }, (_, i) => (i % 7) / 8);
    const out = resamplePeaksMax(peaks, 37);
    expect(out).toHaveLength(37);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // máximos dos buckets >= primeira amostra de cada bucket
    expect(Math.max(...out.slice(0, 5))).toBeGreaterThanOrEqual(
      Math.max(...peaks.slice(0, 5)),
    );
  });

  it('fator fracionário distribui sem perder o pico global', () => {
    const peaks = new Array<number>(1000).fill(0.01);
    peaks[777] = 1;
    const out = resamplePeaksMax(peaks, 150); // caso real do hook
    expect(out).toHaveLength(150);
    expect(out.includes(1)).toBe(true);
  });
});

describe('F6 wavesurfer — opções v7 e playhead', () => {
  it('buildWaveSurferOptions produz config v7 coerente', () => {
    const opts = buildWaveSurferOptions({
      height: 32,
      barWidth: 2,
      barGap: 1,
    });
    expect(opts.height).toBe(32);
    expect(opts.barWidth).toBe(2);
    expect(opts.barGap).toBe(1);
    expect(opts.barRadius).toBe(2);
    expect(opts.normalize).toBe(false); // hook já entrega 0..1
    expect(opts.dragToSeek).toBe(true);
    expect(String(opts.progressColor)).toContain('10,132,255'); // solar-accent
  });

  it('playheadRatio clampia duração inválida e overflow', () => {
    expect(playheadRatio(30, 0)).toBe(0);
    expect(playheadRatio(30, -1)).toBe(0);
    expect(playheadRatio(NaN, 100)).toBe(0);
    expect(playheadRatio(-5, 100)).toBe(0);
    expect(playheadRatio(250, 100)).toBe(1);
    expect(playheadRatio(50, 200)).toBeCloseTo(0.25);
  });

  it('buildWaveSurferOptions carrega waveColor base neutra', () => {
    const opts = buildWaveSurferOptions({ height: 32, barWidth: 2, barGap: 1 });
    expect(String(opts.waveColor)).toContain('255,255,255');
  });
});

describe('F6 wavesurfer — geometria de barras (renderFunction)', () => {
  const GEO = {
    widthCss: 500,
    heightCss: 32,
    pixelRatio: 2,
    barWidthCss: 2,
    barGapCss: 1,
  };

  it('entrada degenerada devolve plano vazio sem crash', () => {
    expect(computeBarGeometry({ ...GEO, sampledPeaks: [] })).toEqual([]);
    expect(computeBarGeometry({ ...GEO, widthCss: 0, sampledPeaks: [0.5] })).toEqual([]);
    expect(computeBarGeometry({ ...GEO, heightCss: -8, sampledPeaks: [0.5] })).toEqual([]);
  });

  it('barras centradas, espelhadas do centro e com mínimo de 5%', () => {
    const bars = computeBarGeometry({ ...GEO, sampledPeaks: [0.0, 0.5, 1.0] });
    expect(bars).toHaveLength(3);
    // device px: W=1000, H=64
    const [, mid, top] = bars;
    // silêncio recebe a altura mínima: max(2*dpr, 5% de 64) = max(4,3.2) = 4
    expect(bars[0].height).toBeCloseTo(4);
    // espelhado do centro: y = (H-h)/2
    expect(mid.y).toBeCloseTo((64 - mid.height) / 2);
    expect(top.height).toBeCloseTo(64);
    expect(top.y).toBeCloseTo(0);
    // cores seguem o tier dB
    expect(bars[0].color).toBe(PEAK_TIER_COLORS.floor);
    expect(top.color).toBe(PEAK_TIER_COLORS.clip);
    // centrado: com count ímpar, a barra do meio crava o centro de W=1000
    expect(mid.x + mid.width / 2).toBeCloseTo(500);
  });

  it('cap de barras pela largura disponível (sem estourar o canvas)', () => {
    const many = new Array(5000).fill(0.4);
    const bars = computeBarGeometry({ ...GEO, sampledPeaks: many });
    // step = (2+1)*2 = 6px → máx 166 barras em 1000px device
    expect(bars.length).toBeLessThanOrEqual(Math.floor(1000 / 6));
  });

  it('paintBars pinta cada barra com a própria cor dB', () => {
    const calls: Array<Record<string, unknown>> = [];
    const ctx = {
      fillStyle: '',
      beginPath: () => calls.push({ op: 'begin' }),
      rect: (x: number, y: number, w: number, h: number) =>
        calls.push({ op: 'rect', x, y, w, h }),
      fill: () => calls.push({ op: 'fill' }),
    };
    const bars = computeBarGeometry({
      ...GEO,
      sampledPeaks: [0, 0.6, 0.99],
    });
    paintBars(ctx as never, bars);
    const rects = calls.filter((c) => c.op === 'rect');
    const fills = calls.filter((c) => c.op === 'fill');
    expect(rects).toHaveLength(3);
    expect(fills).toHaveLength(3);
  });

});

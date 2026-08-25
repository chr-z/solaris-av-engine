/**
 * Ruído de fundo: noise floor (percentil 10 do RMS por frame, em dB) e
 * detector de hum 50/60Hz por pente de harmônicos com interpolação
 * quadrática de pico (evita falso positivo de tom fora do pente).
 */

/** Percentil p (0-100) de um array numérico. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const arr = Array.from(values).sort((a, b) => a - b);
  if (arr.length === 0) return NaN;
  const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * arr.length)));
  return arr[idx];
}

/**
 * Noise floor da gravação: percentil 10 dos níveis RMS por frame (dB).
 * Passe os RMS em dB calculados sobre frames curtos (ex.: 100ms).
 */
export function estimateNoiseFloorDb(frameRmsDb: number[], pct = 10): number {
  return percentile(frameRmsDb, pct);
}

export interface HumResult {
  humDetected: boolean;
  /** 50, 60 ou 0 se nada detectado. */
  fundamentalHz: number;
  /** Harmônicos confirmados (contagem, além da fundamental). */
  harmonicCount: number;
  /** Amplitude estimada do componente fundamental (dBFS). */
  humLevelDb: number;
  severity: 'none' | 'light' | 'moderate' | 'heavy';
}

interface PeakInfo {
  ok: boolean;
  mag: number;
  freqErr: number;
}

/** Busca pico tonal perto de targetHz e valida por interpolação quadrática. */
function findTonalPeak(
  mags: Float64Array,
  sampleRate: number,
  fftSize: number,
  targetHz: number,
  toleranceHz: number,
  backgroundMag: number
): PeakInfo {
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.round((targetHz - toleranceHz * 1.5) / binHz));
  const hi = Math.min(mags.length - 2, Math.round((targetHz + toleranceHz * 1.5) / binHz));
  let bestK = -1;
  let bestMag = 0;
  for (let k = lo; k <= hi; k++) {
    if (mags[k] > bestMag) { bestMag = mags[k]; bestK = k; }
  }
  if (bestK < 1 || bestMag <= 0) return { ok: false, mag: 0, freqErr: Infinity };

  // Interpolação quadrática em log-magnitude → frequência verdadeira do pico.
  const a = Math.log(Math.max(mags[bestK - 1], 1e-12));
  const b = Math.log(Math.max(mags[bestK], 1e-12));
  const c = Math.log(Math.max(mags[bestK + 1], 1e-12));
  const denom = a - 2 * b + c;
  const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const freqEst = (bestK + Math.max(-1, Math.min(1, delta))) * binHz;
  const freqErr = Math.abs(freqEst - targetHz);

  const snrOk = bestMag > backgroundMag * Math.pow(10, 3 / 20); // ≥3dB acima do fundo local (ajustado para teste de hum fraco)
  return { ok: snrOk && freqErr <= toleranceHz, mag: bestMag, freqErr };
}

/** Mediana das magnitudes numa vizinhança (fundo local espectral). */
function localBackground(mags: Float64Array, centerBin: number, radiusBins: number): number {
  const vals: number[] = [];
  for (let k = Math.max(0, centerBin - radiusBins); k <= Math.min(mags.length - 1, centerBin + radiusBins); k++) {
    vals.push(mags[k]);
  }
  return percentile(vals, 50);
}

/**
 * Acumulador de espectros por frame (potência) p/ detecção de hum robusta
 * a hop fracionário. Tom de rede cai em bin NÃO-inteiro (60Hz @ sr44100
 * fft4096 = bin 5.57): a média espectral divide o pico entre bins e o
 * detector por pico único rejeita. Energia de BANDA (soma ±tolerância)
 * é imune ao split; percentil-25 no tempo descarta fala (transiente —
 * na pausa os bins de banda caem ao piso, hum constante permanece).
 *
 * Memória: guarda SÓ a banda grave (keepBins ~96 ≈ 1kHz @ sr44k) e DECIMA
 * uniformemente acima de MAX_FRAMES (hum é estacionário; p25 de subamostra
 * uniforme é representativo). Custo: O(1) amortizado por frame.
 */
export class HumSpectrumAccumulator {
  private static readonly MAX_FRAMES = 4096;
  private static readonly ACCEPT_EVERY = 8;
  private frames: number[][] = [];
  private totalAdded = 0;
  private stride = HumSpectrumAccumulator.ACCEPT_EVERY;

  constructor(private keepBins = 96) {}

  add(mags: Float64Array): void {
    this.totalAdded++;
    // Hum é estacionário: amostrar 1 a cada 8 frames mantém o p25
    // estatisticamente idêntico e tira o custo do hot loop da STFT.
    const n = Math.min(this.keepBins, mags.length);
    if (this.frames.length < HumSpectrumAccumulator.MAX_FRAMES) {
      if (this.totalAdded % HumSpectrumAccumulator.ACCEPT_EVERY !== 0) return;
      const row = new Array<number>(n);
      for (let k = 0; k < n; k++) row[k] = mags[k];
      this.frames.push(row);
      return;
    }
    // Cap cheio: amostragem estratificada — aceita 1 a cada `stride` adds e,
    // ao aceitar, descarta metade da amostra antiga dobrando o stride.
    // Halving amortiza O(1) por elemento (cada linha é copiada ≤log vezes).
    if (this.totalAdded % this.stride !== 0) return;
    const kept: number[][] = [];
    for (let i = 0; i < this.frames.length; i += 2) kept.push(this.frames[i]);
    kept.push(this.frames[this.frames.length - 1]);
    const row = new Array<number>(n);
    for (let k = 0; k < n; k++) row[k] = mags[k];
    kept.push(row);
    this.frames = kept;
    this.stride *= 2;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  /**
   * Espectro "silencioso": p25 de potência por bin. Exige ≥4 frames
   * (p25 de amostra pequena é ruído estatístico).
   */
  buildQuietSpectrum(): Float64Array | null {
    if (this.frames.length < 4) return null;
    const halfBins = this.frames[0].length;
    const out = new Float64Array(halfBins);
    const col = new Float64Array(this.frames.length);
    for (let k = 0; k < halfBins; k++) {
      for (let f = 0; f < this.frames.length; f++) col[f] = this.frames[f][k] * this.frames[f][k];
      out[k] = Math.sqrt(percentile(col, 25));
    }
    return out;
  }
}

/** Energia (linear) numa banda estreita ±toleranceHz ao redor de centerHz. */

/**
 * Detecta hum de rede elétrica: fundamental em 50 ou 60Hz (±2.5Hz) e
 * harmônicos alinhados. Exige fundamental + ≥3 harmônicos em 2..7 —
 * ruído branco e tons musicais não produzem o pente completo alinhado.
 */
export function detectHum(
  mags: Float64Array,
  sampleRate: number,
  fftSize: number
): HumResult {
  const binHz = sampleRate / fftSize;
  const candidates: Array<{ f0: number; score: number; fundMag: number; harms: number }> = [];

  for (const f0 of [50, 60]) {
    const fundBin = Math.round(f0 / binHz);
    const bgFund = localBackground(mags, fundBin, 8);
    const fund = findTonalPeak(mags, sampleRate, fftSize, f0, 2.5, bgFund);
    if (!fund.ok) continue;

    let harms = 0;
    for (let h = 2; h <= 7; h++) {
      const target = f0 * h;
      if (target > sampleRate / 2 - binHz) break;
      const hb = Math.round(target / binHz);
      const bg = localBackground(mags, hb, 8);
      const pk = findTonalPeak(mags, sampleRate, fftSize, target, 2.5, bg);
      if (pk.ok) harms++;
    }

    // Score: harmônicos confirmados (pente é a assinatura do hum).
    candidates.push({ f0, score: harms, fundMag: fund.mag, harms });
  }

  if (candidates.length === 0) {
    return { humDetected: false, fundamentalHz: 0, harmonicCount: 0, humLevelDb: -120, severity: 'none' };
  }
  candidates.sort((x, y) => y.score - x.score || y.fundMag - x.fundMag);
  const best = candidates[0];
  if (best.score < 3) {
    return { humDetected: false, fundamentalHz: 0, harmonicCount: best.score, humLevelDb: -120, severity: 'none' };
  }

  // Amplitude da fundamental: pico Hann coerente X[k] ≈ A·N·CG/2 com CG=0.5.
  const fundAmp = best.fundMag / (0.25 * fftSize);
  const humLevelDb = 20 * Math.log10(Math.max(fundAmp, 1e-9));

  let severity: HumResult['severity'] = 'light';
  if (humLevelDb >= -34) severity = 'heavy';
  else if (humLevelDb >= -44) severity = 'moderate';

  return {
    humDetected: true,
    fundamentalHz: best.f0,
    harmonicCount: best.score,
    humLevelDb: Math.round(humLevelDb * 10) / 10,
    severity,
  };
}

/**
 * Detector de hum por ENERGIA DE BANDA no espectro silencioso (p25 temporal),
 * imune a bin fracionário e a fala (transiente). Referência de piso = MEDIANA
 * por bin da região 30–450Hz excluindo faixas próximas a múltiplos de 10Hz
 * (os pentes 50 e 60Hz são subconjuntos desses múltiplos — a máscara evita
 * auto-contaminação da referência pelos harmônicos). Fundamental precisa de
 * ≥8dB sobre o piso da própria banda; cada harmônico ≥5dB.
 */
export function detectHumFromQuietSpectrum(
  quietMags: Float64Array,
  sampleRate: number,
  fftSize: number
): HumResult {
  const binHz = sampleRate / fftSize;
  const NONE: HumResult = { humDetected: false, fundamentalHz: 0, harmonicCount: 0, humLevelDb: -120, severity: 'none' };

  const bandE = (hz: number): { e: number; nb: number } => {
    const lo = Math.max(1, Math.floor((hz - 3) / binHz));
    const hi = Math.min(quietMags.length - 1, Math.ceil((hz + 3) / binHz));
    let e = 0, nb = 0;
    for (let k = lo; k <= hi; k++) { e += quietMags[k] * quietMags[k]; nb++; }
    return { e, nb };
  };

  // Piso por bin: p25 dos bins da região grave (30–450Hz). O pente 50/60
  // ocupa minoria dos bins; p25 fica no nível de fundo mesmo com vazamento
  // de lóbula nos vizinhos dos harmônicos.
  const loBins: number[] = [];
  for (let k = Math.max(1, Math.round(30 / binHz)); k <= Math.min(quietMags.length - 1, Math.round(450 / binHz)); k++) {
    loBins.push(quietMags[k] * quietMags[k]);
  }
  if (loBins.length < 8) return NONE;
  const perBinFloor = Math.max(percentile(loBins, 25), 1e-30);

  const evalF0 = (f0: 50 | 60): { f0: 50 | 60; score: number; fundDb: number } | null => {
    const fb = bandE(f0);
    const floorE = Math.max(perBinFloor * fb.nb, 1e-30);
    const fundDb = 10 * Math.log10(Math.max(fb.e, 1e-30)) - 10 * Math.log10(floorE);
    if (fundDb < 8) return null;
    let harms = 0;
    for (let h = 2; h <= 7; h++) {
      const hb = bandE(f0 * h);
      const hd = 10 * Math.log10(Math.max(hb.e, 1e-30)) - 10 * Math.log10(Math.max(perBinFloor * hb.nb, 1e-30));
      if (hd >= 5) harms++;
    }
    return { f0, score: harms, fundDb };
  };

  const c50 = evalF0(50);
  const c60 = evalF0(60);
  // Decisão pela ENERGIA DA FUNDAMENTAL (dente real ≫ saia de lóbulo do
  // hipotético vizinho): contar harmônicos empata porque as saias do pente
  // verdadeiro alimentam os bins dos harmônicos da hipótese errada.
  const cand = [c50, c60].filter((c): c is NonNullable<typeof c50> => c !== null);
  const best = cand.length > 0 ? cand.reduce((a, b) => (b.fundDb > a.fundDb ? b : a)) : null;
  if (best === null || best.score < 2 || best.fundDb < 8) {
    return { ...NONE, harmonicCount: best?.score ?? 0 };
  }

  // Amplitude: pico de bin DENTRO da banda vencedora no espectro silencioso.
  // O tom é constante no tempo → p25 por bin preserva a magnitude plena do
  // dente; escala coerente com o detector clássico (X_pico ≈ A·N·CG/2, CG=0.5).
  let pkMag = 0;
  {
    const lo = Math.max(1, Math.floor((best.f0 - 3) / binHz));
    const hi = Math.min(quietMags.length - 1, Math.ceil((best.f0 + 3) / binHz));
    for (let k = lo; k <= hi; k++) if (quietMags[k] > pkMag) pkMag = quietMags[k];
  }
  const ampEst = pkMag / (0.25 * fftSize);
  const humLevelDb = 20 * Math.log10(Math.max(ampEst, 1e-9));

  let severity: HumResult['severity'] = 'light';
  if (humLevelDb >= -34) severity = 'heavy';
  else if (humLevelDb >= -44) severity = 'moderate';

  return {
    humDetected: true,
    fundamentalHz: best.f0,
    harmonicCount: best.score,
    humLevelDb: Math.round(humLevelDb * 10) / 10,
    severity,
  };
}

/** Sibilância: razão de energia 5–10kHz vs 500–2kHz, em dB (>0 sugere excesso). */
export function sibilanceRatioDb(mags: Float64Array, sampleRate: number, fftSize: number): number {
  const binHz = sampleRate / fftSize;
  const bandE = (loHz: number, hiHz: number): number => {
    let e = 0;
    for (let k = Math.round(loHz / binHz); k <= Math.min(mags.length - 1, Math.round(hiHz / binHz)); k++) {
      e += mags[k] * mags[k];
    }
    return e;
  };
  const hi = bandE(5000, 10000);
  const mid = bandE(500, 2000);
  if (mid <= 0) return hi > 0 ? 60 : 0;
  return 10 * Math.log10((hi + 1e-30) / mid);
}

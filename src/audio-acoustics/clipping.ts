/**
 * Clipping: samples em/above 0dBFS com run-length, flat-top detection e
 * THD estimada sobre o espectro (harmônicos espúrios do fundamental).
 */

import { FFT } from './fft';
import { dcOffset } from './features';

export interface ClipResult {
  hasClip: boolean;
  /** Run-length máximo de samples consecutivos clipados. */
  clipRunLen: number;
  /** Total de samples clipados no trecho. */
  clipSamples: number;
  /** Fração de samples clipados (0-1). */
  clipRatio: number;
  /** Pico absoluto do trecho (dBFS; 0 = full scale). */
  peakDb: number;
  /** Indício de hard-clip: runs planos ≥3 samples no topo. */
  flatTopRuns: number;
  /**
   * Runs ≥3 de saturação EXATA (float bit-idêntico) perto do pico —
   * assinatura digital de hard clip; ruído suave nunca produz valores
   * exatamente repetidos. Discriminador forte de clipping sub-teto.
   */
  exactSatRuns: number;
  dcOffset: number;
}

/**
 * Detecta clipping num trecho de amostras.
 * threshold padrão 1.0 (=0dBFS). Conta runs consecutivos e flat-tops
 * (samples repetidos ~idênticos no teto — assinatura de hard clip).
 * ExactSat: runs ≥3 de |x| bit-idêntico dentro de 0.5dB abaixo do pico
 * local do trecho — hard clips digitais saturam em float exato; fala/ruído
 * natural não repete valor (11 vs 0 runs nos fixtures sintéticos).
 */
export function detectClip(samples: Float64Array | Float32Array, threshold = 1.0): ClipResult {
  const n = samples.length;
  let maxRun = 0;
  let curRun = 0;
  let clipSamples = 0;
  let flatTopRuns = 0;
  let peak = 0;
  let prevClipped = false;
  let prevVal = 0;

  for (let i = 0; i < n; i++) {
    const s = Math.abs(samples[i]);
    if (s > peak) peak = s;
    if (s >= threshold) {
      curRun++;
      clipSamples++;
      if (curRun > maxRun) maxRun = curRun;
      // Flat-top: sample clipado com valor ~idêntico ao anterior clipado.
      if (prevClipped && Math.abs(Math.abs(samples[i]) - Math.abs(prevVal)) < 1e-4) flatTopRuns++;
      prevClipped = true;
      prevVal = samples[i];
    } else {
      curRun = 0;
      prevClipped = false;
    }
  }

  // Saturação exata relativa ao pico do trecho (pega hard clip sub-teto).
  const satFloor = peak * Math.pow(10, -0.5 / 20);
  let exactSatRuns = 0;
  let run = 1;
  for (let i = 1; i < n; i++) {
    const cur = Math.abs(samples[i]);
    const prv = Math.abs(samples[i - 1]);
    if (cur >= satFloor && Math.abs(cur - prv) <= 1e-9) {
      run++;
    } else {
      if (run >= 3) exactSatRuns++;
      run = 1;
    }
  }
  if (run >= 3) exactSatRuns++;

  return {
    hasClip: clipSamples > 0 || exactSatRuns >= 2,
    clipRunLen: maxRun,
    clipSamples,
    clipRatio: n ? clipSamples / n : 0,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -120,
    flatTopRuns,
    exactSatRuns,
    dcOffset: dcOffset(samples),
  };
}

/**
 * THD sobre espectro: encontra o fundamental (pico espectral abaixo de 2kHz),
 * soma energia dos harmônicos 2f..8f e retorna sqrt(harm/fund).
 * cleanSpectrum=true para medir distorção sem clip (uso geral).
 */
export function estimateTHDFromSpectrum(
  mags: Float64Array,
  sampleRate: number,
  fftSize: number,
  opts?: { maxHarmonic?: number; fundamentalMaxHz?: number }
): number {
  const binHz = sampleRate / fftSize;
  const fundMaxBin = Math.floor((opts?.fundamentalMaxHz ?? 2000) / binHz);
  const maxHarm = opts?.maxHarmonic ?? 8;

  // Fundamental: pico entre bin 2 e fundMaxBin.
  let peakIdx = -1;
  let peakMag = 0;
  for (let i = 2; i <= Math.min(fundMaxBin, mags.length - 1); i++) {
    if (mags[i] > peakMag) { peakMag = mags[i]; peakIdx = i; }
  }
  if (peakIdx < 1 || peakMag <= 0) return 0;

  // Energia do fundamental: bins adjacentes (leakage da janela).
  const bandEnergy = (center: number): number => {
    let e = 0;
    for (let j = center - 1; j <= center + 1; j++) {
      if (j >= 0 && j < mags.length) e += mags[j] * mags[j];
    }
    return e;
  };
  const fundE = bandEnergy(peakIdx);
  if (fundE <= 0) return 0;

  let harmE = 0;
  for (let h = 2; h <= maxHarm; h++) {
    const idx = Math.round(peakIdx * h);
    if (idx >= mags.length - 1) break;
    harmE += bandEnergy(idx);
  }
  return Math.sqrt(harmE / fundE);
}

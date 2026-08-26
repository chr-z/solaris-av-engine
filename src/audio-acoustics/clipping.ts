/**
 * Clipping: samples em/above 0dBFS com run-length, flat-top detection e
 * THD estimada sobre o espectro (harmônicos espúrios do fundamental).
 */

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

export interface CrestEvidence {
  /**
   * Fração de janelas ELEGÍVEIS (com movimento pico-a-pico suficiente) com
   * crest factor < limiar (padrão 9dB). Calibração 25/08 ~19h (probes ritmo ×
   * nível × estrutura, pcm+mp3): sinal limpo fica ≤0.31 MESMO quente/próximo
   * do teto (fixture 16k a -0.5dBFS); conteúdo com saturação fica ≥0.59 em
   * PCM e após round-trip mp3/aac — o codec achata os plateaus mas não
   * restaura a dinâmica.
   */
  lowCrestFrac: number;
  /** Janelas que entraram na estatística (movimento pico-a-pico suficiente). */
  eligibleWindows: number;
}

/**
 * Decisão de saturação por crest. Corte 0.45 = ponto médio da banda vazia
 * medida (limpo ≤0.31 × saturado ≥0.59); mínimo de 40 janelas elegíveis
 * (~2s de fala) para significância estatística.
 */
export function isCrestSaturated(e: CrestEvidence): boolean {
  return e.lowCrestFrac >= 0.45 && e.eligibleWindows >= 40;
}

/**
 * Evidência de saturação por crest factor (peak/RMS em dB por janela curta).
 *
 * Imune a codec lossy: mp3 destrói os plateaus de valor idêntico e recua o
 * pico, mas o crest esmagado das janelas de fala permanece — medido: seco/
 * reverb/ruído têm frac(crest<9dB) ≤0.02 em PCM e pós-mp3; clipado tem
 * ≥0.24 nas mesmas condições. Janelas SEM movimento pico-a-pico relevante
 * (silêncio digital, canal DC travado) são excluídas da estatística —
 * canal constante tem crest 0dB por definição mas não é áudio dinâmico.
 */
export function crestClippingEvidence(
  samples: Float64Array | Float32Array,
  sampleRate: number,
  opts?: { winMs?: number; crestMaxDb?: number; minPtpRel?: number }
): CrestEvidence {
  const winMs = opts?.winMs ?? 50;
  const crestMaxDb = opts?.crestMaxDb ?? 9;
  const minPtpRel = opts?.minPtpRel ?? 0.1;
  const w = Math.max(1, Math.floor((winMs / 1000) * sampleRate));
  const n = samples.length;
  if (n < w) return { lowCrestFrac: 0, eligibleWindows: 0 };

  // Passada 1: pico global (referência do movimento mínimo da janela).
  let globalPeak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > globalPeak) globalPeak = a;
  }
  if (globalPeak <= 1e-9) return { lowCrestFrac: 0, eligibleWindows: 0 };
  const minPtp = minPtpRel * globalPeak;

  // Passada 2: crest por janela; só janelas "vivas" contam.
  let eligible = 0;
  let low = 0;
  for (let off = 0; off + w <= n; off += w) {
    let e = 0, pk = 0, mn = Infinity, mx = -Infinity;
    for (let i = off; i < off + w; i++) {
      const v = samples[i];
      e += v * v;
      if (v > mx) mx = v;
      if (v < mn) mn = v;
      const a = v < 0 ? -v : v;
      if (a > pk) pk = a;
    }
    const rms = Math.sqrt(e / w);
    if (rms <= 1e-6 || mx - mn <= minPtp) continue; // silêncio / canal travado
    eligible++;
    const crestDb = 20 * Math.log10(pk / rms);
    if (crestDb < crestMaxDb) low++;
  }
  return {
    lowCrestFrac: eligible > 0 ? low / eligible : 0,
    eligibleWindows: eligible,
  };
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

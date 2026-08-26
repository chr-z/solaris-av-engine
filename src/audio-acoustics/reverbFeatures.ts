/**
 * Vetor de features para o refinamento ML de reverb (P4).
 *
 * Contrato crítico: esta MESMA função extrai features no treino (gerador de
 * dataset, via esbuild/node) e na inferência (produto). Não há paridade
 * Python↔TS a manter — só existe uma implementação das features.
 *
 * Entradas: PCM mono + sampleRate (qualquer taxa; features normalizadas pelo
 * próprio sinal). Saída: 8 valores FINITOS sempre (entradas degeneradas
 * produzem vetor neutro válido, nunca NaN/Inf).
 *
 * Features (ordem fixa — congelada no modelo ONNX):
 *  0 rt60Det      — estimativa Schroeder atual do detector determinístico (s; 0 se ausente)
 *  1 c50          — clarity early/late do detector (dB)
 *  2 envDecay     — slope linear da cauda do envelope em dB/s (mais negativo = decay mais rápido)
 *  3 pauseFill    — energia média nas pausas relativa à fala (razão linear)
 *  4 tailRatio    — energia RMS no FIM da pausa / início da pausa (persistência da cauda)
 *  5 flatnessPause— flatness espectral mediana nos frames de pausa
 *  6 centroidVar  — desvio padrão do centróide espectral normalizado pela mediana (fala seca varia mais)
 *  7 speechDuty   — fração temporal de fala ativa (salas vivas fundem palavras => duty alto)
 */

import { FFT, hannWindow } from './fft';
import { amplitudeEnvelope, spectralFlatness, spectralCentroid } from './features';
import { detectVoiceActivity } from './reverb';

export const REVERB_ML_FEATURE_COUNT = 8;

export interface Rt60DetectorSnapshot {
  /** Estimativa atual do detector determinístico (s). Passe null se não convergiu. */
  rt60: number | null;
  /** Clarity C50 do detector (dB). */
  c50: number;
}

/** Limites físicos por feature (clamp defensivo contra NaN/Inf/outliers). */
const FEATURE_BOUNDS: Array<[number, number]> = [
  [0, 4], [-80, 80], [-600, 50], [0, 50], [0, 50], [0, 1], [0, 20], [0, 1],
];

/** Vetor usado quando o trecho não permite extrair nada útil. */
const NEUTRAL_VEC = [0, 0, -120, 0, 0, 0.5, 0, 0];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampVec(vec: number[]): number[] {
  return vec.map((v, i) => {
    if (!Number.isFinite(v)) return NEUTRAL_VEC[i];
    const [lo, hi] = FEATURE_BOUNDS[i];
    return clamp(v, lo, hi);
  });
}

function neutralVector(detector: Rt60DetectorSnapshot): number[] {
  const v = [...NEUTRAL_VEC];
  v[0] = Number.isFinite(detector.rt60 ?? 0) ? clamp(detector.rt60 ?? 0, 0, 4) : 0;
  v[1] = Number.isFinite(detector.c50) ? clamp(detector.c50, -80, 80) : 0;
  return v;
}

/** Extrai o vetor de 8 features. Sempre retorna valores finitos. */
export function extractReverbFeatureVector(
  samples: Float64Array | Float32Array,
  sampleRate: number,
  detector: Rt60DetectorSnapshot
): number[] {
  return extractReverbFeaturesDetailed(samples, sampleRate, detector).vector;
}

/** Versão detalhada: vetor + duty de fala (usado como gate de elegibilidade do ML). */
export function extractReverbFeaturesDetailed(
  samples: Float64Array | Float32Array,
  sampleRate: number,
  detector: Rt60DetectorSnapshot
): { vector: number[]; speechDuty: number } {
  const neutral = neutralVector(detector);
  if (samples.length < Math.floor(sampleRate * 0.5)) {
    return { vector: neutral, speechDuty: 0 };
  }

  const sig = samples instanceof Float64Array ? samples : new Float64Array(samples);
  const env = amplitudeEnvelope(sig, sampleRate, 4);

  // ---------- VAD (mesma escada adaptativa do analyzeReverb) ----------
  let peak = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i];
  if (peak <= 1e-9) return { vector: neutral, speechDuty: 0 };

  let segs = detectVoiceActivity(env, sampleRate, { floorDbBelowPeak: -12, minSilenceMs: 150 });
  for (const fl of [-20, -26, -32, -38]) {
    if (segs.length >= 2) break;
    segs = detectVoiceActivity(env, sampleRate, { floorDbBelowPeak: fl, minSilenceMs: 150 });
  }
  for (const ms of [120, 90]) {
    if (segs.length >= 2) break;
    for (const fl of [-20, -26, -32]) {
      segs = detectVoiceActivity(env, sampleRate, { floorDbBelowPeak: fl, minSilenceMs: ms });
      if (segs.length >= 2) break;
    }
  }
  let speechSamples = 0;
  for (const s of segs) speechSamples += s.end - s.start;
  const speechDuty = speechSamples / Math.max(env.length, 1);

  // ---------- Features de cauda nas pausas ----------
  // Cada pausa (gap entre segmentos): energia no início vs fim — sala viva
  // mantém cauda alta até o fim (tailRatio alto); sala seca colapsa (~0).
  // GUARDA de 40ms antes do fim do gap: os últimos ms contêm o ATAQUE da
  // próxima palavra (medido: onset -28dB no p7 do gap seco envenenava a
  // cauda e o slope — falso "reverb" em sinal seco).
  const GUARD = Math.floor(sampleRate * 0.04);
  let pauseCount = 0;
  let fillAcc = 0;   // soma de tailE/headE
  let tailAcc = 0;   // soma de sqrt(tailE/headE)
  let decaySum = 0;
  let decayN = 0;
  for (let i = 0; i + 1 < segs.length; i++) {
    const gapStart = segs[i].end;
    const gapEnd = segs[i + 1].start - GUARD; // região útil termina ANTES do ataque
    const gapLen = gapEnd - gapStart;
    if (gapLen < Math.floor(sampleRate * 0.05)) continue;
    const edge = Math.min(Math.floor(sampleRate * 0.03), gapLen);
    const headE = meanEnergy(env, gapStart, gapStart + edge);
    const tailE = meanEnergy(env, gapEnd - edge, gapEnd);
    if (headE <= 1e-12) continue;
    // Piso relativo à cabeça (-60dB): abaixo disso é "invisível" — mantém o
    // slope limitado e compara entre sinais de níveis diferentes.
    const floorE = headE * 1e-3;
    pauseCount++;
    fillAcc += tailE / headE;
    tailAcc += Math.sqrt(Math.max(tailE / headE, 0));
    // Slope linear do envelope em dB ao longo do gap (com piso relativo).
    const pts = 8;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let p = 0; p < pts; p++) {
      const pos = gapStart + Math.floor(((p + 0.5) / pts) * gapLen);
      const e = Math.max(meanEnergy(env, pos, Math.min(pos + edge, gapEnd)), floorE);
      const y = 20 * Math.log10(e);
      const x = (pos - gapStart) / sampleRate;
      sx += x; sy += y; sxx += x * x; sxy += x * y; n++;
    }
    const denom = n * sxx - sx * sx;
    if (denom !== 0) {
      const b = (n * sxy - sx * sy) / denom;
      if (Number.isFinite(b)) { decaySum += b; decayN++; }
    }
  }

  // Energia total pausa vs fala (fill global — cobre bordas sem gap interno).
  const segMask = new Uint8Array(env.length);
  for (const s of segs) {
    for (let i = s.start; i < s.end && i < env.length; i++) segMask[i] = 1;
  }
  let spE = 0, paE = 0, spN = 0, paN = 0;
  for (let i = 0; i < env.length; i++) {
    if (segMask[i]) { spE += env[i] * env[i]; spN++; }
    else { paE += env[i] * env[i]; paN++; }
  }
  const pauseFill = spE > 1e-15 && paN > 0 ? paE / paN / (spE / spN) : 0;

  // ---------- Espectro: flatness nas pausas + variabilidade de centróide ----------
  const fftSize = 2048;
  const hop = 1024;
  const fft = new FFT(fftSize);
  const win = hannWindow(fftSize);
  const numFrames = Math.max(0, Math.floor((sig.length - fftSize) / hop) + 1);
  const flatPauses: number[] = [];
  const centroids: number[] = [];
  for (let f = 0; f < numFrames; f++) {
    const off = f * hop;
    const center = off + fftSize / 2;
    const mags = fft.magnitudeSpectrum(sig.subarray(off, off + fftSize) as Float64Array, win);
    if (center < segMask.length && segMask[center] === 0 && flatPauses.length < 400) {
      flatPauses.push(spectralFlatness(mags));
    }
    if (centroids.length < 800) centroids.push(spectralCentroid(mags, sampleRate));
  }
  const flatnessPause = flatPauses.length ? median(flatPauses) : NEUTRAL_VEC[5];
  const cenMed = centroids.length ? median(centroids) : 0;
  let cenVar = 0;
  if (centroids.length > 4 && cenMed > 1e-6) {
    let acc = 0;
    for (const c of centroids) acc += (c - cenMed) * (c - cenMed);
    cenVar = Math.sqrt(acc / centroids.length) / cenMed;
  }

  // ---------- Montagem ----------
  const vector = clampVec([
    detector.rt60 ?? 0,
    detector.c50,
    decayN > 0 ? decaySum / decayN : NEUTRAL_VEC[2],
    pauseFill,
    pauseCount > 0 ? fillAcc / pauseCount : 0,
    flatnessPause,
    cenVar,
    speechDuty,
  ]);
  return { vector, speechDuty };
}

function meanEnergy(env: Float64Array, from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(env.length, to);
  if (b <= a) return 0;
  let acc = 0;
  for (let i = a; i < b; i++) acc += env[i] * env[i];
  return acc / (b - a);
}

function median(arr: number[]): number {
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
}

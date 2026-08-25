/** Geradores de áudio sintético para testes known-answer (P2).
* Determinísticos: RNG mulberry32 com seed fixa. Zero deps.
*/

import { convolveFFTOla } from './fft';

/** RNG determinístico (mulberry32). */export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSine(freq: number, durSec: number, sampleRate: number, amp = 0.5): Float64Array {
  const n = Math.round(durSec * sampleRate);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/**
 * "Fala" sintética: rajadas de ruído filtrado (word-like) com pausas.
 * wordsSec/pauseSec alternados. Amplitude alvo `amp` (pico ~amp).
 */
export function makeSpeechLike(
  patternSec: Array<{ word: number; pause: number }>,
  sampleRate: number,
  amp = 0.5,
  seed = 42
): Float64Array {
  const rng = makeRng(seed);
  // Estado do filtro média-móvel (suaviza ruído → espectro tipo fala, cai com freq).
  let z1 = 0, z2 = 0;
  const totalSamples = patternSec.reduce((acc, p) => acc + Math.round((p.word + p.pause) * sampleRate), 0);
  const out = new Float64Array(totalSamples);
  let pos = 0;

  for (const { word, pause } of patternSec) {
    const wN = Math.round(word * sampleRate);
    const pN = Math.round(pause * sampleRate);
    for (let i = 0; i < wN && pos < totalSamples; i++, pos++) {
      // Envelope de palavra: ataque/decay suaves para não estourar bordas.
      const tEdge = Math.min(i / (sampleRate * 0.01), (wN - i) / (sampleRate * 0.03), 1);
      const white = rng() * 2 - 1;
      z1 = 0.6 * z1 + 0.4 * white;
      z2 = 0.85 * z2 + 0.15 * z1; // lowpass leve
      out[pos] = amp * tEdge * z2 * 3.5;
    }
    // Pausa: silêncio digital (reverb vai preencher se presente).
    pos += pN;
  }
  return out.subarray(0, pos) as Float64Array;
}

/** IR exponencial decrescente com RT60 conhecido (+ ruído para densidade). */export function makeExponentialIR(rt60Sec: number, sampleRate: number, seed = 123): Float64Array {
  // Duração da cauda: RT60 + 25% de margem.
  const tailSec = rt60Sec * 1.25;
  const n = Math.max(16, Math.round(tailSec * sampleRate));
  const rng = makeRng(seed);
  const out = new Float64Array(n);
  const decayPerSample = Math.pow(10, -60 / (20 * rt60Sec * sampleRate)); // amplitude cai 60dB em RT60
  for (let i = 0; i < n; i++) {
    out[i] = (rng() * 2 - 1) * Math.pow(decayPerSample, i);
  }
  // Normaliza energia da IR (convolução preserva nível RMS aproximado).
  let e = 0;
  for (let i = 0; i < n; i++) e += out[i] * out[i];
  const norm = 1 / Math.sqrt(Math.max(e, 1e-30));
  for (let i = 0; i < n; i++) out[i] *= norm;
  return out;
}

/** Reverb sintético por convolução FFT (overlap-add) com IR de RT60 conhecido. */export function addReverb(
  dry: Float64Array,
  rt60Sec: number,
  sampleRate: number,
  wetGain = 1.0
): Float64Array {
  const ir = makeExponentialIR(rt60Sec, sampleRate);
  const wet = convolveFFTOla(dry, ir);
  const out = new Float64Array(dry.length);
  for (let i = 0; i < dry.length; i++) {
    out[i] = dry[i] + wetGain * wet[i];
  }
  return out;
}

/** Ruído branco em SNR conhecida (relativo ao RMS do sinal limpo). */export function addWhiteNoise(signal: Float64Array, snrDb: number, seed = 7): Float64Array {
  const rng = makeRng(seed);
  let sigE = 0;
  for (let i = 0; i < signal.length; i++) sigE += signal[i] * signal[i];
  const sigPower = sigE / Math.max(signal.length, 1);
  const noisePower = sigPower * Math.pow(10, -snrDb / 10);
  const noiseAmp = Math.sqrt(noisePower);
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    // Soma de 12 uniformes ≈ gaussiana (teorema central limite).
    let g = 0;
    for (let k = 0; k < 12; k++) g += rng();
    g -= 6;
    out[i] = signal[i] + g * noiseAmp;
  }
  return out;
}

/** Hard clip: limita |x| ao teto linear correspondente a thresholdDbFS. */export function hardClip(signal: Float64Array, thresholdDbFs: number): Float64Array {
  const ceil = Math.pow(10, thresholdDbFs / 20);
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    const s = signal[i];
    out[i] = s > ceil ? ceil : s < -ceil ? -ceil : s;
  }
  return out;
}

/** Eco discreto: cópia do sinal atrasada delayMs com ganho gainDb. */export function addEcho(
  signal: Float64Array,
  sampleRate: number,
  delayMs: number,
  gainDb: number
): Float64Array {
  const d = Math.round((delayMs / 1000) * sampleRate);
  const gain = Math.pow(10, gainDb / 20);
  const out = new Float64Array(signal.length + d);
  for (let i = 0; i < signal.length; i++) out[i] += signal[i];
  for (let i = 0; i < signal.length; i++) out[i + d] += gain * signal[i];
  return out;
}

/** Hum de rede elétrica: fundamental + harmônicos ímpares em nível dBFS. */export function addHum(
  signal: Float64Array,
  sampleRate: number,
  f0: 50 | 60,
  levelDbFs: number,
  harmonics?: Array<{ mult: number; relDb: number }>
): Float64Array {
  const amp0 = Math.pow(10, levelDbFs / 20);
  const out = new Float64Array(signal.length);
  const comps: Array<{ f: number; a: number }> = [{ f: f0, a: amp0 }];
  const defaultHarmonics: Array<{ mult: number; relDb: number }> = [
    { mult: 3, relDb: -12 },
    { mult: 5, relDb: -20 },
    { mult: 7, relDb: -25 }
  ];
  const useHarmonics = harmonics ?? defaultHarmonics;
  for (const h of useHarmonics) comps.push({ f: f0 * h.mult, a: amp0 * Math.pow(10, h.relDb / 20) });
  for (let i = 0; i < signal.length; i++) {
    let v = signal[i];
    for (const c of comps) v += c.a * Math.sin((2 * Math.PI * c.f * i) / sampleRate);
    out[i] = v;
  }
  return out;
}

/** Conversão para Float32 (formato do pipeline WebAudio). */export function toFloat32(x: Float64Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i];
  return out;
}

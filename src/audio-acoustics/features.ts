/**
 * Features de áudio — operam sobre amostras no tempo (Float64) e
 * espectros de magnitude (saída de FFT.magnitudeSpectrum). Zero deps.
 */

/** RMS no domínio do tempo. */
export function rmsTime(samples: Float64Array | Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** RMS a partir do espectro de magnitude (bins 0..N/2, Parseval com correção de janela). */
export function rmsFromSpectrum(mags: Float64Array): number {
  // Soma das energias x2 (bins espelhados), exceto DC e Nyquist.
  let sum = 0;
  for (let i = 0; i < mags.length; i++) sum += mags[i] * mags[i];
  if (mags.length > 2) sum = 2 * sum - mags[0] * mags[0] - mags[mags.length - 1] * mags[mags.length - 1];
  return Math.sqrt(sum / (2 * (mags.length - 1)));
}

/**
 * Spectral flatness (Wiener entropy) = média geométrica / média aritmética.
 * ~0 = tonal; ~1 = ruidoso. Usa log-média para estabilidade numérica.
 */
export function spectralFlatness(mags: Float64Array, binStart = 1, binEnd?: number): number {
  const end = Math.min(binEnd ?? mags.length, mags.length);
  let logSum = 0;
  let linSum = 0;
  let count = 0;
  const floorAmp = 1e-12;
  for (let i = binStart; i < end; i++) {
    const m = Math.max(mags[i], floorAmp);
    logSum += Math.log(m);
    linSum += m;
    count++;
  }
  if (count === 0 || linSum === 0) return 1;
  const geo = Math.exp(logSum / count);
  const ari = linSum / count;
  return geo / ari;
}

/** Centroide espectral em Hz. */
export function spectralCentroid(mags: Float64Array, sampleRate: number, binStart = 0, binEnd?: number): number {
  const N = (mags.length - 1) * 2; // tamanho da FFT que gerou o espectro
  const binHz = sampleRate / N;
  const end = Math.min(binEnd ?? mags.length, mags.length);
  let num = 0;
  let den = 0;
  for (let i = binStart; i < end; i++) {
    const m = mags[i];
    num += i * binHz * m;
    den += m;
  }
  return den > 0 ? num / den : 0;
}

export interface BandEnergies {
  sub: number;     // 20–120 Hz
  low: number;     // 120–500 Hz
  mid: number;     // 500–2000 Hz
  highmid: number; // 2k–5k Hz
  high: number;    // 5k–10k Hz
  air: number;     // 10k–16k Hz
}

/** Energia por banda a partir do espectro de magnitude. */
export function bandEnergies(mags: Float64Array, sampleRate: number): BandEnergies {
  const N = (mags.length - 1) * 2;
  const binHz = sampleRate / N;
  const idx = (hz: number) => Math.max(0, Math.min(mags.length - 1, Math.round(hz / binHz)));

  function sum(a: number, b: number): number {
    let s = 0;
    for (let i = idx(a); i <= idx(b); i++) s += mags[i] * mags[i];
    return s;
  }
  return {
    sub: sum(20, 120),
    low: sum(120, 500),
    mid: sum(500, 2000),
    highmid: sum(2000, 5000),
    high: sum(5000, 10000),
    air: sum(10000, 16000),
  };
}

/** Pico absoluto no domínio do tempo (sample peak). */
export function samplePeak(samples: Float64Array | Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/** DC offset = média aritmética das amostras. */
export function dcOffset(samples: Float64Array | Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i];
  return samples.length ? sum / samples.length : 0;
}

/**
 * Envelope de amplitude via média móvel de |x| (janela curta, causal centrada).
 * windowMs padrão 5ms — resolução suficiente para VAD/decay.
 */
export function amplitudeEnvelope(samples: Float64Array | Float32Array, sampleRate: number, windowMs = 5): Float64Array {
  const win = Math.max(1, Math.floor((windowMs * sampleRate) / 1000));
  const n = samples.length;
  const env = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += Math.abs(samples[i]);
    if (i >= win) acc -= Math.abs(samples[i - win]);
    env[i] = acc / win;
  }
  return env;
}

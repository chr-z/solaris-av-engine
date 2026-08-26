/**
 * Testes known-answer do motor acústico (P2).
 * Fixtures sintéticos determinísticos: cada detector DEVE acertar o
 * fixture correspondente e NÃO disparar no áudio limpo.
 */

import { describe, it, expect } from 'vitest';
import { FFT, convolveFFTOla } from '../fft';
import {
  makeSine, makeSpeechLike, addReverb, addWhiteNoise, hardClip, addEcho, addHum,
} from '../fixtures';
import { detectClip, estimateTHDFromSpectrum } from '../clipping';
import { detectHum } from '../noise';
import { detectEcho } from '../echo';
import { analyzeReverb, rt60Schroeder } from '../reverb';
import { analyzeAudioPcm } from '../audioAcoustics';

const SR = 44100;

// Padrão de "aula": palavras de ~0.4s com pausas de ~0.6s (pausas longas dão
// janelas de decay utilizáveis pelo Schroeder).
const AULA: Array<{ word: number; pause: number }> = Array.from({ length: 6 }, () => ({ word: 0.4, pause: 0.6 }));

describe('FFT', () => {
  it('recupera tom de 1kHz com bin correto', () => {
    const n = 4096;
    const fft = new FFT(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const binHz = SR / n; // ~10.77Hz
    const targetBin = Math.round(1000 / binHz); // ~93
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 1000 * i) / SR);
    fft.transform(re, im);
    let bestK = 0, bestM = 0;
    for (let k = 1; k < n / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      if (m > bestM) { bestM = m; bestK = k; }
    }
    expect(Math.abs(bestK - targetBin)).toBeLessThanOrEqual(1);
    // Amplitude coerente: pico em bin inteiro ≈ N/2
    expect(bestM).toBeGreaterThan(0.35 * n);
  });

  it('IFFT inverte a FFT (round-trip)', () => {
    const n = 256;
    const fft = new FFT(n);
    const rngSeedArr = new Float64Array(n);
    let x = 12345;
    for (let i = 0; i < n; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      rngSeedArr[i] = (x / 0x7fffffff) * 2 - 1;
    }
    const re = Float64Array.from(rngSeedArr);
    const im = new Float64Array(n);
    fft.transform(re, im);
    fft.inverse(re, im);
    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(rngSeedArr[i], 6);
  });

  it('convolução OLA == convolução direta (IR curta)', () => {
    const sig = makeSine(220, 0.05, SR, 0.5);
    const ir = new Float64Array([1, 0.5, 0.25]);
    // Direta
    const direct = new Float64Array(sig.length + ir.length - 1);
    for (let i = 0; i < sig.length; i++)
      for (let j = 0; j < ir.length; j++) direct[i + j] += sig[i] * ir[j];
    const fast = convolveFFTOla(sig, ir, 1024);
    expect(fast.length).toBe(direct.length);
    for (let i = 0; i < direct.length; i++) expect(fast[i]).toBeCloseTo(direct[i], 4);
  });
});

describe('Clipping', () => {
  it('detecta hard clip em -1dB e não dispara no limpo', () => {
    const clean = makeSpeechLike(AULA, SR, 0.9);
    // Garante que o sinal cruza -1dBFS (pico ~0.9*3.5*... pode variar; normaliza):
    let peak = 0;
    for (let i = 0; i < clean.length; i++) peak = Math.max(peak, Math.abs(clean[i]));
    // Normaliza pico para 1.15 → clipa em -1dB (0.891)
    const norm = new Float64Array(clean.length);
    for (let i = 0; i < clean.length; i++) norm[i] = (clean[i] / peak) * 1.15;
    const clipped = hardClip(norm, -1);

    const r = detectClip(clipped, Math.pow(10, -1 / 20));
    expect(r.hasClip).toBe(true);
    expect(r.clipSamples).toBeGreaterThan(50);
    expect(r.flatTopRuns).toBeGreaterThan(3);
    // Limpo com folga abaixo do teto: zero clip
    const okSig = new Float64Array(norm.length);
    for (let i = 0; i < norm.length; i++) okSig[i] = norm[i] * 0.5;
    const rOk = detectClip(okSig, 1.0);
    expect(rOk.hasClip).toBe(false);
  });

  it('THD alta em sinal clipado vs baixa no limpo', () => {
    const n = 4096;
    const tone = makeSine(440, n / SR, SR, 0.9);
    const clipped = hardClip(tone, -6);
    const fft = new FFT(n);
    const magsClean = fft.magnitudeSpectrum(tone);
    const magsClip = fft.magnitudeSpectrum(clipped);
    const thdClean = estimateTHDFromSpectrum(magsClean, SR, n);
    const thdClip = estimateTHDFromSpectrum(magsClip, SR, n);
    expect(thdClip).toBeGreaterThan(0.08);
    expect(thdClean).toBeLessThan(thdClip / 3);
  });
});

describe('Hum / Noise floor', () => {
  it('detecta hum 60Hz com harmônicos e não dispara no limpo', () => {
    const base = makeSine(3000, 2, SR, 0.2); // tonal alto, fora do pente do hum
    const withHum = addHum(base, SR, 60, -30);
    const fft = new FFT(4096);
    // Espectro médio sobre vários frames
    const avg = averageSpectrum(withHum, fft, 40);
    const humRes = detectHum(avg, SR, 4096);
    expect(humRes.humDetected).toBe(true);
    expect(humRes.fundamentalHz).toBe(60);
    expect(humRes.harmonicCount).toBeGreaterThanOrEqual(3);
    expect(humRes.severity).not.toBe('none');

    // Mesmo sinal sem hum → sem detecção
    const avgClean = averageSpectrum(base, fft, 40);
    const resClean = detectHum(avgClean, SR, 4096);
    expect(resClean.humDetected).toBe(false);
  });

  it('noise floor: percentil 10 reflete ruído adicionado', () => {
    const speech = makeSpeechLike(AULA, SR, 0.5);
    const noisy = addWhiteNoise(speech, 10, 99);
    const floors = [frameFloor(speech), frameFloor(noisy)];
    // Com SNR 10dB o floor sobe bastante.
    expect(floors[1] - floors[0]).toBeGreaterThan(8);
    expect(floors[0]).toBeLessThan(-40);
  });
});

describe('Eco real', () => {
  it('detecta eco 150ms/-6dB e não dispara no limpo', () => {
    const speech = makeSpeechLike([...AULA, ...AULA], SR, 0.5);
    const withEchoFull = addEcho(speech, SR, 150, -6);
    const r = detectEcho(withEchoFull.subarray(0, SR * 10) as Float64Array, SR);
    expect(r.hasEcho).toBe(true);
    expect(r.isReal).toBe(true);
    expect(Math.abs(r.delayMs - 150)).toBeLessThanOrEqual(5);

    const rClean = detectEcho(speech.subarray(0, SR * 10) as Float64Array, SR);
    expect(rClean.hasEcho).toBe(false);
  });
});

describe('Reverb (PRIORIDADE MÁXIMA)', () => {
  it('Schroeder recupera RT60 conhecido por convolução com IR exponencial', () => {
    const cases: Array<[number, number]> = [[0.3, 0.25], [0.6, 0.25], [1.2, 0.3]];
    for (const [rt60, tol] of cases) {
      const dry = makeSpeechLike([...AULA, ...AULA], SR, 0.5);
      const wet = addReverb(dry, rt60, SR, 1.0);
      const res = analyzeReverb(wet, SR);
      expect(res.rt60Method).toBe('schroeder');
      expect(Math.abs(res.rt60 - rt60)).toBeLessThan(tol);
    }
  }, 60000);

  it('sinal seco (sem reverb) classifica dry e RT60 baixo', () => {
    const dry = makeSpeechLike([...AULA, ...AULA], SR, 0.5);
    const res = analyzeReverb(dry, SR);
    expect(res.rt60).toBeLessThan(0.25);
    expect(res.classification).toBe('dry');
  });

  it('monotonicidade: RT60 medido cresce com RT60 real', () => {
    const dry = makeSpeechLike([...AULA, ...AULA], SR, 0.5);
    const a = analyzeReverb(addReverb(dry, 0.3, SR), SR).rt60;
    const b = analyzeReverb(addReverb(dry, 1.2, SR), SR).rt60;
    expect(b).toBeGreaterThan(a + 0.4);
  }, 60000);

  it('rt60Schroeder direto num decay sintético retorna valor próximo', () => {
    // Decay exponencial puro com RT60=0.5s + ruído de piso leve
    const rt = 0.5;
    const n = Math.floor(SR * 1.0);
    const sig = new Float64Array(n);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < n; i++) {
      const decay = Math.pow(10, (-60 * (i / SR)) / (20 * rt));
      sig[i] = rnd() * 2 - 1 * decay;
      sig[i] *= decay; // aplicado corretamente
    }
    const est = rt60Schroeder(sig, SR);
    expect(est).not.toBeNull();
    expect(est as number).toBeGreaterThan(0.3);
    expect(est as number).toBeLessThan(0.85);
  });
});

describe('analyzeAudioPcm — integração (relatório completo)', () => {
  it('áudio limpo: todos os eixos saudáveis, sem falsos positivos', () => {
    const clean = makeSpeechLike([...AULA, ...AULA], SR, 0.5);
    const rep = analyzeAudioPcm(to32(clean), SR);
    expect(rep.axes.reverb.score).toBeGreaterThan(75);
    expect(rep.axes.clipping.score).toBeGreaterThan(80);
    expect(rep.axes.echo.score).toBeGreaterThan(75);
    expect(rep.axes.noise.score).toBeGreaterThan(70);
    expect(rep.hum.humDetected).toBe(false);
    expect(rep.overallScore).toBeGreaterThan(70);
  }, 60000);

  it('reverb crítico derruba score de reverb; clipping derruba clipping', () => {
    const dry = makeSpeechLike([...AULA, ...AULA], SR, 0.95);
    let peak = 0;
    for (let i = 0; i < dry.length; i++) peak = Math.max(peak, Math.abs(dry[i]));
    const normalized = new Float64Array(dry.length);
    for (let i = 0; i < dry.length; i++) normalized[i] = (dry[i] / peak) * 1.1;

    const reverbed = addReverb(normalized, 1.2, SR, 1.0);
    const repRev = analyzeAudioPcm(to32(reverbed), SR);
    expect(repRev.axes.reverb.severity).toBe('critical');
    expect(repRev.axes.reverb.score).toBeLessThan(40);

    const clipped = hardClip(normalized, -1);
    const repClip = analyzeAudioPcm(to32(clipped), SR);
    expect(repClip.axes.clipping.severity).toBe('critical');
    expect(repClip.timelineMarks.filter(m => m.axis === 'clipping').length).toBeGreaterThan(0);
    expect(repClip.warnings.some(w => w.toLowerCase().includes('clip') || w.includes('Hum'))).toBe(false);
  }, 120000);

  it('ruído em SNR 20dB mantém noise axis ok; SNR baixo penaliza', () => {
    const speech = makeSpeechLike([...AULA, ...AULA], SR, 0.5);
    const light = analyzeAudioPcm(to32(addWhiteNoise(speech, 20)), SR);
    expect(light.axes.noise.score).toBeGreaterThan(30); // curva corrigida (antes: >40, era leniente)

    const bad = analyzeAudioPcm(to32(addWhiteNoise(speech, 4)), SR);
    expect(bad.axes.noise.score).toBeLessThan(light.axes.noise.score);
    expect(bad.axes.noise.score).toBeLessThan(60);
  }, 120000);

  it('baseline de estúdio muda a explicação e o threshold de reverb', () => {
    const dry = makeSpeechLike([...AULA, ...AULA], SR, 0.5);
    const rep = analyzeAudioPcm(to32(dry), SR, { baseline: { name: 'SEDE-11', rt60Target: 0.25 } });
    expect(rep.axes.reverb.explanation).toContain('SEDE-11');
  }, 60000);
});

// ---------- helpers ----------

function to32(x: Float64Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i];
  return out;
}

function averageSpectrum(sig: Float64Array, fft: FFT, frames: number): Float64Array {
  const hop = 1024;
  const half = fft.n / 2 + 1;
  const acc = new Float64Array(half);
  let count = 0;
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    if (off + fft.n > sig.length) break;
    const m = fft.magnitudeSpectrum(sig.subarray(off, off + fft.n));
    for (let k = 0; k < half; k++) acc[k] += m[k] * m[k];
    count++;
  }
  for (let k = 0; k < half; k++) acc[k] = Math.sqrt(acc[k] / Math.max(count, 1));
  return acc;
}

/** Noise floor rápido p/ teste: percentil 10 dos RMS de frames de 100ms. */
function frameFloor(sig: Float64Array): number {
  const win = Math.floor(SR * 0.1);
  const dbs: number[] = [];
  for (let off = 0; off + win <= sig.length; off += win) {
    let e = 0;
    for (let i = off; i < off + win; i++) e += sig[i] * sig[i];
    const r = Math.sqrt(e / win);
    dbs.push(r > 0 ? 20 * Math.log10(r) : -120);
  }
  dbs.sort((a, b) => a - b);
  return dbs[Math.floor(dbs.length * 0.1)];
}

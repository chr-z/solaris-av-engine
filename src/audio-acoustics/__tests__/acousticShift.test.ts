/**
 * Testes do detector de mudança acústica mid-video (spec: linha INFO da tabela).
 *
 * Cenários known-answer com fixtures sintéticas determinísticas:
 *  - limpo            → NÃO detecta (anti-FP)
 *  - só reverb forte  → NÃO detecta (timbre muda gradualmente, não em degrau)
 *  - só ruído uniforme→ NÃO detecta
 *  - queda de nível   → detecta kind='level' (legado)
 *  - troca de timbre com nível IGUAL (troca de sala/mic) → detecta kind='spectral'
 *    — o caso que o detector antigo (só RMS) deixava passar.
 */

import { describe, it, expect } from 'vitest';
import { makeSpeechLike, addReverb, addWhiteNoise } from '../fixtures';
import { analyzeAudioPcm } from '../audioAcoustics';
import type { AcousticReport } from '../audioAcoustics';

const SR = 44100;
/** 16s de "aula": 20 pares palavra 0.5s / pausa 0.3s. */
const PAT = Array.from({ length: 20 }, () => ({ word: 0.5, pause: 0.3 }));
const HALF_SEC = 8;

function rms(x: Float64Array): number {
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  return Math.sqrt(e / Math.max(x.length, 1));
}

function concat(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function scaleTo(sig: Float64Array, targetRms: number): Float64Array {
  const g = targetRms / Math.max(rms(sig), 1e-12);
  const out = new Float64Array(sig.length);
  for (let i = 0; i < sig.length; i++) out[i] = sig[i] * g;
  return out;
}

/** Lowpass one-pole aplicado n vezes (escurece o timbre drasticamente). */
function lowpass(sig: Float64Array, alpha: number, passes = 1): Float64Array {
  let cur = Float64Array.from(sig);
  for (let p = 0; p < passes; p++) {
    const out = new Float64Array(cur.length);
    let z = 0;
    for (let i = 0; i < cur.length; i++) {
      z += alpha * (cur[i] - z);
      out[i] = z;
    }
    cur = out;
  }
  return cur;
}

function analyze(sig: Float64Array): AcousticReport {
  return analyzeAudioPcm(Float64Array.from(sig), SR);
}

describe('acousticShift — mudança acústica mid-video (INFO)', () => {
  it('aula homogênea limpa → não detecta (anti-FP)', () => {
    const rep = analyze(makeSpeechLike(PAT, SR, 0.5, 42));
    expect(rep.acousticShift.detected).toBe(false);
    expect(rep.timelineMarks.some((m) => m.axis === 'shift')).toBe(false);
  });

  it('só reverb forte (RT60 0.9s) → não detecta (timbre muda sem degrau)', () => {
    const dry = makeSpeechLike(PAT, SR, 0.5, 42);
    const wet = analyze(dry); // sanity: seco não detecta
    expect(wet.acousticShift.detected).toBe(false);

    const rev = analyze(addReverb(dry, 0.9, SR));
    // Reverb altera features espectrais de forma contínua ao longo de todo o
    // bloco — mediana móvel por janela não cria um degrau localizado.
    expect(rev.acousticShift.detected).toBe(false);
  });

  it('só ruído uniforme (SNR 10dB) → não detecta', () => {
    const noisy = addWhiteNoise(makeSpeechLike(PAT, SR, 0.5, 42), 10, 7);
    const rep = analyze(noisy);
    expect(rep.acousticShift.detected).toBe(false);
  });

  it('queda de nível -12dB aos 8s → detecta kind="level" perto do corte', () => {
    const a = makeSpeechLike(PAT.slice(0, 10), SR, 0.5, 42);
    const b = makeSpeechLike(PAT.slice(0, 10), SR, 0.125, 43); // -12dB
    const rep = analyze(concat(a, b));
    expect(rep.acousticShift.detected).toBe(true);
    expect(rep.acousticShift.kind).toBe('level');
    expect(Math.abs(rep.acousticShift.tSec - HALF_SEC)).toBeLessThanOrEqual(2);
    // Marco de timeline presente e clicável no segundo certo.
    const mark = rep.timelineMarks.find((m) => m.axis === 'shift');
    expect(mark).toBeTruthy();
    expect(Math.abs((mark as { tSec: number }).tSec - HALF_SEC)).toBeLessThanOrEqual(2);
  });

  it('troca de sala/mic com nível IGUAL aos 8s → detecta kind="spectral" (caso que o detector só-RMS errava)', () => {
    const a = makeSpeechLike(PAT.slice(0, 10), SR, 0.5, 42);
    const bRaw = lowpass(makeSpeechLike(PAT.slice(0, 10), SR, 0.5, 99), 0.02, 2);
    const b = scaleTo(bRaw, rms(a)); // mesma loudness, outro timbre
    const rep = analyze(concat(a, b));

    // Guard: a normalização realmente igualou os quartis de RMS (<9dB).
    expect(rep.acousticShift.kind).toBe('spectral');
    expect(rep.acousticShift.detected).toBe(true);
    expect(Math.abs(rep.acousticShift.tSec - HALF_SEC)).toBeLessThanOrEqual(3);
  });

  it('troca de timbre sutil (mic diferente, mesmo ambiente) ainda detecta', () => {
    const a = makeSpeechLike(PAT.slice(0, 10), SR, 0.5, 42);
    const bRaw = lowpass(makeSpeechLike(PAT.slice(0, 10), SR, 0.5, 77), 0.25, 1);
    const b = scaleTo(bRaw, rms(a));
    const rep = analyze(concat(a, b));
    expect(rep.acousticShift.detected).toBe(true);
  });

  it('entrada curta demais (<2s) → sem crash, não detecta', () => {
    const short = makeSpeechLike([{ word: 0.5, pause: 0.3 }], SR, 0.5, 42);
    const rep = analyze(short);
    expect(rep.acousticShift.detected).toBe(false);
  });
});

/**
 * Known-answer tests for granular progress + cooperative cancellation.
 *
 * Contract under test:
 * - Instrumenting the engine with onProgress must NOT change any number in
 *   the report (byte-equal axes/score vs un-instrumented run).
 * - Stages arrive in engine order (frames → peak → reverb → echo → finalize)
 *   with monotonically non-decreasing pct.
 * - Aborting opts.signal mid-run throws AnalysisCancelledError synchronously
 *   and yields no report; a pre-aborted signal throws before doing any work.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeAudioPcm,
  AnalysisCancelledError,
  type AcousticProgress,
} from '../audioAcoustics';
import { makeSpeechLike } from '../fixtures';

const SR = 16000;

function pcm10s(): Float64Array {
  return makeSpeechLike(
    Array.from({ length: 5 }, () => ({ word: 1.2, pause: 0.8 })),
    SR
  );
}

describe('analyzeAudioPcm progress + cancellation', () => {
  it('emits ordered stages with monotonic pct and identical results', () => {
    const samples = pcm10s();
    const clean = analyzeAudioPcm(samples, SR);

    const seen: AcousticProgress[] = [];
    const instrumented = analyzeAudioPcm(samples, SR, {
      onProgress: (p) => seen.push({ ...p }),
    });

    // Progresso não pode alterar o resultado.
    expect(instrumented.overallScore).toBe(clean.overallScore);
    expect(JSON.stringify(instrumented.axes)).toBe(JSON.stringify(clean.axes));

    // Estágios em ordem de motor, pct monótono.
    const seq: string[] = [];
    for (const ev of seen) {
      if (seq[seq.length - 1] !== ev.stage) seq.push(ev.stage);
    }
    expect(seq).toEqual(['frames', 'peak', 'reverb', 'echo', 'finalize']);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].pct).toBeGreaterThanOrEqual(seen[i - 1].pct);
    }
    expect(seen[0].stage).toBe('frames');
    expect(seen[seen.length - 1]).toEqual({ pct: 94, stage: 'finalize' });
    // Contadores de frames presentes no estágio longo.
    const withCounters = seen.filter((e) => e.stage === 'frames' && e.framesDone !== undefined);
    expect(withCounters.length).toBeGreaterThan(0);
  }, 30000);

  it('short clip (zero STFT frames) still walks peak/reverb/echo/finalize', () => {
    const tiny = new Float64Array(2000);
    for (let i = 0; i < tiny.length; i++) tiny[i] = Math.sin((2 * Math.PI * 220 * i) / SR);
    const seq: string[] = [];
    const rep = analyzeAudioPcm(tiny, SR, {
      onProgress: (p) => {
        if (seq[seq.length - 1] !== p.stage) seq.push(p.stage);
      },
    });
    expect(seq).toEqual(['peak', 'reverb', 'echo', 'finalize']);
    expect(rep.durationSec).toBeCloseTo(0.125, 3);
  }, 15000);

  it('aborting mid-analysis throws AnalysisCancelledError (no partial result)', () => {
    const signal = { aborted: false };
    let calls = 0;
    let threw: unknown = null;
    try {
      analyzeAudioPcm(pcm10s(), SR, {
        signal,
        onProgress: () => {
          calls++;
          if (calls >= 3) signal.aborted = true;
        },
      });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(AnalysisCancelledError);
    expect(calls).toBeGreaterThanOrEqual(3);
  }, 15000);

  it('pre-aborted signal throws before doing any work', () => {
    let calls = 0;
    expect(() =>
      analyzeAudioPcm(pcm10s(), SR, {
        signal: { aborted: true },
        onProgress: () => {
          calls++;
        },
      })
    ).toThrow(AnalysisCancelledError);
    expect(calls).toBe(0);
  }, 15000);
});

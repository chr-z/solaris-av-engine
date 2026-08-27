/**
 * Benchmark de performance do motor acústico (P2 — spec SOLARIS_AUDIO_ACOUSTICS.md).
 *
 * Alvo da spec: 1h de áudio analisa em <90s num Web Worker.
 * Este suite NÃO roda worker — mede o núcleo puro (analyzeAudioPcm), que é
 * ~todo o custo; o overhead do worker (transfer/structured clone) é O(1)
 * sobre o PCM transferido e não muda a ordem de grandeza.
 *
 * Estratégia: medir 2 minutos sintéticos e extrapolar linearmente
 * (o pipeline é linear no tempo de áudio: STFT com hop fixo, envelope O(n),
 * eco por janelas limitadas). Orçamento proporcional: 2min < 3s.
 */

import { describe, it, expect } from 'vitest';
import { makeSpeechLike, toFloat32 } from '../fixtures';
import { analyzeAudioPcm } from '../audioAcoustics';
import { noiseScoreFromFloorDb } from '../audioAcoustics';

const SR = 44100;
const BENCH_SEC = 120;

function makeLectureSec(sec: number): Float64Array {
  const pairs = Math.ceil(sec / 2);
  const pat = Array.from({ length: pairs }, () => ({ word: 1, pause: 1 }));
  return makeSpeechLike(pat, SR, 0.5);
}

describe('noiseScoreFromFloorDb — monotonicidade', () => {
  it('piso mais limpo nunca pontua pior que piso mais sujo', () => {
    // varredura fina de -100 a 0 dBFS
    let prev = Infinity;
    for (let db = -100; db <= 0; db += 0.5) {
      const s = noiseScoreFromFloorDb(db);
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      prev = s;
    }
  });

  it('regressão: joelho invertido de -40dB corrigido', () => {
    // Curva antiga: [-48dB]→~77 mas [-42dB]→~88 (sujo ganhava do limpo).
    expect(noiseScoreFromFloorDb(-48)).toBeGreaterThan(noiseScoreFromFloorDb(-42));
    // Ancoragens sãs nas pontas.
    expect(noiseScoreFromFloorDb(-80)).toBeGreaterThanOrEqual(95);
    expect(noiseScoreFromFloorDb(-25)).toBeLessThanOrEqual(20);
    // Estúdio típico (-55..-65) fica na faixa "ok".
    expect(noiseScoreFromFloorDb(-58)).toBeGreaterThan(80);
  });
});

describe('benchmark — 1h < 90s (spec P2)', () => {
  it(
    '2 minutos de aula sintética processam em <3s (extrapola p/ 1h<90s)',
    () => {
      const pcm = toFloat32(makeLectureSec(BENCH_SEC));
      expect(pcm.length).toBe(BENCH_SEC * SR);

      // Aquecimento do JIT com 3s antes de cronometrar.
      const warm = analyzeAudioPcm(pcm.subarray(0, 3 * SR) as Float32Array, SR);
      expect(warm.overallScore).toBeGreaterThan(0);

      const t0 = performance.now();
      const rep = analyzeAudioPcm(pcm, SR);
      const dtMs = performance.now() - t0;

      const perHour = (dtMs / BENCH_SEC) * 3600;
      console.log(
        `[bench] ${BENCH_SEC}s de áudio em ${(dtMs / 1000).toFixed(2)}s ` +
        `→ 1h ≈ ${(perHour / 1000).toFixed(1)}s (alvo spec: <90s)`
      );
      expect(rep.durationSec).toBeCloseTo(BENCH_SEC, 0);
      expect(dtMs).toBeLessThan(3000); // 2min < 3s ⇒ 1h extrapolada < 90s
    },
    120000
  );
});

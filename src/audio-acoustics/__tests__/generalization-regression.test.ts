/**
 * REGRESSÃO de generalização (além do fixture canônico do precision-recall):
 * varre ritmo de fala × nível de gravação nas condições principais.
 * Nasceu de um spike que achou 2 bugs reais invisíveis ao fixture canônico:
 *  1) FN total de reverb em fala rápida com cauda (VAD fundia tudo num
 *     segmento único; escada de minSilence resolve);
 *  2) FP de eco em cadência lenta seca (pico espúrio de prosódia na ACF;
 *     gate de significância estatística z≥2 resolve).
 */
import { describe, it, expect } from 'vitest';
import {
  makeSpeechLike, addReverb, addWhiteNoise, addEcho, addHum,
} from '../fixtures';
import { analyzeAudioPcm } from '../audioAcoustics';

const SR = 44100;
const RHYTHMS: Record<string, Array<{ word: number; pause: number }>> = {
  canon: Array.from({ length: 6 }, () => ({ word: 0.4, pause: 0.6 })),
  fast: Array.from({ length: 10 }, () => ({ word: 0.3, pause: 0.3 })),
  slow: Array.from({ length: 4 }, () => ({ word: 0.5, pause: 1.0 })),
};
const LEVELS = [0.15, 0.5, 0.95];
const isFlag = (s: string) => s === 'warn' || s === 'critical';

describe('Generalização: ritmo × nível (regressão dos bugs do spike 25/08)', () => {
  it(
    'seco nunca flagra; reverb forte/sutil sempre flagram com RT60 são',
    { timeout: 900_000 },
    () => {
      for (const [rname, blocks] of Object.entries(RHYTHMS)) {
        for (const lvl of LEVELS) {
          const mk = () => makeSpeechLike(blocks, SR, lvl, 42);

          // Seco: zero flag de reverb e eco (qualquer ritmo, qualquer nível).
          const rDry = analyzeAudioPcm(mk(), SR);
          expect(rDry.axes.reverb.severity, `${rname}/L${lvl} dry flagou reverb`).toBe('ok');
          expect(rDry.axes.echo.severity, `${rname}/L${lvl} dry flagou eco`).toBe('ok');

          // Seco + ruído de fundo: reverb continua ok (porta pela forma).
          const rNoi = analyzeAudioPcm(addWhiteNoise(mk(), 20, 43), SR);
          expect(rNoi.axes.reverb.severity, `${rname}/L${lvl} dry-noise flagou reverb`).toBe('ok');

          // Reverb forte RT60 0.9: SEMPRE flagrado (nenhum ritmo cai no fallback "dry").
          const rWet = analyzeAudioPcm(addReverb(mk(), 0.9, SR, 1.0), SR);
          expect(isFlag(rWet.axes.reverb.severity), `${rname}/L${lvl} rt0.9 não flagrou (${rWet.reverb.rt60Method})`).toBe(true);

          // Reverb sutil RT60 0.55: sempre flagrado; estimativa dentro de ±35%.
          const rSub = analyzeAudioPcm(addReverb(mk(), 0.55, SR, 1.0), SR);
          expect(isFlag(rSub.axes.reverb.severity), `${rname}/L${lvl} rt0.55 não flagrou`).toBe(true);
          if (rSub.reverb.rt60Method === 'schroeder') {
            expect(Math.abs(rSub.reverb.rt60 - 0.55) / 0.55, `${rname}/L${lvl} rt0.55 est=${rSub.reverb.rt60}`).toBeLessThanOrEqual(0.35);
          }

          // Eco real 150ms/-6dB: detectado em qualquer ritmo/nível.
          const rEc = analyzeAudioPcm(addEcho(mk(), SR, 150, -6), SR);
          expect(isFlag(rEc.axes.echo.severity), `${rname}/L${lvl} echo150 não flagrou`).toBe(true);

          // Hum 60Hz: fundamental correta em qualquer ritmo/nível.
          const rHm = analyzeAudioPcm(addHum(mk(), SR, 60, -30), SR);
          expect(rHm.hum.humDetected, `${rname}/L${lvl} hum60 não detectado`).toBe(true);
        }
      }
    }
  );
});

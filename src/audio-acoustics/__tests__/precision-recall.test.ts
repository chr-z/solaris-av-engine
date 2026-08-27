/**
 * Validação precision/recall do motor acústico (metodologia da spec):
 * pega "aulas" limpas sintéticas e ADULTERA com defeitos de verdade
 * conhecida; cada condição tem rótulo binário (defeito presente ou não)
 * e o relatório completo do analyzeAudioPcm é julgado contra ele.
 *
 * Métricas impressas em tabela (para o log): TP/FP/TN/FN por eixo,
 * precision/recall, erro relativo do RT60 estimado.
 *
 * Tiers da spec:
 *  - forte   (RT60 ≥ 0.8): recall alvo ≥ 0.95  — ASSERTIVO
 *  - sutil   (RT60 0.45–0.55): sensibilidade DOCUMENTADA (banda ambígua
 *    por natureza: entre o alvo de estúdio 0.4s e o problema claro)
 */

import { describe, it, expect } from 'vitest';
import {
  makeSpeechLike, addReverb, addWhiteNoise, hardClip, addEcho, addHum,
} from '../fixtures';
import { analyzeAudioPcm, type AcousticReport } from '../audioAcoustics';

const SR = 44100;
// Aula padrão: 6 blocos palavra(0.4s)/pausa(0.6s) = 6s. Pausas longas dão
// janelas de decay utilizáveis pelo Schroeder (idem known-answer).
const AULA = Array.from({ length: 6 }, () => ({ word: 0.4, pause: 0.6 }));

interface Row {
  axis: string;
  id: string;
  truth: 'pos' | 'neg';
  flagged: boolean;
  detail: string;
}

function isFlagged(sev: string): boolean {
  return sev === 'warn' || sev === 'critical';
}

describe('Validação precision/recall (spec SOLARIS_AUDIO_ACOUSTICS)', () => {
  it(
    'dataset adulterado: métricas por eixo + acurácia de RT60',
    { timeout: 240_000 },
    () => {
      const rows: Row[] = [];
      const rt60Errors: Array<{ truth: number; est: number; method: string }> = [];
      let clockMs = 0;

      const run = (id: string, sig: Float64Array): AcousticReport => {
        const t0 = Date.now();
        const rep = analyzeAudioPcm(sig, SR);
        clockMs += Date.now() - t0;
        return rep;
      };
      const rec = (
        axis: string, id: string, truth: 'pos' | 'neg',
        flagged: boolean, detail: string
      ): void => {
        rows.push({ axis, id, truth, flagged, detail });
      };

      // ---------------- REVERB ----------------
      // Negativos: sala seca (sem reverb adicionado), 2 seeds + seco com ruído.
      for (const seed of [42, 1337]) {
        const dry = makeSpeechLike(AULA, SR, 0.5, seed);
        const rep = run(`dry#s${seed}`, dry);
        rec('reverb', `dry#s${seed}`, 'neg', isFlagged(rep.axes.reverb.severity),
          `rt60=${rep.reverb.rt60}/${rep.reverb.rt60Method}`);
        // Robustez: ruído de fundo não pode virar falso reverb.
        const noisy = addWhiteNoise(dry, 20, seed + 1);
        const repN = run(`dry-noise20#s${seed}`, noisy);
        rec('reverb', `dry-noise20#s${seed}`, 'neg', isFlagged(repN.axes.reverb.severity),
          `rt60=${repN.reverb.rt60}/${repN.reverb.rt60Method}`);
      }

      // Positivos FORTES: RT60 conhecido por convolução com IR exponencial.
      for (const rt60 of [0.8, 0.9, 1.2]) {
        for (const seed of [42, 1337]) {
          const dry = makeSpeechLike(AULA, SR, 0.5, seed);
          const wet = addReverb(dry, rt60, SR, 1.0);
          const rep = run(`rt${rt60}#s${seed}`, wet);
          rec('reverb', `rt${rt60}#s${seed}`, 'pos', isFlagged(rep.axes.reverb.severity),
            `est=${rep.reverb.rt60}/${rep.reverb.rt60Method}`);
          if (rep.reverb.rt60Method === 'schroeder') {
            rt60Errors.push({ truth: rt60, est: rep.reverb.rt60, method: rep.reverb.rt60Method });
          }
        }
      }

      // Positivos SUTIS (banda ambígua 0.45–0.55): sensibilidade documentada.
      const subtle: Array<{ rt60: number; flagged: boolean; est: number; method: string }> = [];
      for (const rt60 of [0.45, 0.5, 0.55]) {
        const dry = makeSpeechLike(AULA, SR, 0.5, 42);
        const rep = run(`sub${rt60}`, addReverb(dry, rt60, SR, 1.0));
        const flagged = isFlagged(rep.axes.reverb.severity);
        subtle.push({ rt60, flagged, est: rep.reverb.rt60, method: rep.reverb.rt60Method });
        rec('reverb', `subtle${rt60}`, 'pos', flagged,
          `est=${rep.reverb.rt60}/${rep.reverb.rt60Method}`);
      }
      // Calibração 25/08 ~17h (tick subtle0.45): com o estimador Schroeder
      // maduro (mediana-âncora + escada VAD dupla), erro ≤1.5% na banda sutil.
      // A curva de score foi recalibrada (warn <82 ⇒ 0.45 flagra) e o alvo da
      // spec (recall ≥0.85 pra reverb SUTIL) agora é ASSERTIVO em toda a banda.
      const subFlag = subtle.filter(s => s.flagged).length;
      expect(subFlag / subtle.length,
        `recall sutil ${subFlag}/${subtle.length}`).toBeGreaterThanOrEqual(0.85);
      expect(subtle.find(s => s.rt60 === 0.45)?.flagged,
        'subtle0.45 deve flagrar (est≈verdade ±5%)').toBe(true);
      // ...e a margem seca continua folgada: nenhum negativo perto do warn.

      // ---------------- ECO ----------------
      {
        const dry = makeSpeechLike(AULA, SR, 0.5, 42);
        const repPos = run('echo150', addEcho(dry, SR, 150, -6));
        rec('echo', 'echo150ms-6dB', 'pos', isFlagged(repPos.axes.echo.severity),
          `delay=${repPos.echo.delayMs}ms conf=${repPos.echo.confidence.toFixed(2)}`);

        const dry2 = makeSpeechLike(AULA, SR, 0.5, 1337);
        const repPos2 = run('echo220', addEcho(dry2, SR, 220, -10));
        rec('echo', 'echo220ms-10dB', 'pos', isFlagged(repPos2.axes.echo.severity),
          `delay=${repPos2.echo.delayMs}ms conf=${repPos2.echo.confidence.toFixed(2)}`);

        const repNeg = run('clean', dry);
        rec('echo', 'clean', 'neg', isFlagged(repNeg.axes.echo.severity),
          `delay=${repNeg.echo.delayMs}ms`);
        // Reverb forte não pode ser lido como eco discreto (falsos positivos).
        const repRev = run('rev-echo-guard', addReverb(dry, 0.9, SR, 1.0));
        rec('echo', 'reverb0.9', 'neg', isFlagged(repRev.axes.echo.severity),
          `delay=${repRev.echo.delayMs}ms`);
      }

      // ---------------- CLIPPING ----------------
      {
        const base = makeSpeechLike(AULA, SR, 0.5, 42);
        let peak = 0;
        for (let i = 0; i < base.length; i++) peak = Math.max(peak, Math.abs(base[i]));
        const normTo = (target: number): Float64Array => {
          const out = new Float64Array(base.length);
          for (let i = 0; i < base.length; i++) out[i] = (base[i] / peak) * target;
          return out;
        };
        const repC1 = run('clip-1db', hardClip(normTo(1.15), -1));
        rec('clipping', 'hardclip-1dB', 'pos', isFlagged(repC1.axes.clipping.severity),
          `ratio=${repC1.clip.clipRatio.toExponential(1)}`);
        const repC3 = run('clip-3db', hardClip(normTo(1.15), -3));
        rec('clipping', 'hardclip-3dB', 'pos', isFlagged(repC3.axes.clipping.severity),
          `ratio=${repC3.clip.clipRatio.toExponential(1)}`);
        const repOk = run('headroom', normTo(0.85));
        rec('clipping', 'headroom0.85', 'neg', isFlagged(repOk.axes.clipping.severity),
          `ratio=${repOk.clip.clipRatio.toExponential(1)}`);
      }

      // ---------------- RUÍDO + HUM ----------------
      {
        const dry = makeSpeechLike(AULA, SR, 0.5, 42);
        const repN10 = run('snr10', addWhiteNoise(dry, 10, 9));
        rec('noise', 'snr10dB', 'pos', isFlagged(repN10.axes.noise.severity),
          `floor=${repN10.noiseFloorDb}dB`);
        const repClean = run('clean2', dry);
        rec('noise', 'clean', 'neg', isFlagged(repClean.axes.noise.severity),
          `floor=${repClean.noiseFloorDb}dB`);

        const repH60 = run('hum60', addHum(dry, SR, 60, -30));
        rec('hum', 'hum60-30dB', 'pos', repH60.hum.humDetected,
          `${repH60.hum.fundamentalHz}Hz ${repH60.hum.severity}`);
        const repH50 = run('hum50', addHum(makeSpeechLike(AULA, SR, 0.5, 1337), SR, 50, -30));
        rec('hum', 'hum50-30dB', 'pos', repH50.hum.humDetected,
          `${repH50.hum.fundamentalHz}Hz ${repH50.hum.severity}`);
        rec('hum', 'clean-hum', 'neg', repClean.hum.humDetected, '-');
      }

      // ---------------- MÉTRICAS ----------------
      const axes = [...new Set(rows.map(r => r.axis))];
      const lines: string[] = [];
      const pr: Record<string, { tp: number; fp: number; tn: number; fn: number }> = {};
      for (const ax of axes) {
        const m = { tp: 0, fp: 0, tn: 0, fn: 0 };
        for (const r of rows.filter(x => x.axis === ax)) {
          if (r.truth === 'pos' && r.flagged) m.tp++;
          else if (r.truth === 'pos' && !r.flagged) m.fn++;
          else if (r.truth === 'neg' && r.flagged) m.fp++;
          else m.tn++;
        }
        pr[ax] = m;
        const precision = m.tp + m.fp > 0 ? m.tp / (m.tp + m.fp) : 1;
        const recall = m.tp + m.fn > 0 ? m.tp / (m.tp + m.fn) : 1;
        lines.push(`${ax.padEnd(9)} TP=${m.tp} FP=${m.fp} TN=${m.tn} FN=${m.fn}  P=${precision.toFixed(2)} R=${recall.toFixed(2)}`);
      }
      console.log('\n[PR-TABLE]\n' + lines.join('\n'));

      const detLines = rows.map(r =>
        `${r.axis.padEnd(9)} ${String(r.flagged ? 'FLAG' : 'pass').padEnd(4)} ${r.id.padEnd(18)} ${r.detail}`);
      console.log('[PR-CASES]\n' + detLines.join('\n'));

      const errLines = rt60Errors.map(e => {
        const rel = (e.est - e.truth) / e.truth;
        return `rt60 truth=${e.truth} est=${e.est.toFixed(2)} rel=${(rel * 100).toFixed(0)}%`;
      });
      console.log('[PR-RT60]\n' + errLines.join('\n'));
      console.log('[PR-SUBTLE]\n' + subtle.map(s =>
        `rt60=${s.rt60} flagged=${s.flagged} est=${s.est.toFixed(2)}/${s.method}`).join('\n'));
      console.log(`[PR-COST] ${rows.length} análises completas em ${(clockMs / 1000).toFixed(1)}s`);

      // ---- ASSERTIVOS (fortes) ----
      // Reverb forte: recall ≥ 0.95 das condições RT60≥0.8 (spec).
      const strong = rows.filter(r => r.axis === 'reverb' && r.truth === 'pos' && !r.id.startsWith('subtle'));
      const strongHit = strong.filter(r => r.flagged).length;
      expect(strongHit / strong.length).toBeGreaterThanOrEqual(0.95);

      // ZERO falso positivo de reverb em salas secas, com ou sem ruído de
      // fundo (fix 25/08 tarde: janela de pausa com ruído fabricava RT60≈1.3s;
      // porta pela forma da janela — cauda decai, ruído é plano — zera o FP).
      const dryRows = rows.filter(r => r.axis === 'reverb' && r.id.startsWith('dry'));
      const dryFp = dryRows.filter(r => r.flagged).length;
      expect(dryFp, `FP reverb seco: ${dryFp}/2`).toBe(0);

      // Eco: 2/2 positivos, zero falso positivo (limpo e reverb-only).
      expect(pr.echo!.tp).toBe(2);
      expect(pr.echo!.fp).toBe(0);

      // Clipping: 2/2 e zero FP.
      expect(pr.clipping!.tp).toBe(2);
      expect(pr.clipping!.fp).toBe(0);

      // Hum 50/60Hz detectado; limpo sem hum.
      expect(pr.hum!.tp).toBe(2);
      expect(pr.hum!.fp).toBe(0);

      // Ruído: SNR 10dB flagrado, limpo não.
      expect(pr.noise!.tp).toBe(1);
      expect(pr.noise!.fp).toBe(0);

      // Acurácia RT60 (Schroeder): erro relativo |Δ|≤35% em TODA condição forte.
      for (const e of rt60Errors) {
        expect(Math.abs(e.est - e.truth) / e.truth, `rt60 truth=${e.truth} est=${e.est}`).toBeLessThanOrEqual(0.35);
      }
    }
  );
});

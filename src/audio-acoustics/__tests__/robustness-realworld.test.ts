/**
 * ROBUSTEZ MUNDO-REAL (além dos sintéticos limpos do known-answer/precision-recall):
 *
 *  1) Invariância de taxa de amostragem — o produto recebe áudio do YouTube
 *     (48k/22.05k) e gravações locais (16k/44.1k); os detectores precisam
 *     manter as MESMAS decisões flag/ok e estimativas são em qualquer taxa.
 *  2) Entradas degeneradas (vazia, sub-janela de FFT, canal travado em DC) —
 *     relatório sempre bem-formado: zero NaN/Inf (NaN quebra o JSON do
 *     sheet-sync), zero crash, e canal constante NÃO pode ler como clipping.
 *  3) Round-trip codec lossy REAL (mp3 96k / m4a-aac 128k via ffmpeg-static,
 *     dependência que já existe no projeto): o áudio do Gran chega codificado
 *     pelo YouTube — a detecção tem que sobreviver ao codec, não só ao PCM.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import {
  makeSpeechLike, addReverb, addEcho, addHum, hardClip, toFloat32,
} from '../fixtures';
import { analyzeAudioPcm, type AcousticReport } from '../audioAcoustics';

const require_ = createRequire(import.meta.url);
const FF = require_('ffmpeg-static') as string;

const SR = 44100;
const CANON = Array.from({ length: 6 }, () => ({ word: 0.4, pause: 0.6 }));
const isFlag = (s: string) => s === 'warn' || s === 'critical';

/** Todo relatório deste arquivo precisa ser serializável: zero NaN/Inf. */
function expectWellFormed(r: AcousticReport, label: string): void {
  const nums: Array<[string, number]> = [
    ['overallScore', r.overallScore],
    ['durationSec', r.durationSec],
    ['noiseFloorDb', r.noiseFloorDb],
    ['sibilanceRatioDb', r.sibilanceRatioDb],
    ['reverb.rt60', r.reverb.rt60],
    ['echo.confidence', r.echo.confidence],
    ['clip.peakDb', r.clip.peakDb],
  ];
  for (const [k, axis] of Object.entries(r.axes)) {
    nums.push([`${k}.score`, axis.score], [`${k}.value`, axis.value]);
  }
  for (const [k, v] of nums) {
    expect(Number.isFinite(v), `${label}: ${k}=${v} não-finito`).toBe(true);
  }
}

/** Codifica PCM f32le mono num codec lossy real e decodifica de volta p/ PCM. */
function transcodeLossy(pcm: Float32Array | Float64Array, sampleRate: number, ext: 'mp3' | 'm4a', bitrate: string): Float32Array {
  expect(existsSync(FF), 'ffmpeg-static não encontrado no node_modules').toBe(true);
  const dir = mkdtempSync(join(tmpdir(), 'solaris-codec-'));
  try {
    const raw = join(dir, 'in.f32');
    const enc = join(dir, `out.${ext}`);
    const dec = join(dir, 'dec.f32');
    const f32 = toFloat32(Float64Array.from(pcm));
    writeFileSync(raw, Buffer.from(f32.buffer, 0, f32.byteLength));
    execFileSync(
      FF,
      ['-y', '-hide_banner', '-loglevel', 'error',
       '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-i', raw,
       '-b:a', bitrate, enc],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    expect(existsSync(enc), `encoder não produziu ${enc}`).toBe(true);
    execFileSync(
      FF,
      ['-y', '-hide_banner', '-loglevel', 'error',
       '-i', enc, '-f', 'f32le', '-c:a', 'pcm_f32le',
       '-ar', String(sampleRate), '-ac', '1', dec],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    const buf = readFileSync(dec);
    const usable = buf.byteLength - (buf.byteLength % 4);
    return new Float32Array(buf.buffer, buf.byteOffset, usable / 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Robustez 1 — invariância de sample rate', () => {
  const RATES = [16000, 22050, 32000, 48000];

  it(
    'seco permanece ok; reverb/eco/hum mantêm decisão e RT60 são em qualquer taxa',
    { timeout: 900_000 },
    () => {
      for (const sr of RATES) {
        const mk = () => makeSpeechLike(CANON, sr, 0.5, 42);

        // Seco: zero flag em qualquer taxa.
        const dry = analyzeAudioPcm(mk(), sr);
        expectWellFormed(dry, `sr${sr}/dry`);
        expect(dry.axes.reverb.severity, `sr${sr} dry flagou reverb`).toBe('ok');
        expect(dry.axes.echo.severity, `sr${sr} dry flagou eco`).toBe('ok');

        // Reverb forte RT60 0.9: sempre flagrado, estimativa dentro de ±35%.
        const wet = analyzeAudioPcm(addReverb(mk(), 0.9, sr, 1.0), sr);
        expectWellFormed(wet, `sr${sr}/rt0.9`);
        expect(isFlag(wet.axes.reverb.severity), `sr${sr} rt0.9 não flagrou (${wet.reverb.rt60Method})`).toBe(true);
        if (wet.reverb.rt60Method === 'schroeder') {
          expect(Math.abs(wet.reverb.rt60 - 0.9) / 0.9, `sr${sr} rt0.9 est=${wet.reverb.rt60}`).toBeLessThanOrEqual(0.35);
        }

        // Eco real 150ms/-6dB: detectado em qualquer taxa.
        const ec = analyzeAudioPcm(addEcho(mk(), sr, 150, -6), sr);
        expectWellFormed(ec, `sr${sr}/echo`);
        expect(isFlag(ec.axes.echo.severity), `sr${sr} eco150 não flagrou`).toBe(true);

        // Hum 60Hz: fundamental correta em qualquer taxa.
        const hm = analyzeAudioPcm(addHum(mk(), sr, 60, -25), sr);
        expectWellFormed(hm, `sr${sr}/hum`);
        expect(hm.hum.humDetected, `sr${sr} hum60 não detectado`).toBe(true);
        expect(hm.hum.fundamentalHz, `sr${sr} hum fundamental errada`).toBe(60);
      }
    }
  );
});

describe('Robustez 2 — entradas degeneradas', () => {
  it('vazio e sub-janela de FFT: relatório bem-formado, sem NaN', () => {
    for (const [label, n] of [['vazio', 0], ['sub-janela', 2000]] as const) {
      const r = analyzeAudioPcm(new Float64Array(n), SR);
      expectWellFormed(r, label);
      expect(r.durationSec).toBeCloseTo(n / SR, 5);
    }
  });

  it('canal travado (DC constante 3s): não lê como clipping nem crasha', () => {
    const dc = new Float64Array(3 * SR).fill(0.5);
    const r = analyzeAudioPcm(dc, SR);
    expectWellFormed(r, 'dc');
    expect(r.axes.clipping.severity, 'canal constante leu como clipping').toBe('ok');
    // Patologia conhecida, documentada e NÃO assertada neste tick: o fallback
    // C50 de um sinal congelado lê como reverb crítico (energia "tardia"
    // domina por construção geométrica do split 50ms). O alarme existe
    // (overall despenca), só o RÓTULO do eixo é impreciso p/ esse caso
    // patológico que não ocorre em gravação real.
  });

  it('sinal quente limpo (pico ~-0.5dBFS, sem saturação): clipping permanece ok', () => {
    // Fixture estruturalmente igual ao do qcIntegration (16k, palavras longas,
    // gerador sem normalização de ganho → pico encosta no teto): o crest cai
    // mas NÃO cruza o corte de saturação (medido: frac ≤0.31 × corte 0.45).
    const hot = makeSpeechLike(
      [
        { word: 1.2, pause: 0.9 }, { word: 1.4, pause: 0.9 }, { word: 1.2, pause: 0.9 },
        { word: 1.6, pause: 0.9 }, { word: 1.3, pause: 0.0 },
      ],
      16000
    );
    const r = analyzeAudioPcm(hot, 16000);
    expectWellFormed(r, 'hot16');
    expect(r.axes.clipping.severity, `hot16 limpo flagrou clipping (${r.axes.clipping.explanation})`).toBe('ok');
  });
});

describe('Robustez 3 — round-trip codec lossy real (ffmpeg)', () => {
  it(
    'mp3 96k: decisões de todos os eixos sobrevivem ao codec',
    { timeout: 900_000 },
    () => {
      const mk = () => makeSpeechLike(CANON, SR, 0.7, 42);
      const mkLoud = () => makeSpeechLike(CANON, SR, 1.15, 42); // pico acima do teto

      // Limpo codificado: continua limpo (zero FP induzido por codec).
      const dry = analyzeAudioPcm(transcodeLossy(mk(), SR, 'mp3', '96k'), SR);
      expectWellFormed(dry, 'mp3/dry');
      expect(dry.axes.reverb.severity, 'mp3 dry flagou reverb').toBe('ok');
      expect(dry.axes.echo.severity, 'mp3 dry flagou eco').toBe('ok');
      expect(dry.hum.humDetected, 'mp3 dry inventou hum').toBe(false);

      // Reverb RT60 0.9 codificado: segue flagrado.
      const wet = analyzeAudioPcm(transcodeLossy(addReverb(mk(), 0.9, SR, 1.0), SR, 'mp3', '96k'), SR);
      expectWellFormed(wet, 'mp3/rt0.9');
      expect(isFlag(wet.axes.reverb.severity), `mp3 rt0.9 não flagrou (${wet.reverb.rt60Method})`).toBe(true);

      // Eco 150ms/-6dB codificado: segue flagrado.
      const ec = analyzeAudioPcm(transcodeLossy(addEcho(mk(), SR, 150, -6), SR, 'mp3', '96k'), SR);
      expectWellFormed(ec, 'mp3/echo');
      expect(isFlag(ec.axes.echo.severity), 'mp3 eco150 não flagrou').toBe(true);

      // Hum 60Hz codificado: grave sobrevive bem a lossy.
      const hm = analyzeAudioPcm(transcodeLossy(addHum(mk(), SR, 60, -25), SR, 'mp3', '96k'), SR);
      expectWellFormed(hm, 'mp3/hum');
      expect(hm.hum.humDetected, 'mp3 hum60 não detectado').toBe(true);

      // Hard clip codificado: plateaus têm que continuar evidentes.
      const cl = analyzeAudioPcm(transcodeLossy(hardClip(mkLoud(), -1), SR, 'mp3', '96k'), SR);
      expectWellFormed(cl, 'mp3/clip');
      expect(isFlag(cl.axes.clipping.severity), `mp3 clip não flagrou (ratio=${cl.clip.clipRatio}, runs=${cl.clip.clipRunLen})`).toBe(true);
    }
  );

  it(
    'aac 128k (m4a): limpo continua limpo, reverb segue flagrado',
    { timeout: 900_000 },
    () => {
      const mk = () => makeSpeechLike(CANON, SR, 0.7, 42);

      const dry = analyzeAudioPcm(transcodeLossy(mk(), SR, 'm4a', '128k'), SR);
      expectWellFormed(dry, 'aac/dry');
      expect(dry.axes.reverb.severity, 'aac dry flagou reverb').toBe('ok');
      expect(dry.axes.echo.severity, 'aac dry flagou eco').toBe('ok');

      const wet = analyzeAudioPcm(transcodeLossy(addReverb(mk(), 0.9, SR, 1.0), SR, 'm4a', '128k'), SR);
      expectWellFormed(wet, 'aac/rt0.9');
      expect(isFlag(wet.axes.reverb.severity), `aac rt0.9 não flagrou (${wet.reverb.rt60Method})`).toBe(true);
    }
  );
});

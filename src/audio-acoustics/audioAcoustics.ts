/**
 * Solaris Acoustic Analysis API (P3 surface sobre o núcleo P1).
 *
 * Entrada: PCM mono Float32/Float64 + sampleRate (caminho puro, testável).
 * Saída: relatório com score de QUALIDADE 0-100 por eixo (100 = limpo),
 * severidade, marcas de timeline, explicações geradas dos números e
 * suporte a baseline por estúdio.
 *
 * Decodificação de arquivo/URL usa AudioContext quando disponível (browser);
 * em Node/jsdom use analyzeAudioPcm diretamente após decodificar.
 */

import { FFT, hannWindow } from './fft';
import { rmsTime } from './features';
import { detectClip, estimateTHDFromSpectrum, type ClipResult } from './clipping';
import { detectHum, estimateNoiseFloorDb, sibilanceRatioDb, percentile } from './noise';
import { detectEcho, type EchoResult } from './echo';
import { analyzeReverb, type ReverbResult } from './reverb';

export interface StudioBaseline {
  /** RT60 alvo do estúdio (s). Desvios para cima penalizam mais cedo. */
  rt60Target?: number;
  /** Noise floor aceitável (dBFS). */
  noiseFloorDbMax?: number;
  /** Nome/ID do estúdio (para explicações). */
  name?: string;
}

export interface AcousticOptions {
  fftSize?: number;
  hop?: number;
  baseline?: StudioBaseline;
  /** Analisa eco apenas nestas janelas (padrão: até 10 janelas de 15s espalhadas). */
  echoWindowsSec?: number;
}

export type Severity = 'ok' | 'warn' | 'critical';

export interface AxisResult {
  /** Qualidade 0-100 (100 = limpo). */
  score: number;
  severity: Severity;
  /** Métrica principal do eixo (RT60 s, % clip, dB floor, THD razão, ms delay…). */
  value: number;
  /** Explicação gerada dos números. */
  explanation: string;
}

export interface TimelineMark {
  tSec: number;
  axis: 'clipping' | 'reverb' | 'echo' | 'noise' | 'hum';
  severity: Exclude<Severity, 'ok'>;
  note: string;
}

export interface AcousticReport {
  durationSec: number;
  sampleRate: number;
  axes: {
    reverb: AxisResult;
    clipping: AxisResult;
    distortion: AxisResult;
    noise: AxisResult;
    echo: AxisResult;
    sibilance: AxisResult;
  };
  /** Score consolidado (média ponderada; reverb pesa 2x — prioridade do produto). */
  overallScore: number;
  timelineMarks: TimelineMark[];
  reverb: ReverbResult;
  echo: EchoResult;
  hum: ReturnType<typeof detectHum>;
  clip: ClipResult;
  noiseFloorDb: number;
  sibilanceRatioDb: number;
  /** Mudança acústica mid-video (INFO). */
  acousticShift: { detected: boolean; tSec: number; note: string };
  warnings: string[];
}

const clamp01_100 = (v: number) => Math.max(0, Math.min(100, v));

/** Interpolação piecewise: pontos [x0,y0],[x1,y1]… decrescentes. */
function piecewise(points: Array<[number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

function sevFromScore(score: number, warnBelow = 75, critBelow = 50): Severity {
  if (score < critBelow) return 'critical';
  if (score < warnBelow) return 'warn';
  return 'ok';
}

/**
 * Análise pura sobre PCM mono. Determinística, sem acesso a DOM/AudioContext.
 */
export function analyzeAudioPcm(
  samplesIn: Float32Array | Float64Array,
  sampleRate: number,
  opts?: AcousticOptions
): AcousticReport {
  const fftSize = opts?.fftSize ?? 4096;
  const hop = Math.min(opts?.hop ?? 1024, fftSize);
  const warnings: string[] = [];

  const samples = samplesIn instanceof Float64Array ? samplesIn : new Float64Array(samplesIn);
  const durationSec = samples.length / sampleRate;

  // ---------- Frames STFT ----------
  const fft = new FFT(fftSize);
  const win = hannWindow(fftSize);
  const halfBins = fftSize / 2 + 1;

  // Correção de ganho da janela Hann para RMS coerente.
  let winPower = 0;
  for (let i = 0; i < fftSize; i++) winPower += win[i] * win[i];
  const winRmsCorrection = Math.sqrt(fftSize / winPower);

  const frameRmsDb: number[] = [];
  const meanPowSpec = new Float64Array(halfBins);
  const clipEvents: Array<{ sampleIdx: number; runLen: number }> = [];
  let globalPeakDb = -120;
  let tonalFrames = 0;
  const thdSamples: number[] = [];
  const sibSamples: number[] = [];

  const numFrames = Math.max(0, Math.floor((samples.length - fftSize) / hop) + 1);
  for (let f = 0; f < numFrames; f++) {
    const off = f * hop;
    const mags = fft.magnitudeSpectrum(samples.subarray(off, off + fftSize) as Float64Array, win);

    // RMS do frame no tempo (barato e exato).
    const fr = rmsTime(samples.subarray(off, off + fftSize));
    frameRmsDb.push(fr > 0 ? 20 * Math.log10(fr * winRmsCorrection) : -120);

    // Espectro médio (potência).
    for (let k = 0; k < halfBins; k++) meanPowSpec[k] += mags[k] * mags[k];

    // Clipping absoluto neste frame (para timeline).
    const clip = detectClip(samples.subarray(off, off + fftSize), 1.0);
    if (clip.hasClip) {
      clipEvents.push({ sampleIdx: off, runLen: clip.clipRunLen });
    }

    // THD apenas em frames tonais (fundamental identificável).
    const fundBinEst = argmax(mags, 2, Math.floor(2000 / (sampleRate / fftSize)));
    if (fundBinEst > 0 && mags[fundBinEst] > localMed(mags, fundBinEst, 24) * 8) {
      tonalFrames++;
      if (thdSamples.length < 400) {
        thdSamples.push(estimateTHDFromSpectrum(mags, sampleRate, fftSize));
      }
    }
    if (sibSamples.length < 800) sibSamples.push(sibilanceRatioDb(mags, sampleRate, fftSize));
  }

  // Pico global.
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > globalPeakDb) globalPeakDb = a; // reuse como pico linear temporariamente
  }
  globalPeakDb = globalPeakDb > 0 ? 20 * Math.log10(globalPeakDb) : -120;

  // Espectro médio final (magnitude).
  const avgMags = new Float64Array(halfBins);
  const nSpec = Math.max(numFrames, 1);
  for (let k = 0; k < halfBins; k++) avgMags[k] = Math.sqrt(meanPowSpec[k] / nSpec);

  // ---------- Eixos ----------
  // Reverb (prioridade máxima).
  const reverb = analyzeReverb(samples, sampleRate);
  const rt60Target = opts?.baseline?.rt60Target ?? 0.4;
  const reverbScore = clamp01_100(piecewise(
    [[Math.min(rt60Target, 0.3), 96], [0.45, 82], [0.6, 62], [0.8, 42], [1.2, 18], [2.0, 5]],
    reverb.rt60 || 2.5
  ));
  const reverbSev = sevFromScore(reverbScore, 78, 55);

  // Clipping: evidência absoluta + flat-top em qualquer teto é checada aqui em cima
  // do pico global (sub-ceil clipping) — passamos threshold dinâmico.
  const absCeil = Math.pow(10, -0.01 / 20); // ~0dBFS
  const clipAbs = detectClip(samples, absCeil);
  // Flat-top sub-ceil: plateaus ≥4 samples dentro de 1dB abaixo do pico global.
  const flatTop = detectPlateausNearCeil(samples, Math.pow(10, (globalPeakDb - 1.2) / 20));
  const subCeilClip = flatTop.count >= 8 && clipAbs.flatTopRuns < flatTop.count / 4;
  const clipRatio = Math.max(clipAbs.clipRatio, flatTop.samples / Math.max(samples.length, 1));
  // Hard clip digital tem assinatura exata (samples bit-idênticos saturados):
  // mesmo com poucos samples afetados, a evidência é definitiva — o score não
  // pode ficar alto só porque a razão é pequena.
  const definiteHardClip = clipAbs.exactSatRuns >= 2;
  let clippingScore = !clipAbs.hasClip && !subCeilClip
    ? 98
    : clamp01_100(piecewise([[0, 92], [0.0005, 72], [0.003, 45], [0.02, 15], [0.08, 3]], clipRatio));
  if (definiteHardClip) clippingScore = Math.min(clippingScore, 40);
  const clippingSev = sevFromScore(clippingScore, 80, 50);

  // Distorção: THD mediana dos frames tonais; sem tonalidade → neutro-bom.
  let distortionValue = 0;
  let distortionScore: number;
  if (tonalFrames >= 5 && thdSamples.length > 0) {
    distortionValue = percentile(thdSamples, 50);
    distortionScore = clamp01_100(piecewise(
      [[0, 97], [0.01, 88], [0.03, 68], [0.08, 40], [0.2, 15]],
      distortionValue
    ));
  } else {
    distortionScore = clipAbs.hasClip || subCeilClip ? 55 : 92;
    // Aviso só faz sentido quando a falta de tom NÃO é explicada por clipping
    // (com clipping confirmado, o eixo clipping já carrega a informação).
    if (!(clipAbs.hasClip || subCeilClip)) {
      warnings.push('Sem tom sustentado identificável — THD não mensurável neste trecho.');
    }
  }
  const distortionSev = sevFromScore(distortionScore, 78, 50);

  // Ruído: noise floor = percentil 10 dos RMS por frame.
  const noiseFloorDb = estimateNoiseFloorDb(frameRmsDb, 10);
  const floorMax = opts?.baseline?.noiseFloorDbMax ?? -45;
  const noiseScoreRaw = clamp01_100(piecewise(
    [[-70, 97], [-60, 85], [-50, 75], [-40, 90], [-30, 30]],
    noiseFloorDb
  ));

  // Hum no espectro médio — hum confirmado penaliza o eixo ruído.
  const hum = detectHum(avgMags, sampleRate, fftSize);
  let humNoisePenalty = 0;
  if (hum.humDetected) {
    humNoisePenalty = hum.severity === 'heavy' ? 40 : hum.severity === 'moderate' ? 22 : 10;
    warnings.push(`Hum ${hum.fundamentalHz}Hz detectado (${hum.severity}, ${hum.harmonicCount} harmônicos, ${hum.humLevelDb}dBFS).`);
  }
  const noiseScoreFinal = clamp01_100(noiseScoreRaw - humNoisePenalty);
  const noiseSev = sevFromScore(noiseScoreFinal, 75, 50);

  // Eco.
  const echoWinSec = opts?.echoWindowsSec ?? 15;
  const echo = detectEchoWindows(samples, sampleRate, echoWinSec);
  const echoScore = !echo.hasEcho
    ? 96
    : clamp01_100(piecewise([[0.25, 65], [0.4, 45], [0.6, 28], [0.9, 10]], echo.confidence));
  const echoSev = sevFromScore(echoScore, 75, 50);

  // Sibilância: mediana das razões por frame.
  const sibDb = sibSamples.length ? percentile(sibSamples, 50) : 0;
  const sibilanceScore = clamp01_100(piecewise([[-10, 96], [-6, 86], [-2, 68], [2, 45], [8, 25]], sibDb));
  const sibilanceSev = sevFromScore(sibilanceScore, 70, 45);

  // Mudança acústica mid-video: compara ruído/centroide entre quartis.
  const acousticShift = detectAcousticShift(frameRmsDb, hop, sampleRate, fftSize);

  // ---------- Timeline ----------
  const timelineMarks: TimelineMark[] = [];
  const seenSecs = new Set<string>();
  for (const ev of clipEvents.slice(0, 200)) {
    const tSec = Math.floor(ev.sampleIdx / sampleRate);
    const key = `c${tSec}`;
    if (!seenSecs.has(key)) {
      seenSecs.add(key);
      timelineMarks.push({
        tSec,
        axis: 'clipping',
        severity: clippingSev === 'critical' ? 'critical' : 'warn',
        note: `clip ${ev.runLen} samples`,
      });
    }
  }
  if (reverb.rt60Method === 'schroeder') {
    timelineMarks.push({
      tSec: 0,
      axis: 'reverb',
      severity: reverbSev === 'critical' ? 'critical' : 'warn',
      note: `RT60≈${reverb.rt60}s (${reverb.usedWindows} janelas de decay)`,
    });
  }
  if (echo.hasEcho) {
    timelineMarks.push({
      tSec: 0,
      axis: 'echo',
      severity: echoSev === 'critical' ? 'critical' : 'warn',
      note: `eco ${echo.delayMs}ms conf=${echo.confidence}`,
    });
  }
  if (hum.humDetected) {
    timelineMarks.push({
      tSec: 0,
      axis: 'hum',
      severity: hum.severity === 'heavy' ? 'critical' : 'warn',
      note: `hum ${hum.fundamentalHz}Hz ${hum.humLevelDb}dBFS`,
    });
  }

  // ---------- Scores finais + explicações ----------
  const axes = {
    reverb: makeAxis(reverbScore, reverbSev, reverb.rt60,
      explainReverb(reverb, rt60Target, opts?.baseline?.name)),
    clipping: makeAxis(clippingScore, clippingSev, clipRatio,
      explainClipping(clipAbs, subCeilClip, clipRatio)),
    distortion: makeAxis(distortionScore, distortionSev, distortionValue,
      explainDistortion(distortionValue, tonalFrames, clipAbs.hasClip || subCeilClip)),
    noise: makeAxis(noiseScoreFinal, noiseSev, noiseFloorDb,
      explainNoise(noiseFloorDb, floorMax, opts?.baseline?.name)),
    echo: makeAxis(echoScore, echoSev, echo.delayMs,
      explainEcho(echo)),
    sibilance: makeAxis(sibilanceScore, sibilanceSev, sibDb,
      explainSibilance(sibDb)),
  };

  const overallScore = Math.round(
    axes.reverb.score * 0.25 +
    axes.clipping.score * 0.2 +
    axes.distortion.score * 0.15 +
    axes.noise.score * 0.2 +
    axes.echo.score * 0.15 +
    axes.sibilance.score * 0.05
  );

  return {
    durationSec,
    sampleRate,
    axes,
    overallScore,
    timelineMarks,
    reverb,
    echo,
    hum,
    clip: clipAbs,
    noiseFloorDb: Math.round(noiseFloorDb * 10) / 10,
    sibilanceRatioDb: Math.round(sibDb * 10) / 10,
    acousticShift,
    warnings,
  };
}

// ---------- helpers ----------

function makeAxis(score: number, severity: Severity, value: number, explanation: string): AxisResult {
  return { score: Math.round(score), severity, value, explanation };
}

function argmax(arr: Float64Array, from: number, to: number): number {
  let bi = -1, bv = -Infinity;
  const hi = Math.min(to, arr.length - 1);
  for (let i = Math.max(0, from); i <= hi; i++) {
    if (arr[i] > bv) { bv = arr[i]; bi = i; }
  }
  return bi;
}

function localMed(arr: Float64Array, center: number, radius: number): number {
  const vals: number[] = [];
  for (let k = Math.max(0, center - radius); k <= Math.min(arr.length - 1, center + radius); k++) vals.push(arr[k]);
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)] ?? 0;
}

/**
 * Detecta plateaus (runs de valores ~idênticos) próximos ao teto dado —
 * assinatura de hard clip mesmo abaixo de 0dBFS.
 */
function detectPlateausNearCeil(samples: Float64Array | Float32Array, ceilAmp: number): { count: number; samples: number; longest: number } {
  const EPS = 1e-4;
  let count = 0, total = 0, longest = 0;
  let run = 1;
  for (let i = 1; i < samples.length; i++) {
    const cur = Math.abs(samples[i]);
    const prev = Math.abs(samples[i - 1]);
    if (cur >= ceilAmp && Math.abs(cur - prev) <= EPS) {
      run++;
    } else {
      if (run >= 4) { count++; total += run; longest = Math.max(longest, run); }
      run = 1;
    }
  }
  if (run >= 4) { count++; total += run; longest = Math.max(longest, run); }
  return { count, samples: total, longest };
}

/** Eco avaliado em até 10 janelas espalhadas pelo arquivo (custo limitado). */
function detectEchoWindows(samples: Float64Array, sampleRate: number, winSec: number): EchoResult {
  const winLen = Math.min(Math.floor(winSec * sampleRate), samples.length);
  if (winLen < sampleRate * 2) {
    return detectEcho(samples, sampleRate);
  }
  const maxWindows = 10;
  const stride = Math.max(winLen, Math.floor((samples.length - winLen) / (maxWindows - 1)));
  for (let start = 0; start + winLen <= samples.length; start += stride) {
    const r = detectEcho(samples.subarray(start, start + winLen) as Float64Array, sampleRate);
    if (r.hasEcho) return { ...r, delayMs: r.delayMs }; // primeiro hit já qualifica
  }
  return { delayMs: 0, delaySamples: 0, confidence: 0, isReal: false, hasEcho: false };
}

/** Shift acústico: queda/descolamento grande entre quartis do RMS-frame. */
function detectAcousticShift(
  frameRmsDb: number[],
  hop: number,
  sampleRate: number,
  fftSize: number
): { detected: boolean; tSec: number; note: string } {
  const q = 4;
  const per = Math.max(1, Math.floor(frameRmsDb.length / q));
  const medians: number[] = [];
  for (let i = 0; i < q; i++) {
    const slice = frameRmsDb.slice(i * per, Math.min(frameRmsDb.length, (i + 1) * per));
    medians.push(slice.length ? percentile(slice, 50) : -120);
  }
  for (let i = 1; i < q; i++) {
    const jump = Math.abs(medians[i] - medians[i - 1]);
    if (jump >= 9) {
      const tSec = Math.round(((i * per * hop + fftSize / 2) / sampleRate) * 10) / 10;
      return {
        detected: true,
        tSec,
        note: `Nível médio mudou ${jump.toFixed(1)}dB entre blocos ${i - 1}→${i} (possível troca de sala/mic)`,
      };
    }
  }
  return { detected: false, tSec: 0, note: '' };
}

// ---------- explicações ----------

function explainReverb(r: ReverbResult, target: number, studio?: string): string {
  const alvo = studio ? `alvo ${target}s do estúdio ${studio}` : `referência ${target}s`;
  if (r.rt60Method === 'schroeder') {
    const extra = r.rt60 > target ? `acima do ${alvo}` : `dentro do ${alvo}`;
    return `RT60≈${r.rt60}s (${extra}); método Schroeder em ${r.usedWindows} pausa(s) de fala; C50=${r.c50}dB.`;
  }
  if (r.rt60Method === 'c50-fallback') {
    const extra = r.rt60 > target ? `acima do ${alvo}` : `dentro do ${alvo}`;
    return `Sem pausas claras p/ Schroeder; C50=${r.c50}dB/C80=${r.c80}dB sugere sala "${r.classification}" (estimativa ${r.rt60}s; ${extra}).`;
  }
  return 'Trecho curto demais para estimar reverb.';
}
function explainClipping(c: ClipResult, subCeil: boolean, ratio: number): string {
  if (!c.hasClip && !subCeil) return `Sem clipping (pico ${Math.round(c.peakDb * 10) / 10}dBFS).`;
  const modo = subCeil && !c.hasClip ? 'plateaus de hard clip abaixo de 0dBFS' : 'samples em 0dBFS';
  return `Clipping por ${modo}: ${(ratio * 100).toFixed(3)}% dos samples, run máx ${c.clipRunLen}.`;
}
function explainDistortion(thd: number, tonalFrames: number, clipped: boolean): string {
  if (tonalFrames < 5) return clipped ? 'THD não mensurável; há clipping que sugere distorção.' : 'Conteúdo não tonal — THD n/a.';
  return `THD≈${(thd * 100).toFixed(1)}% (mediana de ${tonalFrames} frames tonais).`;
}
function explainNoise(floorDb: number, floorMax: number, studio?: string): string {
  const ref = studio ? `máximo ${floorMax}dBFS de ${studio}` : `referência ${floorMax}dBFS`;
  return `Noise floor ${Math.round(floorDb)}dBFS (percentil 10; ${ref}).`;
}
function explainEcho(e: EchoResult): string {
  if (!e.hasEcho) return 'Sem eco perceptível (autocorrelação do envelope sem pico proeminente ≥80ms).';
  return `Eco real: delay ${e.delayMs}ms, confiança ${(e.confidence * 100).toFixed(0)}%.`;
}
function explainSibilance(db: number): string {
  return db > 0
    ? `Energia 5-10kHz excede 500-2kHz em ${db.toFixed(1)}dB — sibilância forte.`
    : `Balanço de sibilância ok (5-10kHz está ${Math.abs(db).toFixed(1)}dB abaixo do mid).`;
}

// ---------- entrada de alto nível ----------

/**
 * Decodifica arquivo/ArrayBuffer via AudioContext (browser) e analisa.
 * Em ambiente sem WebAudio lança erro orientado — use analyzeAudioPcm.
 */
export async function analyzeAudio(
  input: ArrayBuffer | Float32Array | Float64Array,
  sampleRateIfRaw = 48000,
  opts?: AcousticOptions
): Promise<AcousticReport> {
  let samples: Float32Array | Float64Array;
  let sr = sampleRateIfRaw;
  if (input instanceof ArrayBuffer) {
    const AC = (globalThis as { AudioContext?: new () => { decodeAudioData(b: ArrayBuffer): Promise<{ sampleRate: number; getChannelData(ch: number): Float32Array }>; close?(): void } }).AudioContext;
    if (!AC) throw new Error('AudioContext indisponível neste runtime; decodifique externamente e use analyzeAudioPcm().');
    const ctx = new AC();
    try {
      const buf = await ctx.decodeAudioData(input);
      samples = buf.getChannelData(0);
      sr = buf.sampleRate;
    } finally {
      ctx.close?.();
    }
  } else {
    samples = input;
  }
  return analyzeAudioPcm(samples, sr, opts);
}

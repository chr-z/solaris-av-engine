/**
 * Eco real (delay distinto de sala): autocorrelação NORMALIZADA do envelope
 * em blocos, com proeminência local — o pico em d só conta se dominar a
 * vizinhança ±lag. Eco real: delay ≥80ms.
 */

import { amplitudeEnvelope } from './features';

export interface EchoResult {
  /** Delay do pico aceito, em ms (0 se nenhum). */
  delayMs: number;
  delaySamples: number;
  /** Autocorrelação normalizada no pico (0-1). */
  confidence: number;
  isReal: boolean;
  hasEcho: boolean;
}

/**
 * Autocorrelação por blocos sobre o envelope (downsampled para ~1kHz):
 * r(d) = Σ env[i]·env[i+d] / sqrt(Σenv[i]²·Σenv[i+d]²), normalizada.
 */
function envelopeAutocorr(
  env: Float64Array,
  minLag: number,
  maxLag: number
): { lags: Float64Array; values: Float64Array } {
  const n = env.length;
  const numLags = maxLag - minLag + 1;
  const lags = new Float64Array(numLags);
  const values = new Float64Array(numLags);

  for (let d = minLag; d <= maxLag; d++) {
    let s0 = 0, s1 = 0, cross = 0;
    const m = n - d;
    for (let i = 0; i < m; i++) {
      const a = env[i];
      const b = env[i + d];
      s0 += a * a;
      s1 += b * b;
      cross += a * b;
    }
    const norm = Math.sqrt(s0 * s1);
    lags[d - minLag] = d;
    values[d - minLag] = norm > 0 ? cross / norm : 0;
  }
  return { lags, values };
}

/** Mediana local dos valores numa janela de raio r ao redor de idx. */
function medianAround(values: Float64Array, idx: number, radius: number): number {
  const vals: number[] = [];
  for (let k = Math.max(0, idx - radius); k <= Math.min(values.length - 1, idx + radius); k++) {
    if (k !== idx) vals.push(values[k]);
  }
  vals.sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length / 2)] : 0;
}

/**
 * Detecta eco real no trecho. Requer:
 * - pico normalizado ≥ threshold;
 * - proeminência local: pico ≥ 2× mediana da vizinhança ±40ms;
 * - nitidez: domina a borda ±(4..12)ms (ecos discretos são PICOS finos;
 *   auto-similaridade de prosódia é LARGA);
 * - delay ≥ 80ms (definição de eco vs reflexão inicial).
 *
 * Branqueamento (env[n] - 0.97·env[n-1]) antes da ACF: suprime a
 * auto-similaridade lenta da fala que criava falsos máximos largos
 * (pico verdadeiro em 150ms perdia para um ombro em ~80ms).
 */
export function detectEcho(
  samples: Float64Array | Float32Array,
  sampleRate: number,
  opts?: { threshold?: number; minDelayMs?: number }
): EchoResult {
  const threshold = opts?.threshold ?? 0.07;
  const minDelayMs = opts?.minDelayMs ?? 80;

  // Envelope downsampled a ~1kHz (bloco = sampleRate/1000).
  const block = Math.max(1, Math.floor(sampleRate / 1000));
  const nBlocks = Math.floor(samples.length / block);
  if (nBlocks < 200) return { delayMs: 0, delaySamples: 0, confidence: 0, isReal: false, hasEcho: false };

  const raw = new Float64Array(nBlocks);
  for (let i = 0; i < nBlocks; i++) {
    let s = 0;
    for (let j = i * block; j < (i + 1) * block; j++) s += Math.abs(samples[j]);
    raw[i] = s / block;
  }

  // Whitening: high-pass 1ª ordem (~5Hz @1kHz).
  const env = new Float64Array(nBlocks);
  let prev = raw[0];
  for (let i = 0; i < nBlocks; i++) {
    env[i] = raw[i] - 0.97 * prev;
    prev = raw[i];
  }

  const msPerBlock = (block / sampleRate) * 1000;
  const minLag = Math.max(1, Math.ceil(minDelayMs / msPerBlock));
  const maxLag = Math.min(nBlocks - 50, Math.floor(600 / msPerBlock));
  if (maxLag <= minLag + 10) {
    return { delayMs: 0, delaySamples: 0, confidence: 0, isReal: false, hasEcho: false };
  }

  const { lags, values } = envelopeAutocorr(env, minLag, maxLag);

  let bestIdx = -1;
  let bestVal = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > bestVal) { bestVal = values[i]; bestIdx = i; }
  }
  if (bestIdx < 0 || bestVal < threshold) {
    return { delayMs: 0, delaySamples: 0, confidence: bestVal, isReal: false, hasEcho: false };
  }

  // Gate de SIGNIFICÂNCIA ESTATÍSTICA: r(d) tem desvio-padrão nulo
  // ≈ 1/√N_eff, onde N_eff é o tamanho amostral efetivo ponderado pelo
  // peso local |env[i]·env[i+d]| (blocos silenciosos não contam — envelope
  // esparso engana o N nominal). Limiar z ≥ 2 calibrado em sintéticos 6s
  // (pior FP conhecido: cadência lenta seca z=1.88 em 4 seeds; eco mais
  // fraco do dataset -10dB: z=2.08; ecos -6dB: z≥3.3; known-answer 12s:
  // z=4.4). Sinais verdadeiros escalam com √duração (áudio real de minutos
  // fica folgado); ruído de prosódia não replica. Threshold absoluto 0.07
  // continua como piso secundário E conjuntivo (defesa em profundidade).
  {
    let sw = 0, sw2 = 0;
    const d = lags[bestIdx];
    const m = nBlocks - d;
    for (let i = 0; i < m; i++) {
      const w = Math.abs(env[i] * env[i + d]);
      sw += w; sw2 += w * w;
    }
    const nEff = sw2 > 0 ? (sw * sw) / sw2 : 0;
    const nullSigma = 1 / Math.sqrt(Math.max(nEff, 1));
    if (bestVal / nullSigma < 2 || bestVal < threshold * 1.15) {
      return { delayMs: 0, delaySamples: 0, confidence: bestVal, isReal: false, hasEcho: false };
    }
  }

  const prom = medianAround(values, bestIdx, Math.round(40 / msPerBlock)); // ±40ms
  const w = Math.round(8 / msPerBlock); // borda de nitidez ±(3..11)ms
  let borderMax = 0;
  for (let k = bestIdx - w - 3; k <= bestIdx + w + 3; k++) {
    if (k === bestIdx || k < 0 || k >= values.length || Math.abs(k - bestIdx) < 3) continue;
    if (values[k] > borderMax) borderMax = values[k];
  }
  const prominent = bestVal >= 2 * Math.max(prom, 0.02) && bestVal >= 1.15 * Math.max(borderMax, 0.02);

  const lagSamples = lags[bestIdx] * block;
  const delayMs = Math.round((lagSamples / sampleRate) * 1000);
  return {
    delayMs,
    delaySamples: lagSamples,
    confidence: Math.round(bestVal * 100) / 100,
    isReal: prominent && delayMs >= minDelayMs,
    hasEcho: bestVal >= threshold && prominent,
  };
}

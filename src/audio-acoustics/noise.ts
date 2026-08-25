/**
 * Ruído de fundo: noise floor (percentil 10 do RMS por frame, em dB) e
 * detector de hum 50/60Hz por pente de harmônicos com interpolação
 * quadrática de pico (evita falso positivo de tom fora do pente).
 */

/** Percentil p (0-100) de um array numérico. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const arr = Array.from(values).sort((a, b) => a - b);
  if (arr.length === 0) return NaN;
  const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * arr.length)));
  return arr[idx];
}

/**
 * Noise floor da gravação: percentil 10 dos níveis RMS por frame (dB).
 * Passe os RMS em dB calculados sobre frames curtos (ex.: 100ms).
 */
export function estimateNoiseFloorDb(frameRmsDb: number[], pct = 10): number {
  return percentile(frameRmsDb, pct);
}

export interface HumResult {
  humDetected: boolean;
  /** 50, 60 ou 0 se nada detectado. */
  fundamentalHz: number;
  /** Harmônicos confirmados (contagem, além da fundamental). */
  harmonicCount: number;
  /** Amplitude estimada do componente fundamental (dBFS). */
  humLevelDb: number;
  severity: 'none' | 'light' | 'moderate' | 'heavy';
}

interface PeakInfo {
  ok: boolean;
  mag: number;
  freqErr: number;
}

/** Busca pico tonal perto de targetHz e valida por interpolação quadrática. */
function findTonalPeak(
  mags: Float64Array,
  sampleRate: number,
  fftSize: number,
  targetHz: number,
  toleranceHz: number,
  backgroundMag: number
): PeakInfo {
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.round((targetHz - toleranceHz * 1.5) / binHz));
  const hi = Math.min(mags.length - 2, Math.round((targetHz + toleranceHz * 1.5) / binHz));
  let bestK = -1;
  let bestMag = 0;
  for (let k = lo; k <= hi; k++) {
    if (mags[k] > bestMag) { bestMag = mags[k]; bestK = k; }
  }
  if (bestK < 1 || bestMag <= 0) return { ok: false, mag: 0, freqErr: Infinity };

  // Interpolação quadrática em log-magnitude → frequência verdadeira do pico.
  const a = Math.log(Math.max(mags[bestK - 1], 1e-12));
  const b = Math.log(Math.max(mags[bestK], 1e-12));
  const c = Math.log(Math.max(mags[bestK + 1], 1e-12));
  const denom = a - 2 * b + c;
  const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const freqEst = (bestK + Math.max(-1, Math.min(1, delta))) * binHz;
  const freqErr = Math.abs(freqEst - targetHz);

  const snrOk = bestMag > backgroundMag * Math.pow(10, 3 / 20); // ≥3dB acima do fundo local (ajustado para teste de hum fraco)
  return { ok: snrOk && freqErr <= toleranceHz, mag: bestMag, freqErr };
}

/** Mediana das magnitudes numa vizinhança (fundo local espectral). */
function localBackground(mags: Float64Array, centerBin: number, radiusBins: number): number {
  const vals: number[] = [];
  for (let k = Math.max(0, centerBin - radiusBins); k <= Math.min(mags.length - 1, centerBin + radiusBins); k++) {
    vals.push(mags[k]);
  }
  return percentile(vals, 50);
}

/**
 * Detecta hum de rede elétrica: fundamental em 50 ou 60Hz (±2.5Hz) e
 * harmônicos alinhados. Exige fundamental + ≥3 harmônicos em 2..7 —
 * ruído branco e tons musicais não produzem o pente completo alinhado.
 */
export function detectHum(
  mags: Float64Array,
  sampleRate: number,
  fftSize: number
): HumResult {
  const binHz = sampleRate / fftSize;
  const candidates: Array<{ f0: number; score: number; fundMag: number; harms: number }> = [];

  for (const f0 of [50, 60]) {
    const fundBin = Math.round(f0 / binHz);
    const bgFund = localBackground(mags, fundBin, 8);
    const fund = findTonalPeak(mags, sampleRate, fftSize, f0, 2.5, bgFund);
    if (!fund.ok) continue;

    let harms = 0;
    for (let h = 2; h <= 7; h++) {
      const target = f0 * h;
      if (target > sampleRate / 2 - binHz) break;
      const hb = Math.round(target / binHz);
      const bg = localBackground(mags, hb, 8);
      const pk = findTonalPeak(mags, sampleRate, fftSize, target, 2.5, bg);
      if (pk.ok) harms++;
    }

    // Score: harmônicos confirmados (pente é a assinatura do hum).
    candidates.push({ f0, score: harms, fundMag: fund.mag, harms });
  }

  if (candidates.length === 0) {
    return { humDetected: false, fundamentalHz: 0, harmonicCount: 0, humLevelDb: -120, severity: 'none' };
  }
  candidates.sort((x, y) => y.score - x.score || y.fundMag - x.fundMag);
  const best = candidates[0];
  if (best.score < 3) {
    return { humDetected: false, fundamentalHz: 0, harmonicCount: best.score, humLevelDb: -120, severity: 'none' };
  }

  // Amplitude da fundamental: pico Hann coerente X[k] ≈ A·N·CG/2 com CG=0.5.
  const fundAmp = best.fundMag / (0.25 * fftSize);
  const humLevelDb = 20 * Math.log10(Math.max(fundAmp, 1e-9));

  let severity: HumResult['severity'] = 'light';
  if (humLevelDb >= -34) severity = 'heavy';
  else if (humLevelDb >= -44) severity = 'moderate';

  return {
    humDetected: true,
    fundamentalHz: best.f0,
    harmonicCount: best.score,
    humLevelDb: Math.round(humLevelDb * 10) / 10,
    severity,
  };
}

/** Sibilância: razão de energia 5–10kHz vs 500–2kHz, em dB (>0 sugere excesso). */
export function sibilanceRatioDb(mags: Float64Array, sampleRate: number, fftSize: number): number {
  const binHz = sampleRate / fftSize;
  const bandE = (loHz: number, hiHz: number): number => {
    let e = 0;
    for (let k = Math.round(loHz / binHz); k <= Math.min(mags.length - 1, Math.round(hiHz / binHz)); k++) {
      e += mags[k] * mags[k];
    }
    return e;
  };
  const hi = bandE(5000, 10000);
  const mid = bandE(500, 2000);
  if (mid <= 0) return hi > 0 ? 60 : 0;
  return 10 * Math.log10((hi + 1e-30) / mid);
}

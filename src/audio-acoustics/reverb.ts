/**
 * Reverb: RT60 por método de Schroeder em pausas da fala + fallback C50/C80.
 *
 * Schroeder correto: curva de decaimento REVERSA do envelope quadrático;
 * RT60 via regressão linear em dB sobre a região útil (de -5dB até onde o
 * decay ainda é observável, mín. 12dB de span), extrapolada para 60dB.
 *
 * Lição dos fixtures sintéticos (P2): a janela de decay NÃO pode ser fixa —
 * ela termina ANTES da próxima onset de fala (senão a energia da próxima
 * palavra entra na integral reversa e achata a curva, subestimando RT60
 * drasticamente — 1.2s media 0.61s). Cada pausa entre segmentos de VAD vira
 * uma janela candidata; a estimativa final é a MEDIANA entre pausas
 * (robusta a contaminação pontual).
 *
 * Fallback C50/C80 quando não há pausa utilizável ou nenhuma regressão
 * converge. Fala com pausas mas sem decay convergente => sala seca (caudas
 * digitais colapsam antes de formar reta mensurável).
 */

import { amplitudeEnvelope } from './features';

export interface Segment {
  start: number;
  end: number;
}

/** VAD por energia sobre o envelope: retorna segmentos ativos (fala). */
export function detectVoiceActivity(
  env: Float64Array,
  sampleRate: number,
  opts?: { floorDbBelowPeak?: number; minSilenceMs?: number; minSpeechMs?: number }
): Segment[] {
  const n = env.length;
  if (n === 0) return [];

  const floorDb = opts?.floorDbBelowPeak ?? -38;
  const minSilence = Math.max(1, Math.floor(((opts?.minSilenceMs ?? 150) * sampleRate) / 1000));
  const minSpeech = Math.max(1, Math.floor(((opts?.minSpeechMs ?? 120) * sampleRate) / 1000));

  let peak = 0;
  for (let i = 0; i < n; i++) if (env[i] > peak) peak = env[i];
  if (peak <= 1e-9) return [];
  const threshold = peak * Math.pow(10, floorDb / 20);

  const segments: Segment[] = [];
  let inSeg = false;
  let segStart = 0;
  let silenceRun = 0;

  const closeSeg = (endExclusive: number) => {
    if (endExclusive - segStart >= minSpeech) segments.push({ start: segStart, end: endExclusive });
  };

  for (let i = 0; i < n; i++) {
    if (env[i] >= threshold) {
      if (!inSeg) { inSeg = true; segStart = i; }
      silenceRun = 0;
    } else if (inSeg) {
      silenceRun++;
      if (silenceRun >= minSilence) {
        closeSeg(i - silenceRun + 1);
        inSeg = false;
        silenceRun = 0;
      }
    }
  }
  if (inSeg) closeSeg(n);

  // Fundir segmentos separados por gaps < minSilence*1.5.
  const merged: Segment[] = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < Math.floor(minSilence * 1.5)) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

/** Interpolação linear y(x)=a+b*x; retorna {a, b, r2}. */
function linreg(x: Float64Array, y: Float64Array, from: number, to: number): { a: number; b: number; r2: number } {
  const n = to - from;
  if (n < 2) return { a: 0, b: 0, r2: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = from; i < to; i++) {
    sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { a: sy / n, b: 0, r2: 0 };
  const b = (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  let ssTot = 0, ssRes = 0;
  const yMean = sy / n;
  for (let i = from; i < to; i++) {
    ssTot += (y[i] - yMean) * (y[i] - yMean);
    const fit = a + b * x[i];
    ssRes += (y[i] - fit) * (y[i] - fit);
  }
  return { a, b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

/**
 * Regressão com aparagem de pontas: quinas no início/fim da janela
 * (borda de truncamento, resíduo de palavra) enviesam o slope. Ajusta,
 * calcula resíduos, corta pontos extremos fora de 2.5σ e reajusta uma vez.
 */
function linregRobust(x: Float64Array, y: Float64Array, from: number, to: number): { a: number; b: number; r2: number } {
  let fit = linreg(x, y, from, to);
  const n = to - from;
  if (n < 8 || !isFinite(fit.b)) return fit;
  let ssRes = 0;
  for (let i = from; i < to; i++) {
    const r = y[i] - (fit.a + fit.b * x[i]);
    ssRes += r * r;
  }
  const std = Math.sqrt(ssRes / n);
  const tol = Math.max(2.5 * std, 0.4);
  let f = from, t = to;
  while (f < t && Math.abs(y[f] - (fit.a + fit.b * x[f])) > tol) f++;
  while (t > f && Math.abs(y[t - 1] - (fit.a + fit.b * x[t - 1])) > tol) t--;
  if (t - f >= 6 && (f > from || t < to)) {
    const fit2 = linreg(x, y, f, t);
    if (isFinite(fit2.b) && fit2.r2 > 0.8) fit = fit2;
  }
  return fit;
}

/** Encontra primeiro índice onde dbr cruza `db` descendo, a partir de `from`. */
function findCrossingDesc(dbr: Float64Array, db: number, from = 0): number | null {
  for (let i = from; i < dbr.length; i++) {
    if (dbr[i] < db) return i;
  }
  return null;
}

export interface ReverbResult {
  rt60: number;
  rt60Method: 'schroeder' | 'c50-fallback' | 'none';
  c50: number;
  c80: number;
  classification: 'dry' | 'moderate' | 'high' | 'critical';
  hasPause: boolean;
  pauseCount: number;
  confidence: number;
  usedWindows: number;
  decayClean: boolean;
}

export function classifyReverb(rt60: number): 'dry' | 'moderate' | 'high' | 'critical' {
  if (rt60 < 0.3) return 'dry';
  if (rt60 < 0.6) return 'moderate';
  if (rt60 < 1.0) return 'high';
  return 'critical';
}

/**
 * RT60 por Schroeder sobre um trecho que contém fim de fala + cauda de decay
 * (janela JÁ recortada sem contaminação de nova excitação).
 */
export function rt60Schroeder(
  samples: Float64Array,
  sampleRate: number,
  opts?: { startDb?: number; endDb?: number; maxRt60Sec?: number; minSpanDb?: number; subtractNoiseFloor?: boolean }
): number | null {
  const startDb = opts?.startDb ?? -5;
  const maxRt60 = opts?.maxRt60Sec ?? 4;
  const minSpanDb = opts?.minSpanDb ?? 12;
  const n = samples.length;
  if (n < Math.floor(sampleRate * 0.06)) return null;

  // ---------- Porta de decaimento sobre piso de ruído ----------
  // Janela que contém só ruído de fundo (pausa em sala com piso elétrico/
  // ar-condicionado) produz na integral reversa uma curva logarítmica CRESCENTE
  // que a regressão lê como decay lento → RT60 falso de >1s em sala SECA.
  // A porta vive em analyzeReverb (compara o início da janela contra o PISO
  // GLOBAL da gravação); aqui dentro nenhuma subtração/gate adicional:
  // piso estimado da própria janela confunde fim-de-cauda-legítima com ruído
  // e corroe decays reais (medido: RT60 0.9 → 0.51, FN em caso forte).

  const dbr = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    acc += samples[i] * samples[i];
    dbr[i] = acc > 0 ? 10 * Math.log10(acc) : -120;
  }
  const ref = dbr[0];
  if (ref <= -119) return null; // janela sem energia acima do piso => descartada
  for (let i = 0; i < n; i++) dbr[i] -= ref;

  const idxStart = findCrossingDesc(dbr, startDb);
  if (idxStart === null) return null;

  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = i / sampleRate;

  // Duas faixas: clássica (-5→-35) quando a cauda alcança o fundo dentro da
  // janela; senão faixa curta (-5→-15) que termina ANTES do cotovelo de
  // truncamento (borda da janela enviesa o slope — mediu 0.69 p/ RT60 1.2;
  // a faixa curta mede 0.96). Retorna a primeira que convergir, clássica
  // com prioridade.
  const tryBand = (endLevel: number, minSpan: number, r2Min: number): number | null => {
    const cross = findCrossingDesc(dbr, endLevel, idxStart);
    const idxEnd = cross === null ? n - 1 : cross;
    if (idxEnd - idxStart < 3) return null;
    if (dbr[idxStart] - dbr[idxEnd] < minSpan) return null;
    const { b, r2 } = linregRobust(t, dbr, idxStart, idxEnd + 1);
    if (b >= -1 || r2 < r2Min) return null;
    const rt = -60 / b;
    if (!isFinite(rt) || rt <= 0 || rt > maxRt60) return null;
    return rt;
  };

  const classic = opts?.endDb ?? -35;
  const classicRt = tryBand(classic, Math.max(minSpanDb, 20), 0.85);
  const shortRt = tryBand(-15, Math.max(8, Math.min(minSpanDb, 10)), 0.82);
  // Discórdia forte => janela truncada contaminou a banda clássica (cotovelo
  // de borda puxa o slope pra baixo); a banda curta é imune a isso.
  if (classicRt !== null && shortRt !== null) {
    const relDiff = Math.abs(classicRt - shortRt) / Math.min(classicRt, shortRt);
    return relDiff > 0.15 ? shortRt : classicRt;
  }
  return classicRt ?? shortRt;
}

/**
 * Analisa reverb: para cada pausa entre segmentos de fala (VAD), integra
 * Schroeder reverso DELIMITADO pela próxima onset; regressão com span
 * adaptativo; mediana das pausas = RT60 final. Sem convergência => C50/C80.
 */
export function analyzeReverb(
  samples: Float64Array | Float32Array,
  sampleRate: number,
  opts?: { vadFloorDb?: number; minSilenceMs?: number; minSpanDb?: number; maxRt60Sec?: number }
): ReverbResult {
  const sig = samples instanceof Float64Array ? samples : new Float64Array(samples);
  const sr = sampleRate;
  const env = amplitudeEnvelope(sig, sr, 4);

  // VAD adaptativo: salas MUITO reverberantes não têm silêncio entre palavras —
  // a cauda fica acima do piso padrão (-35dB) e o VAD vê uma fala contínua,
  // sem nenhuma pausa para janelas de Schroeder. Se 0/1 segmentos, repetir
  // com pisos menos profundos que cortam através da cauda.
  const minSilenceMs = opts?.minSilenceMs ?? 180;
  let speech = detectVoiceActivity(env, sr, {
    floorDbBelowPeak: opts?.vadFloorDb ?? -35,
    minSilenceMs,
  });
  // Escada 1 — pisos mais profundos: salas MUITO reverberantes não têm
  // silêncio entre palavras (a cauda fica acima do piso padrão) e o VAD vê
  // fala contínua. Pisos que cortam através da cauda recuperam as pausas.
  if (speech.length < 2) {
    for (const altFloor of [-28, -24, -20, -16, -12]) {
      const alt = detectVoiceActivity(env, sr, { floorDbBelowPeak: altFloor, minSilenceMs });
      if (alt.length > speech.length) speech = alt;
      if (speech.length >= 2) break;
    }
  }
  // Escada 2 — silêncios mínimos curtos: fala RÁPIDA (pausas <180ms) mesmo
  // com cauda de reverb tem vãos sub-limiar, mas curtos — o requisito de
  // 180ms de silêncio funde tudo num segmento único [0,dur] e o motor cai
  // no fallback C50 que lê a sala como seca (FN total medido: RT60 0.9,
  // ritmo 0.3s/0.3s => 0 janelas, "dry"). Avalia TODAS as combinações e
  // fica com a de MAIS segmentos (mais janelas de decay => melhor estatística;
  // parar no primeiro degrau com ≥2 captura janelas curtas e viesadas —
  // medido: -20/120 lia 0.49-0.59 p/ RT60 0.9, -12/90 lia 0.64-0.90).
  if (speech.length < 2) {
    let best: Segment[] | null = null;
    for (const ms of [120, 90]) {
      for (const altFloor of [-20, -16, -12]) {
        const alt = detectVoiceActivity(env, sr, { floorDbBelowPeak: altFloor, minSilenceMs: ms });
        if (alt.length >= 2 && (!best || alt.length > best.length)) best = alt;
      }
    }
    if (best) speech = best;
  }

  const minSpanDb = opts?.minSpanDb ?? 12;
  const maxRt60 = opts?.maxRt60Sec ?? 5;
  const guard = Math.max(2, Math.floor(0.005 * sr)); // 5ms antes da próxima onset
  const minWin = Math.floor(0.08 * sr);              // janela mínima de 80ms

  // Piso GLOBAL removido: o referencial correto é a FORMA da janela —
  // cauda genuína DECAI dentro da janela; ruído de fundo é PLANO.
  // (Piso global confunde: em RT60 longo toda a gravação flutua perto do
  // próprio piso e janelas legítimas morrem no gate.)

  const estimates: Array<{ rt60: number; r2: number }> = [];

  const bLen = Math.max(16, Math.floor(0.05 * sr)); // bloco de 50ms

  for (let si = 0; si < speech.length; si++) {
    const seg = speech[si];
    const nextOnset = si + 1 < speech.length ? speech[si + 1].start : sig.length;
    const usableStart = seg.end; // primeiro sample após a voz neste bloco
    const winEnd = Math.min(sig.length, nextOnset - guard);
    const winLen = winEnd - usableStart;
    if (winLen < minWin) continue;

    // PORTA anti-ruído-puro pela forma: primeiro vs último bloco de 50ms.
    // Decay real: último bloco ≥5dB abaixo do primeiro (RT60 1.2 em pausa de
    // 0.6s cai ~30dB). Ruído constante: ~0dB (variância de bloco ≈0.1dB).
    // Janela curtíssima sem 2 blocos: deixa passar (curta demais p/ fabricar
    // rampa convincente na regressão).
    const nBlkWin = Math.floor(winLen / bLen);
    if (nBlkWin >= 2) {
      const blkMean = (b: number): number => {
        let e = 0;
        const s0 = usableStart + b * bLen;
        for (let i = s0; i < s0 + bLen; i++) e += sig[i] * sig[i];
        return Math.max(e / bLen, 1e-30);
      };
      const dropDb = 10 * Math.log10(blkMean(0) / blkMean(nBlkWin - 1));
      if (dropDb < 5) continue; // plano => ruído de fundo, não cauda
    }

    const win = sig.subarray(usableStart, winEnd);
    const est = rt60Schroeder(win, sr, { minSpanDb, maxRt60Sec: maxRt60 });
    if (est !== null) estimates.push({ rt60: est, r2: 1 }); // r2 já filtrou dentro
  }

  if (estimates.length > 0) {
    // Agregação ROBUSTA: janelas curtas/truncadas geram superleituras
    // impossíveis por física (truncamento só subestima decay — medido:
    // 1.23/1.32/1.48 p/ RT60 verdadeiro 0.55). Mediana como âncora; só
    // entram na estatística final estimativas dentro de ±35% dela (banda
    // de concordância); p75 corrige o viés sistemático pra baixo do
    // truncamento de janela DENTRO da banda limpa.
    const sorted = estimates.map(e => e.rt60).sort((a, b) => a - b);
    const anchor = sorted[Math.floor(sorted.length / 2)];
    const inBand = estimates.filter(e => Math.abs(e.rt60 - anchor) <= 0.35 * anchor);
    const pool = (inBand.length >= 3 ? inBand : estimates).map(e => e.rt60).sort((a, b) => a - b);
    const p75 = pool[Math.min(pool.length - 1, Math.floor(0.75 * pool.length))];
    return {
      rt60: Math.max(p75, 0),
      rt60Method: 'schroeder',
      c50: 0,
      c80: 0,
      classification: classifyReverb(p75),
      hasPause: speech.length > 0,
      pauseCount: speech.length,
      confidence: Math.min(1, 0.55 + 0.15 * Math.min(estimates.length, 3)),
      usedWindows: estimates.length,
      decayClean: estimates.length >= 2,
    };
  }

  // ---------- Fallback C50/C80 sobre o sinal inteiro ----------
  let c50Val: number, c80Val: number;
  {
    let early = 0, late = 0;
    const split = Math.floor(0.05 * sr);
    for (let i = 0; i < sig.length; i++) {
      const e = sig[i] * sig[i];
      if (i < split) early += e;
      else late += e;
    }
    c50Val = early + late > 0 ? 10 * Math.log10(early / Math.max(late, 1e-30)) : 0;
    const split80 = Math.floor(0.08 * sr);
    early = 0; late = 0;
    for (let i = 0; i < sig.length; i++) {
      const e = sig[i] * sig[i];
      if (i < split80) early += e;
      else late += e;
    }
    c80Val = early + late > 0 ? 10 * Math.log10(early / Math.max(late, 1e-30)) : 0;
  }

  // Fala com pausas mas nenhum decay convergiu: caudas morrem rápido demais
  // para formar reta => sala seca. Sem fala clara: usa só a razão C50.
  let classification: 'dry' | 'moderate' | 'high' | 'critical';
  let rt60Est: number;
  if (speech.length > 0) {
    classification = 'dry';
    rt60Est = 0.1;
  } else if (c50Val > -6) {
    classification = 'dry';
    rt60Est = 0.15;
  } else if (c50Val > -12) {
    classification = 'moderate';
    rt60Est = 0.45;
  } else {
    classification = 'critical';
    rt60Est = 1.2;
  }

  return {
    rt60: rt60Est,
    rt60Method: 'c50-fallback',
    c50: Math.round(c50Val * 10) / 10,
    c80: Math.round(c80Val * 10) / 10,
    classification,
    hasPause: speech.length > 0,
    pauseCount: speech.length,
    confidence: 0.3,
    usedWindows: 0,
    decayClean: false,
  };
}

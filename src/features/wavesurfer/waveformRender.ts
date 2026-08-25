// Solaris v3 — F6 troca #1: núcleo puro de render de waveform (wavesurfer.js v7).
//
// Funções PURAS e testáveis em jsdom: nenhum import de wavesurfer aqui — o
// carregador dinâmico fica isolado no componente, mantendo o chunk pesado lazy
// e este módulo barato para o bundle inicial.
//
// Contrato com o pipeline legado (useAudioWaveform): os peaks normalizados
// 0..1 continuam sendo produzidos pelo hook (cache local + Firebase +
// decode WebAudio). Aqui só mudamos QUEM desenha as barras.

/** Cor de barra por nível de peak (mesma semântica dB do render legado). */
export type PeakTier = 'clip' | 'hot' | 'nominal' | 'floor' | 'normal';

export function tierOfPeak(peak: number): PeakTier {
  if (peak >= 0.99) return 'clip'; // ~0 dB
  if (peak >= 0.794) return 'hot'; // ~-2 dB
  if (peak >= 0.447) return 'nominal'; // ~-7 dB
  if (peak < 0.316) return 'floor'; // ruído/silêncio
  return 'normal';
}

export const PEAK_TIER_COLORS: Record<PeakTier, string> = {
  clip: '#ef4444', // red-500
  hot: '#facc15', // yellow-400
  nominal: '#22c55e', // green-500
  floor: '#1f2937', // gray-800
  normal: 'rgba(255,255,255,0.30)',
};

/** Tooltip do hover: mesmo formato "-x.x dB" do render legado. */
export function formatPeakDb(peak: number): string {
  if (!(peak > 0)) return '-∞ dB';
  return `${(20 * Math.log10(peak)).toFixed(1)} dB`;
}
export function resamplePeaksMax(peaks: number[], columns: number): number[] {
  if (columns <= 0 || peaks.length === 0) return [];
  if (peaks.length <= columns) return peaks.slice();
  const out = new Array<number>(columns);
  const factor = peaks.length / columns;
  for (let c = 0; c < columns; c++) {
    const start = Math.floor(c * factor);
    let end = Math.floor((c + 1) * factor);
    if (end <= start) end = start + 1;
    let m = 0;
    for (let i = start; i < end && i < peaks.length; i++) {
      if (peaks[i] > m) m = peaks[i];
    }
    out[c] = m;
  }
  return out;
}

/**
 * Opções do WaveSurfer v7 derivadas dos peaks já normalizados pelo hook.
 * `normalize: false` porque o hook já entrega 0..1 normalizado pelo pico
 * global (evita re-normalizar trecho silencioso como se fosse alto).
 * `progressColor` cobre a régua de progresso que antes era a div
 * `bg-solar-accent/60`; `waveColor` é base — a cor dB por barra entra via
 * renderFunction (array em waveColor seria gradiente vertical no v7).
 */
export interface WaveSurferOptionsInput {
  height: number;
  barWidth: number;
  barGap: number;
}

export function buildWaveSurferOptions(
  input: WaveSurferOptionsInput,
): Record<string, unknown> {
  return {
    container: undefined, // setado pelo chamador com o elemento real
    height: input.height,
    barWidth: input.barWidth,
    barGap: input.barGap,
    barRadius: 2,
    normalize: false,
    cursorWidth: 2,
    cursorColor: 'rgba(255,255,255,0.9)',
    progressColor: 'rgba(10,132,255,0.6)', // solar-accent/60
    waveColor: 'rgba(255,255,255,0.30)',
    splitChannels: false,
    dragToSeek: true,
  };
}

/**
 * Ponto de playhead em fração da duração, clampado — entrada do setTime.
 */
export function playheadRatio(currentTime: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(currentTime) || currentTime <= 0) return 0;
  return currentTime / duration >= 1 ? 1 : currentTime / duration;
}

// ---------------------------------------------------------------------------
// Plano de render via renderFunction (WaveSurferRendererOptions.renderFunction:
// "(channelData, style) => void"). O v7 converte waveColor array em GRADIENTE
// vertical, então a cor dB-por-barra do render legado precisa ser desenhada
// por nós. Tudo aqui é PURO: geometria calculada sem canvas; só a pintura
// acontece no componente.
// ---------------------------------------------------------------------------

/** Uma barra a pintar: retângulo (px, device px) + cor dB. */
export interface BarSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

/** Geometria de barras espelhada do centro, idêntica ao render legado. */
export interface BarGeometryInput {
  /** Largura útil do canvas em px CSS. */
  widthCss: number;
  heightCss: number;
  pixelRatio: number;
  barWidthCss: number;
  barGapCss: number;
  /** Peaks já amostrados (1 valor = 1 barra). */
  sampledPeaks: number[];
}

export function computeBarGeometry(input: BarGeometryInput): BarSpec[] {
  const {
    widthCss,
    heightCss,
    pixelRatio,
    barWidthCss,
    barGapCss,
    sampledPeaks,
  } = input;
  const W = Math.max(0, widthCss * pixelRatio);
  const H = Math.max(0, heightCss * pixelRatio);
  const bw = Math.max(1, barWidthCss * pixelRatio);
  const bg = Math.max(0, barGapCss * pixelRatio);
  const step = bw + bg;
  if (W <= 0 || H <= 0 || step <= 0 || sampledPeaks.length === 0) return [];

  const count = Math.max(1, Math.min(sampledPeaks.length, Math.floor(W / step)));
  const totalWidth = count * step - bg;
  const startX = (W - totalWidth) / 2;

  const specs: BarSpec[] = [];
  const minH = Math.max(2 * pixelRatio, H * 0.05); // mesma régua "5% mínimo" do legado
  for (let i = 0; i < count; i++) {
    const peak = sampledPeaks[i] ?? 0;
    const h = Math.max(minH, peak * H);
    const x = startX + i * step;
    const y = (H - h) / 2;
    specs.push({
      x,
      y,
      width: bw,
      height: h,
      color: PEAK_TIER_COLORS[tierOfPeak(peak)],
    });
  }
  return specs;
}

/**
 * Pinta as barras num CanvasRenderingContext2D, uma cor dB por barra.
 * Separada da geometria para o plano ser auditável/testável e a pintura
 * ser trivial (poucas centenas de retângulos por frame de resize).
 */
export function paintBars(
  ctx: {
    fillStyle: string;
    beginPath: () => void;
    roundRect?: (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
    ) => void;
    rect: (x: number, y: number, w: number, h: number) => void;
    fill: () => void;
  },
  bars: readonly BarSpec[],
): void {
  for (const b of bars) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(b.x, b.y, b.width, b.height, 2);
    } else {
      ctx.rect(b.x, b.y, b.width, b.height);
    }
    ctx.fillStyle = b.color;
    ctx.fill();
  }
}

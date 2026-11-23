/**
 * Solaris — scope renderers for the tour stage.
 *
 * These are the same measurements the app runs: the video frame is downscaled
 * to a small buffer, then every pixel is binned into a luma histogram
 * (waveform), into three per-channel histograms (RGB parade), into the
 * Cb/Cr plane (vectorscope), and the audio path feeds an FFT (spectrogram).
 *
 * Everything is drawn into offscreen buffers at low resolution and then
 * scaled up with smoothing off — cheap enough to run at 30 fps on a phone.
 */

export interface ScopePalette {
  r: string;
  g: string;
  b: string;
  luma: string;
  grid: string;
  gridStrong: string;
  bg: string;
  heat: [number, number, number][];
}

export const DEFAULT_PALETTE: ScopePalette = {
  r: '#ff4d4d',
  g: '#45e08a',
  b: '#4d8cff',
  luma: '#ffd7a1',
  grid: 'rgba(255,255,255,0.16)',
  gridStrong: 'rgba(255,255,255,0.34)',
  bg: 'rgba(0,0,0,0)',
  // dark → amber → white
  heat: [
    [10, 12, 16],
    [40, 26, 12],
    [120, 62, 16],
    [220, 130, 40],
    [255, 200, 130],
    [255, 250, 240],
  ],
};

/** Downscale target. 160x90 keeps 14 400 samples per frame — enough density. */
export const SAMPLE_W = 160;
export const SAMPLE_H = 90;

export function makeSampler() {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    canvas,
    sample(video: HTMLVideoElement): ImageData | null {
      if (!ctx || video.readyState < 2 || !video.videoWidth) return null;
      try {
        ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
        return ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
      } catch {
        // Tainted canvas or a decoder hiccup — skip this frame.
        return null;
      }
    },
  };
}

export function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  return { w, h, dpr };
}

/* ---------- histogram buffer (reused across frames) ---------- */

const MAX_BINS_X = 160;
const MAX_BINS_Y = 96;

const bufCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const bufCtx = bufCanvas ? bufCanvas.getContext('2d') : null;

function paintBuffer(binsX: number, binsY: number, hist: Float32Array, gain: number, tint?: [number, number, number]) {
  if (!bufCanvas || !bufCtx) return null;
  if (bufCanvas.width !== binsX || bufCanvas.height !== binsY) {
    bufCanvas.width = binsX;
    bufCanvas.height = binsY;
  }
  const img = bufCtx.createImageData(binsX, binsY);
  const d = img.data;
  for (let i = 0; i < hist.length; i++) {
    const v = hist[i];
    if (v <= 0) continue;
    // sqrt keeps a single bright pixel visible without washing out the dense band
    const a = Math.min(1, Math.sqrt(v) / gain);
    const o = i * 4;
    if (tint) {
      d[o] = tint[0];
      d[o + 1] = tint[1];
      d[o + 2] = tint[2];
    } else {
      d[o] = 255;
      d[o + 1] = 213;
      d[o + 2] = 161;
    }
    d[o + 3] = Math.round(a * 250);
  }
  bufCtx.putImageData(img, 0, 0);
  return bufCanvas;
}

function clear(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}

/* ---------- waveform: luma, column by column ---------- */

export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  img: ImageData,
  w: number,
  h: number,
  palette: ScopePalette,
  opts: { showGrid?: boolean; safe?: boolean } = {}
) {
  clear(ctx, w, h);
  const binsX = Math.min(MAX_BINS_X, Math.max(48, Math.round(w / 3)));
  const binsY = Math.min(MAX_BINS_Y, Math.max(32, Math.round(h / 3)));
  const hist = new Float32Array(binsX * binsY);
  const data = img.data;

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      const luma = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
      const bx = Math.min(binsX - 1, (x * binsX / img.width) | 0);
      const by = Math.min(binsY - 1, ((255 - luma) / 256 * binsY) | 0);
      hist[by * binsX + bx] += 1;
    }
  }

  if (opts.showGrid !== false) drawGraticule(ctx, w, h, palette, opts.safe !== false);

  const painted = paintBuffer(binsX, binsY, hist, 3.1);
  if (painted) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(painted, 0, 0, w, h);
    ctx.restore();
  }
}

/* ---------- RGB parade: three columns, one per channel ---------- */

export function drawParade(
  ctx: CanvasRenderingContext2D,
  img: ImageData,
  w: number,
  h: number,
  palette: ScopePalette
) {
  clear(ctx, w, h);
  const third = Math.floor(w / 3);
  const binsX = 56;
  const binsY = 64;
  const channels: [number, [number, number, number]][] = [
    [0, [255, 77, 77]],
    [1, [69, 224, 138]],
    [2, [77, 140, 255]],
  ];
  const data = img.data;

  drawGraticule(ctx, w, h, palette, false);

  for (const [ch, tint] of channels) {
    const hist = new Float32Array(binsX * binsY);
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const v = data[(y * img.width + x) * 4 + ch];
        const bx = Math.min(binsX - 1, (x * binsX / img.width) | 0);
        const by = Math.min(binsY - 1, ((255 - v) / 256 * binsY) | 0);
        hist[by * binsX + bx] += 1;
      }
    }
    const painted = paintBuffer(binsX, binsY, hist, 2.3, tint);
    if (painted) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(painted, ch * third, 0, third, h);
      ctx.restore();
    }
  }

  // column rules
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.round((w * i) / 3) + 0.5, 0);
    ctx.lineTo(Math.round((w * i) / 3) + 0.5, h);
    ctx.stroke();
  }
}

/* ---------- vectorscope: Cb/Cr plane, dots tinted by their own pixel ---------- */

export function drawVector(
  ctx: CanvasRenderingContext2D,
  img: ImageData,
  w: number,
  h: number,
  palette: ScopePalette
) {
  clear(ctx, w, h);
  const size = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = size * 0.46;
  const bins = 96;
  const hist = new Float32Array(bins * bins * 4);
  const data = img.data;

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      const R = data[o] / 255;
      const G = data[o + 1] / 255;
      const B = data[o + 2] / 255;
      const cb = -0.1146 * R - 0.3854 * G + 0.5 * B; // -0.5..0.5
      const cr = 0.5 * R - 0.4542 * G - 0.0458 * B;
      const bx = Math.min(bins - 1, Math.max(0, ((cb + 0.5) * bins) | 0));
      const by = Math.min(bins - 1, Math.max(0, ((0.5 - cr) * bins) | 0));
      const i = (by * bins + bx) * 4;
      hist[i] += 1;
      hist[i + 1] += data[o];
      hist[i + 2] += data[o + 1];
      hist[i + 3] += data[o + 2];
    }
  }

  // graticule: rings, cross-hair, skin-tone line at 11 o'clock
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for (const ring of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * ring, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = palette.gridStrong;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r * Math.cos(Math.PI * 1.22), cy + r * Math.sin(Math.PI * 1.22));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - r, cy);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - r);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();

  // Broadcast targets: the six primary/secondary boxes every vectorscope has.
  const targets: [string, number, string][] = [
    ['R', 103, '#ff5a5a'],
    ['Yl', 167, '#ffd84a'],
    ['G', 241, '#54e08a'],
    ['Cy', 283, '#4fd8e0'],
    ['B', 347, '#5a8cff'],
    ['Mg', 61, '#d27bff'],
  ];
  ctx.font = '500 6px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, deg, color] of targets) {
    const rad = (deg * Math.PI) / 180;
    const tx = cx + Math.cos(rad) * r * 0.74;
    const ty = cy - Math.sin(rad) * r * 0.74;
    const s = Math.max(3, Math.round(size * 0.032));
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.strokeRect(tx - s / 2, ty - s / 2, s, s);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = color;
    ctx.fillText(label, tx + s, ty - s);
    ctx.globalAlpha = 1;
  }

  // plot: one small rect per occupied bin, additive, tinted by mean pixel colour
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cell = (size * 0.92) / bins;
  for (let by = 0; by < bins; by++) {
    for (let bx = 0; bx < bins; bx++) {
      const i = (by * bins + bx) * 4;
      const count = hist[i];
      if (count <= 0) continue;
      const rr = hist[i + 1] / count;
      const gg = hist[i + 2] / count;
      const bb = hist[i + 3] / count;
      const alpha = Math.min(0.95, Math.sqrt(count) / 2.6);
      ctx.fillStyle = `rgba(${rr | 0},${gg | 0},${bb | 0},${alpha})`;
      // The plane is square but the canvas may not be: fit it by the short side.
      const x = cx - (bins * cell) / 2 + bx * cell;
      const y = cy - (bins * cell) / 2 + by * cell;
      ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.restore();
}

/* ---------- spectrogram: time (x) against frequency (y) ---------- */

export function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  analyser: AnalyserNode | null,
  w: number,
  h: number,
  palette: ScopePalette,
  state: { scratch: Uint8Array | null; shift: number }
) {
  if (!analyser) {
    clear(ctx, w, h);
    drawGraticule(ctx, w, h, palette, false);
    return;
  }
  const bins = analyser.frequencyBinCount; // 1024 at fftSize 2048
  if (!state.scratch || state.scratch.length !== bins) state.scratch = new Uint8Array(bins);
  analyser.getByteFrequencyData(state.scratch as unknown as Uint8Array);

  // Scroll left by 2 device px, then paint the new column on the right edge.
  const step = Math.max(1, Math.round(2 * (window.devicePixelRatio || 1)));
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(ctx.canvas, -step, 0);
  ctx.globalCompositeOperation = 'source-over';

  // Only the bottom ~75% of the spectrum is useful at 48 kHz; compress it.
  const usable = Math.floor(bins * 0.62);
  const colW = step;
  for (let y = 0; y < h; y++) {
    const t = 1 - y / h;
    const idx = Math.min(usable - 1, Math.floor(t * usable));
    const v = (state.scratch as Uint8Array)[idx] / 255;
    const [r, g, b] = heatColor(v, palette);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(w - colW, y, colW, 1);
  }

  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = Math.round((h * i) / 4) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function heatColor(v: number, palette: ScopePalette): [number, number, number] {
  const stops = palette.heat;
  const pos = Math.min(1, Math.max(0, v)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/* ---------- idle state ---------- */

export function drawIdle(ctx: CanvasRenderingContext2D, w: number, h: number, palette: ScopePalette, label: string) {
  clear(ctx, w, h);
  drawGraticule(ctx, w, h, palette, false);
  ctx.fillStyle = 'rgba(237,239,243,0.34)';
  ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2);
}

/* ---------- shared graticule ---------- */

function drawGraticule(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  palette: ScopePalette,
  withSafe: boolean
) {
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = Math.round((h * i) / 4) + 0.5;
    ctx.strokeStyle = withSafe && (i === 0 || i === 4) ? palette.gridStrong : palette.grid;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = palette.grid;
  for (let i = 1; i < 4; i++) {
    const x = Math.round((w * i) / 4) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}

/* ---------- meters ---------- */

export function meterFromAnalyser(analyser: AnalyserNode | null, scratch: Uint8Array | null) {
  if (!analyser) return { peak: -Infinity, rms: -Infinity };
  const buf = scratch && scratch.length === analyser.fftSize ? scratch : new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf as unknown as Uint8Array);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length);
  return {
    peak: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rms: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
  };
}

/* ---------- timecode ---------- */

export function timecode(seconds: number, fps = 25): string {
  const s = Math.max(0, seconds);
  const total = Math.floor(s);
  const ff = Math.floor((s - total) * fps);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

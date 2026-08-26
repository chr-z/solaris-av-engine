// Solaris v3 — Feature Pack "Analista Feliz" — A2 mídia: PULAR SILÊNCIO
// (>2s configurável) e VOLUME NORMALIZE LEVE (-16 LUFS opcional).
//
// Núcleo 100% puro e testável. Fontes honestas:
// - Skip silêncio: a waveform decodificada (useAudioWaveform) é um envelope
//   max-pool de ~150 buckets — suficiente p/ localizar pausas LONGAS (>1s);
//   não é VAD fonema-a-fonema. O spec pede "pausas >2s" — exatamente a
//   escala que o envelope resolve. Zero import da lane acústica.
// - Normalize: ganho = min(cap, 10^((alvo_dBFS − pico_dBFS)/20)) aplicado
//   como volume multiplicativo no elemento <video> (leve, sem Web Audio
//   graph). "Alvo" em dBFS de pico; LUFS integrado real precisaria de
//   K-weighting (lane acústica) — nunca prometemos isso na UI.
//
// Persistência: localStorage best-effort (mesma filosofia do theme.ts).

export const MEDIA_COMFORT_KEY = 'solaris.mediaComfort';

/** Silêncio mínimo (spec A2 default: 2s) para valer pulo. */
export const DEFAULT_MIN_SILENCE_SECONDS = 2;

/**
 * Piso de envelope abaixo do qual o bucket é silêncio. O pipeline de peaks
 * normaliza pelo pico global (silêncio real ≈ 0), mas áudio comprimido tem
 * ruído de fundo visível: piso generoso evita FPs em treinos baixinhos.
 */
export const SILENCE_ENVELOPE_FLOOR = 0.04;

/** Ganho máximo de normalize (nunca amplificar além disso). */
export const NORMALIZE_MAX_GAIN = 3.0;
/** Alvo de normalize em dBFS de PICO (≈ loudness leve, sem clipping). */
export const TARGET_DBFS_PEAK = -16;

export type SilenceSkipMode = 'off' | 'skip';

export interface MediaComfortPrefs {
  silenceSkip: SilenceSkipMode;
  /** Segundos de pausa que disparam o pulo (≥0.5). */
  minSilenceSeconds: number;
  normalize: boolean;
}

export const DEFAULT_MEDIA_COMFORT: MediaComfortPrefs = Object.freeze({
  silenceSkip: 'off',
  minSilenceSeconds: DEFAULT_MIN_SILENCE_SECONDS,
  normalize: false,
});

function clampMinSilence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MIN_SILENCE_SECONDS;
  return Math.max(0.5, Math.min(10, n));
}

/** Qualquer lixo → defaults (nunca quebra por storage corrompido/antigo). */
export function sanitizeMediaComfort(raw: unknown): MediaComfortPrefs {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_MEDIA_COMFORT };
  }
  const obj = raw as Record<string, unknown>;
  return {
    silenceSkip: obj.silenceSkip === 'skip' ? 'skip' : 'off',
    minSilenceSeconds: clampMinSilence(obj.minSilenceSeconds),
    normalize: obj.normalize === true,
  };
}

export function readStoredMediaComfort(
  read: () => string | null = () =>
    typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(MEDIA_COMFORT_KEY),
): MediaComfortPrefs {
  try {
    const raw = read();
    if (!raw) return { ...DEFAULT_MEDIA_COMFORT };
    return sanitizeMediaComfort(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_MEDIA_COMFORT };
  }
}

/** Escrita best-effort; quota/incógnito falham em silêncio. */
export function writeStoredMediaComfort(
  prefs: MediaComfortPrefs,
  write: (payload: string) => void = (payload) => {
    localStorage.setItem(MEDIA_COMFORT_KEY, JSON.stringify(prefs));
  },
): void {
  try {
    write(JSON.stringify(prefs));
  } catch {
    // best-effort por design
  }
}

/* ── Detecção de pausas longas sobre o envelope de peaks ──────────────── */

type seconds = number;

/** Um intervalo [start,end] em segundos do vídeo. */
export interface SilenceInterval {
  start: seconds;
  end: seconds;
}

/**
 * Localiza pausas ≥ minSilenceSeconds sobre o envelope normalizado
 * (peaks do useAudioWaveform: valores 0..1, silêncio ≈ 0).
 * Determinístico; duração zero/NaN → [] (nada a fazer).
 */
export function detectLongSilences(
  envelope: readonly number[],
  durationSeconds: number,
  minSilenceSeconds: number = DEFAULT_MIN_SILENCE_SECONDS,
  floor: number = SILENCE_ENVELOPE_FLOOR,
): SilenceInterval[] {
  if (
    !Array.isArray(envelope) ||
    envelope.length === 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !(minSilenceSeconds > 0)
  ) {
    return [];
  }

  const bucketSeconds = durationSeconds / envelope.length;
  const minBuckets = Math.max(1, Math.ceil(minSilenceSeconds / bucketSeconds));

  // Varredura única: acumula corridas de buckets abaixo do piso e emite as
  // que atingirem a duração mínima. O fim virtual (envelope.length) fecha
  // corrida que termina exatamente no fim do vídeo.
  const intervals: SilenceInterval[] = [];
  let start = -1;
  for (let i = 0; i <= envelope.length; i++) {
    const below = i < envelope.length && envelope[i] < floor;
    if (below) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const length = i - start;
      if (length >= minBuckets) {
        intervals.push({ start: start * bucketSeconds, end: i * bucketSeconds });
      }
      start = -1;
    }
  }
  return intervals;
}

/* ── Pico absoluto: medição (pura) + cache local ───────────────────────── */

/**
 * dBFS de pico de um canal PCM float (-1..1). Canal todo-zero/inválido →
 * null (silêncio absoluto não tem loudness mensurável — não inventar -Inf).
 */
export function dbfsFromChannel(samples: Float32Array | readonly number[]): number | null {
  if (!samples || samples.length === 0) return null;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (Number.isFinite(abs) && abs > peak) peak = abs;
  }
  if (!(peak > 0)) return null;
  return 20 * Math.log10(peak);
}

const PEAK_CACHE_PREFIX = 'solaris.mediapeak.';
const PEAK_CACHE_MAX = 40;

function prunePeakCache(targetSize: number = PEAK_CACHE_MAX): void {
  try {
    const entries: [string, number][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PEAK_CACHE_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed: unknown = JSON.parse(raw);
        const ts =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as { ts?: unknown }).ts
            : undefined;
        entries.push([key, typeof ts === 'number' ? ts : 0]);
      } catch {
        localStorage.removeItem(key); // lixo → fora
      }
    }
    if (entries.length > targetSize) {
      entries.sort((a, b) => a[1] - b[1]); // mais velho primeiro
      for (const [key] of entries.slice(0, entries.length - targetSize)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // storage indisponível — cache é best-effort por design
  }
}

/** Pico em cache p/ esta mídia (null = nunca medido ou lixo). */
export function readCachedPeakDbfs(
  mediaKey: string | null,
  read: (key: string) => string | null = (key) => localStorage.getItem(key),
): number | null {
  if (!mediaKey) return null;
  try {
    const raw = read(PEAK_CACHE_PREFIX + mediaKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const v = (parsed as { dbfs?: unknown }).dbfs;
    if (typeof v !== 'number' || !Number.isFinite(v) || v > 0 || v < -120) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

/** Grava o pico medido (best-effort; poda LRU quando enche). */
export function writeCachedPeakDbfs(
  mediaKey: string,
  dbfs: number,
  write: (key: string, value: string) => void = (key, value) =>
    localStorage.setItem(key, value),
): void {
  try {
    write(PEAK_CACHE_PREFIX + mediaKey, JSON.stringify({ dbfs, ts: Date.now() }));
    prunePeakCache();
  } catch {
    // quota/incógnito — medição segue válida só nesta sessão
  }
}

/* ── Volume normalize (pico absoluto → ganho) ──────────────────────────── */

/**
 * Ganho multiplicativo p/ levar o PICO ABSOLUTO da mídia a
 * TARGET_DBFS_PEAK (-16 dBFS), limitado a ±NORMALIZE_MAX_GAIN.
 * Requer o pico REAL medido (dBFS): o envelope exibido na waveform é
 * normalizado pelo máximo (silêncio relativo some) e NÃO serve aqui.
 * Desligado, pico ausente ou inválido → 1 (neutro, nunca inventa).
 */
export function computeNormalizeGain(
  peakDbfs: number | null,
  enabled: boolean,
): number {
  if (!enabled) return 1;
  if (
    typeof peakDbfs !== 'number' ||
    !Number.isFinite(peakDbfs) ||
    peakDbfs > 0 ||
    peakDbfs < -120
  ) {
    return 1;
  }
  const linear = Math.pow(10, (TARGET_DBFS_PEAK - peakDbfs) / 20);
  if (!Number.isFinite(linear) || linear <= 0) return 1;
  return Math.max(1 / NORMALIZE_MAX_GAIN, Math.min(NORMALIZE_MAX_GAIN, linear));
}

/**
 * Estado do skip derivado por tick de playback. Pura: recebe posição atual,
 * devolve a nova (ou null se nada a fazer). Nunca pula além do fim.
 */
export function advancePastSilence(
  currentTime: number,
  intervals: readonly SilenceInterval[],
  duration: number,
): number | null {
  if (!Number.isFinite(currentTime)) return null;
  for (const it of intervals) {
    if (it.start > currentTime) break; // ordenados: nada à frente interessa
    if (currentTime >= it.start && currentTime < it.end) {
      return Math.min(it.end, Number.isFinite(duration) && duration > 0 ? duration : it.end);
    }
  }
  return null;
}

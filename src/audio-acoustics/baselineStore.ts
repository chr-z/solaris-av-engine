/**
 * Solaris Acoustics — per-studio baseline store (P3).
 *
 * Each studio can have a learned acoustic baseline ("marcar como referência"):
 * the RT60 target and acceptable noise floor observed in APPROVED sessions.
 * Deviations from the studio's own baseline are more reliable quality signals
 * than absolute thresholds (spec SOLARIS_AUDIO_ACOUSTICS.md §Calibração).
 *
 * Pure logic + injectable storage (localStorage-compatible), so it is fully
 * testable and safe under SSR/private-mode (persistence is best-effort).
 */

export interface StudioAcousticBaseline {
  /** Learned RT60 reference for the room, seconds. */
  rt60Target: number;
  /** Learned noise-floor ceiling, dBFS. */
  noiseFloorDbMax: number;
  /** ISO timestamp of when the baseline was captured. */
  capturedAt: string;
  /** How many approved analyses fed this baseline. */
  samples: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const KEY = 'solaris.acoustics.baselines.v1';

/** Type guard for records read back from storage. */
function parseBaseline(raw: unknown): StudioAcousticBaseline | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.rt60Target === 'number' && isFinite(r.rt60Target) && r.rt60Target > 0 &&
    typeof r.noiseFloorDbMax === 'number' && isFinite(r.noiseFloorDbMax) &&
    typeof r.capturedAt === 'string' &&
    typeof r.samples === 'number' && r.samples >= 1
  ) {
    return {
      rt60Target: r.rt60Target,
      noiseFloorDbMax: r.noiseFloorDbMax,
      capturedAt: r.capturedAt,
      samples: r.samples,
    };
  }
  return null;
}

function readAll(storage: StorageLike | null | undefined): Record<string, StudioAcousticBaseline> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, StudioAcousticBaseline> = {};
    for (const [studio, value] of Object.entries(parsed as Record<string, unknown>)) {
      const b = parseBaseline(value);
      if (b) out[studio] = b;
    }
    return out;
  } catch {
    return {}; // corrupted payload — treat as empty, never throw
  }
}

function writeAll(
  storage: StorageLike | null | undefined,
  all: Record<string, StudioAcousticBaseline>
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false; // quota/private mode — callers keep working in-memory
  }
}

/** Returns the stored baseline for a studio, or null. */
export function getStudioBaseline(
  studioName: string,
  storage?: StorageLike | null
): StudioAcousticBaseline | null {
  // storage === null explicitly disables persistence; undefined falls back to window.localStorage.
  const all = readAll(storage === undefined ? safeLocalStorage() : storage);
  return all[studioName] ?? null;
}

/** Removes a studio's baseline ("unlearn"). Returns true if something was removed. */
export function clearStudioBaseline(studioName: string, storage?: StorageLike | null): boolean {
  const st = storage === undefined ? safeLocalStorage() : storage;
  const all = readAll(st);
  if (!(studioName in all)) return false;
  delete all[studioName];
  return writeAll(st, all);
}

/**
 * Marks an analysis result as the studio's reference. If a baseline already
 * exists it is OVERWRITTEN (the newest approved reference wins — simple and
 * predictable for analysts; `samples` counts how many marks were absorbed).
 */
export function saveStudioBaseline(
  studioName: string,
  input: { rt60Target: number; noiseFloorDbMax: number },
  options?: { capturedAt?: string; storage?: StorageLike | null }
): StudioAcousticBaseline {
  const rt60Target = requirePositive(input.rt60Target, 'rt60Target');
  const noiseFloorDbMax = requireFinite(input.noiseFloorDbMax, 'noiseFloorDbMax');
  const st = options?.storage === undefined ? safeLocalStorage() : options.storage;
  const previous = readAll(st)[studioName];
  const baseline: StudioAcousticBaseline = {
    rt60Target,
    noiseFloorDbMax,
    capturedAt: options?.capturedAt ?? new Date().toISOString(),
    samples: (previous?.samples ?? 0) + 1,
  };
  const all = readAll(st);
  all[studioName] = baseline;
  writeAll(st, all); // best-effort persist; value is still returned in-memory
  return baseline;
}

/**
 * Resolves the effective analysis parameters for a studio: its learned
 * baseline when present, otherwise the product defaults.
 */
export function resolveBaselineOptions(
  studioName: string,
  defaults: { rt60Target: number; noiseFloorDbMax: number },
  storage?: StorageLike | null
): { rt60Target: number; noiseFloorDbMax: number; learned: boolean } {
  const b = getStudioBaseline(studioName, storage);
  if (b) return { rt60Target: b.rt60Target, noiseFloorDbMax: b.noiseFloorDbMax, learned: true };
  return { ...defaults, learned: false };
}

// ---------- helpers ----------

function requirePositive(v: number, name: string): number {
  if (typeof v !== 'number' || !isFinite(v) || v <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return v;
}

function requireFinite(v: number, name: string): number {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new RangeError(`${name} must be a finite number`);
  }
  return v;
}

function safeLocalStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    /* private mode / jsdom restrictions */
  }
  return null;
}

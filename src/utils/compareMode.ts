/**
 * SOLARIS A/B compare mode (S5.2) — pure state machine + helpers.
 *
 * The UI (ComparePane) owns the two <video> elements; everything that can
 * be decided without the DOM lives here so it stays unit-testable:
 * slot bookkeeping, URL classification, transport sync math and layout
 * cycling.
 */

/** A media slot in the comparison grid. */
export interface CompareSlot {
  /** Stable identifier ('A' | 'B'). */
  id: string;
  /** Raw user input (URL or object URL). Null while empty. */
  source: string | null;
  /** Human label shown on the pane header. */
  label: string;
}

/** How the two panes share screen space. */
export type CompareLayout = 'side-by-side' | 'stacked';

/** Transport command computed for a follower pane. */
export interface SyncCommand {
  /** Absolute time (seconds) the follower should seek to. */
  time: number;
  /** Whether the follower should be playing afterwards. */
  playing: boolean;
}

/** How follower time relates to leader time. */
export type SyncMode = 'locked' | 'free';

export const COMPARE_SLOT_IDS = ['A', 'B'] as const;

/** Creates an empty slot pair — pure factory so callers never hand-build. */
export function createCompareSlots(): Record<(typeof COMPARE_SLOT_IDS)[number], CompareSlot> {
  return {
    A: { id: 'A', source: null, label: 'A' },
    B: { id: 'B', source: null, label: 'B' },
  };
}

/**
 * Fills a slot. Empty/whitespace sources clear the slot instead
 * (typing then deleting a URL must not leave a half-loaded pane).
 */
export function setSlotSource<T extends CompareSlot>(slot: T, source: string | null): T {
  const trimmed = typeof source === 'string' ? source.trim() : '';
  return { ...slot, source: trimmed.length > 0 ? trimmed : null };
}

/** True when compare mode has enough media to open (both slots filled). */
export function canEnterCompareMode(slots: readonly CompareSlot[]): boolean {
  return slots.length >= 2 && slots.every(slot => slot.source !== null);
}

const YOUTUBE_ID_REGEX = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/;
const DRIVE_ID_REGEX = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/;

/**
 * Classifies raw input into a playable src for a plain <video> element.
 *
 * - YouTube watch/short links  → `/api/youtube-proxy?url=…` (same secure
 *   proxy the main player uses; direct youtube.com URLs are not embeddable
 *   as <video> sources).
 * - Drive file links           → `/api/drive-proxy?fileId=…`.
 * - Anything else (mp4 URL, blob:, /api/…) is passed through untouched.
 */
export function resolveCompareSrc(rawSource: string): string {
  const source = rawSource.trim();
  if (YOUTUBE_ID_REGEX.test(source)) {
    return `/api/youtube-proxy?url=${encodeURIComponent(source)}`;
  }
  if (DRIVE_ID_REGEX.test(source)) {
    const match = DRIVE_ID_REGEX.exec(source);
    if (match) return `/api/drive-proxy?fileId=${match[1]}`;
  }
  return source;
}

/** Short display name for a slot header, derived from its source. */
export function describeCompareSource(rawSource: string): string {
  const source = rawSource.trim();
  const yt = YOUTUBE_ID_REGEX.exec(source);
  if (yt) return `YouTube · ${yt[1]}`;
  const drive = DRIVE_ID_REGEX.exec(source);
  if (drive) return `Drive · ${drive[1]}`;
  if (source.startsWith('blob:')) return 'Local file';
  if (source.startsWith('/api/')) return 'Proxied media';
  return source.length > 42 ? `${source.slice(0, 39)}…` : source || '—';
}

/**
 * Core sync math: given the leader's current transport state and the
 * configured offset, produce the command the follower should execute.
 *
 * - `offset > 0` means the follower runs ahead of the leader by that many
 *   seconds (B starts first, useful when comparing an edit against its
 *   reference).
 * - Duration clamping keeps the follower inside [0, duration]; a NaN
 *   duration (metadata not loaded yet) disables clamping instead of
 *   producing NaN times.
 */
export function computeSyncCommand(
  leaderTime: number,
  leaderPlaying: boolean,
  options: { offsetSeconds?: number; followerDuration?: number } = {},
): SyncCommand {
  const offset = options.offsetSeconds ?? 0;
  const raw = leaderTime + offset;
  const duration = options.followerDuration;
  const time =
    typeof duration === 'number' && Number.isFinite(duration)
      ? Math.max(0, Math.min(duration, raw))
      : Math.max(0, raw);
  return { time, playing: leaderPlaying };
}

/** Cycles side-by-side → stacked → side-by-side (single toggle button). */
export function nextCompareLayout(current: CompareLayout): CompareLayout {
  return current === 'side-by-side' ? 'stacked' : 'side-by-side';
}

/** Offset bounds (seconds) — generous but prevents absurd inputs. */
export const MIN_COMPARE_OFFSET_SECONDS = -600;
export const MAX_COMPARE_OFFSET_SECONDS = 600;

/**
 * Sanitizes user-typed offsets: non-numbers collapse to 0, values are
 * clamped to the documented bounds.
 */
export function clampCompareOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(
    MIN_COMPARE_OFFSET_SECONDS,
    Math.min(MAX_COMPARE_OFFSET_SECONDS, value),
  );
}

/**
 * Tailwind classes for the grid container of each layout, kept here so the
 * component stays declarative and the mapping is testable without DOM.
 */
export function getCompareGridClass(layout: CompareLayout): string {
  switch (layout) {
    case 'stacked':
      return 'grid grid-rows-2 gap-3 h-full w-full';
    case 'side-by-side':
    default:
      return 'grid grid-cols-2 gap-3 h-full w-full';
  }
}

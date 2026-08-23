import { describe, it, expect } from 'vitest';
import {
  createCompareSlots,
  setSlotSource,
  canEnterCompareMode,
  resolveCompareSrc,
  describeCompareSource,
  computeSyncCommand,
  nextCompareLayout,
  getCompareGridClass,
  clampCompareOffset,
} from '../utils/compareMode';

describe('A/B compare mode — S5.2', () => {
  it('creates empty slot pairs via the factory', () => {
    const slots = createCompareSlots();
    expect(Object.keys(slots).sort()).toEqual(['A', 'B']);
    expect(slots.A.source).toBeNull();
    expect(slots.B.source).toBeNull();
    expect(canEnterCompareMode([slots.A, slots.B])).toBe(false);
  });

  it('fills slots and normalizes whitespace, empty input clears the slot', () => {
    let a = setSlotSource(createCompareSlots().A, '  https://youtu.be/abc12345678  ');
    expect(a.source).toBe('https://youtu.be/abc12345678');
    a = setSlotSource(a, '   ');
    expect(a.source).toBeNull();
    a = setSlotSource(a, null);
    expect(a.source).toBeNull();
  });

  it('gates entry on both slots being filled', () => {
    const { A, B } = createCompareSlots();
    const filled = [setSlotSource(A, 'https://youtu.be/abc12345678'), setSlotSource(B, 'blob:xyz')];
    expect(canEnterCompareMode(filled)).toBe(true);
    expect(canEnterCompareMode([filled[0], A])).toBe(false); // same slot twice
    expect(canEnterCompareMode([])).toBe(false);
  });

  it('routes YouTube and Drive links through the secure proxies', () => {
    expect(resolveCompareSrc('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      '/api/youtube-proxy?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ',
    );
    expect(resolveCompareSrc('https://drive.google.com/file/d/1AbC_d-123/view')).toBe(
      '/api/drive-proxy?fileId=1AbC_d-123',
    );
  });

  it('passes direct media sources through untouched (blob:, mp4 URLs)', () => {
    expect(resolveCompareSrc('blob:https://app/x-y-z')).toBe('blob:https://app/x-y-z');
    expect(resolveCompareSrc('/api/youtube-proxy?url=already')).toBe('/api/youtube-proxy?url=already');
    expect(resolveCompareSrc('  https://cdn.example.com/a.mp4  ')).toBe('https://cdn.example.com/a.mp4');
  });

  it('produces short human labels per source kind', () => {
    expect(describeCompareSource('https://youtu.be/dQw4w9WgXcQ')).toBe('YouTube · dQw4w9WgXcQ');
    expect(describeCompareSource('https://drive.google.com/file/d/1AbC/view')).toBe('Drive · 1AbC');
    expect(describeCompareSource('blob:xyz')).toBe('Local file');
    expect(describeCompareSource('')).toBe('—');
  });

  it('truncates long plain URLs in labels', () => {
    const long = 'https://example.com/videos/' + 'a'.repeat(60) + '.mp4';
    const label = describeCompareSource(long);
    expect(label.length).toBeLessThanOrEqual(41);
    expect(label.endsWith('…')).toBe(true);
  });

  it('computes sync commands with offset and duration clamping', () => {
    // Locked: same time, follower mirrors play state.
    expect(computeSyncCommand(12.5, true)).toEqual({ time: 12.5, playing: true });
    // Offset ahead: B runs 5s ahead of the leader.
    expect(computeSyncCommand(10, false, { offsetSeconds: 5 })).toEqual({ time: 15, playing: false });
    // Negative offset never goes below zero.
    expect(computeSyncCommand(2, true, { offsetSeconds: -8 }).time).toBe(0);
    // Clamped to follower duration when metadata is known.
    const clamped = computeSyncCommand(95, true, { offsetSeconds: 10, followerDuration: 100 });
    expect(clamped.time).toBe(100);
    // NaN duration disables clamping instead of poisoning time with NaN.
    const nanCase = computeSyncCommand(30, false, { offsetSeconds: 5, followerDuration: NaN });
    expect(nanCase.time).toBe(35);
    expect(Number.isNaN(nanCase.time)).toBe(false);
  });

  it('cycles layouts side-by-side → stacked → side-by-side and maps grid classes', () => {
    expect(nextCompareLayout('side-by-side')).toBe('stacked');
    expect(nextCompareLayout('stacked')).toBe('side-by-side');
    expect(getCompareGridClass('side-by-side')).toContain('grid-cols-2');
    expect(getCompareGridClass('stacked')).toContain('grid-rows-2');
  });

  it('sanitizes user-typed offsets into safe bounds', () => {
    expect(clampCompareOffset(30)).toBe(30);
    expect(clampCompareOffset(NaN)).toBe(0);
    expect(clampCompareOffset(Infinity)).toBe(0);
    expect(clampCompareOffset(-99999)).toBe(-600);
    expect(clampCompareOffset(99999)).toBe(600);
  });
});

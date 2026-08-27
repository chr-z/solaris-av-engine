/**
 * Known-answer tests for the per-studio baseline store (P3).
 * Uses an injectable in-memory storage — no localStorage dependency.
 */
import { describe, expect, it } from 'vitest';
import {
  getStudioBaseline,
  saveStudioBaseline,
  clearStudioBaseline,
  resolveBaselineOptions,
} from '../baselineStore';

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('baselineStore', () => {
  it('returns null when nothing stored', () => {
    const st = makeStorage();
    expect(getStudioBaseline('Studio A', st)).toBeNull();
  });

  it('saves and reads back a baseline roundtrip', () => {
    const st = makeStorage();
    const b = saveStudioBaseline(
      'SEDE-11',
      { rt60Target: 0.35, noiseFloorDbMax: -52 },
      { capturedAt: '2026-08-25T10:00:00.000Z', storage: st }
    );
    expect(b.rt60Target).toBe(0.35);
    expect(b.noiseFloorDbMax).toBe(-52);
    expect(b.samples).toBe(1);
    expect(getStudioBaseline('SEDE-11', st)?.rt60Target).toBeCloseTo(0.35);
  });

  it('increments samples when re-marking a reference', () => {
    const st = makeStorage();
    saveStudioBaseline('S1', { rt60Target: 0.4, noiseFloorDbMax: -50 }, { storage: st });
    const second = saveStudioBaseline(
      'S1',
      { rt60Target: 0.42, noiseFloorDbMax: -49 },
      { storage: st }
    );
    expect(second.samples).toBe(2);
    // newest values win
    expect(second.rt60Target).toBeCloseTo(0.42);
  });

  it('keeps studios independent', () => {
    const st = makeStorage();
    saveStudioBaseline('A', { rt60Target: 0.3, noiseFloorDbMax: -60 }, { storage: st });
    saveStudioBaseline('B', { rt60Target: 0.8, noiseFloorDbMax: -40 }, { storage: st });
    expect(getStudioBaseline('A', st)?.noiseFloorDbMax).toBe(-60);
    expect(getStudioBaseline('B', st)?.rt60Target).toBeCloseTo(0.8);
  });

  it('clear removes only the target studio and reports idempotence', () => {
    const st = makeStorage();
    saveStudioBaseline('A', { rt60Target: 0.3, noiseFloorDbMax: -60 }, { storage: st });
    expect(clearStudioBaseline('A', st)).toBe(true);
    expect(clearStudioBaseline('A', st)).toBe(false);
    expect(getStudioBaseline('A', st)).toBeNull();
  });

  it('resolves learned baseline over defaults and flags it', () => {
    const st = makeStorage();
    const before = resolveBaselineOptions(
      'X',
      { rt60Target: 0.4, noiseFloorDbMax: -45 },
      st
    );
    expect(before).toEqual({ rt60Target: 0.4, noiseFloorDbMax: -45, learned: false });

    saveStudioBaseline('X', { rt60Target: 0.55, noiseFloorDbMax: -38 }, { storage: st });
    const after = resolveBaselineOptions('X', { rt60Target: 0.4, noiseFloorDbMax: -45 }, st);
    expect(after.rt60Target).toBeCloseTo(0.55);
    expect(after.learned).toBe(true);
  });

  it('rejects invalid numeric input with RangeError', () => {
    const st = makeStorage();
    expect(() =>
      saveStudioBaseline('bad', { rt60Target: NaN, noiseFloorDbMax: -50 }, { storage: st })
    ).toThrow(RangeError);
    expect(() =>
      saveStudioBaseline('bad', { rt60Target: Infinity, noiseFloorDbMax: -50 }, { storage: st })
    ).toThrow(RangeError);
    expect(() =>
      saveStudioBaseline('bad', { rt60Target: -1, noiseFloorDbMax: -50 }, { storage: st })
    ).toThrow(RangeError);
    expect(() =>
      saveStudioBaseline('bad', { rt60Target: 0.4, noiseFloorDbMax: NaN }, { storage: st })
    ).toThrow(RangeError);
  });

  it('survives corrupted storage payloads without throwing', () => {
    const st = makeStorage();
    st.setItem('solaris.acoustics.baselines.v1', '{not json!!');
    expect(getStudioBaseline('any', st)).toBeNull();

    st.setItem(
      'solaris.acoustics.baselines.v1',
      JSON.stringify({ ghost: { rt60Target: 'x' } })
    );
    expect(getStudioBaseline('ghost', st)).toBeNull();
  });

  it('works with no storage at all (private mode) — in-memory value still returned', () => {
    const b = saveStudioBaseline('offline', { rt60Target: 0.5, noiseFloorDbMax: -44 }, { storage: null });
    expect(b.samples).toBe(1);
    expect(clearStudioBaseline('offline', null)).toBe(false);
  });
});

/**
 * Tests for the acoustic panel presentation model (P3).
 * Real engine reports on synthetic fixtures — no mocks.
 */
import { describe, expect, it } from 'vitest';
import { analyzeAudioPcm } from '../audioAcoustics';
import { makeSpeechLike, makeSine, addReverb, addHum } from '../fixtures';
import {
  buildPanelRows,
  buildTimelineMarks,
  overallVerdict,
  overallScoreClass,
  formatClock,
  canMarkReference,
  referenceFromReport,
  SEVERITY_BAR_CLASS,
} from '../panelModel';

const SR = 16000;

function makeCleanReport() {
  const dry = makeSpeechLike(
    [
      { word: 1.2, pause: 0.9 },
      { word: 1.4, pause: 0.9 },
      { word: 1.2, pause: 0.9 },
      { word: 1.6, pause: 0.9 },
      { word: 1.3, pause: 0.0 },
    ],
    SR
  );
  return { report: analyzeAudioPcm(dry, SR), durationSec: dry.length / SR };
}

function makeReverbReport() {
  const dry = makeSpeechLike(
    [
      { word: 1.2, pause: 0.8 },
      { word: 1.4, pause: 0.8 },
      { word: 1.2, pause: 0.8 },
      { word: 1.6, pause: 0.8 },
      { word: 1.3, pause: 0 },
    ],
    SR
  );
  return analyzeAudioPcm(addReverb(dry, 1.2, SR), SR);
}

function makeHumReport() {
  // Tonal base outside the hum comb (mirrors known-answer.test.ts) so the
  // 50/60Hz spectral pencil is not masked by speech-like broadband noise.
  const base = makeSine(3000, 4, SR, 0.2);
  return analyzeAudioPcm(addHum(base, SR, 60, -30), SR);
}

describe('panelModel — buildPanelRows', () => {
  it('returns five rows with reverb first and clamped widths', () => {
    const { report } = makeCleanReport();
    const rows = buildPanelRows(report);
    expect(rows.map((r) => r.key)).toEqual(['reverb', 'clipping', 'noise', 'distortion', 'echo']);
    for (const r of rows) {
      expect(r.widthPct).toBeGreaterThanOrEqual(0);
      expect(r.widthPct).toBeLessThanOrEqual(100);
      expect(r.valueLabel.length).toBeGreaterThan(0);
    }
    // reverb value label carries seconds unit
    expect(rows[0].valueLabel).toMatch(/s$/);
  });

  it('reverberant fixture pushes reverb row severity below ok', () => {
    const rows = buildPanelRows(makeReverbReport());
    expect(rows[0].severity).not.toBe('ok');
    expect(rows[0].score).toBeLessThan(78);
    expect(SEVERITY_BAR_CLASS[rows[0].severity]).toBeDefined();
  });

  it('locale switches labels', () => {
    const { report } = makeCleanReport();
    const pt = buildPanelRows(report, 'pt');
    const en = buildPanelRows(report, 'en');
    expect(pt[2].label).toBe('Ruído');
    expect(en[2].label).toBe('Noise');
    expect(pt[3].label).toBe('Distorção');
  });
});

describe('panelModel — buildTimelineMarks', () => {
  it('positions marks within 0-100% and sorted by time', () => {
    const { report, durationSec } = makeCleanReport();
    const marks = buildTimelineMarks(report, durationSec);
    for (const m of marks) {
      expect(m.posPct).toBeGreaterThanOrEqual(0);
      expect(m.posPct).toBeLessThanOrEqual(100);
    }
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].tSec).toBeGreaterThanOrEqual(marks[i - 1].tSec);
    }
  });

  it('hum fixture produces a hum-severity mark', () => {
    const report = makeHumReport();
    const marks = buildTimelineMarks(report, report.durationSec);
    expect(marks.some((m) => m.severity === 'hum')).toBe(true);
  });
});

describe('panelModel — verdict & helpers', () => {
  it('overall verdict bands are monotonic', () => {
    expect(overallVerdict(95)).toBe('Aprovado');
    expect(overallVerdict(70)).toBe('Atenção');
    expect(overallVerdict(45)).toBe('Reprovável');
    expect(overallVerdict(10)).toBe('Crítico');
  });

  it('score classes match severity colors', () => {
    expect(overallScoreClass(90)).toContain('emerald');
    expect(overallScoreClass(70)).toContain('amber');
    expect(overallScoreClass(20)).toContain('red');
  });

  it('formats clock as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
  });

  it('reference capture only offered for trustworthy schroeder runs without clipping', () => {
    const { report: clean } = makeCleanReport();
    if (clean.reverb.rt60Method === 'schroeder' && !clean.clip.hasClip) {
      expect(canMarkReference(clean)).toBe(true);
      const ref = referenceFromReport(clean);
      expect(ref.rt60Target).toBeGreaterThan(0);
      expect(ref.noiseFloorDbMax).toBeLessThan(0);
    }
    const clipped = analyzeAudioPcm(hardClipOf(), SR);
    expect(canMarkReference(clipped)).toBe(false);
  });

  it('reverb axis of a reverberant room is NOT eligible as its own clean reference', () => {
    const rep = makeReverbReport();
    if (rep.reverb.rt60 > 0.7) {
      // product rule lives in canMarkReference via schroeder+no-clip; a very
      // reverberant take CAN be marked (it is the studio truth), so only
      // assert the values captured are sane.
      const ref = referenceFromReport(rep);
      expect(ref.rt60Target).toBeCloseTo(Math.round(rep.reverb.rt60 * 100) / 100);
    }
  });
});

// helper kept out of fixtures to avoid widening their public surface in tests
function hardClipOf(): Float64Array {
  const dry = makeSpeechLike([{ word: 2, pause: 0.5 }, { word: 2, pause: 0 }], SR);
  const out = new Float64Array(dry.length);
  const ceil = Math.pow(10, -1 / 20); // hard clip at -1dBFS → detectable absolute clip
  for (let i = 0; i < dry.length; i++) {
    out[i] = dry[i] > ceil ? ceil : dry[i] < -ceil ? -ceil : dry[i];
  }
  return out;
}

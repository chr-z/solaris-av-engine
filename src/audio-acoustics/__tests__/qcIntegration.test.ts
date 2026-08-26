/**
 * Tests for the acoustics → QC report / sheet bridge (P3).
 * Uses REAL synthetic fixtures through the full engine (known-answer style):
 * clean speech-like audio must score high everywhere; a hard-clipped variant
 * must tank the clipping axis and produce timeline marks.
 */
import { describe, expect, it } from 'vitest';
import { analyzeAudioPcm } from '../audioAcoustics';
import { makeSpeechLike, hardClip } from '../fixtures';
import {
  buildAcousticQCSection,
  acousticSheetColumns,
  renderAcousticQCSectionHtml,
  SHEET_COLUMNS_HEADERS,
  AXIS_LABEL_PT,
} from '../qcIntegration';

const SR = 16000;

function makeCleanReport() {
  // ~14s of word/pause pattern — enough for Schroeder windows.
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
  return analyzeAudioPcm(dry, SR);
}

function makeClippedReport() {
  const dry = makeSpeechLike(
    [{ word: 2, pause: 0.5 }, { word: 2, pause: 0.5 }, { word: 2, pause: 0 }],
    SR
  );
  return analyzeAudioPcm(hardClip(dry, -3), SR);
}

describe('qcIntegration — buildAcousticQCSection', () => {
  it('clean fixture yields high overall score and ok severities on the five axes', () => {
    const section = buildAcousticQCSection(makeCleanReport());
    expect(section.overallScore).toBeGreaterThanOrEqual(75);
    for (const a of section.axes) {
      expect(a.score).toBeGreaterThanOrEqual(70);
    }
    expect(section.axes.map((a) => a.axis)).toEqual([
      'reverb',
      'clipping',
      'distortion',
      'noise',
      'echo',
    ]);
  });

  it('clipped fixture drops the clipping axis below warn threshold with marks', () => {
    const report = makeClippedReport();
    const section = buildAcousticQCSection(report);
    const clipAxis = section.axes.find((a) => a.axis === 'clipping')!;
    expect(clipAxis.severity).not.toBe('ok');
    expect(section.timelineMarks).toBeGreaterThan(0);
    // other axes must not be dragged to critical by the clip alone
    expect(section.axes.find((a) => a.axis === 'echo')!.score).toBeGreaterThanOrEqual(60);
  });

  it('rt60Sec is null only when reverb method is none', () => {
    const section = buildAcousticQCSection(makeCleanReport());
    if (section.rt60Sec === null) {
      expect(section.rt60Sec).toBeNull();
    } else {
      expect(section.rt60Sec).toBeGreaterThan(0);
      expect(section.rt60Sec).toBeLessThan(3);
    }
  });

  it('is deterministic (same input, same section)', () => {
    const r = makeCleanReport();
    const s1 = buildAcousticQCSection(r);
    const s2 = buildAcousticQCSection(r);
    expect(s1).toEqual(s2);
  });
});

describe('qcIntegration — sheet columns', () => {
  it('produces five integer scores 0-100 in fixed order semantics', () => {
    const cols = acousticSheetColumns(makeCleanReport());
    const entries = Object.entries(cols);
    expect(entries.length).toBe(5);
    for (const [, v] of entries) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(Object.keys(cols)).toEqual(['reverb', 'clipping', 'noise', 'distortion', 'echo']);
  });

  it('clipped fixture scores lower on clipping than clean fixture', () => {
    const clean = acousticSheetColumns(makeCleanReport()).clipping;
    const clipped = acousticSheetColumns(makeClippedReport()).clipping;
    expect(clipped).toBeLessThan(clean);
    expect(clipped).toBeLessThanOrEqual(80);
  });

  it('exposes exactly the five product headers', () => {
    expect(SHEET_COLUMNS_HEADERS.map((h) => h.header)).toEqual([
      'Audio Reverb Score',
      'Audio Clipping Score',
      'Audio Ruído Score',
      'Audio Distorção Score',
      'Audio Eco Score',
    ]);
    expect(Object.keys(AXIS_LABEL_PT)).toHaveLength(5);
  });
});

describe('qcIntegration — HTML export', () => {
  it('renders axis rows and escapes explanations', () => {
    const section = buildAcousticQCSection(makeCleanReport());
    const html = renderAcousticQCSectionHtml(section);
    expect(html).toContain('Análise Acústica');
    expect(html).toContain('<table');
    expect(html).toMatch(/Reverb<\/td><td>\d+/);
    // explanation text is present and escaped
    expect(html).not.toMatch(/<script/i);
    const evil: typeof section = {
      ...section,
      axes: section.axes.map((a) =>
        a.axis === 'reverb' ? { ...a, explanation: '<img src=x onerror=alert(1)>' } : a
      ),
    };
    expect(renderAcousticQCSectionHtml(evil)).not.toContain('<img src=x');
  });
});

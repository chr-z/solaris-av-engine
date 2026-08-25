/**
 * Solaris Acoustics — panel presentation model (P3).
 *
 * Pure functions turning an AcousticReport into everything the UI panel
 * renders: axis bar rows, timeline mark positions (percent), colors keyed
 * by severity, and formatted metric labels. No React/DOM here — fully
 * unit-testable (mirrors the utils/ pattern of the repo).
 */

import type { AcousticReport, Severity } from './audioAcoustics';
import { AXIS_LABEL_PT, AXIS_LABEL_EN, type AcousticAxisKey } from './qcIntegration';

export interface PanelAxisRow {
  key: AcousticAxisKey;
  label: string;
  score: number;
  severity: Severity;
  /** Bar width percentage 0-100 (clamped). */
  widthPct: number;
  /** Compact value label, e.g. "0.62 s" / "-38 dBFS" / "3.1%". */
  valueLabel: string;
  explanation: string;
}

export interface PanelTimelineMark {
  tSec: number;
  /** Horizontal position as percentage of the timeline width (0-100). */
  posPct: number;
  severity: Exclude<Severity, 'ok'> | 'hum';
  axis: string;
  note: string;
}

/** Tailwind-ish class tokens kept as data so tests assert them directly. */
export const SEVERITY_BAR_CLASS: Record<Severity, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  critical: 'bg-red-500',
};

export const SEVERITY_DOT_CLASS: Record<PanelTimelineMark['severity'], string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  critical: 'bg-red-400',
  hum: 'bg-fuchsia-400',
};

const AXIS_VALUE_UNIT: Record<AcousticAxisKey, (v: number) => string> = {
  reverb: (v) => `${round(v, 2)} s`,
  clipping: (v) => `${round(v * 100, 3)}%`,
  distortion: (v) => `${round(v * 100, 1)}%`,
  noise: (v) => `${round(v, 0)} dBFS`,
  echo: (v) => `${round(v, 0)} ms`,
  sibilance: (v) => `${round(v, 1)} dB`,
};

function round(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * Builds the five axis rows (reverb first — product priority) for the panel.
 */
export function buildPanelRows(
  report: AcousticReport,
  locale: 'en' | 'pt' = 'pt'
): PanelAxisRow[] {
  const order: AcousticAxisKey[] = ['reverb', 'clipping', 'noise', 'distortion', 'echo'];
  const label = locale === 'pt' ? AXIS_LABEL_PT : AXIS_LABEL_EN;
  return order.map((key) => {
    const axis = report.axes[key];
    return {
      key,
      label: label[key],
      score: Math.max(0, Math.min(100, axis.score)),
      severity: axis.severity,
      widthPct: Math.max(0, Math.min(100, axis.score)),
      valueLabel: AXIS_VALUE_UNIT[key](axis.value),
      explanation: axis.explanation,
    };
  });
}

/**
 * Timeline marks positioned along [0, durationSec]. Marks beyond duration
 * (shouldn't happen) are clamped. Sorted by time for stable rendering.
 */
export function buildTimelineMarks(
  report: AcousticReport,
  durationSec: number
): PanelTimelineMark[] {
  const dur = durationSec > 0 ? durationSec : Math.max(report.durationSec, 1);
  return report.timelineMarks
    .map((m) => ({
      tSec: m.tSec,
      posPct: Math.max(0, Math.min(100, (m.tSec / dur) * 100)),
      severity: m.axis === 'hum' ? 'hum' : m.severity,
      axis: m.axis,
      note: m.note,
    }))
    .sort((a, b) => a.tSec - b.tSec || a.posPct - b.posPct);
}

/** Overall score verdict line shown next to the big number. */
export function overallVerdict(score: number, locale: 'en' | 'pt' = 'pt'): string {
  const band =
    score >= 85 ? 'good' : score >= 60 ? 'fair' : score >= 40 ? 'poor' : 'bad';
  const pt = { good: 'Aprovado', fair: 'Atenção', poor: 'Reprovável', bad: 'Crítico' };
  const en = { good: 'Pass', fair: 'Fair', poor: 'Poor', bad: 'Critical' };
  return (locale === 'pt' ? pt : en)[band];
}

export function overallScoreClass(score: number): string {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
}

/** "m:ss" formatting for timeline tooltips. */
export function formatClock(tSec: number): string {
  const s = Math.max(0, Math.floor(tSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Decides whether the "marcar como referência" action should be offered:
 * only when the reverb measurement came from Schroeder windows (trustworthy)
 * and no critical clipping is poisoning the noise floor estimate.
 */
export function canMarkReference(report: AcousticReport): boolean {
  return report.reverb.rt60Method === 'schroeder' && !report.clip.hasClip;
}

/** Values captured when marking the current session as the studio reference. */
export function referenceFromReport(report: AcousticReport): {
  rt60Target: number;
  noiseFloorDbMax: number;
} {
  return {
    rt60Target: round(report.reverb.rt60, 2),
    noiseFloorDbMax: round(report.noiseFloorDb, 0),
  };
}

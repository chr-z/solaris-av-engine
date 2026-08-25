/**
 * Solaris Acoustics → QC Report / Sheet integration (P3).
 *
 * Pure bridge between the acoustic engine output (AcousticReport) and the
 * product surfaces: the exportable QC report section and the five new
 * sheet-sync columns (Reverb/Clip/Ruído/Distorção/Eco), mirroring
 * SOLARIS_AUDIO_ACOUSTICS.md §Saída.
 */

import type { AcousticReport, AxisResult, Severity } from './audioAcoustics';

/** Axis keys in report order (stable contract for exports/sheet headers). */
export const ACOUSTIC_AXIS_KEYS = [
  'reverb',
  'clipping',
  'distortion',
  'noise',
  'echo',
] as const;

export type AcousticAxisKey = (typeof ACOUSTIC_AXIS_KEYS)[number];

/** Portuguese display names for the sheet columns / QC report. */
export const AXIS_LABEL_PT: Record<AcousticAxisKey, string> = {
  reverb: 'Reverb',
  clipping: 'Clip',
  distortion: 'Distorção',
  noise: 'Ruído',
  echo: 'Eco',
};

export const AXIS_LABEL_EN: Record<AcousticAxisKey, string> = {
  reverb: 'Reverb',
  clipping: 'Clip',
  distortion: 'Distortion',
  noise: 'Noise',
  echo: 'Echo',
};

/** Exportable acoustics section of the QC report. */
export interface AcousticQCSection {
  overallScore: number;
  /** One row per axis, fixed order (reverb, clipping, distortion, noise, echo). */
  axes: Array<{
    axis: AcousticAxisKey;
    label: string;
    score: number;
    severity: Severity;
    value: number;
    explanation: string;
  }>;
  /** Number of timeline problem marks (0 = clean run). */
  timelineMarks: number;
  /** Estimated RT60 in seconds when measurable (Schroeder/C50), else null. */
  rt60Sec: number | null;
}

/**
 * Builds the QC-report acoustics section from an analysis.
 * Deterministic: same report in, same section out.
 */
export function buildAcousticQCSection(report: AcousticReport): AcousticQCSection {
  const axes = ACOUSTIC_AXIS_KEYS.map((key) => {
    const a: AxisResult = report.axes[key];
    return {
      axis: key,
      label: AXIS_LABEL_PT[key],
      score: a.score,
      severity: a.severity,
      value: a.value,
      explanation: a.explanation,
    };
  });
  return {
    overallScore: report.overallScore,
    axes,
    timelineMarks: report.timelineMarks.length,
    rt60Sec: report.reverb.rt60Method === 'none' ? null : report.reverb.rt60,
  };
}

/** The five per-axis quality scores as flat sheet columns (0-100 each). */
export interface AcousticSheetColumns {
  reverb: number;
  clipping: number;
  noise: number;
  distortion: number;
  echo: number;
}

/**
 * Column values for sheet-sync: integer scores 0-100 (100 = clean),
 * in DEMO_HEADERS-compatible order semantics (Reverb/Clip/Ruído/Distorção/Eco).
 * Round-half-up keeps integers stable across JSON roundtrips.
 */
export function acousticSheetColumns(report: AcousticReport): AcousticSheetColumns {
  const r100 = (v: number) => Math.round(Math.max(0, Math.min(100, v)));
  return {
    reverb: r100(report.axes.reverb.score),
    clipping: r100(report.axes.clipping.score),
    noise: r100(report.axes.noise.score),
    distortion: r100(report.axes.distortion.score),
    echo: r100(report.axes.echo.score),
  };
}

/** Column header labels for the sheet (pt-BR product language). */
export const SHEET_COLUMNS_HEADERS: Array<{ key: AcousticAxisKey; header: string }> = [
  { key: 'reverb', header: 'Audio Reverb Score' },
  { key: 'clipping', header: 'Audio Clipping Score' },
  { key: 'noise', header: 'Audio Ruído Score' },
  { key: 'distortion', header: 'Audio Distorção Score' },
  { key: 'echo', header: 'Audio Eco Score' },
];

/** Renders the acoustics section as HTML for the QC report export. */
export function renderAcousticQCSectionHtml(section: AcousticQCSection): string {
  const rows = section.axes
    .map(
      (a) =>
        `<tr><td>${a.label}</td><td>${a.score}</td><td>${a.severity}</td><td>${escapeHtml(a.explanation)}</td></tr>`
    )
    .join('');
  const rt60 =
    section.rt60Sec !== null
      ? `<li>RT60 estimado: ${section.rt60Sec}s</li>`
      : '<li>RT60 não mensurável neste trecho</li>';
  return `
    <h2>Análise Acústica</h2>
    <ul>
      <li>Score geral: ${section.overallScore}/100</li>
      ${rt60}
      <li>Marcas de timeline: ${section.timelineMarks}</li>
    </ul>
    <table border="1" cellpadding="4">
      <thead><tr><th>Eixo</th><th>Score</th><th>Severidade</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/**
 * Solaris Acoustics — "Análise Acústica" panel (P3 UI).
 *
 * Presentational component: all state comes from useAcousticAnalysis via the
 * parent workspace. Clicking the timeline seeks the player (absolute seek
 * through the <video> element ref).
 */
import React from 'react';
import { useI18n } from '../../i18n/I18nContext';
import type { AcousticReport } from '../../audio-acoustics/audioAcoustics';
import {
  buildPanelRows,
  buildTimelineMarks,
  overallVerdict,
  overallScoreClass,
  formatClock,
  canMarkReference,
  SEVERITY_BAR_CLASS,
  SEVERITY_DOT_CLASS,
} from '../../audio-acoustics/panelModel';
import type { BaselineInfo } from '../../hooks/useAcousticAnalysis';
import type { AcousticStatus } from '../../hooks/useAcousticAnalysis';

interface AcousticPanelProps {
  status: AcousticStatus;
  report: AcousticReport | null;
  error: string | null;
  baselineInfo: BaselineInfo;
  durationSec: number;
  onMarkReference: () => void;
  onForgetReference: () => void;
  /** Absolute seek into the player (seconds). */
  onSeek: (tSec: number) => void;
}

const AcousticPanel: React.FC<AcousticPanelProps> = ({
  status,
  report,
  error,
  baselineInfo,
  durationSec,
  onMarkReference,
  onForgetReference,
  onSeek,
}) => {
  const { t } = useI18n();

  if (!report && status !== 'running') {
    return null; // nothing to show before any media/analysis exists
  }

  const rows = report ? buildPanelRows(report) : [];
  const marks = report ? buildTimelineMarks(report, durationSec || report.durationSec) : [];
  const refEligible = report ? canMarkReference(report) : false;

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!report) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(frac * (durationSec || report.durationSec));
  };

  return (
    <section
      aria-label={t('acoustics.panel.label')}
      className="rounded-lg bg-solar-dark-content/90 border border-solar-dark-border p-3 text-sm text-gray-200"
    >
      <header className="flex items-center justify-between mb-2">
        <h3 className="font-bold">{t('acoustics.panel.title')}</h3>
        {status === 'running' && (
          <span className="text-xs text-gray-400" role="status">
            {t('acoustics.panel.analyzing')}
          </span>
        )}
        {status === 'done' && report && (
          <span className="flex items-center gap-2">
            <span className={`text-lg font-bold ${overallScoreClass(report.overallScore)}`}>
              {report.overallScore}
            </span>
            <span className="text-xs text-gray-400">
              {overallVerdict(report.overallScore)} · {t('acoustics.panel.overall')}
            </span>
          </span>
        )}
      </header>

      {status === 'error' && (
        <p className="text-red-400 text-xs" role="alert">
          {t('acoustics.panel.error')}: {error}
        </p>
      )}

      {report && (
        <>
          {/* Axis bars */}
          <div className="flex flex-col gap-1.5 mb-3">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2" title={r.explanation}>
                <span className="w-20 flex-shrink-0 text-xs text-gray-400">{r.label}</span>
                <div className="flex-1 h-2 rounded bg-solar-dark-bg overflow-hidden">
                  <div
                    data-testid={`acoustics-bar-${r.key}`}
                    className={`h-full ${SEVERITY_BAR_CLASS[r.severity]}`}
                    style={{ width: `${r.widthPct}%` }}
                  />
                </div>
                <span className="w-8 text-right text-xs tabular-nums">{r.score}</span>
                <span className="w-20 text-right text-xs text-gray-500">{r.valueLabel}</span>
              </div>
            ))}
          </div>

          {/* Clickable timeline */}
          <div className="mb-2">
            <div
              className="relative h-6 rounded bg-solar-dark-bg border border-solar-dark-border cursor-pointer"
              onClick={handleTimelineClick}
              role="button"
              tabIndex={0}
              aria-label={t('acoustics.panel.timeline')}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' && report) {
                  e.preventDefault();
                  onSeek(Math.min(durationSec || report.durationSec, (durationSec || report.durationSec) > 0 ? Math.floor(durationSec / 10) : 0));
                }
              }}
            >
              {marks.map((m, i) => (
                <span
                  key={`${m.tSec}-${m.axis}-${i}`}
                  title={`${formatClock(m.tSec)} · ${m.axis}: ${m.note}`}
                  className={`absolute top-0 h-full w-1 ${SEVERITY_DOT_CLASS[m.severity]} opacity-80`}
                  style={{ left: `${m.posPct}%` }}
                />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-gray-500">{t('acoustics.panel.seekHint')}</p>
          </div>

          {/* Baseline / reference actions */}
          <footer className="flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-500">
              {baselineInfo.learned
                ? t('acoustics.panel.baselineLearned', {
                    rt60: String(baselineInfo.rt60Target),
                    floor: String(baselineInfo.noiseFloorDbMax),
                  })
                : t('acoustics.panel.baselineDefault', {
                    rt60: String(baselineInfo.rt60Target),
                    floor: String(baselineInfo.noiseFloorDbMax),
                  })}
            </span>
            <span className="flex gap-2">
              {refEligible && !baselineInfo.learned && (
                <button
                  onClick={onMarkReference}
                  disabled={!refEligible}
                  className="px-2 py-1 rounded-md bg-solar-accent/20 text-solar-accent hover:bg-solar-accent/30 transition-colors focus:outline-none focus:ring-2 focus:ring-solar-accent"
                >
                  {t('acoustics.panel.markReference')}
                </button>
              )}
              {baselineInfo.learned && (
                <button
                  onClick={onForgetReference}
                  className="px-2 py-1 rounded-md text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-solar-accent"
                >
                  {t('acoustics.panel.forgetReference')}
                </button>
              )}
            </span>
          </footer>

          {/* Warnings */}
          {report.warnings.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-[11px] text-amber-400/90">
              {report.warnings.slice(0, 3).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

export default AcousticPanel;

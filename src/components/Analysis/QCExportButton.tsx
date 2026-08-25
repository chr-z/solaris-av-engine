import React, { useState } from 'react';
import {
  generateQCReport,
  getQCReportDataURI,
  getQCSummary,
  QCReport,
} from '../../utils/qcReport';
import { useCountUp } from '../../hooks/useCountUp';
import { countFrame } from '../../utils/countUp';

/**
 * S4.1 (repaired in S5.1): downloads a printable QC report for the current
 * dataset and shows a small confirmation dialog with the summary.
 *
 * Uses the app's own lightweight i18n (the previous draft imported
 * react-i18next, which was never installed and broke `tsc --noEmit`).
 */
// Momento wow #2 da spec v3: ao concluir a análise/exportar o relatório, os
// números resumidos animam de 0 até o total (ease-out cúbico, 900ms).
// O util countFrame faz snap EXATO no destino no último frame, então o texto
// final renderizado é idêntico ao estático de antes — só a chegada muda.
const AnimatedStat: React.FC<{ value: number; format: (n: number) => string }> = ({
  value,
  format,
}) => {
  const animated = useCountUp(value);
  return <span className="tnum">{format(animated)}</span>;
};

export const QCExportButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [summary, setSummary] = useState<ReturnType<typeof getQCSummary> | null>(null);
  const [lastDataURI, setLastDataURI] = useState<string | null>(null);

  const buildReport = (): { report: QCReport; dataURI: string } => {
    const report = generateQCReport('en', { filtered: false });
    return { report, dataURI: getQCReportDataURI(report) };
  };

  const triggerDownload = (dataURI: string) => {
    const link = document.createElement('a');
    link.href = dataURI;
    link.download = `solar-qc-report-${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownload = () => {
    const { report, dataURI } = buildReport();
    setSummary(getQCSummary(report));
    setLastDataURI(dataURI);
    triggerDownload(dataURI);
  };

  if (!summary) {
    return (
      <button
        onClick={handleDownload}
        className={`btn btn-primary px-3 py-2 rounded-md ${className}`}
        aria-label="Export QC Report"
        title="Export QC Report"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M10 5l7 7-7 7M12 3v3l6 6L12 21V5a1 1 0 00-2 0z" />
        </svg>
        <span>QC Report</span>
      </button>
    );
  }

  // Confirmation dialog with the generated summary.
  return (
    <div
      className="qc-export-popup fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in-fast"
      onClick={() => setSummary(null)}
      role="dialog"
      aria-modal="true"
      aria-label="QC Report Exported"
    >
      <div
        className="card card-raised rounded-lg p-6 max-w-sm w-full mx-4 text-center shadow-pop"
        onClick={event => event.stopPropagation()}
      >
        <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="19" stroke="var(--color-ok)" strokeWidth="2.5" strokeDasharray="95 25" strokeLinecap="round" transform="rotate(-90 24 24)" />
            <path d="M17 24.5l4.5 4.5L31 20" stroke="var(--color-ok)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="font-bold text-lg mb-1">Report exported</h2>
        <p className="text-sm text-ink-secondary mb-4">
          {summary.title} — <AnimatedStat value={summary.totalRows} format={(n) => `${Math.round(n)} rows`} /> · avg{' '}
          <AnimatedStat value={summary.avgAnalysisTime} format={(n) => n.toFixed(1)} />s ·{' '}
          <span className={summary.errorCount > 0 ? 'text-warn' : ''}>
            <AnimatedStat
              value={summary.errorCount}
              format={(n) => {
                const r = Math.round(n);
                return `${r} ${r === 1 ? 'error' : 'errors'}`;
              }}
            />
          </span>
        </p>
        <div className="flex justify-center gap-2">
          <button
            onClick={() => lastDataURI && triggerDownload(lastDataURI)}
            disabled={!lastDataURI}
            className="btn btn-primary px-4 py-2 rounded-md transition-colors disabled:opacity-50"
          >
            Download again
          </button>
          <button
            onClick={() => setSummary(null)}
            className="btn btn-ghost px-4 py-2 rounded-md"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default QCExportButton;

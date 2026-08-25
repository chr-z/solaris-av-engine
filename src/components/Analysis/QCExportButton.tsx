import React, { useState } from 'react';
import {
  generateQCReport,
  getQCReportDataURI,
  getQCSummary,
  QCReport,
} from '../../utils/qcReport';

/**
 * S4.1 (repaired in S5.1): downloads a printable QC report for the current
 * dataset and shows a small confirmation dialog with the summary.
 *
 * Uses the app's own lightweight i18n (the previous draft imported
 * react-i18next, which was never installed and broke `tsc --noEmit`).
 */
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
        className={`flex items-center gap-2 px-3 py-2 rounded-md bg-solar-accent text-solar-dark-bg hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent ${className}`}
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
        className="bg-solar-dark-content rounded-lg p-6 max-w-sm w-full mx-4 text-center text-white border border-solar-dark-border shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <h3 className="font-bold text-lg mb-1">Report exported</h3>
        <p className="text-sm text-gray-300 mb-4">
          {summary.title} — {summary.totalRows} rows · avg {summary.avgAnalysisTime}s ·{' '}
          {summary.errorCount} errors
        </p>
        <div className="flex justify-center gap-2">
          <button
            onClick={() => lastDataURI && triggerDownload(lastDataURI)}
            disabled={!lastDataURI}
            className="px-4 py-2 bg-solar-accent text-solar-dark-bg rounded-md hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-solar-accent disabled:opacity-50"
          >
            Download again
          </button>
          <button
            onClick={() => setSummary(null)}
            className="px-4 py-2 rounded-md hover:bg-gray-500/20 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default QCExportButton;

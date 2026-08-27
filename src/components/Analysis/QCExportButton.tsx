import React, { useState } from 'react';
import {
  exportQCReportBlob,
  generateQCReport,
  getQCSummary,
  QCReport,
} from '../../utils/qcReport';
import {
  exportQCReportPdf,
  suggestedQCFileName,
} from '../../utils/qcPdf';


/**
 * S4.1 (repaired in S5.1; upgraded in F6/D): downloads a professional PDF
 * QC report (pdfmake, lazy-loaded chunk) for the current dataset and shows
 * a small confirmation dialog with the summary.
 *
 * Fallback contract (offline-first): if the pdfmake chunk fails to load or
 * render (e.g. corrupted cache, very old browser), the previous printable
 * HTML report is downloaded instead so the analyst is never blocked.
 *
 * Uses the app's own lightweight i18n approach (hardcoded EN strings, same
 * as before the upgrade).
 */
// Momento wow #2 da spec v3: ao concluir a análise/exportar o relatório, os
// números resumidos animam de 0 até o total (ease-out cúbico, 900ms).
// O util countFrame faz snap EXATO no destino no último frame, então o texto
// final renderizado é idêntico ao estático de antes — só a chegada muda.

export const QCExportButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [summary, setSummary] = useState<ReturnType<typeof getQCSummary> | null>(null);
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [lastFileName, setLastFileName] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);

  const saveBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const downloadLegacyHtml = (report: QCReport) => {
    // Fallback offline-first: reusa o relatório HTML rico do S4.1
    // (exportQCReportBlob), não um template mínimo.
    const blob = exportQCReportBlob(report);
    const fileName = `solar-qc-report-${new Date(report.generatedAt).toISOString().split('T')[0]}.html`;
    setLastBlob(blob);
    setLastFileName(fileName);
    saveBlob(blob, fileName);
  };

  const handleDownload = async () => {
    const report = generateQCReport('en', { filtered: false });
    // Diálogo só abre DEPOIS que o artefato existe: enquanto gera, o botão
    // mostra "Generating…" desabilitado (senão o estado era código morto).
    setIsGenerating(true);
    setUsedFallback(false);
    try {
      const blob = await exportQCReportPdf(report);
      if (blob.size <= 0) throw new Error('empty pdf');
      const fileName = suggestedQCFileName(report);
      setLastBlob(blob);
      setLastFileName(fileName);
      saveBlob(blob, fileName);
      setSummary(getQCSummary(report));
    } catch {
      downloadLegacyHtml(report);
      setSummary(getQCSummary(report));
      setUsedFallback(true);
    } finally {
      setIsGenerating(false);
    }
  };

  if (!summary) {
    return (
      <button
        onClick={() => void handleDownload()}
        disabled={isGenerating}
        className={`flex items-center gap-2 px-3 py-2 rounded-md bg-solar-accent text-white hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-content focus:ring-solar-accent disabled:opacity-60 ${className}`}
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
        <span>{isGenerating ? 'Generating…' : 'QC Report'}</span>
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
        <h3 className="font-bold text-lg mb-1">Report exported</h3>
        <p className="text-sm text-gray-300 mb-2">
          {summary.title} — {summary.totalRows} rows · avg {summary.avgAnalysisTime}s ·{' '}
          {summary.errorCount} errors

        </p>
        {usedFallback && (
          <p className="text-xs text-amber-400 mb-3" role="status">
            PDF engine unavailable — printable HTML downloaded instead.
          </p>
        )}
        <div className="flex justify-center gap-2">
          <button
            onClick={() => lastBlob && lastFileName && saveBlob(lastBlob, lastFileName)}
            disabled={!lastBlob || !lastFileName}
            className="px-4 py-2 bg-solar-accent text-white rounded-md hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-solar-accent disabled:opacity-50"
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

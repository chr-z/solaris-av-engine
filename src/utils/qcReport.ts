/**
 * QC Report Utils — S4.1: relatório QC exportável PDF/print CSS
 * Gera dados estruturados para relatório de qualidade de conteúdo,
 * compatível com impressão via CSS @media print e download PDF client-side.
 */

import { DEMO_HEADERS, DEMO_ROWS } from './demoData';
import {
  getLatestAcousticQCSection,
  renderAcousticQCSectionHtml,
} from '../audio-acoustics/qcIntegration';

/** Estrutura do relatório QC exportado */
export interface QCReport {
  title: string;
  generatedAt: string;
  locale: string;
  totalSheets: number;
  totalRows: number;
  filteredRows: number;
  headers: string[];
  metrics: {
    avgAnalysisTime: number;
    totalErrors: number;
    warningCount: number;
  };
}

/** Gera um relatório QC a partir dos dados ativos do app */
export function generateQCReport(
  locale: string = 'en',
  options: { filtered?: boolean } = {}
): QCReport {
  const allRows = DEMO_ROWS;
  const totalRows = allRows.length;

  // Extract analysis times from row[6] (ANALYSIS TIME column index, per AnalysisSheet structure)
  const analysisTimes = allRows
    .map((r) => r.row[6]?.value)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => {
      const n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    });

  const avgAnalysisTime =
    analysisTimes.length > 0
      ? analysisTimes.reduce((a, b) => a + b, 0) / analysisTimes.length
      : 0;

  // Count errors: rows where EVENT column (index 2) contains error-related text
  const totalErrors = allRows.reduce(
    (count, r) => {
      const event = r.row[2]?.value?.toLowerCase() || '';
      return event.includes('error') || event.includes('clipping') || event.includes('failed')
        ? count + 1
        : count;
    },
    0
  );

  // When filtered mode, use same row count as total for demo purposes
  const displayFilteredRows = options.filtered ? totalRows : 0;

  const timestamp = new Date();

  return {
    title: locale === 'pt' ? 'Relatório QC Solar' : 'Solar QC Report',
    generatedAt: timestamp.toISOString(),
    locale,
    totalSheets: 1, // single demo sheet
    totalRows,
    filteredRows: displayFilteredRows,
    headers: DEMO_HEADERS.map((h) => h.toString()),
    metrics: {
      avgAnalysisTime: Math.round(avgAnalysisTime * 10) / 10,
      totalErrors,
      warningCount: 0, // placeholder for future expansion
    },
  };
}

/** Exporta o relatório como blob downloadável (client-side) */
export function exportQCReportBlob(report: QCReport): Blob {
  // Spec SOLARIS_AUDIO_ACOUSTICS §Saída: o relatório QC inclui os scores
  // acústicos. A seção vem do registro da última análise acústica publicada;
  // sem análise prévia, o relatório sai sem a seção (comportamento anterior).
  const acousticSection = getLatestAcousticQCSection();
  const acousticHtml = acousticSection ? renderAcousticQCSectionHtml(acousticSection) : '';
  const formattedDate = new Date(report.generatedAt).toISOString().split('T')[0];
  const template = `
    <h1>${report.title}</h1>
    <p><strong>Generated:</strong> ${formattedDate}</p>
    <p><strong>Locale:</strong> ${report.locale.toUpperCase()}</p>
    <hr />
    <h2>Metrics</h2>
    <ul>
      <li>Total Rows: ${report.totalRows}</li>
      <li>Filtered Rows: ${report.filteredRows}</li>
      <li>Avg Analysis Time: ${report.metrics.avgAnalysisTime}s</li>
      <li>Total Errors: ${report.metrics.totalErrors}</li>
      <li>Warnings: ${report.metrics.warningCount}</li>
    </ul>
    <h2>Headers</h2>
    <pre>${JSON.stringify(report.headers, null, 2)}</pre>
    ${acousticHtml}
  `;

  const blob = new Blob([template], { type: 'text/html' });
  return blob;
}

/** Converte um relatório QC em dados de dados URI para download */
export function getQCReportDataURI(report: QCReport): string {
  const blob = exportQCReportBlob(report);
  return URL.createObjectURL(blob);
}

/** Resumo simplificado para o modo comparativo A/B (S4.2) */
export interface QCSummary {
  title: string;
  totalRows: number;
  avgAnalysisTime: number;
  errorCount: number;
}

export function getQCSummary(report: QCReport): QCSummary {
  return {
    title: report.title,
    totalRows: report.totalRows,
    avgAnalysisTime: report.metrics.avgAnalysisTime,
    errorCount: report.metrics.totalErrors,
  };
}
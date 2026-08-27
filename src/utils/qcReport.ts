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

/** Exporta o relatório como documento HTML completo, pronto pra abrir/imprimir/PDF */
export function exportQCReportBlob(report: QCReport): Blob {
  // Spec SOLARIS_AUDIO_ACOUSTICS §Saída: o relatório QC inclui os scores
  // acústicos. A seção vem do registro da última análise acústica publicada;
  // sem análise prévia, o relatório sai sem a seção (comportamento anterior).
  const acousticSection = getLatestAcousticQCSection();
  const acousticHtml = acousticSection ? renderAcousticQCSectionHtml(acousticSection) : '';
  const formattedDate = new Date(report.generatedAt).toISOString().split('T')[0];
  const generatedAt = new Date(report.generatedAt).toLocaleString(
    report.locale === 'pt' ? 'pt-BR' : 'en-US',
    { dateStyle: 'medium', timeStyle: 'short' }
  );
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const template = `<!doctype html>
<html lang="${report.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(report.title)} · ${formattedDate}</title>
<style>
  :root { --ink:#161a23; --muted:#5b6474; --line:rgba(16,20,30,.12);
          --accent:#8f6ff7; --accent2:#f09a52; --warn:#b45309; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f6f7fb; color:var(--ink);
         font:15px/1.55 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;
         -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .qc-doc { max-width:800px; margin:32px auto; padding:0 24px; }
  .qc-header h1 { font-size:24px; letter-spacing:-.01em; margin:0; }
  .qc-rule { height:3px; border-radius:999px;
             background:linear-gradient(90deg,var(--accent),var(--accent2));
             margin:14px 0 10px; }
  .qc-meta { color:var(--muted); font-size:13px; margin:0; }
  .qc-meta strong { color:var(--ink); }
  .qc-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(128px,1fr));
             gap:10px; margin:20px 0 6px; }
  .qc-stat { background:#fff; border:1px solid var(--line);
             border-radius:10px; padding:12px 14px; }
  .qc-stat b { display:block; font-size:24px; line-height:1.2;
               font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
  .qc-stat span { font-size:11px; text-transform:uppercase;
                  letter-spacing:.06em; color:var(--muted); }
  .qc-stat.is-warn b { color:var(--warn); }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em;
       color:var(--muted); border-top:1px solid var(--line);
       padding-top:14px; margin:22px 0 10px; }
  pre { background:#fff; border:1px solid var(--line); border-radius:10px;
        padding:12px 14px; margin:0;
        font:12.5px/1.5 'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
        overflow-x:auto; }
  .qc-footer { margin-top:26px; padding-top:12px;
               border-top:1px solid var(--line); color:var(--muted);
               font-size:12px; display:flex; justify-content:space-between; gap:12px; }
  @page { size:A4; margin:14mm; }
  @media print {
    body { background:#fff; }
    .qc-doc { margin:0; max-width:none; padding:0; }
  }
</style>
</head>
<body>
<main class="qc-doc">
  <header class="qc-header">
    <h1>${esc(report.title)}</h1>
    <div class="qc-rule" aria-hidden="true"></div>
    <p class="qc-meta"><strong>Generated:</strong> ${generatedAt} &middot;
       <strong>Locale:</strong> ${esc(report.locale.toUpperCase())}</p>
  </header>
  <section class="qc-grid" aria-label="Metrics">
    <div class="qc-stat"><b>${report.totalRows}</b><span>Total rows</span></div>
    <div class="qc-stat"><b>${report.filteredRows}</b><span>Filtered rows</span></div>
    <div class="qc-stat"><b>${report.metrics.avgAnalysisTime}s</b><span>Avg analysis time</span></div>
    <div class="qc-stat${report.metrics.totalErrors > 0 ? ' is-warn' : ''}"><b>${report.metrics.totalErrors}</b><span>Total errors</span></div>
    <div class="qc-stat"><b>${report.metrics.warningCount}</b><span>Warnings</span></div>
  </section>
  <h2>Headers</h2>
  <pre>${esc(JSON.stringify(report.headers, null, 2))}</pre>
  <footer class="qc-footer">
    <span>Solaris AV Analysis Engine</span>
    <span>${formattedDate}</span>
  </footer>
</main>
</body>
</html>
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
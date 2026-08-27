/**
 * QC PDF Report — F6/D tech swap: pdfmake client-side (spec seção D).
 * Substitui o blob HTML do S4.1 por um relatório QC profissional anexável.
 *
 * Arquitetura:
 * - `buildQCReportDocDefinition` é PURO (sem importar pdfmake) → testável
 *   em vitest sem custo de parser.
 * - `exportQCReportPdf` faz dynamic import() da UMD build + vfs de fontes →
 *   o bundle (~2MB min) fica num chunk separado, fora do caminho crítico.
 * - Offline-first: Roboto vem embutida no pacote (vfs_fonts), zero CDN.
 */
import type { QCReport } from './qcReport';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

const ACCENT = '#0a84ff';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

/** Labels bilíngues do relatório (módulo puro — não depende do contexto React). */
export interface QCReportLabels {
  generatedAt: string;
  metrics: string;
  totalSheets: string;
  totalRows: string;
  filteredRows: string;
  avgAnalysisTime: string;
  totalErrors: string;
  warnings: string;
  sheetColumns: string;
  column: string;
  filteredNote: string;
  footerBrand: string;
}

const LABELS: Record<string, QCReportLabels> = {
  en: {
    generatedAt: 'Generated at',
    metrics: 'Metrics',
    totalSheets: 'Sheets',
    totalRows: 'Total rows',
    filteredRows: 'Filtered rows',
    avgAnalysisTime: 'Avg analysis time',
    totalErrors: 'Errors',
    warnings: 'Warnings',
    sheetColumns: 'Sheet columns',
    column: 'Column',
    filteredNote: 'Report includes the active filter subset.',
    footerBrand: 'Solaris AV Engine · QC Report',
  },
  pt: {
    generatedAt: 'Gerado em',
    metrics: 'Métricas',
    totalSheets: 'Planilhas',
    totalRows: 'Linhas totais',
    filteredRows: 'Linhas filtradas',
    avgAnalysisTime: 'Tempo médio por análise',
    totalErrors: 'Inconformidades',
    warnings: 'Avisos',
    sheetColumns: 'Colunas da planilha',
    column: 'Coluna',
    filteredNote: 'Relatório inclui o subconjunto do filtro ativo.',
    footerBrand: 'Solaris AV Engine · Relatório QC',
  },
};

export function qcReportLabels(locale: string): QCReportLabels {
  return LABELS[locale] ?? LABELS.en;
}

/** Data ISO → formato local do relatório (en-US / pt-BR). */
export function formatReportDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'pt' ? 'pt-BR' : 'en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

/** Segundos → string localizada ("12,5 s" pt / "12.5 s" en). */
export function formatAnalysisSeconds(seconds: number, locale: string): string {
  const n = Number.isFinite(seconds) ? seconds : 0;
  return `${n.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US', {
    maximumFractionDigits: 1,
  })} s`;
}

/** Nome de arquivo sugerido: solar-qc-report-YYYY-MM-DD.pdf */
export function suggestedQCFileName(report: QCReport): string {
  const day = (report.generatedAt || new Date().toISOString()).split('T')[0];
  return `solar-qc-report-${day}.pdf`;
}

interface StatCell {
  stack: { text: string; fontSize: number; color: string; bold?: boolean }[];
}

function statCell(label: string, value: string): StatCell {
  return {
    stack: [
      { text: String(value), fontSize: 16, bold: true, color: INK },
      { text: label, fontSize: 8.5, color: MUTED },
    ],
  };
}

/**
 * Monta o docDefinition completo do relatório QC (puro, serializável).
 */
export function buildQCReportDocDefinition(
  report: QCReport,
  labelsInput?: QCReportLabels
): TDocumentDefinitions {
  const labels = labelsInput ?? qcReportLabels(report.locale);
  const intlLocale = report.locale === 'pt' ? 'pt-BR' : 'en-US';

  const metricCells = [
    statCell(labels.totalRows, String(report.totalRows)),
    statCell(labels.filteredRows, String(report.filteredRows)),
    statCell(labels.avgAnalysisTime, formatAnalysisSeconds(report.metrics.avgAnalysisTime, intlLocale)),
    statCell(labels.totalErrors, String(report.metrics.totalErrors)),
    statCell(labels.warnings, String(report.metrics.warningCount)),
    statCell(labels.totalSheets, String(report.totalSheets)),
  ];
  // Grid 3 colunas × 2 linhas de estatísticas.
  const statsGrid = {
    margin: [0, 10, 0, 4] as [number, number, number, number],
    table: {
      widths: ['*', '*', '*'],
      body: [
        [metricCells[0], metricCells[1], metricCells[2]],
        [metricCells[3], metricCells[4], metricCells[5]],
      ],
    },
    layout: {
      hLineWidth: (): number => 0,
      vLineWidth: (): number => 0,
      paddingLeft: (): number => 6,
      paddingRight: (): number => 6,
      paddingTop: (): number => 8,
      paddingBottom: (): number => 8,
    },
  };

  const headerRows = report.headers.map((header, index) => [
    { text: String(index + 1), fontSize: 9, color: MUTED, alignment: 'right' as const },
    { text: header, fontSize: 10, color: INK },
  ]);

  const content: unknown[] = [
    { text: 'SOLARIS', fontSize: 9, bold: true, color: ACCENT, characterSpacing: 2 },
    { text: report.title, fontSize: 22, bold: true, color: INK, margin: [0, 4, 0, 2] },
    {
      text: `${labels.generatedAt}: ${formatReportDate(report.generatedAt, intlLocale)}`,
      fontSize: 9.5,
      color: MUTED,
    },
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: ACCENT }],
      margin: [0, 8, 0, 2],
    },
    { text: labels.metrics, fontSize: 13, bold: true, color: INK, margin: [0, 10, 0, 0] },
    statsGrid,
  ] as unknown[];

  if (report.filteredRows > 0) {
    content.push({
      text: labels.filteredNote,
      fontSize: 9,
      italics: true,
      color: MUTED,
      margin: [0, 0, 0, 4],
    });
  }

  content.push(
    { text: labels.sheetColumns, fontSize: 13, bold: true, color: INK, margin: [0, 14, 0, 4] },
    {
      table: {
        widths: [30, '*'],
        body: headerRows.length > 0 ? headerRows : [[{ text: '—', color: MUTED }, { text: '—' }]],
      },
      layout: {
        hLineColor: (): string => LINE,
        hLineWidth: (i: number, node: { table?: { body?: unknown[] } }): number =>
          i === 0 || i === (node.table?.body?.length ?? 0) ? 0 : 0.5,
        vLineWidth: (): number => 0,
        paddingTop: (): number => 3,
        paddingBottom: (): number => 3,
        paddingLeft: (): number => 2,
        paddingRight: (): number => 6,
      } as never,
    }
  );

  return {
    content: content as TDocumentDefinitions['content'],
    defaultStyle: { font: 'Roboto' },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 48],
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 12, 40, 0],
      columns: [
        { text: labels.footerBrand, fontSize: 8, color: MUTED },
        {
          text: `${currentPage} / ${pageCount}`,
          fontSize: 8,
          color: MUTED,
          alignment: 'right',
        },
      ],
    }),
  };
}

let vfsLoaded = false;

/** Garante Roboto no vfs do pdfmake (uma única vez por sessão). */
async function ensureFonts(pdfMake: { addVirtualFileSystem: (vfs: unknown) => void }): Promise<void> {
  if (vfsLoaded) return;
  const vfsMod = (await import('pdfmake/build/vfs_fonts.js')) as unknown as {
    default?: Record<string, string>;
  };
  const vfs = vfsMod.default ?? (vfsMod as unknown as Record<string, string>);
  pdfMake.addVirtualFileSystem(vfs);
  vfsLoaded = true;
}

type PdfMakeClient = {
  createPdf: (
    docDefinition: TDocumentDefinitions
  ) => { getBlob: () => Promise<Blob> };
};

/**
 * Gera o Blob PDF do relatório QC. Import pesado 100% lazy — o chunk do
 * pdfmake só baixa quando o analista pede o relatório.
 */
export async function exportQCReportPdf(report: QCReport): Promise<Blob> {
  const mod = (await import('pdfmake/build/pdfmake.js')) as unknown as {
    default: PdfMakeClient;
  };
  const pdfMake = mod.default;
  await ensureFonts(pdfMake as unknown as { addVirtualFileSystem: (vfs: unknown) => void });
  const doc = pdfMake.createPdf(buildQCReportDocDefinition(report));
  return doc.getBlob();
}

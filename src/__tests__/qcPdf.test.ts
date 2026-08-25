import { describe, it, expect } from 'vitest';
import {
  qcReportLabels,
  formatReportDate,
  formatAnalysisSeconds,
  suggestedQCFileName,
  buildQCReportDocDefinition,
} from '../utils/qcPdf';
import { QCReport } from '../utils/qcReport';

const sampleReport: QCReport = {
  title: 'Solar QC Report',
  generatedAt: new Date('2026-08-25T12:34:56Z').toISOString(),
  locale: 'en',
  totalSheets: 1,
  totalRows: 50,
  filteredRows: 25,
  headers: ['WO', 'EVENT', 'UNIFORM'],
  metrics: {
    avgAnalysisTime: 12.5,
    totalErrors: 3,
    warningCount: 2,
  },
};

describe('qcPdf — F6/D tech swap (pdfmake)', () => {
  describe('qcReportLabels', () => {
    it('defaults to EN labels for unknown locales', () => {
      expect(qcReportLabels('fr').metrics).toBe('Metrics');
      expect(qcReportLabels('').totalRows).toBe('Total rows');
    });

    it('returns PT labels for pt', () => {
      const labels = qcReportLabels('pt');
      expect(labels.metrics).toBe('Métricas');
      expect(labels.totalRows).toBe('Linhas totais');
      expect(labels.totalErrors).toBe('Inconformidades');
      expect(labels.footerBrand).toContain('Relatório QC');
    });
  });

  describe('formatReportDate', () => {
    it('formats ISO date in en-US long style', () => {
      const out = formatReportDate('2026-08-25T12:34:56Z', 'en');
      expect(out).toMatch(/August 25, 2026/);
    });

    it('formats ISO date in pt-BR', () => {
      const out = formatReportDate('2026-08-25T12:34:56Z', 'pt');
      expect(out).toMatch(/25 de agosto de 2026/);
    });

    it('falls back to the raw string for invalid dates', () => {
      expect(formatReportDate('not-a-date', 'en')).toBe('not-a-date');
    });
  });

  describe('formatAnalysisSeconds', () => {
    it('uses dot decimal in en', () => {
      expect(formatAnalysisSeconds(12.5, 'en')).toBe('12.5 s');
    });

    it('uses comma decimal in pt', () => {
      expect(formatAnalysisSeconds(12.5, 'pt')).toBe('12,5 s');
    });

    it('coerces non-finite input to zero', () => {
      expect(formatAnalysisSeconds(NaN, 'en')).toBe('0 s');
      expect(formatAnalysisSeconds(Infinity, 'en')).toBe('0 s');
    });
  });

  describe('suggestedQCFileName', () => {
    it('derives YYYY-MM-DD from the report timestamp', () => {
      expect(suggestedQCFileName(sampleReport)).toBe('solar-qc-report-2026-08-25.pdf');
    });

    it('falls back to today when generatedAt is empty', () => {
      const name = suggestedQCFileName({ ...sampleReport, generatedAt: '' });
      expect(name).toMatch(/^solar-qc-report-\d{4}-\d{2}-\d{2}\.pdf$/);
    });
  });

  describe('buildQCReportDocDefinition (pure builder)', () => {
    it('produces an A4 Roboto document with title content', () => {
      const doc = buildQCReportDocDefinition(sampleReport);
      expect(doc.pageSize).toBe('A4');
      expect(doc.defaultStyle?.font).toBe('Roboto');
      expect(Array.isArray(doc.content)).toBe(true);
      const titleNode = (doc.content as unknown as { text?: unknown }[])[1];
      expect(titleNode.text).toBe('Solar QC Report');
    });

    it('renders the six KPI cells in a 3×2 grid', () => {
      const doc = buildQCReportDocDefinition(sampleReport);
      const grid = (doc.content as unknown as Record<string, unknown>[]).find(
        (node) =>
          typeof node === 'object' &&
          node !== null &&
          (node as { table?: { widths?: string[] } }).table?.widths?.join(',') === '*,*,*'
      ) as { table: { body: { stack: { text: string }[][] }[] } } | undefined;
      expect(grid).toBeDefined();
      expect(grid!.table.body.length).toBe(2);
      const flat = grid!.table.body.flat().map((cell) => (cell as unknown as { stack: { text: string }[] }).stack[0].text);
      expect(flat).toEqual(['50', '25', '12.5 s', '3', '2', '1']);
    });

    it('includes the filter note only when filteredRows > 0', () => {
      const withNote = buildQCReportDocDefinition(sampleReport);
      expect(JSON.stringify(withNote.content)).toContain('filter subset');

      const withoutNote = buildQCReportDocDefinition({
        ...sampleReport,
        filteredRows: 0,
      });
      expect(JSON.stringify(withoutNote.content)).not.toContain('filter subset');
    });

    it('lists one row per sheet column', () => {
      const doc = buildQCReportDocDefinition(sampleReport);
      const colTable = (doc.content as unknown as Record<string, unknown>[]).find(
        (node) =>
          typeof node === 'object' &&
          node !== null &&
          (node as { table?: { widths?: unknown[] } }).table?.widths?.length === 2
      ) as { table: { body: unknown[][] } };
      expect(colTable.table.body.length).toBe(3);
      expect((colTable.table.body[0][1] as { text: string }).text).toBe('WO');
    });

    it('falls back to a placeholder row when there are no columns', () => {
      const doc = buildQCReportDocDefinition({ ...sampleReport, headers: [] });
      const json = JSON.stringify(doc.content);
      expect(json).toContain('—');
    });

    it('footer renders current/pageCount and brand line', () => {
      const doc = buildQCReportDocDefinition(sampleReport);
      expect(typeof doc.footer).toBe('function');
      const rendered = (doc.footer as (c: number, t: number) => unknown)(2, 7) as {
        columns: { text: string }[];
      };
      expect(rendered.columns[1].text).toBe('2 / 7');
      expect(rendered.columns[0].text).toContain('Solaris AV Engine');
    });

    it('docDefinition is fully JSON-serializable (except callbacks)', () => {
      const doc = buildQCReportDocDefinition(sampleReport);
      const { footer, ...serializable } = doc;
      expect(() => JSON.stringify(serializable)).not.toThrow();
      expect(footer).toBeDefined();
    });
  });
});

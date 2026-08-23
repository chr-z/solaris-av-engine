import { describe, it, expect } from 'vitest';
import {
  generateQCReport,
  exportQCReportBlob,
  getQCReportDataURI,
  getQCSummary,
  QCReport,
  QCSummary,
} from '../utils/qcReport';

const sampleReport: QCReport = {
  title: 'Solar QC Report',
  generatedAt: new Date().toISOString(),
  locale: 'en',
  totalSheets: 1,
  totalRows: 50,
  filteredRows: 25,
  headers: ['WO', 'EVENT', 'UNIFORM', 'ANALYST', 'OPERATOR', 'ANALYSIS TIME', 'INSTRUCTOR', 'STUDIO'],
  metrics: {
    avgAnalysisTime: 12.5,
    totalErrors: 3,
    warningCount: 0,
  },
};

describe('QC Report Utils — S4.1', () => {
  describe('generateQCReport', () => {
    it('generates a report with expected structure and default params', () => {
      const report = generateQCReport('en');
      expect(report).toHaveProperty('title');
      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('locale', 'en');
      expect(report).toHaveProperty('totalSheets');
      expect(report).toHaveProperty('totalRows');
      expect(report).toHaveProperty('filteredRows');
      expect(report).toHaveProperty('headers');
      expect(report).toHaveProperty('metrics');
      expect(report.title).toBe('Solar QC Report');
      expect(report.locale).toBe('en');
      expect(report.totalSheets).toBe(1);
      expect(Array.isArray(report.headers)).toBe(true);
      expect(report.metrics).toHaveProperty('avgAnalysisTime');
      expect(report.metrics).toHaveProperty('totalErrors');
      expect(report.metrics).toHaveProperty('warningCount');
    });

    it('generates Portuguese report with correct locale', () => {
      const report = generateQCReport('pt');
      expect(report.locale).toBe('pt');
      expect(report.title).toBe('Relatório QC Solar');
    });

    it('generates report with filtered rows when options.filtered=true', () => {
      const report = generateQCReport('en', { filtered: true });
      expect(report.filteredRows).toBeGreaterThan(0);
      expect(report.totalRows).toBeGreaterThan(0);
    });

    it('metrics have correct type structure', () => {
      const report = generateQCReport('en');
      expect(typeof report.metrics.avgAnalysisTime).toBe('number');
      expect(typeof report.metrics.totalErrors).toBe('number');
      expect(typeof report.metrics.warningCount).toBe('number');
    });
  });

  describe('getQCSummary', () => {
    it('extracts summary from full report with 8+ asserts', () => {
      const summary = getQCSummary(sampleReport);
      expect(summary).toHaveProperty('title');
      expect(summary).toHaveProperty('totalRows');
      expect(summary).toHaveProperty('avgAnalysisTime');
      expect(summary).toHaveProperty('errorCount');
      expect(summary.title).toBe('Solar QC Report');
      expect(summary.totalRows).toBe(50);
      expect(summary.avgAnalysisTime).toBe(12.5);
      expect(summary.errorCount).toBe(3);
    });

    it('handles report with zero errors', () => {
      const noErrorsReport = {
        ...sampleReport,
        metrics: { ...sampleReport.metrics, totalErrors: 0 },
      } as QCReport;
      const summary = getQCSummary(noErrorsReport);
      expect(summary.errorCount).toBe(0);
    });
  });

  describe('exportQCReportBlob', () => {
    it('creates a valid Blob from report', () => {
      const blob = exportQCReportBlob(sampleReport);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('text/html');
    });

    it('blob text contains report title and row count', async () => {
      const blob = exportQCReportBlob(sampleReport);
      const text = await blob.text();
      expect(text).toContain('Solar QC Report');
      expect(text).toContain('50');
    });

    it('blob contains generated date string', async () => {
      const blob = exportQCReportBlob(sampleReport);
      const text = await blob.text();
      expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('getQCReportDataURI', () => {
    it('returns a blob URI string', () => {
      const uri = getQCReportDataURI(sampleReport);
      expect(typeof uri).toBe('string');
      expect(uri).toMatch(/^blob:/);
    });
  });
});
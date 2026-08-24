import { describe, it, expect } from 'vitest';
import {
  buildHeatmapSheetXml,
  buildHeatmapXlsx,
  heatmapXlsxFilename,
  buildMarkHeatmap,
  buildHeatmapCsv,
} from '../utils/markHeatmap';
import type { Dataset, OsRecord } from '../utils/dashboard';

// ---------- Fixtures ----------

const rec = (over: Partial<OsRecord>): OsRecord => ({
  rowIndex: 2,
  date: null,
  month: null,
  wo: '',
  event: '',
  studio: '',
  instructor: '',
  analyst: '',
  finalScore: null,
  marks: [],
  ...over,
});

const DATASET: Dataset = {
  records: [
    rec({
      rowIndex: 2,
      date: '2024-02-10',
      month: '2024-02',
      wo: 'WO-001',
      studio: 'Studio A',
      event: 'Intro, "part" 1',
      marks: ['audio-estourando', 'muito-pouco-teto'],
    }),
    rec({ rowIndex: 3, date: '2024-02-20', month: '2024-02', wo: 'WO-002', marks: ['audio-estourando'] }),
    rec({ rowIndex: 4, date: '2024-03-05', month: '2024-03', wo: 'WO-003', marks: ['audio-estourando'] }),
    // Undated row: its marking must never leak into any month column.
    rec({ rowIndex: 5, wo: 'WO-004', marks: ['muito-pouco-teto'] }),
  ],
};

const WHEN = new Date('2026-08-24T18:00:00Z');

describe('P16 heatmap XLSX — sheet XML', () => {
  it('mirrors the CSV header (rule + one ISO month column per bucket)', () => {
    const heatmap = buildMarkHeatmap(DATASET);
    const xml = buildHeatmapSheetXml(heatmap);
    const csvHeader = buildHeatmapCsv(heatmap).split('\r\n')[0];

    expect(xml).toContain('<row r="1">');
    expect(xml).toContain('>rule<');
    for (const month of heatmap.months) {
      expect(xml).toContain(`>${month}<`);
      expect(csvHeader).toContain(month); // same buckets on both exports
    }
    expect(csvHeader.startsWith('rule,')).toBe(true);
  });

  it('emits counts as numeric cells at the right spreadsheet refs', () => {
    const heatmap = buildMarkHeatmap(DATASET);
    const xml = buildHeatmapSheetXml(heatmap);
    // Row order: audio clipping (total 3) first, ceiling (total 1) second.
    expect(heatmap.rows.map((r) => r.ruleId)).toEqual(['audio-estourando', 'muito-pouco-teto']);
    expect(xml).toContain('<c r="A2" t="inlineStr">'); // rule name is a string cell
    expect(xml).toContain('<c r="B2"><v>2</v></c>'); // audio × 2024-02
    expect(xml).toContain('<c r="C2"><v>1</v></c>'); // audio × 2024-03
    expect(xml).toContain('<c r="B3"><v>1</v></c>'); // ceiling × 2024-02 only
    expect(xml).not.toContain('<c r="C3"><v>1</v></c>'); // undated leak guard
  });

  it('keeps hostile rule names as escaped inline strings', () => {
    const xmlHostile = buildHeatmapSheetXml({
      months: ['2024-02'],
      rows: [
        {
          ruleId: 'x',
          name: 'say "hi" & <bye>',
          categoryId: 'AUDIO',
          total: 1,
          cells: [1],
        },
      ],
    });
    expect(xmlHostile).toContain('say &quot;hi&quot; &amp; &lt;bye&gt;');
    expect(xmlHostile).not.toContain('<bye>');
    expect(xmlHostile).toContain('t="inlineStr"');
  });

  it('renders an empty matrix as a single-cell sheet without erroring', () => {
    const xml = buildHeatmapSheetXml({ months: [], rows: [] });
    expect(xml).toContain('<row r="1">');
    expect(xml).toContain('>rule<');
    expect(xml).not.toContain('<row r="2">');
  });

  it('survives wide horizons with bijective base-26 column refs (Z → AA → AB…)', () => {
    const months = Array.from({ length: 28 }, (_, i) => `2024-${String((i % 12) + 1).padStart(2, '0')}`);
    const xml = buildHeatmapSheetXml({
      months,
      rows: [{ ruleId: 'x', name: 'X', categoryId: '', total: 1, cells: months.map(() => 0) }],
    });
    expect(xml).toContain('<c r="AA1" t="inlineStr">'); // col 27 (26th month + rule offset)
    expect(xml).toContain('<c r="AB1" t="inlineStr">'); // col 28
    expect(xml).not.toContain('r="[object Object]'); // sanity: refs always well-formed
    expect(xml.match(/<c r="/g)?.length).toBe(29 * 2); // header + one data row
  });
});

describe('P16 heatmap XLSX — package & filenames', () => {
  it('packages the five OOXML parts deterministically with a Heatmap sheet', () => {
    const heatmap = buildMarkHeatmap(DATASET);
    const first = Buffer.from(buildHeatmapXlsx(heatmap, WHEN));
    const second = Buffer.from(buildHeatmapXlsx(heatmap, WHEN));
    expect(first.equals(second)).toBe(true);

    const text = first.toString('latin1');
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('_rels/.rels');
    expect(text).toContain('xl/workbook.xml');
    expect(text).toContain('xl/_rels/workbook.xml.rels');
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(first.toString('utf8')).toContain('<sheet name="Heatmap"');
    expect(first.toString('utf8')).toContain('Audio Clipping (Peaking)');
  });

  it('keeps the CSV/XLSX twin contract on filenames — extension is the only difference', () => {
    expect(heatmapXlsxFilename()).toBe('solaris-mark-heatmap.xlsx');
    expect(heatmapXlsxFilename({})).toBe('solaris-mark-heatmap.xlsx');
    expect(heatmapXlsxFilename({ from: 'garbage!!' })).toBe('solaris-mark-heatmap.xlsx');
    expect(heatmapXlsxFilename({ from: '2024-03' })).toBe(
      'solaris-mark-heatmap_2024-03_latest.xlsx',
    );
    expect(heatmapXlsxFilename({ to: '2024-12-31' })).toBe(
      'solaris-mark-heatmap_start_2024-12-31.xlsx',
    );
    expect(heatmapXlsxFilename({ from: '2024-03', to: '2024-04' })).toBe(
      'solaris-mark-heatmap_2024-03_2024-04.xlsx',
    );
  });
});

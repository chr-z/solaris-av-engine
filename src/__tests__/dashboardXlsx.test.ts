import { describe, it, expect } from 'vitest';
import {
  escapeXmlText,
  columnIndexToLetter,
  buildDashboardSheetXml,
  buildWorkbookXml,
  buildRootRelsXml,
  buildWorkbookRelsXml,
  buildContentTypesXml,
  crc32,
  dosDateTime,
  zipStoreEntries,
  buildDashboardXlsx,
  xlsxFilename,
  xlsxDrilldownFilename,
  xlsxMonthGroupFilename,
} from '../utils/dashboardXlsx';
import type { OsRecord } from '../utils/dashboard';

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
  ...over,
});

const RECORDS: OsRecord[] = [
  rec({ rowIndex: 2, date: '2024-02-28', month: '2024-02', wo: 'WO-001', studio: 'Studio A', analyst: 'Guest', finalScore: 5.0 }),
  rec({ rowIndex: 3, date: '2024-03-01', month: '2024-03', wo: 'WO-002', studio: 'Studio B', instructor: 'Jane Doe', event: 'Intro, part 1', finalScore: 4.33 }),
  rec({ rowIndex: 4, date: '2024-03-31', month: '2024-03', wo: 'WO-003' }),
];

const WHEN = new Date('2026-08-24T12:00:00Z');

describe('P12 dashboard XLSX — XML parts', () => {
  it('escapes XML specials and strips control characters', () => {
    expect(escapeXmlText('a<b>&"c"')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
    expect(escapeXmlText("it's")).toBe('it&#39;s');
    expect(escapeXmlText('bad\u0007char')).toBe('badchar');
    expect(escapeXmlText('')).toBe('');
    expect(escapeXmlText(undefined as unknown as string)).toBe('');
  });

  it('maps 0-based column indexes to letters and reuses the CSV column set', () => {
    expect(columnIndexToLetter(0)).toBe('A');
    expect(columnIndexToLetter(8)).toBe('I');
  });

  it('emits header row plus numeric score cells in sheet order', () => {
    const xml = buildDashboardSheetXml([RECORDS[2]]);
    expect(xml).toContain('<row r="1">');
    expect(xml).toContain('>final_score<');
    // Unscored record → no I-column cell (absence == blank), row still present.
    expect(xml).not.toContain('<c r="I2"');
    // But its month cell exists.
    expect(xml).toContain('>2024-03<');
    expect(xml).toContain('<row r="2">');
    const scored = buildDashboardSheetXml([RECORDS[1]]);
    expect(scored).toContain('<c r="I2"><v>4.33</v></c>');
  });

  it('quotes hostile text fields as inline strings without breaking the XML', () => {
    const hostile = rec({ rowIndex: 9, event: 'say "hi" & <bye>' });
    const xml = buildDashboardSheetXml([hostile]);
    expect(xml).toContain('&lt;bye&gt;');
    expect(xml).not.toContain('<bye>');
  });

  it('declares workbook, rels and content types consistently', () => {
    expect(buildWorkbookXml()).toContain('name="Scores"');
    expect(buildWorkbookXml()).toContain('r:id="rId1"');
    expect(buildRootRelsXml()).toContain('Target="xl/workbook.xml"');
    expect(buildWorkbookRelsXml()).toContain('Target="worksheets/sheet1.xml"');
    expect(buildContentTypesXml()).toContain('/xl/worksheets/sheet1.xml');
    expect(buildContentTypesXml()).toContain('sheet.main+xml');
  });
});

describe('P12 dashboard XLSX — ZIP layer', () => {
  it('computes CRC-32 per IEEE 802.3 (known vectors)', () => {
    const bytes = (s: string) => new TextEncoder().encode(s);
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('packs MS-DOS date/time from UTC with clamping', () => {
    const { time, date } = dosDateTime(new Date('2026-08-24T18:34:21Z'));
    expect(date).toBe(((2026 - 1980) << 9) | (8 << 5) | 24);
    expect(time).toBe((18 << 11) | (34 << 5) | 10);
    const preClamp = dosDateTime(new Date('1970-01-01T00:00:00Z'));
    expect(preClamp.date).toBe((1 << 5) | 1); // year floors to 1980
  });

  it('writes a structurally sound STORE-only archive', () => {
    const payload = new TextEncoder().encode('hello solaris');
    const bytes = zipStoreEntries([{ name: 'a.txt', data: payload }], WHEN);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Local file header signature + STORE method.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0); // method = store
    // Sizes match the payload; UTF-8 flag set.
    expect(view.getUint32(18, true)).toBe(payload.length);
    expect(view.getUint16(6, true) & 0x0800).not.toBe(0);

    // Walk to the central directory via the EOCD and verify its entry count.
    const eocd = bytes.byteLength - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    const entryCount = view.getUint16(eocd + 10, true);
    expect(entryCount).toBe(1);
    const cdOffset = view.getUint32(eocd + 16, true);
    expect(view.getUint32(cdOffset, true)).toBe(0x02014b50);
    expect(view.getUint32(cdOffset + 42, true)).toBe(0); // LFH at 0

    // Payload round-trips byte-for-byte after its 30-byte local header.
    const nameLen = view.getUint16(26, true);
    const slice = bytes.slice(30 + nameLen, 30 + nameLen + payload.length);
    expect(Buffer.from(slice).toString('utf8')).toBe('hello solaris');
  });
});

describe('P12 dashboard XLSX — package assembly', () => {
  it('assembles a deterministic .xlsx container with all five parts', () => {
    const first = Buffer.from(buildDashboardXlsx(RECORDS, WHEN));
    const second = Buffer.from(buildDashboardXlsx(RECORDS, WHEN));
    expect(first.equals(second)).toBe(true);

    const text = first.toString('latin1');
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('_rels/.rels');
    expect(text).toContain('xl/workbook.xml');
    expect(text).toContain('xl/_rels/workbook.xml.rels');
    expect(text).toContain('xl/worksheets/sheet1.xml');

    // Sheet payload survives inside the package (STORE = plain bytes).
    expect(first.toString('utf8')).toContain('Studio A');
    expect(text).toContain('PK'); // ZIP magic at offset 0
    expect(text.charCodeAt(0)).toBe(0x50);
    expect(text.charCodeAt(1)).toBe(0x4b);
  });

  it('builds deterministic filenames mirroring the P6 CSV convention', () => {
    expect(xlsxFilename()).toBe('solaris-dashboard.xlsx');
    expect(xlsxFilename({})).toBe('solaris-dashboard.xlsx');
    expect(xlsxFilename({ from: '2024-03' })).toBe('solaris-dashboard_2024-03_latest.xlsx');
    expect(xlsxFilename({ to: '2024-12-31' })).toBe('solaris-dashboard_start_2024-12-31.xlsx');
    expect(xlsxFilename({ from: '2024-03', to: '2024-04' })).toBe(
      'solaris-dashboard_2024-03_2024-04.xlsx',
    );
    expect(xlsxFilename({ from: 'garbage' })).toBe('solaris-dashboard.xlsx');
  });

  it('builds scoped drill-down filenames with slugs (P7/P10 parity)', () => {
    expect(xlsxDrilldownFilename({}, 'Estúdio Águia')).toBe('solaris-dashboard_estudio-aguia.xlsx');
    expect(xlsxDrilldownFilename({ from: '2024-03' }, 'Studio B!').endsWith('_studio-b.xlsx')).toBe(true);
    expect(xlsxMonthGroupFilename({}, '2024-03', 'Ana')).toBe(
      'solaris-dashboard_2024-03_ana.xlsx',
    );
    // Empty label degrades to the shared sentinel slug, never an empty name part.
    expect(xlsxDrilldownFilename({}, '')).toBe('solaris-dashboard_grupo.xlsx');
    // Extension swap only — the base name is untouched.
    expect(xlsxMonthGroupFilename({ to: '2024-12' }, '2024-02', 'X Y').startsWith('solaris-dashboard_start_2024-12_')).toBe(true);
  });
});

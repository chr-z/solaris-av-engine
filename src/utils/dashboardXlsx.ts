// Solaris v3 P12 — Dashboard XLSX export (real Excel spreadsheet, zero deps).
//
// Pure, framework-free helpers consumed by DashboardPanel. Mirrors the P6 CSV
// pipeline (same columns, same ordering, same period-filename convention) but
// emits an OOXML SpreadsheetML package: a ZIP container holding
//   • [Content_Types].xml
//   • _rels/.rels
//   • xl/workbook.xml
//   • xl/_rels/workbook.xml.rels
//   • xl/worksheets/sheet1.xml   (inline strings + numeric score cells)
//
// The ZIP writer below implements STORE (no compression) with UTF-8 names,
// which every spreadsheet tool accepts — deterministic bytes in, valid .xlsx
// out, fully unit-testable without DOM, Blob or fetch.

import type { OsRecord } from './dashboard';
import { normalizeBound, type PeriodRange } from './dashboardExport';

// ---------- XML helpers ----------

// Intentional control-char range: this regex EXISTS to strip illegal XML 1.0
// control characters from spreadsheet text before escaping.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** Escapes XML special characters and strips control chars illegal in XML 1.0. */
export function escapeXmlText(value: string): string {
  const clean = (value ?? '').replace(CONTROL_CHARS_RE, '');
  return clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Sheet XML ----------

/** Same columns/order as the P6 CSV export — one source of truth per row shape. */
export const XLSX_COLUMNS: Array<{ header: string; pick: (r: OsRecord) => string | null }> = [
  { header: 'row', pick: (r) => String(r.rowIndex) },
  { header: 'date', pick: (r) => r.date ?? '' },
  { header: 'month', pick: (r) => r.month ?? '' },
  { header: 'wo', pick: (r) => r.wo },
  { header: 'event', pick: (r) => r.event },
  { header: 'studio', pick: (r) => r.studio },
  { header: 'instructor', pick: (r) => r.instructor },
  { header: 'analyst', pick: (r) => r.analyst },
  { header: 'final_score', pick: (r) => (r.finalScore === null ? null : String(r.finalScore)) },
];

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** 'A'..'Z' column letter for a 0-based index (enough for our 9 columns). */
export function columnIndexToLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function cellXml(ref: string, value: string | null): string {
  // Numbers (row index / scores) become true numeric cells; everything else is
  // an inline string. Empty values emit no cell at all — absence == blank.
  if (value === null || value === '') return '';
  const numeric = value !== '' && !Number.isNaN(Number(value));
  if (numeric && /^-?\d+(\.\d+)?$/.test(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`;
}

/**
 * Builds the worksheet XML: header row plus one row per record, in input
 * (= sheet) order. Scores land as numbers so Excel can aggregate them.
 */
export function buildDashboardSheetXml(records: OsRecord[]): string {
  const rows: string[] = [];
  const headerCells = XLSX_COLUMNS.map((c, i) =>
    `<c r="${columnIndexToLetter(i)}1" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(c.header)}</t></is></c>`,
  ).join('');
  rows.push(`<row r="1">${headerCells}</row>`);

  records.forEach((rec, idx) => {
    const rowNumber = idx + 2;
    const cells = XLSX_COLUMNS.map((col, i) => {
      const ref = `${columnIndexToLetter(i)}${rowNumber}`;
      return cellXml(ref, col.pick(rec));
    })
      .filter(Boolean)
      .join('');
    rows.push(`<row r="${rowNumber}">${cells}</row>`);
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>${rows.join('')}</sheetData></worksheet>`
  );
}

/** workbook.xml declaring a single sheet (default 'Scores'). */
export function buildWorkbookXml(sheetName: string = 'Scores'): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${escapeXmlText(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
}

/** Root relationships: points Office at the workbook. */
export function buildRootRelsXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
  );
}

/** Workbook-level relationships: points the sheet at sheet1.xml. */
export function buildWorkbookRelsXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`
  );
}

/** Package content types covering rels + workbook + worksheet parts. */
export function buildContentTypesXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`
  );
}

// ---------- Minimal STORE-only ZIP writer ----------

const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (IEEE 802.3), the checksum ZIP central directories carry. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed time/date pair used by ZIP headers (UTC-in, clamped ≥1980). */
export function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(at.getUTCFullYear(), 1980);
  const month = Math.min(Math.max(at.getUTCMonth() + 1, 1), 12);
  const day = Math.min(Math.max(at.getUTCDate(), 1), 31);
  const hours = Math.min(Math.max(at.getUTCHours(), 0), 23);
  const minutes = Math.min(Math.max(at.getUTCMinutes(), 0), 59);
  const seconds = Math.min(Math.max(at.getUTCSeconds(), 0), 59);
  return {
    time: (hours << 11) | (minutes << 5) | (seconds >> 1),
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const encoder = new TextEncoder();

function writeU32(target: DataView, offset: number, value: number): void {
  target.setUint32(offset, value >>> 0, true);
}

function writeU16(target: DataView, offset: number, value: number): void {
  target.setUint16(offset, value & 0xffff, true);
}

const LFH_SIG = 0x04034b50;
const CDH_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;

/**
 * Serializes entries into an uncompressed ZIP archive (STORE, UTF-8 flag,
 * no extras/comments) — the smallest byte stream Excel/LibreOffice accept.
 */
export function zipStoreEntries(entries: ZipEntry[], at: Date): Uint8Array {
  const { time, date } = dosDateTime(at);
  const encoded = entries.map((e) => ({ name: encoder.encode(e.name), data: e.data }));

  let totalSize = 0;
  for (const e of encoded) {
    totalSize += 30 + e.name.length + e.data.length; // local header + payload
  }
  const directorySize = encoded.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const bufferSize = totalSize + directorySize + 22;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 0;
  const offsets: number[] = [];
  for (const e of encoded) {
    offsets.push(offset);
    writeU32(view, offset, LFH_SIG);
    writeU16(view, offset + 4, 20); // version needed
    writeU16(view, offset + 6, ZIP_UTF8_FLAG);
    writeU16(view, offset + 8, STORE_METHOD);
    writeU16(view, offset + 10, time);
    writeU16(view, offset + 12, date);
    writeU32(view, offset + 14, crc32(e.data));
    writeU32(view, offset + 18, e.data.length); // compressed
    writeU32(view, offset + 22, e.data.length); // uncompressed
    writeU16(view, offset + 26, e.name.length);
    writeU16(view, offset + 28, 0); // extra length
    bytes.set(e.name, offset + 30);
    bytes.set(e.data, offset + 30 + e.name.length);
    offset += 30 + e.name.length + e.data.length;
  }

  const directoryOffset = offset;
  for (let i = 0; i < encoded.length; i++) {
    const e = encoded[i];
    writeU32(view, offset, CDH_SIG);
    writeU16(view, offset + 4, 20); // version made by
    writeU16(view, offset + 6, 20); // version needed
    writeU16(view, offset + 8, ZIP_UTF8_FLAG);
    writeU16(view, offset + 10, STORE_METHOD);
    writeU16(view, offset + 12, time);
    writeU16(view, offset + 14, date);
    writeU32(view, offset + 16, crc32(e.data));
    writeU32(view, offset + 20, e.data.length);
    writeU32(view, offset + 24, e.data.length);
    writeU16(view, offset + 28, e.name.length);
    writeU16(view, offset + 30, 0); // extra
    writeU16(view, offset + 32, 0); // comment
    writeU16(view, offset + 34, 0); // disk start
    writeU16(view, offset + 36, 0); // internal attrs
    writeU32(view, offset + 38, 0); // external attrs
    writeU32(view, offset + 42, offsets[i]);
    bytes.set(e.name, offset + 46);
    offset += 46 + e.name.length;
  }

  writeU32(view, offset, EOCD_SIG);
  writeU16(view, offset + 4, 0); // this disk
  writeU16(view, offset + 6, 0); // dir disk
  writeU16(view, offset + 8, encoded.length);
  writeU16(view, offset + 10, encoded.length);
  writeU32(view, offset + 12, offset - directoryOffset);
  writeU32(view, offset + 16, directoryOffset);
  writeU16(view, offset + 20, 0); // comment length

  return bytes.slice(0, bufferSize);
}

// ---------- Package assembly ----------

/**
 * Builds the complete .xlsx package bytes for the given records.
 * Deterministic for equal (records, timestamp) inputs — tests rely on it.
 */
export function buildDashboardXlsx(records: OsRecord[], timestamp: Date = new Date()): Uint8Array {
  return zipStoreEntries(
    [
      { name: '[Content_Types].xml', data: encoder.encode(buildContentTypesXml()) },
      { name: '_rels/.rels', data: encoder.encode(buildRootRelsXml()) },
      { name: 'xl/workbook.xml', data: encoder.encode(buildWorkbookXml()) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(buildWorkbookRelsXml()) },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: encoder.encode(buildDashboardSheetXml(records)),
      },
    ],
    timestamp,
  );
}

/**
 * v3 P14 — generic single-sheet packager shared by every export twin
 * (dashboard scores today, ranking tomorrow). Same five OOXML parts and ZIP
 * conventions as `buildDashboardXlsx`; deterministic for equal inputs.
 */
export function buildSingleSheetXlsx(
  sheetName: string,
  sheetXml: string,
  timestamp: Date = new Date(),
): Uint8Array {
  return zipStoreEntries(
    [
      { name: '[Content_Types].xml', data: encoder.encode(buildContentTypesXml()) },
      { name: '_rels/.rels', data: encoder.encode(buildRootRelsXml()) },
      { name: 'xl/workbook.xml', data: encoder.encode(buildWorkbookXml(sheetName)) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(buildWorkbookRelsXml()) },
      { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml) },
    ],
    timestamp,
  );
}

/** Stable filename; carries the range when one is active (mirrors P6 CSV). */
export function xlsxFilename(range: PeriodRange = {}): string {
  const from = normalizeBound(range.from);
  const to = normalizeBound(range.to);
  if (!from && !to) return 'solaris-dashboard.xlsx';
  const span = `${from ?? 'start'}_${to ?? 'latest'}`;
  return `solaris-dashboard_${span}.xlsx`;
}

// ---------- Scoped filenames (drill-down parity with P7/P10 CSV names) ----------

/** Lowercase ASCII slug shared with the CSV drill-down naming. */
const slugifyLabel = (label: string): string => {
  const slug = (label ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'grupo';
};

/** Drill-down bucket name: 'solaris-dashboard_2024-03_estudio-aguia.xlsx'. */
export function xlsxDrilldownFilename(
  range: { from?: string | null; to?: string | null },
  label: string,
): string {
  return xlsxFilename(range).replace(/\.xlsx$/, `_${slugifyLabel(label)}.xlsx`);
}

/** Second-level leaf name: month slug + group slug before the extension. */
export function xlsxMonthGroupFilename(
  range: { from?: string | null; to?: string | null },
  month: string,
  label: string,
): string {
  return xlsxFilename(range).replace(
    /\.xlsx$/,
    `_${slugifyLabel(month)}_${slugifyLabel(label)}.xlsx`,
  );
}

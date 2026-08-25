// Solaris v3 — Feature Pack "Analista Feliz" — QoL A3.
// Testes do leitor zero-dep de .xlsx (ZIP STORE e DEFLATE + SpreadsheetML).
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  columnRefToIndex,
  crc32Bytes,
  readXlsxFirstSheetGrid,
  unzipEntries,
} from '../features/qol/queueImportXlsx';
import { zipStoreEntries } from '../utils/dashboardXlsx';

// ---------------------------------------------------------------------------
// Fixture builder: pacote OOXML mínimo (workbook + rels + folha)
// ---------------------------------------------------------------------------

const WORKBOOK_XML =
  '<?xml version="1.0"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="Fila" sheetId="1" r:id="rId1"/></sheets></workbook>';

const WORKBOOK_RELS_XML =
  '<?xml version="1.0"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '</Relationships>';

/** Folha com número, inlineStr, shared string e célula pulada (col B vazia). */
const SHARED_STRINGS_XML =
  '<?xml version="1.0"?>' +
  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<si><t>queued</t></si><si><t>Em Análise</t></si></sst>';

const SHEET_XML =
  '<?xml version="1.0"?>' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<sheetData>' +
  '<row r="1"><c r="A1" t="inlineStr"><is><t>os_id</t></is></c>' +
  '<c r="B1" t="inlineStr"><is><t>status</t></is></c>' +
  '<c r="C1" t="inlineStr"><is><t>prioridade</t></is></c></row>' +
  '<row r="2"><c r="A2" t="inlineStr"><is><t>OS-X1</t></is></c>' +
  '<c r="B2" t="s"><v>0</v></c><c r="C2"><v>2</v></c></row>' +
  // Célula A3 direto em D3 (buraco): colunas A-C ausentes nesta linha.
  '<row r="3"><c r="D3" t="inlineStr"><is><t>sobrou</t></is></c></row>' +
  '</sheetData></worksheet>';

function storePackage(): Uint8Array {
  return zipStoreEntries(
    [
      { name: '[Content_Types].xml', data: new TextEncoder().encode('<Types/>') },
      { name: 'xl/workbook.xml', data: new TextEncoder().encode(WORKBOOK_XML) },
      { name: 'xl/_rels/workbook.xml.rels', data: new TextEncoder().encode(WORKBOOK_RELS_XML) },
      { name: 'xl/sharedStrings.xml', data: new TextEncoder().encode(SHARED_STRINGS_XML) },
      { name: 'xl/worksheets/sheet1.xml', data: new TextEncoder().encode(SHEET_XML) },
    ],
    new Date(0),
  );
}

/** ZIP misto: workbook+rels em STORE e a folha em DEFLATE (stream nativa). */
function deflatePackage(): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Array<{ name: string; data: Uint8Array; method: number }> = [
    {
      name: 'xl/workbook.xml',
      data: encoder.encode(WORKBOOK_XML),
      method: 0,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: encoder.encode(WORKBOOK_RELS_XML),
      method: 0,
    },
    {
      name: 'xl/sharedStrings.xml',
      data: encoder.encode(SHARED_STRINGS_XML),
      method: 0,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: new Uint8Array(deflateRawSync(encoder.encode(SHEET_XML))),
      method: 8,
    },
  ];

  const encoded = parts.map((p) => ({
    ...p,
    nameBytes: encoder.encode(p.name),
  }));

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const p of encoded) {
    const lh = new ArrayBuffer(30 + p.nameBytes.length);
    const lv = new DataView(lh);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 flag
    lv.setUint16(8, p.method, true);
    lv.setUint32(14, crc32Bytes(p.data), true);
    lv.setUint32(18, p.data.length, true);
    lv.setUint32(22, p.data.length, true);
    lv.setUint16(26, p.nameBytes.length, true);
    new Uint8Array(lh).set(p.nameBytes, 30);

    const localPart = new Uint8Array(lh.byteLength + p.data.length);
    localPart.set(new Uint8Array(lh), 0);
    localPart.set(p.data, lh.byteLength);
    locals.push(localPart);

    const ch = new ArrayBuffer(46 + p.nameBytes.length);
    const cv = new DataView(ch);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, p.method, true);
    cv.setUint32(16, crc32Bytes(p.data), true);
    cv.setUint32(20, p.data.length, true);
    cv.setUint32(24, p.data.length, true);
    cv.setUint16(28, p.nameBytes.length, true);
    cv.setUint32(42, offset, true); // offset da entrada LOCAL
    new Uint8Array(ch).set(p.nameBytes, 46);
    centrals.push(new Uint8Array(ch));

    offset += localPart.length;
  }

  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, encoded.length, true);
  ev.setUint16(10, encoded.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // CD começa após todos os payloads locais

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const l of locals) {
    out.set(l, pos);
    pos += l.length;
  }
  for (const c of centrals) {
    out.set(c, pos);
    pos += c.length;
  }
  out.set(new Uint8Array(eocd), pos);
  return out;
}

describe('helpers de ZIP/XML', () => {
  it('crc32 bate com o valor clássico de "123456789"', () => {
    expect(crc32Bytes(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('columnRefToIndex: A=0, Z=25, AA=26', () => {
    expect(columnRefToIndex('A1')).toBe(0);
    expect(columnRefToIndex('Z9')).toBe(25);
    expect(columnRefToIndex('AA1')).toBe(26);
  });

  it('unzipEntries lê STORE e devolve todas as partes', async () => {
    const entries = await unzipEntries(storePackage());
    expect(entries.get('xl/workbook.xml')).toBeDefined();
    expect(entries.get('xl/worksheets/sheet1.xml')).toBeDefined();
  });
});

describe('readXlsxFirstSheetGrid', () => {
  it('lê pacote STORE: tipos mistos e buracos preservados', async () => {
    const grid = await readXlsxFirstSheetGrid(storePackage());
    expect(grid[0]).toEqual(['os_id', 'status', 'prioridade']);
    expect(grid[1]).toEqual(['OS-X1', 'queued', '2']);
    // Linha 3: colunas A-C vazias, D tem conteúdo.
    expect(grid[2]).toEqual(['', '', '', 'sobrou']);
  });

  it('lê pacote DEFLATE (DecompressionStream) com o mesmo resultado', async () => {
    const grid = await readXlsxFirstSheetGrid(deflatePackage());
    expect(grid[1]).toEqual(['OS-X1', 'queued', '2']);
  });

  it('integração: grade da planilha alimenta o parser da fila', async () => {
    const { parseQueueImport } = await import('../features/qol/queueImport');
    const grid = await readXlsxFirstSheetGrid(storePackage());
    const res = parseQueueImport(grid, { nowMs: Date.UTC(2026, 7, 25) });
    // Linha 3 do fixture só tem conteúdo FORA das colunas do cabeçalho
    // ('sobrou' na coluna D) → tratada como ruído de planilha, sem erro.
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ os_id: 'OS-X1', status: 'queued', priority: 2 });
  });

  it('arquivo corrupto lança erro claro (UI converte em aviso)', async () => {
    await expect(readXlsxFirstSheetGrid(new Uint8Array([1, 2, 3]))).rejects.toThrow(/xlsx/);
  });

  it('worksheet sem sheetData não crasha: vira linha única vazia', async () => {
    const emptySheet =
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>';
    const grid = await readXlsxFirstSheetGrid(
      zipStoreEntries(
        [
          { name: 'xl/workbook.xml', data: new TextEncoder().encode(WORKBOOK_XML) },
          { name: 'xl/_rels/workbook.xml.rels', data: new TextEncoder().encode(WORKBOOK_RELS_XML) },
          { name: 'xl/worksheets/sheet1.xml', data: new TextEncoder().encode(emptySheet) },
        ],
        new Date(0),
      ),
    );
    expect(grid).toEqual([[]]);
  });

  it('Target absoluto (/xl/...) do rels é resolvido', async () => {
    const relsAbs =
      '<?xml version="1.0"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>';
    const grid = await readXlsxFirstSheetGrid(
      zipStoreEntries(
        [
          { name: 'xl/workbook.xml', data: new TextEncoder().encode(WORKBOOK_XML) },
          { name: 'xl/_rels/workbook.xml.rels', data: new TextEncoder().encode(relsAbs) },
          { name: 'xl/worksheets/sheet1.xml', data: new TextEncoder().encode(SHEET_XML) },
        ],
        new Date(0),
      ),
    );
    expect(grid[1][0]).toBe('OS-X1');
  });
});

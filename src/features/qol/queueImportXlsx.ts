// Solaris v3 — Feature Pack "Analista Feliz" — QoL A3 (anti-fricção administrativa).
//
// Leitor de .xlsx ZERO-dependência para a importação em lote da fila
// (spec A3.1). Espelho do writer OOXML do dashboardXlsx.ts: entende o
// pacote SpreadsheetML mínimo que Excel/LibreOffice/Google Sheets exportam:
//   • container ZIP (STORE 0 e DEFLATE 8) via EOCD → central directory;
//   • xl/workbook.xml → primeira aba (nome + r:id);
//   • xl/_rels/workbook.xml.rels → alvo real da planilha (Target relativo);
//   • folha com células numéricas, inlineStr, shared strings (t="s") e fórmulas.
//
// Offline-first: nada de CDN nem dependência nova — DecompressionStream é
// API nativa de browser/Node ≥18. Falhas estruturais LANÇAM com mensagem
// clara (a UI converte em aviso honesto pro admin), porque arquivo corrupto
// não tem "linha 3 inválida" — tem leitura impossível.
//
// Puro: sem DOM além das streams nativas; grade de saída alimenta
// parseQueueImport (queueImport.ts), que faz toda a validação.

// ---------------------------------------------------------------------------
// CRC32 (só p/ validar entradas quando o verificador quiser; leitura não exige)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32Bytes(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// ZIP: central directory → entradas (STORE nativo, DEFLATE via stream nativa)
// ---------------------------------------------------------------------------

const U16 = (v: DataView, off: number): number => v.getUint16(off, true);
const U32 = (v: DataView, off: number): number => v.getUint32(off, true);

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('xlsx: ambiente sem DecompressionStream (necessário p/ .xlsx comprimido)');
  }
  // ReadableStream puro (sem Blob: o Blob do jsdom não tem .stream()).
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  }).pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Lê todas as entradas do arquivo (nomes UTF-8; métodos 0 e 8). */
export async function unzipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  if (bytes.length < 22 || U32(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0) !== LFH_SIG) {
    // Assinatura inicial não é obrigatória em zips válidos com prefixo
    // (autoexec etc.), mas os geradores reais de xlsx sempre começam com ela;
    // recusar cedo dá erro mais claro que um scan falho lá na frente.
    throw new Error('xlsx: arquivo não parece um .xlsx (assinatura ZIP ausente)');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD: varre do fim (comentário pode ter até 64KiB).
  let eocd = -1;
  for (let off = bytes.length - 22; off >= Math.max(0, bytes.length - 22 - 65535); off--) {
    if (U32(view, off) === EOCD_SIG) {
      eocd = off;
      break;
    }
  }
  if (eocd < 0) throw new Error('xlsx: estrutura ZIP incompleta (EOCD ausente)');

  const count = U16(view, eocd + 10);
  let ptr = U32(view, eocd + 16);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i++) {
    if (ptr + 46 > bytes.length || U32(view, ptr) !== CDH_SIG) {
      throw new Error('xlsx: diretório central corrompido');
    }
    const method = U16(view, ptr + 10);
    const compSize = U32(view, ptr + 20);
    const nameLen = U16(view, ptr + 28);
    const extraLen = U16(view, ptr + 30);
    const commentLen = U16(view, ptr + 32);
    const lfhOff = U32(view, ptr + 42);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    // Local header: tamanhos podem diferirem do central (bit 3/data descriptor).
    if (lfhOff + 30 > bytes.length || U32(view, lfhOff) !== LFH_SIG) {
      throw new Error(`xlsx: entrada '${name}' com header local inválido`);
    }
    const lfhNameLen = U16(view, lfhOff + 26);
    const lfhExtraLen = U16(view, lfhOff + 28);
    const dataStart = lfhOff + 30 + lfhNameLen + lfhExtraLen;
    if (dataStart + compSize > bytes.length) {
      throw new Error(`xlsx: entrada '${name}' truncada`);
    }
    const payload = bytes.subarray(dataStart, dataStart + compSize);
    entries.set(name, method === 0 ? payload.slice() : await inflateRaw(payload));

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// XML: helpers mínimos (entidades + refs de célula)
// ---------------------------------------------------------------------------

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Converte ref de célula ('A1', 'AB7') ao índice 0-based da coluna. */
export function columnRefToIndex(ref: string): number {
  let idx = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    idx = idx * 26 + (ch.charCodeAt(0) - 64);
  }
  return idx - 1;
}

/** Texto visível de todos os <t> concatenados dentro de um snippet XML. */
function inlineText(xml: string): string {
  const parts: string[] = [];
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) parts.push(decodeXmlEntities(m[1]));
  return parts.join('');
}

/** Valor bruto do primeiro <v>…</v> (números, refs de shared string, fórmulas). */
function firstVValue(xml: string): string {
  const m = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(xml);
  return m ? decodeXmlEntities(m[1]) : '';
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/**
 * Grade de strings da PRIMEIRA aba do workbook. Células vazias viram ''
 * para manter as posições — o mesmo formato que parseCsv produz.
 */
export async function readXlsxFirstSheetGrid(bytes: Uint8Array): Promise<string[][]> {
  const entries = await unzipEntries(bytes);

  const workbookXml = decode(entries.get('xl/workbook.xml'), 'xl/workbook.xml');
  const sheetMatch = /<sheet\b[^>]*\/?>/.exec(workbookXml);
  if (!sheetMatch) throw new Error('xlsx: workbook sem abas');
  const rid = /\br:id="([^"]+)"/.exec(sheetMatch[0]);

  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (rid) {
    const relsXml = decode(entries.get('xl/_rels/workbook.xml.rels'), 'xl/_rels/workbook.xml.rels');
    const relRe = new RegExp(`<Relationship\\b[^>]*\\bId="${rid[1]}"[^>]*/?>`, 'i');
    const rel = relRe.exec(relsXml);
    const target = rel ? /\bTarget="([^"]+)"/.exec(rel[0])?.[1] : undefined;
    if (target) {
      sheetPath = target.startsWith('/')
        ? target.slice(1)
        : target.startsWith('xl/')
          ? target
          : `xl/${target}`;
    }
  }

  const sheetXml = decode(entries.get(sheetPath), sheetPath);

  // Shared strings são OPCIONAIS (Excel moderno usa inlineStr com frequência).
  const sstXml = entries.get('xl/sharedStrings.xml');
  const sharedStrings: string[] = [];
  if (sstXml) {
    const text = new TextDecoder().decode(sstXml);
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) sharedStrings.push(inlineText(m[1]));
  }

  const grid: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(sheetXml)) !== null) {
    const body = rm[1] ?? '';
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(body)) !== null) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const colIdx = ref ? columnRefToIndex(ref) : cells.length;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let value: string;
      if (type === 'inlineStr') value = inlineText(inner);
      else if (type === 's') {
        const idx = Number(firstVValue(inner));
        value = Number.isInteger(idx) && idx >= 0 && idx < sharedStrings.length
          ? sharedStrings[idx]
          : '';
      } else value = firstVValue(inner);
      const clean = value.replace(CONTROL_CHARS_RE, '');
      while (cells.length < colIdx) cells.push('');
      cells[colIdx] = clean;
    }
    grid.push(cells);
  }
  // Planilha vazia (só dimensão): devolve uma linha única vazia — o
  // parseQueueImport reporta 'no-os-column' em vez do leitor lançar.
  return grid.length > 0 ? grid : [[]];
}

function decode(entryData: Uint8Array | undefined, label: string): string {
  if (!entryData) throw new Error(`xlsx: parte obrigatória ausente (${label})`);
  return new TextDecoder().decode(entryData);
}

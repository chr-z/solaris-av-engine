// Solaris v3 — Feature Pack "Analista Feliz" — QoL A3 (anti-fricção administrativa).
//
// Importação em lote da fila de OSs (spec A3.1): o admin arrasta um CSV/XLSX
// com dezenas de OSs em vez de cadastrar uma por uma. Este módulo é o NÚCLEO
// PURO: parser CSV RFC 4180, mapeamento tolerante de cabeçalhos (EN/PT, como
// o resto do app), normalização de status/prioridade e validação honesta —
// linha inválida é RELATADA, nunca corrigida em silêncio.
//
// Regras:
//  - sem coluna os_id mapeável → erro único e zero linhas (nada adivinhado);
//  - duplicata dentro do arquivo OU contra a fila existente → linha pulada;
//  - status/prioridade inválidos explícitos → linha pulada (typo não vira P2);
//  - ausência de prioridade → default 2 (mesmo CHECK da migration 0002);
//  - created_at injetável (determinismo de teste); ausente = agora UTC ISO.
//
// O undo da importação é SNAPSHOT (as linhas são NOVAS — não há estado
// anterior a restaurar): um evento único carrega as linhas adicionadas e o
// applier as remove. Mesmo espírito dos kinds existentes do undo.ts.
//
// Exportação: CSV da fila na MESMA forma que o importador lê (ida-e-volta
// sem surpresa), reutilizando escapeCsvField do pipeline P6.
//
// Puro: sem DOM, sem storage, sem Firebase.

import type { QueueRowLike } from './queue';
import type { UndoableActionKind } from './undo';

// ---------------------------------------------------------------------------
// CSV (RFC 4180: vírgula, aspas dobradas, CRLF; tolerante a LF e BOM)
// ---------------------------------------------------------------------------

/** Parseia texto CSV em grade de strings. Linha vazia ao final é descartada. */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Mapeamento tolerante de cabeçalhos (mesmo espírito de dashboard.ts)
// ---------------------------------------------------------------------------

const normalizeHeader = (h: string): string =>
  (h ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();

export const QUEUE_COLUMN_ALIASES: Record<string, string[]> = {
  os_id: ['OS_ID', 'OSID', 'OS', 'O.S.', 'WO', 'ORDEM DE SERVICO', 'ORDEM DE SERVIÇO'],
  title: ['TITLE', 'TITULO', 'TÍTULO'],
  status: ['STATUS', 'SITUACAO', 'SITUAÇÃO'],
  assignee: ['ASSIGNEE', 'ANALISTA', 'RESPONSAVEL', 'RESPONSÁVEL'],
  claimed_by: ['CLAIMED_BY', 'CLAIMEDBY'],
  priority: ['PRIORITY', 'PRIORIDADE'],
  deadline: ['DEADLINE', 'PRAZO'],
  created_at: ['CREATED_AT', 'CRIADO_EM', 'DATA'],
};

/** Resolve cada coluna lógica ao índice na grade (-1 = ausente). */
export function resolveQueueColumns(headerRow: readonly string[]): Record<string, number> {
  const normalized = headerRow.map(normalizeHeader);
  const resolved: Record<string, number> = {};
  for (const [logical, aliases] of Object.entries(QUEUE_COLUMN_ALIASES)) {
    resolved[logical] = -1;
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx !== -1) {
        resolved[logical] = idx;
        break;
      }
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Normalização de valores (tolerante, mas honesta)
// ---------------------------------------------------------------------------

const STATUS_ALIASES: Array<[QueueRowLike['status'], string[]]> = [
  ['queued', ['QUEUED', 'FILA', 'NA FILA', 'PENDENTE', 'NOVA']],
  ['in_analysis', ['IN_ANALYSIS', 'IN ANALYSIS', 'EM ANALISE', 'EM ANÁLISE', 'ANALISANDO']],
  ['done', ['DONE', 'CONCLUIDO', 'CONCLUÍDO', 'CONCLUIDA', 'CONCLUÍDA', 'FECHADO']],
  ['returned', ['RETURNED', 'DEVOLVIDO', 'DEVOLVIDA']],
];

/** Status aceito pela migration 0002 ou null quando inválido explícito. */
export function normalizeQueueStatus(raw: string): QueueRowLike['status'] | null {
  const key = normalizeHeader(raw).replace(/\s+/g, ' ');
  if (!key) return null;
  for (const [status, aliases] of STATUS_ALIASES) {
    if (aliases.includes(key)) return status;
  }
  return null;
}

/** Prioridade aceita pela migration 0002 (1..3) ou null quando inválida. */
export function normalizeQueuePriority(raw: string): 1 | 2 | 3 | null {
  const key = normalizeHeader(raw);
  if (!key) return null;
  if (/^P?[123]$/.test(key)) return (Number(key.replace('P', '')) as 1 | 2 | 3);
  if (key.startsWith('ALTA')) return 1;
  if (key.startsWith('MEDIA') || key.startsWith('MÉDIA') || key.startsWith('NORMAL')) return 2;
  if (key.startsWith('BAIXA')) return 3;
  return null;
}

// ---------------------------------------------------------------------------
// Plano de importação
// ---------------------------------------------------------------------------

export type QueueImportErrorReason =
  | 'no-os-column'
  | 'missing-os'
  | 'duplicate'
  | 'bad-status'
  | 'bad-priority';

export interface QueueImportError {
  /** 1-based incluindo o cabeçalho (linha 1 = header). */
  line: number;
  osId: string | null;
  reason: QueueImportErrorReason;
}

export interface QueueImportResult {
  /** Cabeçalho detectado (após BOM/trim). */
  headers: string[];
  /** Colunas lógicas resolvidas (-1 = ausente). */
  mapped: Record<string, number>;
  /** Linhas novas prontas pra entrar na fila (ordem do arquivo). */
  rows: QueueRowLike[];
  errors: QueueImportError[];
}

export interface QueueImportOptions {
  /** Ids já presentes na fila viva — duplicatas contra eles são puladas. */
  existingIds?: ReadonlySet<string>;
  /** Epoch ms base p/ created_at (determinismo de teste). */
  nowMs?: number;
}

/**
 * Valida a grade inteira e produz as linhas novas. Nunca lança: problemas
 * viram erros estruturados que a UI lista pro admin decidir.
 */
export function parseQueueImport(
  grid: readonly (readonly string[])[],
  opts: QueueImportOptions = {},
): QueueImportResult {
  const headers = grid.length > 0 ? grid[0].map((h) => String(h ?? '')) : [];
  const mapped = resolveQueueColumns(headers);
  const rows: QueueRowLike[] = [];
  const errors: QueueImportError[] = [];

  if (mapped.os_id < 0) {
    return { headers, mapped, rows, errors: [{ line: 1, osId: null, reason: 'no-os-column' }] };
  }

  const nowIso = new Date(opts.nowMs ?? Date.now()).toISOString();
  const seen = new Set<string>();

  for (let line = 2; line <= grid.length; line++) {
    const rawCells = grid[line - 1].map((c) => String(c ?? '').trim());
    // Linha mais curta que o cabeçalho (comum em planilhas): células
    // ausentes viram '' para o mapeamento por índice nunca ler undefined.
    const cells: string[] = headers.map((_, i) => rawCells[i] ?? '');
    // Linha totalmente vazia no meio do arquivo é ignorada (ruído de planilha).
    if (cells.every((c) => c === '')) continue;

    const osId = (cells[mapped.os_id] ?? '').trim();
    if (!osId) {
      errors.push({ line, osId: null, reason: 'missing-os' });
      continue;
    }
    if (seen.has(osId) || opts.existingIds?.has(osId)) {
      errors.push({ line, osId, reason: 'duplicate' });
      continue;
    }

    const statusRaw = mapped.status >= 0 ? cells[mapped.status] : '';
    let status: QueueRowLike['status'] = 'queued';
    if (statusRaw.trim() !== '') {
      const parsed = normalizeQueueStatus(statusRaw);
      if (parsed === null) {
        errors.push({ line, osId, reason: 'bad-status' });
        continue;
      }
      status = parsed;
    }

    const prioRaw = mapped.priority >= 0 ? cells[mapped.priority] : '';
    let priority: 1 | 2 | 3 = 2;
    if (prioRaw.trim() !== '') {
      const parsed = normalizeQueuePriority(prioRaw);
      if (parsed === null) {
        errors.push({ line, osId, reason: 'bad-priority' });
        continue;
      }
      priority = parsed;
    }

    seen.add(osId);
    const claimedBy = mapped.claimed_by >= 0 ? cells[mapped.claimed_by] || null : null;
    const assignee = mapped.assignee >= 0 ? cells[mapped.assignee] || null : null;
    rows.push({
      os_id: osId,
      title: mapped.title >= 0 ? cells[mapped.title] || null : null,
      status,
      assignee,
      claimed_by: claimedBy,
      priority,
      deadline: mapped.deadline >= 0 ? cells[mapped.deadline] || null : null,
      created_at: mapped.created_at >= 0 ? cells[mapped.created_at] || nowIso : nowIso,
    });
  }

  return { headers, mapped, rows, errors };
}

// ---------------------------------------------------------------------------
// Undo por snapshot (linhas NOVAS não têm estado anterior a restaurar)
// ---------------------------------------------------------------------------

/** Novo kind: desfazer importação = remover as linhas adicionadas. */
export type ImportQueueActionKind = Extract<UndoableActionKind, 'import-queue'>;

export interface QueueImportEventPayload {
  /** Cópia profunda das linhas adicionadas (base da remoção no undo). */
  rows: QueueRowLike[];
}

/**
 * Inverso da importação: remove EXATAMENTE os ids adicionados (e nada mais),
 * preservando a ordem das linhas restantes. Id já ausente é tolerado —
 * outra ação pode ter removido antes do undo chegar.
 */
export function applyImportInverse(
  rows: readonly QueueRowLike[],
  payload: QueueImportEventPayload,
): { rows: QueueRowLike[]; changed: boolean } {
  const removedIds = new Set(payload.rows.map((r) => r.os_id));
  const next = rows.filter((r) => !removedIds.has(r.os_id));
  return { rows: next, changed: next.length !== rows.length };
}

// ---------------------------------------------------------------------------
// Exportação CSV (mesma forma que o importador lê — ida-e-volta limpa)
// ---------------------------------------------------------------------------

const EXPORT_COLUMNS: Array<{ header: string; pick: (r: QueueRowLike) => string }> = [
  { header: 'os_id', pick: (r) => r.os_id },
  { header: 'title', pick: (r) => r.title ?? '' },
  { header: 'status', pick: (r) => r.status },
  { header: 'assignee', pick: (r) => r.assignee ?? '' },
  { header: 'claimed_by', pick: (r) => r.claimed_by ?? '' },
  { header: 'priority', pick: (r) => String(r.priority) },
  { header: 'deadline', pick: (r) => r.deadline ?? '' },
  { header: 'created_at', pick: (r) => r.created_at },
];

/** CSV completo da fila (header + uma linha por OS), ordem da entrada. */
export function buildQueueCsv(rows: readonly QueueRowLike[]): string {
  const esc = (v: string): string => {
    if (/[",\r\n]/.test(v) || /^\s|\s$/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines: string[] = [EXPORT_COLUMNS.map((c) => esc(c.header)).join(',')];
  for (const row of rows) {
    lines.push(EXPORT_COLUMNS.map((c) => esc(c.pick(row))).join(','));
  }
  return lines.join('\r\n');
}

/** Nome de arquivo estável com o dia local UTC da exportação. */
export function queueExportFilename(ext: 'csv' | 'xlsx', nowMs: number = Date.now()): string {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return `solaris-fila-${day}.${ext}`;
}

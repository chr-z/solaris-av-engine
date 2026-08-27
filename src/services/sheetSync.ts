// Solaris v3 — SheetConnector (client-side)
//
// Talks to the same serverless API the Gran MVP uses today:
//   GET  /api/sheet-row?rowIndex=N   → full row (service account, readonly)
//   POST /api/sheet-row              → row update (user OAuth access token)
// The v3 additions: dynamic header mapping (no fixed column positions),
// idempotent resilient writes (idempotency key + retry with capped backoff)
// and a local audit trail for every write.

import { formatScorePtBr } from '../engine/scoring';

// ---------- Types ----------

export interface CellData {
  value: string;
  link?: string;
}

export type RowData = CellData[];

export interface SheetQueueEntry {
  rowIndex: number; // 1-based sheet row (headers live on row 1; data starts at 2)
  cells: RowData;
}

export interface SheetFetchOptions {
  /** API base URL (default '' = same origin, matching the MVP deployment). */
  apiBase?: string;
  fetchFn?: typeof fetch;
}

export interface SheetUpdateOptions extends SheetFetchOptions {
  /** Google OAuth access token with spreadsheets scope (user-authorized write). */
  accessToken?: string;
  /** Max attempts for transient failures (default 3). */
  maxAttempts?: number;
  /** Base delay in ms for the retry backoff (default 300). */
  backoffMs?: number;
  /** Persist each attempt to this audit sink (localStorage by default when omitted?). */
  auditSink?: AuditSink | null;
}

export class SheetAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetAuthError';
  }
}

export class SheetApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SheetApiError';
    this.status = status;
  }
}

// ---------- Header mapping ----------

export interface SheetHeaderMap {
  /** header name (normalized) → column index inside the fetched range */
  byName: Map<string, number>;
  rawHeaders: string[];
}

const normalizeHeader = (h: string): string =>
  h.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Builds a name→index map from the current sheet headers. Dynamic by design:
 * the Gran reorganizes columns and the connector keeps working.
 */
export function buildHeaderMap(headers: string[]): SheetHeaderMap {
  const byName = new Map<string, number>();
  headers.forEach((raw, idx) => {
    const key = normalizeHeader(raw ?? '');
    if (!key) return;
    if (!byName.has(key)) byName.set(key, idx); // first occurrence wins
  });
  return { byName, rawHeaders: headers };
}

/** Resolves a column index by any of the aliases (all normalized). */
export function columnIndex(map: SheetHeaderMap, ...aliases: string[]): number {
  for (const alias of aliases) {
    const idx = map.byName.get(normalizeHeader(alias));
    if (idx !== undefined) return idx;
  }
  return -1;
}

// ---------- Queue reading (service-account-backed API) ----------

/**
 * Fetches a single O.S. row with resolved hyperlinks (FORMULA render option is
 * handled server-side, same as MVP's fetchFullRowData).
 */
export async function fetchRow(rowIndex: number, options: SheetFetchOptions = {}): Promise<RowData> {
  if (!Number.isInteger(rowIndex) || rowIndex < 2) {
    throw new Error(`rowIndex inválido: ${String(rowIndex)} (dados começam na linha 2)`);
  }
  const doFetch = options.fetchFn ?? fetch;
  const base = options.apiBase ?? '';
  const res = await doFetch(`${base}/api/sheet-row?rowIndex=${rowIndex}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Falha ao buscar dados da linha.' }));
    throw new SheetApiError(err.error || 'Erro desconhecido do servidor.', res.status);
  }
  return (await res.json()) as RowData;
}

export interface QueueFilters {
  /** Header whose value must equal `equals` (case-insensitive trim), e.g. status columns. */
  pendingWhen?: { header: string; equals: string };
}

/**
 * Fetches the analysis queue: page rows sequentially via /api/sheet-row until an
 * empty row ends the data region. Returns entries plus the header map built from
 * row 1 of each response context.
 *
 * Note: the MVP lists rows from its own index endpoint and then hydrates each one;
 * v3 keeps the hydration contract identical but discovers rows lazily so no extra
 * privileged endpoint is required.
 */
export async function fetchQueue(
  options: SheetFetchOptions & QueueFilters & { startRow?: number; maxRows?: number } = {},
): Promise<{ entries: SheetQueueEntry[]; headerMap: SheetHeaderMap }> {
  const doFetch = options.fetchFn ?? fetch;
  const base = options.apiBase ?? '';
  const startRow = options.startRow ?? 2;
  const maxRows = options.maxRows ?? 500;

  // Row 1 carries the headers — reuse the same public endpoint.
  const headerRes = await doFetch(`${base}/api/sheet-headers`);
  let headers: string[];
  if (headerRes.ok) {
    const body = (await headerRes.json()) as { headers?: string[] };
    headers = body.headers ?? [];
  } else {
    // Fallback: derive headers from the first data row shape (degraded mapping).
    headers = [];
  }

  const entries: SheetQueueEntry[] = [];
  for (let r = startRow; r < startRow + maxRows; r++) {
    let row: RowData;
    try {
      row = await fetchRow(r, { ...options });
    } catch (err) {
      if (err instanceof SheetApiError && err.status === 400) break; // past the end
      throw err;
    }
    if (!row || row.length === 0 || row.every((c) => !c || !c.value)) {
      break; // first fully empty row terminates the queue region
    }
    entries.push({ rowIndex: r, cells: row });
  }

  return { entries, headerMap: buildHeaderMap(headers) };
}

// ---------- Writes (OAuth user token) + resilience ----------

export interface WriteAuditEntry {
  ts: string;
  rowIndex: number;
  attempt: number;
  ok: boolean;
  idempotencyKey: string;
  updatedRange?: string;
  error?: string;
}

export interface AuditSink {
  append(entry: WriteAuditEntry): void;
  list(): WriteAuditEntry[];
}

export function createLocalAuditSink(storage: Storage = localStorage): AuditSink {
  const KEY = 'solaris.v3.sheet-audit';
  return {
    append(entry) {
      try {
        const cur = JSON.parse(storage.getItem(KEY) ?? '[]') as WriteAuditEntry[];
        cur.push(entry);
        storage.setItem(KEY, JSON.stringify(cur.slice(-500)));
      } catch {
        /* audit must never break writes */
      }
    },
    list() {
      try {
        return JSON.parse(storage.getItem(KEY) ?? '[]') as WriteAuditEntry[];
      } catch {
        return [];
      }
    },
  };
}

/** Stable idempotency key: row + payload digest → retries never double-write. */
function makeIdempotencyKey(rowIndex: number, rowData: RowData): string {
  const payload = JSON.stringify(rowData.map((c) => [c?.value ?? '', c?.link ?? '']));
  let h1 = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h1 ^= payload.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  const digest = (h1 >>> 0).toString(16).padStart(8, '0');
  return `os-r${rowIndex}-${digest}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Updates the O.S. row. Idempotent by construction: the payload is a full-row
 * values.update, so replaying after a timeout converges to the same state.
 * Retries only transient errors (network/5xx/429); auth failures abort fast.
 * Every attempt lands in the audit log with its idempotency key.
 */
export async function updateSheetRow(
  rowIndex: number,
  rowData: RowData,
  options: SheetUpdateOptions = {},
): Promise<{ success: boolean; updatedRange?: string; attempts: number; idempotencyKey: string }> {
  if (!Number.isInteger(rowIndex) || rowIndex < 2) {
    throw new Error(`rowIndex inválido: ${String(rowIndex)} (dados começam na linha 2)`);
  }
  if (!options.accessToken) {
    throw new SheetAuthError('Usuário não autenticado ou sessão expirada. Por favor, conecte-se novamente.');
  }

  const doFetch = options.fetchFn ?? fetch;
  const base = options.apiBase ?? '';
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const backoffMs = options.backoffMs ?? 300;
  const audit =
    options.auditSink === null ? null : options.auditSink ?? createLocalAuditSink();
  const idempotencyKey = makeIdempotencyKey(rowIndex, rowData);

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await doFetch(`${base}/api/sheet-row`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.accessToken}`,
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ rowIndex, rowData }),
      });

      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { updatedRange?: string };
        audit?.append({
          ts: new Date().toISOString(),
          rowIndex,
          attempt,
          ok: true,
          idempotencyKey,
          updatedRange: body.updatedRange,
        });
        return { success: true, updatedRange: body.updatedRange, attempts: attempt, idempotencyKey };
      }

      // Non-retryable: bad request or auth/permission problem → surface immediately.
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const err = await res.json().catch(() => ({ error: 'Falha ao salvar os dados.' }));
        const message: string = err.error || 'Erro desconhecido do servidor.';
        audit?.append({ ts: new Date().toISOString(), rowIndex, attempt, ok: false, idempotencyKey, error: message });
        if (res.status !== 400) throw new SheetAuthError(message);
        throw new SheetApiError(message, 400);
      }

      lastError = new SheetApiError(
        `Erro transitório do servidor (HTTP ${res.status}).`,
        res.status,
      );
    } catch (err) {
      if (err instanceof SheetAuthError || err instanceof SheetApiError) {
        if (err instanceof SheetAuthError) throw err;
        if (err instanceof SheetApiError && err.status === 400) throw err;
        lastError = err;
      } else {
        lastError = err instanceof Error ? err : new Error(String(err)); // network failure
      }
    }

    if (attempt < maxAttempts) await sleep(backoffMs * attempt);
  }

  audit?.append({
    ts: new Date().toISOString(),
    rowIndex,
    attempt: maxAttempts,
    ok: false,
    idempotencyKey,
    error: lastError?.message ?? 'unknown',
  });
  throw lastError ?? new Error('Falha ao salvar os dados após múltiplas tentativas.');
}

// ---------- Score writing helper (bridges ScoringEngine → sheet) ----------

export interface OsScoreForSheet {
  finalScore: number;
  categories: Array<{ categoryId: string; finalScore: number }>;
}

/**
 * Builds cell updates for the calculated score fields, resolving column positions
 * through the CURRENT headers (dynamic mapping — MVP used fixed indexOf calls).
 * Values use PT-BR decimal comma exactly like the MVP wrote them.
 */
export function buildScoreCellUpdates(
  headerMap: SheetHeaderMap,
  score: OsScoreForSheet,
): Array<{ colIndex: number; value: string }> {
  const updates: Array<{ colIndex: number; value: string }> = [];
  const cols = [
    ...score.categories.map((c) => ({ header: c.categoryId, value: c.finalScore })),
    { header: 'FINAL', value: score.finalScore },
  ];
  for (const { header, value } of cols) {
    const idx = columnIndex(headerMap, header);
    if (idx >= 0) updates.push({ colIndex: idx, value: formatScorePtBr(value) });
  }
  return updates;
}

// ---------- Acoustic scores → sheet (P3: Reverb/Clip/Ruído/Distorção/Eco) ----------

type AcousticColumnKey = 'reverb' | 'clipping' | 'noise' | 'distortion' | 'echo';

/**
 * Header aliases for the five acoustic columns. First alias mirrors the
 * canonical labels defined in audio-acoustics/qcIntegration.ts
 * (SHEET_COLUMNS_HEADERS); the short ones cover legacy/manual sheets.
 * Kept local (data only) so this service stays decoupled from the engine barrel.
 */
const ACOUSTIC_COLUMN_ALIASES: Array<{ key: AcousticColumnKey; aliases: string[] }> = [
  { key: 'reverb', aliases: ['Audio Reverb Score', 'Reverb'] },
  { key: 'clipping', aliases: ['Audio Clipping Score', 'Clip'] },
  { key: 'noise', aliases: ['Audio Ruído Score', 'Ruído'] },
  { key: 'distortion', aliases: ['Audio Distorção Score', 'Distorção'] },
  { key: 'echo', aliases: ['Audio Eco Score', 'Eco'] },
];

/** Either the engine's flattened columns or the full report shape ({axes}). */
export type AcousticColumnsInput = Record<string, number> | { axes: Record<string, { score: number }> };

function toNumericColumns(input: AcousticColumnsInput): Record<string, number> {
  const maybeAxes = (input as { axes?: Record<string, { score: number }> }).axes;
  if (maybeAxes && typeof maybeAxes === 'object') {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(maybeAxes)) out[k] = typeof v?.score === 'number' ? v.score : 0;
    return out;
  }
  return input as Record<string, number>;
}

/** Integer 0–100, round-half-up (stable across JSON roundtrips, same rule as acousticSheetColumns). */
const formatAcousticCell = (v: number): string =>
  String(Math.round(Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0))));

/**
 * Builds cell updates for the acoustic quality columns against the CURRENT
 * headers (dynamic mapping — same contract as buildScoreCellUpdates). Columns
 * absent from the sheet are silently skipped; a sheet with none of them
 * returns [] so callers can bail out without writing anything.
 */
export function buildAcousticCellUpdates(
  headerMap: SheetHeaderMap,
  input: AcousticColumnsInput,
): Array<{ colIndex: number; value: string }> {
  const numeric = toNumericColumns(input);
  const updates: Array<{ colIndex: number; value: string }> = [];
  for (const { key, aliases } of ACOUSTIC_COLUMN_ALIASES) {
    if (!(key in numeric)) continue;
    const idx = columnIndex(headerMap, ...aliases);
    if (idx >= 0) updates.push({ colIndex: idx, value: formatAcousticCell(numeric[key]) });
  }
  return updates;
}

/**
 * Returns a NEW row with the given updates applied (original untouched).
 * Grows the row with empty cells when an update targets beyond current length
 * (sparse sheets keep positional semantics intact for the API writer).
 */
export function applyCellUpdates(
  rowData: RowData,
  updates: ReadonlyArray<{ colIndex: number; value: string }>,
): RowData {
  const next = rowData.slice();
  for (const u of updates) {
    while (next.length <= u.colIndex) next.push({ value: '' });
    next[u.colIndex] = { ...next[u.colIndex], value: u.value };
  }
  return next;
}

/**
 * One-call bridge used by the workspace save/sync flows: merges the acoustic
 * scores into the row being written, resolving columns from the sheet's
 * current headers. No acoustic columns present ⇒ original row unchanged.
 */
export function mergeAcousticScoresIntoRow(
  rowData: RowData,
  headers: string[],
  columns: AcousticColumnsInput,
): RowData {
  if (!headers.length) return rowData;
  const updates = buildAcousticCellUpdates(buildHeaderMap(headers), columns);
  if (!updates.length) return rowData;
  return applyCellUpdates(rowData, updates);
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildHeaderMap,
  columnIndex,
  fetchRow,
  fetchQueue,
  updateSheetRow,
  createLocalAuditSink,
  buildScoreCellUpdates,
  SheetAuthError,
  SheetApiError,
  type RowData,
} from '../services/sheetSync';
import type { AuditSink } from '../services/sheetSync';

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const errJson = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

// ---------- header mapping ----------

describe('sheetSync: dynamic header mapping', () => {
  const map = buildHeaderMap(['O.S', 'PROFESSOR(A)', ' DATA ', 'ESTÚDIO', 'FINAL', 'ENQUADRAMENTO']);

  it('resolves columns by current header names, not fixed positions', () => {
    expect(columnIndex(map, 'O.S')).toBe(0);
    expect(columnIndex(map, 'PROFESSOR(A)')).toBe(1);
    expect(columnIndex(map, 'DATA')).toBe(2); // trims/case/spacing-normalized
  });

  it('is resilient to reorganized sheets (column moved)', () => {
    // The Gran moves FINAL to the front — mapping follows the headers.
    const moved = buildHeaderMap(['FINAL', 'O.S', 'PROFESSOR(A)']);
    expect(columnIndex(moved, 'FINAL')).toBe(0);
    expect(columnIndex(moved, 'O.S')).toBe(1);
  });

  it('returns -1 for absent headers instead of throwing', () => {
    expect(columnIndex(map, 'COLUNA_INEXISTENTE')).toBe(-1);
    expect(columnIndex(map)).toBe(-1);
  });
});

// ---------- reading ----------

describe('sheetSync: fetchRow/fetchQueue', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches a row through the MVP service-account endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okJson([{ value: 'OS-1' }, { value: 'X', link: 'https://yt' }]));
    const row = await fetchRow(7, { fetchFn });
    expect(fetchFn).toHaveBeenCalledWith('/api/sheet-row?rowIndex=7');
    expect(row[1].link).toBe('https://yt');
  });

  it('rejects invalid rowIndex before hitting the API', async () => {
    const fetchFn = vi.fn();
    await expect(fetchRow(1, { fetchFn })).rejects.toThrow(/rowIndex inválido/);
    await expect(fetchRow(2.5, { fetchFn })).rejects.toThrow(/rowIndex inválido/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces API errors as SheetApiError with status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(errJson(500, { error: 'boom' }));
    await expect(fetchRow(3, { fetchFn })).rejects.toBeInstanceOf(SheetApiError);
  });

  it('walks rows until the first empty one (queue region end)', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const m = String(url).match(/rowIndex=(\d+)/);
      const r = m ? Number(m[1]) : -1;
      if (r === 2) return okJson([{ value: 'OS-2' }, { value: 'A' }]);
      if (r === 3) return okJson([{ value: '' }, { value: '' }]);
      return okJson([{ value: 'NEVER' }]);
    });
    const { entries } = await fetchQueue({ fetchFn, startRow: 2, maxRows: 10 });
    expect(entries.map((e) => e.rowIndex)).toEqual([2]);
  });

  it('builds the header map from /api/sheet-headers when available', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('sheet-headers')) {
        return okJson({ headers: ['O.S', 'PROFESSOR(A)', 'FINAL'] });
      }
      return errJson(400, { error: 'end' }); // immediately ends queue walk
    });
    const { entries, headerMap } = await fetchQueue({ fetchFn, startRow: 2, maxRows: 5 });
    expect(entries).toHaveLength(0);
    expect(columnIndex(headerMap, 'FINAL')).toBe(2);
  });
});

// ---------- writing ----------

function memorySink(): AuditSink & { items: unknown[] } {
  const items: unknown[] = [];
  return {
    items,
    append(e: never) { items.push(e); },
    list() { return items as never[]; },
  };
}

describe('sheetSync: updateSheetRow resilience', () => {
  let rowData: RowData;

  beforeEach(() => {
    rowData = [{ value: 'OS-9' }, { value: '4,85' }];
    vi.restoreAllMocks();
  });

  it('requires an access token before any network call', async () => {
    const sink = memorySink();
    await expect(
      updateSheetRow(4, rowData, { accessToken: undefined, auditSink: sink }),
    ).rejects.toBeInstanceOf(SheetAuthError);
    expect(sink.items).toHaveLength(0);
  });

  it('writes via OAuth bearer POST and reports the updated range', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okJson({ success: true, updatedRange: 'ANÁLISE!A4:BP4' }));
    const res = await updateSheetRow(4, rowData, { accessToken: 'tok123', fetchFn, auditSink: null });
    expect(res.success).toBe(true);
    expect(res.attempts).toBe(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/sheet-row');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok123');
    expect(init.headers['X-Idempotency-Key']).toMatch(/^os-r4-[0-9a-f]{8}$/);
    expect(JSON.parse(init.body)).toEqual({ rowIndex: 4, rowData });
  });

  it('retries transient 500s and succeeds on a later attempt (same idempotency key)', async () => {
    const fetchFn = vi
      .fn<(...a: unknown[]) => Promise<Response>>()
      .mockResolvedValueOnce(errJson(500, { error: 't1' }))
      .mockResolvedValueOnce(errJson(502, { error: 't2' }))
      .mockResolvedValue(okJson({ success: true, updatedRange: 'ANÁLISE!A4:BP4' }));
    const res = await updateSheetRow(4, rowData, {
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
      maxAttempts: 3,
      backoffMs: 1,
      auditSink: null,
    });
    expect(res.attempts).toBe(3);
    const keys = fetchFn.mock.calls.map((c) => (c[1] as RequestInit).headers!['X-Idempotency-Key']);
    expect(new Set(keys).size).toBe(1); // identical key on every retry
  });

  it('aborts fast on auth failures without burning retries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(errJson(401, { error: 'Sessão expirada.' }));
    await expect(
      updateSheetRow(4, rowData, { accessToken: 'expired', fetchFn, maxAttempts: 3, backoffMs: 1, auditSink: null }),
    ).rejects.toBeInstanceOf(SheetAuthError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('aborts fast on 400 bad requests too', async () => {
    const fetchFn = vi.fn().mockResolvedValue(errJson(400, { error: 'Payload inválido.' }));
    await expect(
      updateSheetRow(4, rowData, { accessToken: 'tok', fetchFn, maxAttempts: 3, backoffMs: 1, auditSink: null }),
    ).rejects.toBeInstanceOf(SheetApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries on persistent failures and records every attempt in the audit log', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => errJson(503, { error: 'down' }));
    const sink = memorySink();
    await expect(
      updateSheetRow(4, rowData, {
        accessToken: 'tok',
        fetchFn: fetchFn as unknown as typeof fetch,
        maxAttempts: 3,
        backoffMs: 1,
        auditSink: sink as unknown as AuditSink,
      }),
    ).rejects.toBeInstanceOf(SheetApiError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const entries = sink.list();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1] as { ok: boolean; attempt: number; rowIndex: number };
    expect(last.ok).toBe(false);
    expect(last.rowIndex).toBe(4);
  });

  it('keeps the idempotency key stable for identical payloads', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okJson({ success: true }));
    await updateSheetRow(10, rowData, { accessToken: 'a', fetchFn, auditSink: null });
    await updateSheetRow(10, [...rowData], { accessToken: 'a', fetchFn, auditSink: null });
    const k1 = fetchFn.mock.calls[0][1].headers['X-Idempotency-Key'];
    const k2 = fetchFn.mock.calls[1][1].headers['X-Idempotency-Key'];
    expect(k1).toBe(k2);
  });
});

// ---------- score bridge ----------

describe('sheetSync: score → sheet cell updates', () => {
  it('maps category + FINAL scores to CURRENT column positions with PT-BR formatting', () => {
    const headerMap = buildHeaderMap([
      'O.S', 'ENQUADRAMENTO', 'ILUMINAÇÃO', 'OUTROS', 'CENÁRIO', 'ÁUDIO', 'FINAL',
    ]);
    const updates = buildScoreCellUpdates(headerMap, {
      finalScore: 4.07,
      categories: [
        { categoryId: 'ENQUADRAMENTO', finalScore: 0.97 },
        { categoryId: 'ILUMINAÇÃO', finalScore: 0.84 },
        { categoryId: 'OUTROS', finalScore: 0.92 },
        { categoryId: 'CENÁRIO', finalScore: 0.7 },
        { categoryId: 'ÁUDIO', finalScore: 0.64 },
      ],
    });
    const byHeader = Object.fromEntries(
      ['O.S', 'ENQUADRAMENTO', 'ILUMINAÇÃO', 'OUTROS', 'CENÁRIO', 'ÁUDIO', 'FINAL'].map((h, i) => [h, i]),
    );
    const get = (header: string) =>
      updates.find((u) => u.colIndex === byHeader[header])?.value;
    expect(get('ENQUADRAMENTO')).toBe('0,97');
    expect(get('CENÁRIO')).toBe('0,70');
    expect(get('FINAL')).toBe('4,07');
    expect(updates).toHaveLength(6);
  });

  it('skips categories missing from the sheet without failing', () => {
    const headerMap = buildHeaderMap(['FINAL']);
    const updates = buildScoreCellUpdates(headerMap, {
      finalScore: 5,
      categories: [{ categoryId: 'INEXISTENTE', finalScore: 1 }],
    });
    expect(updates).toEqual([{ colIndex: 0, value: '5,00' }]);
  });
});

describe('sheetSync: local audit sink', () => {
  it('appends and lists entries against an injected Storage', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
    } as unknown as Storage;
    const sink = createLocalAuditSink(storage);
    sink.append({ ts: 't1', rowIndex: 2, attempt: 1, ok: true, idempotencyKey: 'k' });
    sink.append({ ts: 't2', rowIndex: 3, attempt: 1, ok: false, idempotencyKey: 'k2', error: 'x' });
    const all = sink.list();
    expect(all).toHaveLength(2);
    expect(all[1].ok).toBe(false);
  });
});

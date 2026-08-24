// Solaris v3 P5 — dashboard data loading + pure render math.
//
// Loader: composes the existing SheetConnector (dynamic headers, service-
// account-backed reads) with the dashboard core. Falls back to demo rows when
// the API is unavailable so the panel is always demonstrable (guest mode).
// Render math: SVG bar geometry lives here as pure functions — the component
// only maps results onto <rect> elements.

import { DEMO_HEADERS, DEMO_ROWS } from '../utils/demoData';
import {
  fetchRow,
  buildHeaderMap,
  columnIndex,
  type RowData,
  type SheetFetchOptions,
} from '../services/sheetSync';
import type { DashboardEntryInput } from '../utils/dashboard';

export type { DashboardEntryInput };

/** True when a row is entirely empty — terminates the queue region. */
export function isEmptyRow(cells: RowData | undefined | null): boolean {
  return !cells || cells.length === 0 || cells.every((c) => !c || !c.value);
}

/**
 * Loads O.S. entries for the dashboards:
 *   1. GET /api/sheet-headers → header names (dynamic column mapping);
 *   2. GET /api/sheet-row?rowIndex=N sequentially until an empty row or cap;
 *   3. any failure (network, HTTP error) → demo dataset fallback.
 * `maxRows` keeps latency bounded; sequential paging matches fetchQueue().
 */
export async function loadDashboardEntries(
  options: SheetFetchOptions & { maxRows?: number } = {},
): Promise<{ entries: DashboardEntryInput[]; source: 'live' | 'demo' }> {
  const doFetch = options.fetchFn ?? fetch;
  const base = options.apiBase ?? '';
  const maxRows = Math.max(1, options.maxRows ?? 200);

  try {
    const headerRes = await doFetch(`${base}/api/sheet-headers`);
    if (!headerRes.ok) throw new Error(`headers HTTP ${headerRes.status}`);
    const headerBody = (await headerRes.json()) as { headers?: string[] };
    const headers: string[] = Array.isArray(headerBody.headers) ? headerBody.headers : [];

    const map = buildHeaderMap(headers);
    // Any recognizable anchor proves the mapping; otherwise treat as degraded.
    if (
      columnIndex(map, 'FINAL SCORE', 'FINAL') === -1 &&
      columnIndex(map, 'STUDIO', 'ESTÚDIO') === -1
    ) {
      throw new Error('degraded headers');
    }

    const entries: DashboardEntryInput[] = [];
    for (let rowIndex = 2; rowIndex < 2 + maxRows; rowIndex++) {
      let row: RowData;
      try {
        row = await fetchRow(rowIndex, options);
      } catch (err) {
        if (err instanceof Error && err.message.includes('rowIndex inválido')) break; // past the end
        throw err;
      }
      if (isEmptyRow(row)) break;
      entries.push({ rowIndex, headers, cells: row });
    }
    return { entries, source: 'live' };
  } catch {
    return {
      entries: DEMO_ROWS.map((r) => ({ rowIndex: r.rowIndex, headers: DEMO_HEADERS, cells: r.row })),
      source: 'demo',
    };
  }
}

// ---------- Pure bar-chart geometry ----------

export interface BarGeometry {
  /** Normalized height ratio in [0.04, 1] — floor keeps zero-score bars visible. */
  heightRatio: number;
}

const MIN_RATIO = 0.04;

/**
 * Maps a value to a bar height ratio against [0, maxValue]. Deterministic and
 * side-effect free; negative/NaN inputs — or a non-positive/invalid scale —
 * clamp to the minimum so degenerate charts never render full-height lies.
 */
export function barHeightRatio(value: number, maxValue: number): number {
  if (!Number.isFinite(value)) return MIN_RATIO;
  if (!Number.isFinite(maxValue) || maxValue <= 0) return MIN_RATIO;
  const ratio = Math.min(1, Math.max(0, value / maxValue));
  return Math.max(MIN_RATIO, ratio);
}

/** Formats a score for display using PT-BR decimal comma (sheet parity). */
export function formatScoreDisplay(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(2).replace('.', ',');
}

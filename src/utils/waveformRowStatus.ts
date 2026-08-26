import { RowData } from '../components/Analysis/AnalysisSheet';
import { getVideoIdFromUrl } from './videoUtils';

// Column names as they appear in the sheet headers.
export const LIST_HEADERS = {
    WO: 'W.O.',
    INSTRUCTOR: 'INSTRUCTOR',
    DATE: 'DATE',
    STUDIO: 'STUDIO',
    FINAL_SCORE: 'FINAL SCORE',
    OPERATOR: 'OPERATOR',
} as const;

export type ListHeaderKey = keyof typeof LIST_HEADERS;

/**
 * Single-pass index lookup for the columns the work-order list renders.
 * Computed once per headers array instead of O(headers) indexOf calls
 * inside every list item on every render.
 */
export function getHeaderIndexMap(headers: string[]): Record<ListHeaderKey, number> {
    return {
        WO: headers.indexOf(LIST_HEADERS.WO),
        INSTRUCTOR: headers.indexOf(LIST_HEADERS.INSTRUCTOR),
        DATE: headers.indexOf(LIST_HEADERS.DATE),
        STUDIO: headers.indexOf(LIST_HEADERS.STUDIO),
        FINAL_SCORE: headers.indexOf(LIST_HEADERS.FINAL_SCORE),
        OPERATOR: headers.indexOf(LIST_HEADERS.OPERATOR),
    };
}

/**
 * Pure derived state for ListItem's "cached waveform" badge: true when any
 * candidate link (W.O. first, then OPERATOR) resolves to a video id that is
 * in the local waveform cache. Sync and side-effect free so the component can
 * compute it during render (no useEffect/setState double render).
 */
export function findCachedWaveformForRow(
    row: RowData,
    idx: Record<ListHeaderKey, number>,
    cachedVideoIds: Set<string>
): boolean {
    const candidates = [row[idx.WO]?.link, row[idx.OPERATOR]?.link];
    for (const link of candidates) {
        if (!link) continue;
        const videoId = getVideoIdFromUrl(link);
        if (videoId && cachedVideoIds.has(videoId)) {
            return true;
        }
    }
    return false;
}

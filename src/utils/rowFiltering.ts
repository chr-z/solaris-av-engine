import { RowWithSheetIndex } from '../components/Analysis/AnalysisSheet';
import { FilterState } from '../components/Analysis/FilterControls';

/**
 * Column mapping — must match the English Google Sheet headers.
 * Single source of truth shared by App and tests.
 */
export const COLS = {
    WO: 'W.O.',
    EVENT: 'EVENT',
    UNIFORM: 'UNIFORM',
    ANALYST: 'ANALYST',
    OPERATOR: 'OPERATOR',
    ANALYSIS_TIME: 'ANALYSIS TIME',
    INSTRUCTOR: 'INSTRUCTOR',
    STUDIO: 'STUDIO',
} as const;

export interface FilteredRows {
    pending: RowWithSheetIndex[];
    completed: RowWithSheetIndex[];
    special: RowWithSheetIndex[];
}

const SPECIAL_TIME_VALUES = new Set(['0', '00:00:00']);

/**
 * Classify a row as pending, completed or special (system work order).
 * A row without a W.O. number is ignored entirely.
 */
export function classifyRow(
    item: RowWithSheetIndex,
    colIndex: Record<keyof typeof COLS, number>
): 'pending' | 'completed' | 'special' | null {
    const { row } = item;
    if (!row[colIndex.WO]?.value?.trim()) return null;

    const operatorVal = row[colIndex.OPERATOR]?.value?.trim();
    const timeVal = row[colIndex.ANALYSIS_TIME]?.value?.trim();
    if (!operatorVal || SPECIAL_TIME_VALUES.has(timeVal)) return 'special';

    const hasEvent = !!row[colIndex.EVENT]?.value?.trim();
    const hasUniform = !!row[colIndex.UNIFORM]?.value?.trim();
    const hasAnalyst = !!row[colIndex.ANALYST]?.value?.trim();

    return hasEvent && hasUniform && hasAnalyst ? 'completed' : 'pending';
}

/**
 * Apply search/studio/inconformity filters to a classified list.
 * Pure function — no React, no side effects.
 */
export function applyRowFilters(
    list: RowWithSheetIndex[],
    headers: string[],
    filters: Pick<FilterState, 'inconformities' | 'studio'>,
    searchTerm: string
): RowWithSheetIndex[] {
    const instructorIndex = headers.indexOf(COLS.INSTRUCTOR);
    const studioIndex = headers.indexOf(COLS.STUDIO);
    const woIndex = headers.indexOf(COLS.WO);
    const inconformityIndices = filters.inconformities
        .map(name => headers.indexOf(name))
        .filter(index => index !== -1);
    const lowercasedFilter = searchTerm.toLowerCase().trim();

    return list.filter(({ row }) => {
        if (lowercasedFilter) {
            const woValue = String(row[woIndex]?.value || '').toLowerCase();
            const instructor = String(row[instructorIndex]?.value || '').toLowerCase();
            if (!woValue.includes(lowercasedFilter) && !instructor.includes(lowercasedFilter)) {
                return false;
            }
        }
        if (filters.studio && studioIndex > -1) {
            const studioValue = String(row[studioIndex]?.value || '');
            if (studioValue !== filters.studio) return false;
        }
        if (inconformityIndices.length > 0) {
            const hasInconformity = inconformityIndices.some(index => {
                const cellValue = row[index]?.value;
                return cellValue === 'TRUE' || cellValue === 'Noncompliant';
            });
            if (!hasInconformity) return false;
        }
        return true;
    });
}

/**
 * Full pipeline: classify rows against headers, then filter each bucket.
 * Guest mode collapses everything into a single searchable "pending" list.
 */
export function computeFilteredRows(
    allRows: RowWithSheetIndex[],
    headers: string[],
    filters: FilterState,
    searchTerm: string,
    isGuestMode: boolean
): FilteredRows {
    // Guest mode: simplified filtering over demo data
    if (isGuestMode && allRows.length > 0) {
        const lowercasedFilter = searchTerm.toLowerCase();
        const filtered = allRows.filter(({ row }) => {
            const rowString = row.map(c => c.value).join(' ').toLowerCase();
            return rowString.includes(lowercasedFilter);
        });
        return { pending: filtered, completed: [], special: [] };
    }

    if (!allRows.length || !headers.length) {
        return { pending: [], completed: [], special: [] };
    }

    const colIndex = {
        WO: headers.indexOf(COLS.WO),
        EVENT: headers.indexOf(COLS.EVENT),
        UNIFORM: headers.indexOf(COLS.UNIFORM),
        ANALYST: headers.indexOf(COLS.ANALYST),
        OPERATOR: headers.indexOf(COLS.OPERATOR),
        ANALYSIS_TIME: headers.indexOf(COLS.ANALYSIS_TIME),
        INSTRUCTOR: -1,
        STUDIO: -1,
    } as Record<keyof typeof COLS, number>;

    const buckets: FilteredRows = { pending: [], completed: [], special: [] };
    for (const item of allRows) {
        const kind = classifyRow(item, colIndex);
        if (kind) buckets[kind].push(item);
    }

    return {
        pending: applyRowFilters(buckets.pending, headers, filters, searchTerm),
        completed: applyRowFilters(buckets.completed, headers, filters, searchTerm),
        special: applyRowFilters(buckets.special, headers, filters, searchTerm),
    };
}

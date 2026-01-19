import { RowData } from '../components/AnalysisSheet';

const DRAFTS_KEY = 'solaris_drafts';
const DRAFT_UPDATE_EVENT = 'solaris_draft_update';

export interface Draft {
    rowData: RowData;
    analystName: string;
    timestamp: number;
}

export interface Drafts {
    [rowIndex: number]: Draft;
}

/**
 * Retrieves all drafts from local storage.
 * @returns An object containing all saved drafts, keyed by row index.
 */
export const getDrafts = (): Drafts => {
    try {
        const draftsJson = localStorage.getItem(DRAFTS_KEY);
        return draftsJson ? JSON.parse(draftsJson) : {};
    } catch (error) {
        console.error("Failed to parse drafts from localStorage", error);
        return {};
    }
};

/**
 * Saves a draft for a specific row index to local storage.
 */
export const saveDraft = (rowIndex: number, rowData: RowData, analystName: string) => {
    const drafts = getDrafts();
    drafts[rowIndex] = {
        rowData,
        analystName,
        timestamp: Date.now()
    };
    try {
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
        window.dispatchEvent(new CustomEvent(DRAFT_UPDATE_EVENT));
    } catch (error) {
        console.error("Failed to save draft to localStorage", error);
    }
};

export const getDraft = (rowIndex: number): Draft | undefined => {
    const drafts = getDrafts();
    return drafts[rowIndex];
};

export const clearDraft = (rowIndex: number) => {
    const drafts = getDrafts();
    delete drafts[rowIndex];
    try {
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
        window.dispatchEvent(new CustomEvent(DRAFT_UPDATE_EVENT));
    } catch (error) {
        console.error("Failed to clear draft from localStorage", error);
    }
};
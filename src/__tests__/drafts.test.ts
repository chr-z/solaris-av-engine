import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getDrafts,
  saveDraft,
  getDraft,
  clearDraft,
} from '../utils/drafts';
import type { RowData } from '../components/Analysis/AnalysisSheet';

const makeRow = (name: string): RowData =>
  Array.from({ length: 4 }, (_, i) => ({ value: `${name}-${i}` }));

describe('drafts: localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    // ensure each test starts with a clean event bus
    window.dispatchEvent(new CustomEvent('solaris_draft_update'));
  });

  it('starts empty when nothing was saved', () => {
    expect(getDrafts()).toEqual({});
  });

  it('saves and reads back a draft by row index', () => {
    const row = makeRow('alice');
    saveDraft(3, row, 'Zee');
    expect(getDrafts()[3]).toBeDefined();
    expect(getDraft(3)!.rowData).toEqual(row);
    expect(getDraft(3)!.analystName).toBe('Zee');
  });

  it('keeps drafts for different rows independent', () => {
    saveDraft(0, makeRow('a'), 'A');
    saveDraft(7, makeRow('b'), 'B');
    expect(getDraft(0)!.analystName).toBe('A');
    expect(getDraft(7)!.analystName).toBe('B');
    expect(Object.keys(getDrafts()).length).toBe(2);
  });

  it('overwrites an existing draft for the same row', () => {
    saveDraft(2, makeRow('v1'), 'first');
    const updated = makeRow('v2');
    saveDraft(2, updated, 'second');
    expect(getDraft(2)!.rowData).toEqual(updated);
    expect(getDraft(2)!.analystName).toBe('second');
  });

  it('records a timestamp on every save', () => {
    const before = Date.now() - 1;
    saveDraft(1, makeRow('t'), 'ts');
    const draft = getDraft(1)!;
    expect(draft.timestamp).toBeGreaterThanOrEqual(before);
    expect(draft.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('dispatches a solaris_draft_update event on save', () => {
    const spy = vi.fn();
    window.addEventListener('solaris_draft_update', spy);
    saveDraft(5, makeRow('evt'), 'evt');
    expect(spy).toHaveBeenCalled();
    window.removeEventListener('solaris_draft_update', spy);
  });

  it('clears only the targeted row', () => {
    saveDraft(1, makeRow('x'), 'one');
    saveDraft(2, makeRow('y'), 'two');
    clearDraft(1);
    expect(getDraft(1)).toBeUndefined();
    expect(getDraft(2)).toBeDefined();
  });

  it('survives corrupted localStorage content without crashing', () => {
    localStorage.setItem('solaris_drafts', '{not-json');
    expect(() => getDrafts()).not.toThrow();
    expect(getDrafts()).toEqual({});
  });
});

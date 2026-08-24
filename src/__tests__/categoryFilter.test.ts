// Solaris v3 P17 — category filter over the Recurring Issues view.
//
// The category chips must narrow the ENTIRE view (KPIs, ranking table,
// heatmap and every export) exactly like the period filter does. These tests
// pin the pure contract: canonical seed-ordered chip list with the 'unknown'
// bucket last, record-level filtering (union of the family's rule ids),
// unknown-mark resolution, immutability, empty/degenerate cases, QC report
// context propagation and filename parity.

import { describe, it, expect } from 'vitest';
import type { Dataset, OsRecord } from '../utils/dashboard';
import {
  availableCategories,
  filterByCategory,
  UNKNOWN_CATEGORY,
} from '../utils/dashboardInconformities';
import {
  buildQcBatchReport,
  qcBatchFilename,
  renderQcBatchHtml,
} from '../utils/qcBatch';
import { SEED_RULES_CONFIG } from '../config/scoringRules';

// Seed families used in the fixtures — resolved from the real seed so the
// test can never drift from the shipped checklist.
const CAT_ENQUADRAMENTO = SEED_RULES_CONFIG.categories.find(
  (c) => c.id === 'ENQUADRAMENTO',
)!.id;
const CAT_ILUMINACAO = SEED_RULES_CONFIG.categories.find(
  (c) => c.id === 'ILUMINAÇÃO',
)!.id;
const CAT_AUDIO = SEED_RULES_CONFIG.categories.find(
  (c) => c.id === 'ÁUDIO',
)!.id;

const rec = (
  rowIndex: number,
  marks: string[],
  finalScore: number | null = null,
): OsRecord => ({
  rowIndex,
  date: null,
  month: null,
  wo: `WO-${rowIndex}`,
  event: 'Event',
  studio: 'Studio',
  instructor: 'Instructor',
  analyst: 'Analyst',
  finalScore,
  marks,
});

describe('availableCategories', () => {
  it('follows the seed order of the Gran checklist families', () => {
    const dataset: Dataset = {
      records: [
        rec(2, ['volume-baixo']), // ÁUDIO
        rec(3, ['flicker']), // ILUMINAÇÃO
        rec(4, ['camera-inclinada-torta']), // ENQUADRAMENTO
      ],
    };
    const cats = availableCategories(dataset);
    const seedOrder = SEED_RULES_CONFIG.categories.map((c) => c.id);
    expect(cats).toEqual(seedOrder.filter((c) => cats.includes(c)));
    expect(cats.indexOf(CAT_ENQUADRAMENTO)).toBeLessThan(
      cats.indexOf(CAT_ILUMINACAO),
    );
    expect(cats).toContain(CAT_AUDIO);
  });

  it('only lists categories that actually occur in the data', () => {
    const dataset: Dataset = { records: [rec(2, ['flicker'])] };
    const cats = availableCategories(dataset);
    expect(cats).toEqual([CAT_ILUMINACAO]);
    expect(cats).not.toContain(CAT_AUDIO);
  });

  it('buckets unknown/legacy markings under a trailing "unknown" chip', () => {
    const dataset: Dataset = {
      records: [rec(2, ['regra-fantasma-do-mvp']), rec(3, ['volume-baixo'])],
    };
    const cats = availableCategories(dataset);
    expect(cats[cats.length - 1]).toBe(UNKNOWN_CATEGORY);
    expect(cats).toContain(CAT_AUDIO);
    expect(cats).toHaveLength(2);
  });
});

describe('filterByCategory', () => {
  const dataset: Dataset = {
    records: [
      rec(2, ['audio-estourando'], 4.5), // ÁUDIO only
      rec(3, ['volume-baixo', 'flicker'], 5.0), // ÁUDIO + ILUMINAÇÃO
      rec(4, ['camera-inclinada-torta'], null), // ENQUADRAMENTO only
      rec(5, [], 4.0), // unmarked — never matches
    ],
  };

  it('keeps every record with at least one marking of the family (union)', () => {
    const kept = filterByCategory(dataset.records, CAT_AUDIO).map((r) => r.rowIndex);
    expect(kept).toEqual([2, 3]); // row 3 counts for ÁUDIO via volume-baixo
  });

  it('returns all records when no category is active', () => {
    expect(filterByCategory(dataset.records, '')).toEqual(dataset.records);
  });

  it('never mutates the input dataset', () => {
    const snapshot = JSON.stringify(dataset);
    filterByCategory(dataset.records, CAT_ILUMINACAO);
    availableCategories(dataset);
    expect(JSON.stringify(dataset)).toBe(snapshot);
  });

  it('resolves unknown markings only through the "unknown" chip', () => {
    const records = [rec(9, ['regra-fantasma'])];
    expect(filterByCategory(records, UNKNOWN_CATEGORY)).toEqual(records);
    expect(filterByCategory(records, CAT_AUDIO)).toEqual([]);
  });
});

describe('category-scoped QC report (P17)', () => {
  const dataset: Dataset = {
    records: [
      rec(2, ['audio-estourando'], 4.5),
      rec(3, ['camera-inclinada-torta'], 5.0),
    ],
  };

  it('carries the active category into the payload and scopes the rows', () => {
    const scoped: Dataset = {
      records: filterByCategory(dataset.records, CAT_AUDIO),
    };
    const report = buildQcBatchReport(scoped, {
      category: CAT_AUDIO,
      nowIso: '2026-08-24T18:00:00.000Z',
    });
    expect(report.category).toBe(CAT_AUDIO);
    expect(report.count).toBe(1);
    expect(report.records[0].rowIndex).toBe(2);
  });

  it('omits the field entirely when no category is active (backwards compatible)', () => {
    const report = buildQcBatchReport(dataset, {});
    expect('category' in report).toBe(false);
    expect(qcBatchFilename(report)).toBe('solaris-qc-report.html');
  });

  it('rides the filename as _cat-<slug> so exports never mix scopes', () => {
    const report = buildQcBatchReport(dataset, { category: 'ÁUDIO' });
    expect(qcBatchFilename(report)).toBe('solaris-qc-report_cat-audio.html');
  });

  it('states the applied category in both locales of the printable HTML', () => {
    for (const locale of ['en', 'pt'] as const) {
      const html = renderQcBatchHtml(
        buildQcBatchReport(dataset, { category: 'ÁUDIO' }),
        locale,
      );
      expect(html).toContain(locale === 'pt' ? 'Categoria aplicada' : 'Applied category');
      expect(html).toContain('ÁUDIO');
    }
  });
});

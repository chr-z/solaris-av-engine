import { describe, it, expect } from 'vitest';
import {
  buildRankingSheetXml,
  buildRankingXlsx,
  rankingXlsxFilename,
} from '../utils/dashboardInconformities';
import { inconformityRanking } from '../utils/dashboardInconformities';
import type { InconformityStat } from '../utils/dashboardInconformities';
import type { Dataset, OsRecord } from '../utils/dashboard';

// ---------- Fixtures ----------

const rec = (over: Partial<OsRecord>): OsRecord => ({
  rowIndex: 2,
  date: null,
  month: null,
  wo: '',
  event: '',
  studio: '',
  instructor: '',
  analyst: '',
  finalScore: null,
  marks: [],
  ...over,
});

// Two marked rows + one clean row → ranking has exactly two entries.
const DATASET: Dataset = {
  records: [
    rec({
      rowIndex: 2,
      wo: 'WO-001',
      studio: 'Studio A',
      event: 'Intro, "part" 1',
      marks: ['audio-estourando', 'muito-pouco-teto'],
    }),
    rec({ rowIndex: 3, wo: 'WO-002', marks: ['audio-estourando'] }),
    rec({ rowIndex: 4, wo: 'WO-003' }),
  ],
};

const STAT = (over: Partial<InconformityStat>): InconformityStat => ({
  ruleId: 'audio-estourando',
  name: 'Audio Clipping (Peaking)',
  categoryId: 'AUDIO',
  count: 2,
  rate: 2 / 3,
  unitScore: 0.3,
  impact: 0.6,
  ...over,
});

const WHEN = new Date('2026-08-24T15:00:00Z');

describe('P14 ranking XLSX — sheet XML', () => {
  it('mirrors the CSV column set with a header row and rank-ordered rows', () => {
    const xml = buildRankingSheetXml([STAT({}), STAT({ ruleId: 'x', name: 'X', count: 1 })]);
    expect(xml).toContain('<row r="1">');
    expect(xml).toContain('>rule<');
    expect(xml).toContain('>occurrences<');
    expect(xml).not.toContain('>rate_pct<'); // same headers as the CSV export
    expect(xml).toContain('<row r="2">');
  });

  it('emits counts/rates/penalties/impact as numeric cells', () => {
    const xml = buildRankingSheetXml([STAT({})]);
    expect(xml).toContain('<c r="A2"><v>1</v></c>'); // rank
    expect(xml).toContain('<c r="E2"><v>2</v></c>'); // occurrences
    expect(xml).toContain('<c r="F2"><v>66.67</v></c>'); // rate % (dot decimal)
    expect(xml).toContain('<c r="G2"><v>0.30</v></c>');
    expect(xml).toContain('<c r="H2"><v>0.60</v></c>'); // impact
  });

  it('keeps hostile text fields as escaped inline strings', () => {
    const xml = buildRankingSheetXml([
      STAT({ name: 'say "hi" & <bye>' }),
    ]);
    expect(xml).toContain('say &quot;hi&quot; &amp; &lt;bye&gt;');
    expect(xml).not.toContain('<bye>');
    expect(xml).toContain('t="inlineStr"');
  });

  it('renders an empty ranking as a header-only sheet without erroring', () => {
    const xml = buildRankingSheetXml([]);
    expect(xml).toContain('<row r="1">');
    expect(xml).not.toContain('<row r="2">');
  });
});

describe('P14 ranking XLSX — package & filenames', () => {
  it('packages the five OOXML parts deterministically with a Ranking sheet', () => {
    const first = Buffer.from(buildRankingXlsx(inconformityRanking(DATASET), WHEN));
    const second = Buffer.from(buildRankingXlsx(inconformityRanking(DATASET), WHEN));
    expect(first.equals(second)).toBe(true);

    const text = first.toString('latin1');
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('_rels/.rels');
    expect(text).toContain('xl/workbook.xml');
    expect(text).toContain('xl/_rels/workbook.xml.rels');
    expect(text).toContain('xl/worksheets/sheet1.xml');
    // Sheet declared as 'Ranking' (plain name needs no XML escaping).
    expect(first.toString('utf8')).toContain('<sheet name="Ranking"');
    // STORE payload survives verbatim.
    expect(first.toString('utf8')).toContain('Audio Clipping (Peaking)');
  });

  it('counts every marked O.S. of the dataset exactly like the ranking table', () => {
    const ranking = inconformityRanking(DATASET);
    expect(ranking).toHaveLength(2);
    // Leader by impact: audio clipping seen in 2 of 3 O.S.
    expect(ranking[0].ruleId).toBe('audio-estourando');
    expect(ranking[0].count).toBe(2);

    const rows = buildRankingSheetXml(ranking);
    expect((rows.match(/<row r="\d+"/g) ?? []).length).toBe(3); // header + 2 stats
  });

  it('names the file after rankingFilename with only the extension swapped', () => {
    expect(rankingXlsxFilename()).toBe('solaris-inconformity-ranking.xlsx');
    expect(rankingXlsxFilename({})).toBe('solaris-inconformity-ranking.xlsx');
    expect(rankingXlsxFilename({ from: 'garbage!!' })).toBe('solaris-inconformity-ranking.xlsx');
    expect(rankingXlsxFilename({ from: '2024-03' })).toBe(
      'solaris-inconformity-ranking_2024-03_latest.xlsx',
    );
    expect(rankingXlsxFilename({ to: '2024-12-31' })).toBe(
      'solaris-inconformity-ranking_start_2024-12-31.xlsx',
    );
    expect(rankingXlsxFilename({ from: '2024-03', to: '2024-04' })).toBe(
      'solaris-inconformity-ranking_2024-03_2024-04.xlsx',
    );
  });
});

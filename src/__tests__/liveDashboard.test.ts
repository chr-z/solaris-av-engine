// Solaris v3 — F5 Dashboard ao vivo — testes do núcleo puro.
// Cobre KPIs, throughput (dia/hora), presença 🟢🟡⚪, feed dedupe e
// privacidade das métricas cruzadas por papel.

import { describe, expect, it } from 'vitest';
import type { Dataset, OsRecord } from '../utils/dashboard';
import {
  buildAnalystCards,
  buildAnalystQuality,
  buildLiveKpis,
  buildThroughputByDay,
  buildThroughputByHour,
  IDLE_THRESHOLD_MS,
  mergeFeed,
  peakOf,
  presenceState,
  visibleQualityRows,
  type AnalystActivity,
  type FeedEvent,
} from '../utils/liveDashboard';
import { SAO_PAULO_CLOCK, localDayKey } from '../features/gamification/periods';

function rec(partial: Partial<OsRecord>): OsRecord {
  return {
    rowIndex: 0,
    date: '2026-08-25',
    month: '2026-08',
    wo: '',
    event: 'Aula',
    studio: 'Estúdio 1',
    instructor: 'Prof',
    analyst: 'ana',
    finalScore: 90,
    ...partial,
  };
}

function ds(records: OsRecord[]): Dataset {
  return { records };
}

describe('buildLiveKpis', () => {
  const today = '2026-08-25';
  const data = ds([
    rec({ rowIndex: 1, finalScore: 80 }), // hoje, concluída
    rec({ rowIndex: 2, finalScore: null }), // hoje, pendente
    rec({ rowIndex: 3, date: '2026-08-24', finalScore: 70 }), // ontem
    rec({ rowIndex: 4, date: null, finalScore: null }), // sem data, pendente
  ]);

  it('conta só OSs de hoje e separa concluídas', () => {
    const k = buildLiveKpis(data, { todayKey: today });
    expect(k.osToday).toBe(2);
    expect(k.completedToday).toBe(1);
  });

  it('pendências olham o dataset inteiro', () => {
    const k = buildLiveKpis(data, { todayKey: today });
    expect(k.queuePending).toBe(2);
  });

  it('média global ignora linhas sem nota', () => {
    const k = buildLiveKpis(data, { todayKey: today });
    expect(k.avgScore).toBeCloseTo(75, 5); // (80+70)/2
  });

  it('sem snapshot de fila, em análise = 0', () => {
    const k = buildLiveKpis(data, { todayKey: today });
    expect(k.inAnalysis).toBe(0);
    expect(k.inAnalysisWho).toEqual([]);
  });

  it('fila em análise vira "Nome · Nmin"', () => {
    const now = Date.now();
    const k = buildLiveKpis(data, {
      todayKey: today,
      queue: [
        { osId: 'OS-1', status: 'in_analysis', assignee: 'Ana', startedAtMs: now - 12 * 60_000 },
        { osId: 'OS-2', status: 'queued' },
        { osId: 'OS-3', status: 'done' },
      ],
    });
    expect(k.inAnalysis).toBe(1);
    expect(k.inAnalysisWho[0]).toMatch(/^Ana · 12min$/);
  });

  it('sem assignee cai pro id da OS; sem timestamp mostra só o nome', () => {
    const k = buildLiveKpis(ds([]), {
      todayKey: today,
      queue: [{ osId: 'OS-9', status: 'in_analysis' }],
    });
    expect(k.inAnalysisWho).toEqual(['OS-9']);
  });

  it('dataset vazio: zeros honestos, média null', () => {
    const k = buildLiveKpis(ds([]), { todayKey: today });
    expect(k).toEqual({
      osToday: 0,
      completedToday: 0,
      inAnalysis: 0,
      inAnalysisWho: [],
      queuePending: 0,
      avgScore: null,
    });
  });
});

describe('throughput', () => {
  it('série diária conta só concluídas e zera buracos', () => {
    // 2026-08-25 é terça; segunda é 24, domingo 23.
    const records = [
      rec({ rowIndex: 1, finalScore: 90 }),
      rec({ rowIndex: 2, finalScore: null }), // não conta
      rec({ rowIndex: 3, date: '2026-08-20', finalScore: 88 }),
    ];
    const pts = buildThroughputByDay(records, { endDayKey: '2026-08-25', days: 7 });
    expect(pts).toHaveLength(7);
    expect(pts[6].dayKey).toBe('2026-08-25');
    expect(pts[6].count).toBe(1);
    expect(pts[0].dayKey).toBe('2026-08-19');
    expect(pts[0].count).toBe(0);
    const day20 = pts.find((p) => p.dayKey === '2026-08-20');
    expect(day20?.count).toBe(1);
  });

  it('janela que atravessa virada de mês mantém dias consecutivos', () => {
    const pts = buildThroughputByDay([], { endDayKey: '2026-09-01', days: 4 });
    expect(pts.map((p) => p.dayKey)).toEqual([
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ]);
  });

  it('throughput por hora usa fuso -03:00 (não UTC do host)', () => {
    // 02:00 UTC = 23:00 do dia anterior em São Paulo.
    const ts = Date.UTC(2026, 7, 26, 2, 0, 0);
    const pts = buildThroughputByHour([{ ts }]);
    expect(pts[23].count).toBe(1);
    expect(pts[2].count).toBe(0);
  });

  it('timestamp inválido é ignorado sem explodir', () => {
    const pts = buildThroughputByHour([{ ts: NaN }]);
    expect(pts.reduce((a, p) => a + p.count, 0)).toBe(0);
  });

  it('peakOf devolve o maior count (empate fica com o primeiro)', () => {
    expect(peakOf([{ count: 2 }, { count: 5 }, { count: 5 }, { count: 1 }])).toBe(5);
    expect(peakOf([])).toBe(0);
  });
});

describe('presença por analista', () => {
  const now = 1_800_000_000_000;
  const act = (over: Partial<AnalystActivity>): AnalystActivity => ({
    userId: 'u1',
    name: 'Ana',
    lastActiveMs: null,
    analyzingOsId: null,
    ...over,
  });

  it('🟢 analisando domina qualquer lastActive', () => {
    expect(
      presenceState(act({ analyzingOsId: 'OS-1', lastActiveMs: now - 9e8 }), now),
    ).toBe('analyzing');
  });

  it('ativo recente (<15min) = recent; ocioso >15min = idle (spec B2)', () => {
    expect(presenceState(act({ lastActiveMs: now - IDLE_THRESHOLD_MS + 1 }), now)).toBe('recent');
    // Exatamente 15min ainda NÃO é ">15min": segue ativo.
    expect(presenceState(act({ lastActiveMs: now - IDLE_THRESHOLD_MS }), now)).toBe('recent');
    expect(presenceState(act({ lastActiveMs: now - IDLE_THRESHOLD_MS - 1 }), now)).toBe('idle');
    expect(presenceState(act({ lastActiveMs: now - 10 * 60 * 60_000 }), now)).toBe('idle');
  });

  it('sem atividade nenhuma = offline; relógio adiantado não vira idle', () => {
    expect(presenceState(act({}), now)).toBe('offline');
    expect(presenceState(act({ lastActiveMs: now + 60_000 }), now)).toBe('recent');
  });

  it('cards agregam contagem e média SÓ de hoje', () => {
    const todayKey = localDayKey(now, SAO_PAULO_CLOCK);
    const data = ds([
      rec({ rowIndex: 1, analyst: 'u1', date: todayKey, finalScore: 100 }),
      rec({ rowIndex: 2, analyst: 'u1', date: todayKey, finalScore: 60 }),
      rec({ rowIndex: 3, analyst: 'u1', date: '2020-01-01', finalScore: 0 }),
      rec({ rowIndex: 4, analyst: 'u2', date: todayKey, finalScore: null }),
    ]);
    const cards = buildAnalystCards(
      [
        act({ userId: 'u1', analyzingOsId: 'OS-7' }),
        act({ userId: 'u2', name: 'Bia' }),
        act({ userId: 'u3', name: 'Caio', lastActiveMs: now - IDLE_THRESHOLD_MS - 1 }),
      ],
      data,
      { todayKey, nowMs: now },
    );
    expect(cards).toHaveLength(3);
    expect(cards[0].state).toBe('analyzing');
    expect(cards[0].todayCount).toBe(2);
    expect(cards[0].avgGiven).toBe(80);
    expect(cards[1].state).toBe('offline');
    expect(cards[1].todayCount).toBe(0);
    expect(cards[1].avgGiven).toBeNull();
    expect(cards[2].state).toBe('idle');
  });
});

describe('feed ao vivo', () => {
  const ev = (id: string, ts: number, text = id): FeedEvent => ({ id, ts, text });

  it('dedupe por id mantendo o primeiro payload', () => {
    const base = [ev('a', 100)];
    const merged = mergeFeed(base, [ev('a', 999, 'duplicado'), ev('b', 200)]);
    expect(merged.map((e) => e.id)).toEqual(['b', 'a']); // mais novo primeiro
    expect(merged.find((e) => e.id === 'a')?.text).toBe('a'); // primeiro vence
  });

  it('ordena desc por ts e corta no teto', () => {
    const incoming: FeedEvent[] = [];
    for (let i = 0; i < 60; i++) incoming.push(ev(`e${i}`, i));
    const merged = mergeFeed([], incoming);
    expect(merged).toHaveLength(50);
    expect(merged[0].id).toBe('e59');
    expect(merged[49].id).toBe('e10');
  });

  it('teto customizado respeitado (cap=2)', () => {
    const merged = mergeFeed([ev('x', 5)], [ev('y', 10), ev('z', 7)], 2);
    expect(merged.map((e) => e.id)).toEqual(['y', 'z']);
  });
});

describe('métricas cruzadas + privacidade', () => {
  const data = ds([
    rec({ rowIndex: 1, analyst: 'ana', finalScore: 90, marks: ['r1', 'r2'] }),
    rec({ rowIndex: 2, analyst: 'ana', finalScore: 70 }),
    rec({ rowIndex: 3, analyst: 'bia', finalScore: 100, marks: ['r3'] }),
    rec({ rowIndex: 4, analyst: '', finalScore: 50 }), // sem analista: ignora
  ]);

  it('agrega média e marcas por analista; retrabalho segue null (sem fonte)', () => {
    const rows = buildAnalystQuality(data);
    expect(rows).toHaveLength(2);
    const ana = rows.find((r) => r.analyst === 'ana')!;
    expect(ana.analyses).toBe(2);
    expect(ana.avgScore).toBe(80);
    expect(ana.avgMarksPerOs).toBe(2); // 2 marcas em 1 OS com marcação
    expect(ana.reworkRate).toBeNull();
    expect(rows[0].analyst).toBe('ana'); // ordena por volume desc: ana=2 > bia=1
  });

  it('admin vê todos; analista vê só a própria linha', () => {
    const rows = buildAnalystQuality(data);
    const adminView = visibleQualityRows(rows, { userId: 'x', role: 'admin', seniority: 'senior' });
    expect(adminView).toHaveLength(2);
    const anaView = visibleQualityRows(rows, { userId: 'ana', role: 'analyst', seniority: 'junior' });
    expect(anaView).toHaveLength(1);
    expect(anaView[0].analyst).toBe('ana');
    const leadView = visibleQualityRows(rows, { userId: 'l', role: 'lead', seniority: 'senior' });
    expect(leadView).toHaveLength(2);
  });
});

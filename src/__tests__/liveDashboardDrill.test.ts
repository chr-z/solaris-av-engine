// Solaris v3 — F5/B2 — drill-down do analista: núcleo puro.
// Cobre: weekCount na régua do pódio (seg 00h -03:00, meio-aberta, domingo
// ainda é semana anterior), tempo médio/O.S. só da fila real (corrompida fora,
// claimed_by fallback), e o histórico completo (meses, O.S. recentes, caps).

import { describe, expect, it } from 'vitest';
import type { Dataset, OsRecord } from '../utils/dashboard';
import type { QueueRowLike } from '../features/qol/queue';
import {
  analystAvgHoursFromQueue,
  buildAnalystCards,
  buildAnalystDrilldown,
  type AnalystActivity,
} from '../utils/liveDashboard';

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

function ds(records: OsRecord[], queueRows?: QueueRowLike[]): Dataset {
  return queueRows === undefined ? { records } : { records, queueRows };
}

function act(over: Partial<AnalystActivity>): AnalystActivity {
  return {
    userId: 'ana',
    name: 'Ana',
    lastActiveMs: null,
    analyzingOsId: null,
    ...over,
  };
}

// Terça 25/08/2026 12:00 em São Paulo (-03:00). A semana do pódio começou
// segunda 24/08 00:00 local.
const NOW = Date.UTC(2026, 7, 25, 15, 0, 0);
const HOUR = 3_600_000;

describe('weekCount nos cards (B2, régua do pódio seg-dom)', () => {
  const todayKey = '2026-08-25'; // terça

  it('conta a semana inteira, não só hoje', () => {
    const cards = buildAnalystCards(
      [act({})],
      ds([
        rec({ rowIndex: 1, date: '2026-08-24', finalScore: 80 }), // segunda
        rec({ rowIndex: 2, date: todayKey, finalScore: 70 }), // terça (hoje)
        rec({ rowIndex: 3, date: '2026-08-19', finalScore: 60 }), // semana passada
        rec({ rowIndex: 4, date: todayKey, finalScore: null }), // sem nota: fora
      ]),
      { todayKey, nowMs: NOW },
    );
    expect(cards[0].todayCount).toBe(1);
    expect(cards[0].weekCount).toBe(2);
  });

  it('domingo pertence à semana que ABRIU na segunda passada', () => {
    // Domingo 23/08/2026 12:00 em SP: semana vigente = [seg 17/08, seg 24/08).
    const sundayNoonSp = Date.UTC(2026, 7, 23, 15, 0, 0);
    const cards = buildAnalystCards(
      [act({})],
      ds([
        rec({ rowIndex: 1, date: '2026-08-21', finalScore: 90 }), // sexta dessa semana
        rec({ rowIndex: 2, date: '2026-08-18', finalScore: 90 }), // terça idem
        rec({ rowIndex: 3, date: '2026-08-14', finalScore: 90 }), // sexta da ANTERIOR
        rec({ rowIndex: 4, date: '2026-08-24', finalScore: 90 }), // segunda SEGUINTE
      ]),
      { todayKey: '2026-08-23', nowMs: sundayNoonSp },
    );
    expect(cards[0].weekCount).toBe(2);
  });

  it('semana anterior completa NÃO vaza pra semana atual', () => {
    // Segunda 24/08 00:01 SP = semana NOVA; sexta 21/08 ficou de fora.
    const mondayEarly = Date.UTC(2026, 7, 24, 3, 1, 0);
    const cards = buildAnalystCards(
      [act({})],
      ds([rec({ rowIndex: 1, date: '2026-08-21', finalScore: 90 })]),
      { todayKey: '2026-08-24', nowMs: mondayEarly },
    );
    expect(cards[0].weekCount).toBe(0);
    expect(cards[0].todayCount).toBe(0);
  });

  it('analista sem linhas fica com weekCount 0 (nunca NaN)', () => {
    const cards = buildAnalystCards([act({ userId: 'x', name: 'X' })], ds([]), {
      todayKey,
      nowMs: NOW,
    });
    expect(cards[0].weekCount).toBe(0);
    expect(cards[0].avgHoursPerOs).toBeNull();
  });
});

describe('tempo médio por O.S. (B2) — só da fila real', () => {
  function q(partial: Partial<QueueRowLike>): QueueRowLike {
    return {
      os_id: 'OS-1',
      status: 'done',
      priority: 2,
      assignee: 'ana',
      created_at: new Date(NOW - 10 * HOUR).toISOString(),
      completed_at: new Date(NOW - 6 * HOUR).toISOString(), // 4h
      ...partial,
    };
  }

  it('média created→completed por assignee, arredondada a 1 casa', () => {
    const hours = analystAvgHoursFromQueue(
      [
        q({ os_id: 'A' }), // 4h
        q({ os_id: 'B', created_at: new Date(NOW - 8 * HOUR).toISOString(),
            completed_at: new Date(NOW - 6 * HOUR).toISOString() }), // 2h
      ],
      NOW,
    );
    expect(hours.get('ana')).toBe(3); // (4+2)/2
  });

  it('claimed_by assume quando não há assignee', () => {
    const hours = analystAvgHoursFromQueue(
      [q({ claimed_by: 'bia', assignee: null })],
      NOW,
    );
    expect(hours.get('bia')).toBe(4);
    expect(hours.get('ana')).toBeUndefined();
  });

  it('conclusão antes da criação (relógio corrupto) fica FORA', () => {
    const hours = analystAvgHoursFromQueue(
      [
        q({
          os_id: 'BAD',
          created_at: new Date(NOW - HOUR).toISOString(),
          completed_at: new Date(NOW - 5 * HOUR).toISOString(),
        }),
        q({ os_id: 'OK' }),
      ],
      NOW,
    );
    expect(hours.get('ana')).toBe(4); // só a OK entra
  });

  it('sem completed_at parseável → analista nem aparece no mapa', () => {
    const hours = analystAvgHoursFromQueue([q({ completed_at: null })], NOW);
    expect(hours.size).toBe(0);
    expect(hours.get('ana')).toBeUndefined();
  });

  it('status queued/in_analysis nunca pontua tempo', () => {
    const hours = analystAvgHoursFromQueue(
      [q({ status: 'queued' }), q({ status: 'in_analysis' })],
      NOW,
    );
    expect(hours.size).toBe(0);
  });

  it('cards expõem avgHoursPerOs via dataset.queueRows', () => {
    const cards = buildAnalystCards(
      [act({})],
      ds(
        [rec({ rowIndex: 1, date: '2026-08-25', finalScore: 50 })],
        [q({})],
      ),
      { todayKey: '2026-08-25', nowMs: NOW },
    );
    expect(cards[0].avgHoursPerOs).toBe(4);
  });
});

describe('buildAnalystDrilldown (B2 — histórico completo)', () => {
  const todayKey = '2026-08-25';

  it('retorna null pra analista sem atividade conhecida', () => {
    expect(
      buildAnalystDrilldown([act({ userId: 'outra' })], ds([]), {
        userId: 'ana',
        todayKey,
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it('agrega total, média global, mês a mês e O.S. recentes', () => {
    const data = ds([
      rec({ rowIndex: 1, wo: 'OS-A', date: '2026-07-10', finalScore: 60, marks: ['r1'] }),
      rec({ rowIndex: 2, wo: 'OS-B', date: '2026-08-01', finalScore: 80 }),
      rec({ rowIndex: 3, wo: 'OS-C2', date: '2026-08-24', finalScore: 90 }), // segunda desta semana
      rec({ rowIndex: 4, wo: 'OS-C', date: todayKey, finalScore: 100 }),
      rec({ rowIndex: 5, wo: 'OS-D', date: todayKey, finalScore: null }), // pendente
      rec({ rowIndex: 6, analyst: 'bia', date: todayKey, finalScore: 70 }), // outra pessoa
    ]);
    const d = buildAnalystDrilldown([act({ analyzingOsId: 'OS-D' })], data, {
      userId: 'ana',
      todayKey,
      nowMs: NOW,
    })!;
    expect(d.totalCount).toBe(4);
    expect(d.avgScore).toBeCloseTo(82.5, 5); // (60+80+90+100)/4
    expect(d.todayCount).toBe(1);
    expect(d.weekCount).toBe(2); // 24/08 (segunda) + hoje 25/08; 01/08 ficou fora
    expect(d.state).toBe('analyzing');
    expect(d.analyzingOsId).toBe('OS-D');
    expect(d.months.map((m) => m.monthKey)).toEqual(['2026-08', '2026-07']);
    const jul = d.months.find((m) => m.monthKey === '2026-07')!;
    expect(jul.analyses).toBe(1);
    expect(jul.avgScore).toBe(60);
    expect(jul.avgMarksPerOs).toBe(1);
    expect(d.recentOs.map((r) => r.osId)).toEqual(['OS-C', 'OS-D', 'OS-C2', 'OS-B', 'OS-A']);
    expect(d.recentOs[0].marks).toBe(0);
  });

  it('semana do pódio: dia 01/08 fica FORA quando a semana abre 24/08', () => {
    const data = ds([
      rec({ rowIndex: 1, wo: 'OS-B', date: '2026-08-01', finalScore: 80 }),
      rec({ rowIndex: 2, wo: 'OS-C', date: '2026-08-24', finalScore: 100 }),
    ]);
    const d = buildAnalystDrilldown([act({})], data, {
      userId: 'ana',
      todayKey,
      nowMs: NOW,
    })!;
    expect(d.weekCount).toBe(1);
  });

  it('O.S. sem data vai pro fim; cap de 8 recentes respeitado', () => {
    const rows: OsRecord[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(rec({ rowIndex: i + 1, wo: `OS-${i}`, date: `2026-0${i % 9 + 1}-15`, finalScore: 50 }));
    }
    rows.push(rec({ rowIndex: 99, wo: 'OS-NODATE', date: null, finalScore: 40 }));
    const d = buildAnalystDrilldown([act({})], ds(rows), {
      userId: 'ana',
      todayKey,
      nowMs: NOW,
    })!;
    expect(d.recentOs).toHaveLength(8);
    expect(d.recentOs.some((r) => r.osId === 'OS-NODATE')).toBe(false);
    expect(d.months.length).toBeGreaterThan(0);
    expect(d.lastActiveMs).toBeNull();
  });

  it('lastActiveMs e presença refletem a atividade injetada', () => {
    const d = buildAnalystDrilldown(
      [act({ lastActiveMs: NOW - 60_000, analyzingOsId: null })],
      ds([]),
      { userId: 'ana', todayKey, nowMs: NOW },
    )!;
    expect(d.lastActiveMs).toBe(NOW - 60_000);
    expect(d.state).toBe('recent');
    expect(d.totalCount).toBe(0);
    expect(d.avgScore).toBeNull();
  });

  it('fila real alimenta o tempo médio no drilldown', () => {
    const q: QueueRowLike = {
      os_id: 'OS-Q',
      status: 'done',
      priority: 2,
      assignee: 'ana',
      created_at: new Date(NOW - 3 * HOUR).toISOString(),
      completed_at: new Date(NOW - HOUR).toISOString(), // 2h
    };
    const d = buildAnalystDrilldown([act({})], ds([], [q]), {
      userId: 'ana',
      todayKey,
      nowMs: NOW,
    })!;
    expect(d.avgHoursPerOs).toBe(2);
  });

  it('cfg injetável muda a régua da semana (fuso explícito)', () => {
    const tokyoCfg = {
      tzOffsetMinutes: -9 * 60,
      weekStartsOn: 1 as const,
    };
    // 25/08 15:00 UTC já é 26/08 00:00 em Tóquio → semana abre 24/08 lá também,
    // mas "hoje" local muda. Passamos todayKey coerente com o fuso injetado.
    const d = buildAnalystDrilldown(
      [act({})],
      ds([rec({ rowIndex: 1, date: '2026-08-24', finalScore: 90 })]),
      { userId: 'ana', todayKey: '2026-08-26', nowMs: NOW, cfg: tokyoCfg },
    )!;
    expect(d.weekCount).toBe(1);
    expect(d.todayCount).toBe(0);
  });
});

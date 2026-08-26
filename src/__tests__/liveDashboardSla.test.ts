// Solaris v3 — F5 — SLA no painel ao vivo (spec B1 "SLA médio").
// Núcleo puro: média de conclusão da fila done, atraso sobre prazo, e as
// bordas de honestidade (timestamp ausente/inválido/incoerente → fora).

import { describe, expect, it } from 'vitest';
import { buildSlaSummary } from '../utils/liveDashboard';

const NOW = Date.UTC(2026, 7, 25, 15, 0, 0);
const H = 3_600_000;

const iso = (ms: number): string => new Date(ms).toISOString();

function row(over: Partial<{
  status: string;
  deadline: string | null;
  created_at: string;
  completed_at: string | null;
}> = {}): {
  status: string;
  deadline: string | null;
  created_at: string;
  completed_at: string | null;
} {
  return {
    status: 'queued',
    deadline: null,
    created_at: iso(NOW - 24 * H),
    completed_at: null,
    ...over,
  };
}

describe('buildSlaSummary — conclusão média (done)', () => {
  it('média created→completed das OSs concluídas', () => {
    const rows = [
      row({
        status: 'done',
        created_at: iso(NOW - 10 * H),
        completed_at: iso(NOW - 6 * H), // 4h
      }),
      row({
        status: 'done',
        created_at: iso(NOW - 8 * H),
        completed_at: iso(NOW - 2 * H), // 6h
      }),
    ];
    expect(buildSlaSummary(rows, { now: NOW }).avgCompletionHours).toBe(5); // (4+6)/2
  });

  it('fila sem timestamps de conclusão → null (nunca zero inventado)', () => {
    const rows = [row(), row({ status: 'in_analysis' })];
    const sla = buildSlaSummary(rows, { now: NOW });
    expect(sla.avgCompletionHours).toBeNull();
  });

  it('conclusões sem created_at ou com relógio incoerente ficam FORA', () => {
    const rows = [
      // única conclusão válida: 2h
      row({
        status: 'done',
        created_at: iso(NOW - 5 * H),
        completed_at: iso(NOW - 3 * H),
      }),
      // completed_at ausente
      row({ status: 'done', created_at: iso(NOW - 9 * H), completed_at: null }),
      // created_at inválido
      row({ status: 'done', created_at: '', completed_at: iso(NOW) }),
      // conclusão ANTES da criação (relógio corrupto)
      row({
        status: 'done',
        created_at: iso(NOW - 1 * H),
        completed_at: iso(NOW - 7 * H),
      }),
    ];
    expect(buildSlaSummary(rows, { now: NOW }).avgCompletionHours).toBe(2);
  });
});

describe('buildSlaSummary — atraso sobre prazo', () => {
  it('conta só queued com deadline passada e mede a média de atraso', () => {
    const rows = [
      row({ deadline: iso(NOW - 2 * H) }), // atrasada 2h
      row({ deadline: iso(NOW - 6 * H) }), // atrasada 6h
      row({ deadline: iso(NOW + 5 * H) }), // futuro: não conta
      row({ status: 'done', deadline: iso(NOW - 99 * H) }), // done: não é fila
    ];
    const sla = buildSlaSummary(rows, { now: NOW });
    expect(sla.overdueCount).toBe(2);
    expect(sla.avgOverdueHours).toBe(4); // (2+6)/2
  });

  it('sem atraso → overdueCount 0 e avg null', () => {
    const sla = buildSlaSummary([row()], { now: NOW });
    expect(sla.overdueCount).toBe(0);
    expect(sla.avgOverdueHours).toBeNull();
  });

  it('deadline vazia/inválida nunca conta como atrasada (epoch 0 proibido)', () => {
    const sla = buildSlaSummary(
      [row({ deadline: null }), row({ deadline: 'não-é-data' })],
      { now: NOW },
    );
    expect(sla.overdueCount).toBe(0);
  });

  it('arredonda para 1 casa decimal', () => {
    const sla = buildSlaSummary(
      [
        row({ deadline: iso(NOW - 1.25 * H) }),
        row({ deadline: iso(NOW - 1.5 * H) }),
      ],
      { now: NOW },
    );
    expect(sla.avgOverdueHours).toBeCloseTo(1.4, 5); // (1.25+1.5)/2 = 1.375 → 1.4
  });

  it('fila vazia → resumo todo vazio/null', () => {
    const sla = buildSlaSummary([], { now: NOW });
    expect(sla).toEqual({
      avgCompletionHours: null,
      overdueCount: 0,
      avgOverdueHours: null,
    });
  });
});

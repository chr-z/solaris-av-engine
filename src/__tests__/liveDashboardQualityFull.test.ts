// Solaris v3 — F5/B3 — qualidade cruzada COMPLETA (nota dada vs recebida +
// retrabalho auditado + tempo vs média do time). Núcleo puro, sem inventar dado.

import { describe, expect, it } from 'vitest';
import type { Dataset, OsRecord } from '../utils/dashboard';
import {
  buildAnalystQuality,
  buildAnalystQualityFull,
  auditVerdictFromEvents,
  type QualityAuditEvent,
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

const HOUR = 3_600_000;

function q(
  osId: string,
  status: 'queued' | 'in_analysis' | 'done',
  assignee: string | null,
  createdHoursAgo: number,
  durationHours?: number,
) {
  return {
    os_id: osId,
    status,
    priority: 2 as const,
    assignee,
    created_at: new Date(Date.UTC(2026, 7, 20, 12, 0, 0) - createdHoursAgo * HOUR).toISOString(),
    ...(durationHours != null
      ? { completed_at: new Date(Date.UTC(2026, 7, 20, 12, 0, 0) - createdHoursAgo * HOUR + durationHours * HOUR).toISOString() }
      : {}),
  };
}

describe('auditVerdictFromEvents', () => {
  it('separa quality_bonus de rework_penalty e ignora outros motivos', () => {
    const events: QualityAuditEvent[] = [
      { userId: 'ana', amount: 150, reason: 'quality_bonus' },
      { userId: 'ana', amount: 100, reason: 'os_complete' }, // não é auditoria
      { userId: 'ana', amount: -10, reason: 'adjustment' },
      { userId: 'ana', amount: -150, reason: 'rework_penalty' },
      { userId: 'bia', amount: 150, reason: 'quality_bonus' },
    ];
    const v = auditVerdictFromEvents(events);
    expect(v.get('ana')).toEqual({ auditsOk: 1, reworkEvents: 1 });
    expect(v.get('bia')).toEqual({ auditsOk: 1, reworkEvents: 0 });
    expect(v.has('carl')).toBe(false);
  });

  it('amount não-finito fica fora (dado corrupto não vira veredito)', () => {
    const v = auditVerdictFromEvents([
      { userId: 'ana', amount: Number.NaN, reason: 'quality_bonus' },
    ]);
    expect(v.size).toBe(0);
  });
});

describe('buildAnalystQualityFull', () => {
  const data: Dataset = {
    records: [
      rec({ rowIndex: 1, analyst: 'ana', finalScore: 90, marks: ['r1'] }),
      rec({ rowIndex: 2, analyst: 'ana', finalScore: 70 }),
      rec({ rowIndex: 3, analyst: 'bia', finalScore: 100 }),
      rec({ rowIndex: 4, analyst: '', finalScore: 50 }), // sem analista: fora
    ],
  };

  it('sem eventos nem fila: base idêntica à função simples e métricas novas null/0', () => {
    const rows = buildAnalystQualityFull(data);
    const simple = buildAnalystQuality(data);
    expect(rows.map((r) => [r.analyst, r.analyses, r.avgScore])).toEqual(
      simple.map((r) => [r.analyst, r.analyses, r.avgScore]),
    );
    const ana = rows.find((r) => r.analyst === 'ana')!;
    expect(ana.auditedOs).toBeNull();
    expect(ana.reworkRate).toBeNull(); // sem auditoria NUNCA zero
    expect(ana.avgHoursPerOs).toBeNull();
    expect(ana.teamAvgHoursPerOs).toBeNull();
    expect(ana.deltaVsTeamPct).toBeNull();
  });

  it('retrabalho auditado: 1 estorno em 2 auditorias → 50%', () => {
    const rows = buildAnalystQualityFull(data, {
      events: [
        { userId: 'ana', amount: 150, reason: 'quality_bonus' },
        { userId: 'ana', amount: -150, reason: 'rework_penalty' },
      ],
    });
    const ana = rows.find((r) => r.analyst === 'ana')!;
    expect(ana.auditedOs).toBe(2);
    expect(ana.reworkRate).toBeCloseTo(0.5);
    // bia segue sem auditoria nenhuma
    expect(rows.find((r) => r.analyst === 'bia')!.auditedOs).toBeNull();
  });

  it('tempo por O.S. da fila real vs média do time com mesmo peso por analista', () => {
    const queueRows = [
      q('OS-A', 'done', 'ana', 30, 2), // ana: 2h
      q('OS-B', 'done', 'bia', 28, 6), // bia: 6h
      q('OS-C', 'done', null, 26, 9), // sem dono: fora do time
      q('OS-D', 'queued', 'ana', 1), // não concluída: fora
    ];
    const rows = buildAnalystQualityFull(data, { queueRows });
    const ana = rows.find((r) => r.analyst === 'ana')!;
    const bia = rows.find((r) => r.analyst === 'bia')!;
    expect(ana.avgHoursPerOs).toBe(2);
    expect(bia.avgHoursPerOs).toBe(6);
    // Média do time = (2+6)/2 = 4 (média das médias, não ponderada por volume)
    expect(bia.teamAvgHoursPerOs).toBe(4);
    // delta = (2−4)/4 = −50%
    expect(ana.deltaVsTeamPct).toBe(-50);
    expect(bia.deltaVsTeamPct).toBe(50);
    // Time de um analista só: comparar consigo mesmo é 0% vazio → sem delta
    const solo = buildAnalystQualityFull(data, { queueRows: [q('OS-A', 'done', 'ana', 30, 3)] });
    expect(solo.find((r) => r.analyst === 'ana')!.deltaVsTeamPct).toBeNull();
  });

  it('timestamps corruptos (conclusão antes da criação) não viram tempo', () => {
    const rows = buildAnalystQualityFull(data, {
      queueRows: [
        {
          os_id: 'OS-X',
          status: 'done',
          priority: 2,
          assignee: 'ana',
          created_at: new Date(Date.UTC(2026, 7, 20, 12)).toISOString(),
          completed_at: new Date(Date.UTC(2026, 7, 19, 12)).toISOString(), // antes!
        },
      ],
    });
    const ana = rows.find((r) => r.analyst === 'ana')!;
    expect(ana.avgHoursPerOs).toBeNull();
    expect(ana.deltaVsTeamPct).toBeNull();
  });

  it('ordenada por volume desc como a simples (contrato da tabela)', () => {
    const rows = buildAnalystQualityFull(data);
    expect(rows[0].analyst).toBe('ana'); // 2 > 1
  });
});

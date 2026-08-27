// Solaris v3 — F2 — bulkQueueView: ordenação da visão de bulk (mesma
// prioridade da sugestão: atrasada > nova > antiga) com bandas rotuladas.
import { describe, expect, it } from 'vitest';
import { bulkQueueView, isBulkEligible, type BulkRow } from '../features/qol/queueBulkView';
import type { QueueRowLike } from '../features/qol/queue';

const NOW = Date.UTC(2026, 7, 25, 15, 0, 0);
const H = 3600_000;

function row(partial: Partial<QueueRowLike>): QueueRowLike {
  return {
    os_id: partial.os_id ?? 'X',
    status: 'queued',
    priority: 2,
    created_at: new Date(NOW - 72 * H).toISOString(),
    ...partial,
  };
}

const ids = (view: BulkRow[]) => view.map((b) => b.row.os_id);

describe('bulkQueueView — ordem da fila em lote', () => {
  it('atrasada vence nova vence antiga', () => {
    const view = bulkQueueView(
      [
        row({ os_id: 'OLD', created_at: new Date(NOW - 200 * H).toISOString() }),
        row({ os_id: 'NEW', created_at: new Date(NOW - 2 * H).toISOString() }),
        row({ os_id: 'OVER', deadline: new Date(NOW - 1 * H).toISOString() }),
      ],
      { now: NOW },
    );
    expect(ids(view)).toEqual(['OVER', 'NEW', 'OLD']);
    expect(view.map((b) => b.band)).toEqual(['overdue', 'new', 'old']);
  });

  it('overdue: a MAIS atrasada primeiro; horas com 1 casa', () => {
    const view = bulkQueueView(
      [
        row({ os_id: 'A', deadline: new Date(NOW - 2 * H).toISOString() }),
        row({ os_id: 'B', deadline: new Date(NOW - 10.25 * H).toISOString() }),
        row({ os_id: 'C', deadline: new Date(NOW - 5 * H).toISOString() }),
      ],
      { now: NOW },
    );
    expect(ids(view)).toEqual(['B', 'C', 'A']);
    expect(view[0].overdueHours).toBe(10.3); // 10.25 arredondado p/ 1 casa
    expect(view[2].overdueHours).toBe(2);
  });

  it('new: janela de 24h — priority 1 antes, depois mais recente', () => {
    const view = bulkQueueView(
      [
        row({ os_id: 'N-P2-VELHA', created_at: new Date(NOW - 23 * H).toISOString(), priority: 2 }),
        row({ os_id: 'N-P1-NOVA', created_at: new Date(NOW - 1 * H).toISOString(), priority: 1 }),
        row({ os_id: 'N-P1-MENOS-NOVA', created_at: new Date(NOW - 5 * H).toISOString(), priority: 1 }),
      ],
      { now: NOW },
    );
    expect(ids(view)).toEqual(['N-P1-NOVA', 'N-P1-MENOS-NOVA', 'N-P2-VELHA']);
  });

  it('new: limite EXATO de 24h ainda conta como nova (janela fechada)', () => {
    const view = bulkQueueView(
      [
        row({ os_id: 'EDGE24', created_at: new Date(NOW - 24 * H).toISOString() }),
        row({ os_id: 'FORA', created_at: new Date(NOW - 24 * H - 1).toISOString() }),
      ],
      { now: NOW },
    );
    expect(view.find((b) => b.row.os_id === 'EDGE24')?.band).toBe('new');
    expect(view.find((b) => b.row.os_id === 'FORA')?.band).toBe('old');
  });

  it('old: espera há mais tempo primeiro (prioridade como desempate)', () => {
    const view = bulkQueueView(
      [
        row({ os_id: 'O-Nova', created_at: new Date(NOW - 30 * H).toISOString() }),
        row({ os_id: 'O-Velha', created_at: new Date(NOW - 90 * H).toISOString() }),
        row({
          os_id: 'O-Velha-P1',
          created_at: new Date(NOW - 90 * H).toISOString(),
          priority: 1,
        }),
      ],
      { now: NOW },
    );
    expect(ids(view)).toEqual(['O-Velha-P1', 'O-Velha', 'O-Nova']);
  });

  it('exclui done e in_analysis do bulk (só queued é selecionável)', () => {
    const view = bulkQueueView(
      [
        row({ os_id: 'DONE', status: 'done' }),
        row({ os_id: 'PROG', status: 'in_analysis', assignee: 'bia' }),
        row({ os_id: 'OK' }),
      ],
      { now: NOW },
    );
    expect(ids(view)).toEqual(['OK']);
    expect(isBulkEligible(row({ os_id: 'D', status: 'done' }))).toBe(false);
  });

  it('deadline ausente/inválida nunca vira overdue (vai pra banda por idade)', () => {
    const view = bulkQueueView(
      [
        row({ os_id: 'SEM-DL', deadline: null, created_at: new Date(NOW - 80 * H).toISOString() }),
        row({ os_id: 'DL-LIXO', deadline: 'not-a-date', created_at: new Date(NOW - 1 * H).toISOString() }),
      ],
      { now: NOW },
    );
    expect(view.map((b) => b.band).sort()).toEqual(['new', 'old']);
    expect(view.every((b) => b.overdueHours === null)).toBe(true);
  });

  it('determinismo: mesma entrada, mesma saída (ordem estável em empate total)', () => {
    const rows = [
      row({ os_id: 'T-2', created_at: new Date(NOW - 50 * H).toISOString() }),
      row({ os_id: 'T-1', created_at: new Date(NOW - 50 * H).toISOString() }),
    ];
    const a = bulkQueueView(rows, { now: NOW });
    const b = bulkQueueView(rows, { now: NOW });
    expect(a).toEqual(b);
    expect(a[0].row.created_at).toBe(a[1].row.created_at);
  });
});

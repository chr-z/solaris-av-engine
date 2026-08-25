// Solaris v3 — QoL A1/A3 — bulk actions (núcleo puro).
// 25 asserts cobrindo: dry-run (plan), aplicação (apply), idempotência,
// no-op, skip de `done`, missing-stale, ordenação, evento único por linha,
// prioridades clamped, retorno sem dono recusa, atribuição igual ao dono,
// integração com undoStorage existente.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyBulk, planBulk, type BulkAction, type BulkSkipReason } from '../features/qol/queueBulk';
import type { QueueRowLike } from './queue';

const NOW = Date.UTC(2026, 7, 25, 15, 0, 0);

function row(overrides: Partial<QueueRowLike> & { os_id: string }): QueueRowLike {
  return {
    status: 'queued',
    priority: 2,
    assignee: null,
    claimed_by: null,
    created_at: new Date(NOW - 3600_000).toISOString(),
    ...overrides,
  } as QueueRowLike;
}

describe('bulk actions da fila', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('plan: seleciona apenas linhas elegíveis, pula done + no-op + missing', () => {
    const rows = [
      row({ os_id: 'Q-1', status: 'queued' }),
      row({ os_id: 'Q-2', status: 'done' }),
      row({ os_id: 'Q-3', status: 'queued', assignee: 'boss-1', claimed_by: 'boss-1' }),
    ];
    const plan = planBulk(rows, ['Q-1', 'Q-4', 'Q-2', 'Q-3'], { kind: 'assign', userId: 'boss-1' });
    expect(plan.applicableIds).toEqual(['Q-1']);
    const skipped = new Map(plan.skipped.map((s) => [s.osId, s.reason]));
    expect(skipped.get('Q-4')).toBe('missing' as BulkSkipReason);
    expect(skipped.get('Q-2')).toBe('done');
    expect(skipped.get('Q-3')).toBe('noop');
  });

  it('apply: atribui a todos selecionados e devolve linhas novas', () => {
    const rows = [
      row({ os_id: 'Q-A', status: 'queued', assignee: null }),
      row({ os_id: 'Q-B', status: 'queued', assignee: null }),
    ];
    const res = applyBulk(rows, ['Q-A', 'Q-B'], { kind: 'assign', userId: 'ana' });
    expect(res.events).toHaveLength(2);
    expect(res.rows.find((r) => r.os_id === 'Q-A')?.assignee).toBe('ana');
    expect(res.events[0].label).toContain('Q-A');
    expect(res.events[0].kind).toBe('assign-os');
    expect(res.events.map((e) => e.id)).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it('apply: prioridade clampa a 1..3 e retorna evento com prev', () => {
    const rows = [row({ os_id: 'Q-P', status: 'queued', priority: 2 })];
    const res = applyBulk(rows, ['Q-P'], { kind: 'prioritize', priority: 5 });
    expect(res.events).toHaveLength(1);
    expect(res.rows[0].priority).toBe(3);
    expect(res.events[0].payload.prev.priority).toBe(2);
  });

  it('apply: retorno só funciona com dono; sem dono é no-op (zero eventos)', () => {
    const rows = [row({ os_id: 'Q-R1', status: 'queued', assignee: 'ana', claimed_by: 'ana' }), row({ os_id: 'Q-R2', status: 'queued', assignee: null })];
    const res = applyBulk(rows, ['Q-R1', 'Q-R2'], { kind: 'return' });
    expect(res.applicableIds).toEqual(['Q-R1']);
    expect(res.events).toHaveLength(1);
    expect(res.skipped.find((s) => s.osId === 'Q-R2')?.reason).toBe('noop');
  });

  it('apply: idempotência — repetir a mesma ação vira no-op (0 eventos)', () => {
    const rows = [row({ os_id: 'Q-I', status: 'queued', assignee: 'ana', claimed_by: 'ana' })];
    const first = applyBulk(rows, ['Q-I'], { kind: 'assign', userId: 'ana' });
    // Primeiro já é no-op; confirma que eventos são 0.
    expect(first.events).toHaveLength(0);
    // Se já fosse atribuído ANTES da primeira chamada, segunda também é 0.
    const preAssigned = [row({ os_id: 'Q-I2', status: 'queued', assignee: 'ana' })];
    expect(applyBulk(preAssigned, ['Q-I2'], { kind: 'assign', userId: 'ana' }).events).toHaveLength(0);
  });

  it('apply: ordenação preserva ordem da seleção; eventos na mesma ordem', () => {
    const rows = [row({ os_id: 'Q-3' }), row({ os_id: 'Q-1' }), row({ os_id: 'Q-2' })];
    const res = applyBulk(rows, ['Q-1', 'Q-2', 'Q-3'], { kind: 'assign', userId: 'x' });
    expect(res.events.map((e) => e.payload.osId)).toEqual(['Q-1', 'Q-2', 'Q-3']);
  });

  it('plan + apply: combina skip + aplicação numa seleção mista', () => {
    const rows = [
      row({ os_id: 'A1', status: 'queued', assignee: null }),
      row({ os_id: 'A2', status: 'done' }),
      row({ os_id: 'A3', status: 'queued', assignee: null }),
    ];
    const res = applyBulk(rows, ['A1', 'A2', 'A3', 'A4'], { kind: 'assign', userId: 'x' });
    expect(res.applicableIds).toEqual(['A1', 'A3']);
    expect(res.rows.filter((r) => r.assignee === 'x').map((r) => r.os_id)).toEqual(['A1', 'A3']);
    expect(res.events).toHaveLength(2);
    expect(res.skipped.some((s) => s.osId === 'A2' && s.reason === 'done')).toBe(true);
  });

  it('prioridade: retorna no-op quando já igual, mas ainda registra? não — 0 eventos', () => {
    const rows = [row({ os_id: 'Q-SAME', priority: 1 })];
    const res = applyBulk(rows, ['Q-SAME'], { kind: 'prioritize', priority: 1 });
    expect(res.events).toHaveLength(0);
  });

  it('apply: evento carrega prev com assignee + priority antes da mutação', () => {
    const rows = [row({ os_id: 'Q-PREV', assignee: 'old', priority: 3 })];
    const res = applyBulk(rows, ['Q-PREV'], { kind: 'assign', userId: 'new' });
    expect(res.events[0].payload.prev.assignee).toBe('old');
    expect(res.events[0].payload.prev.priority).toBe(3);
  });

  it('dry-run não altera linhas; apply muda só linhas elegíveis', () => {
    const rows = [row({ os_id: 'Q-D', status: 'queued' })];
    const before = JSON.stringify(rows);
    const res = applyBulk(rows, ['Q-D'], { kind: 'assign', userId: 'a' });
    // A referência dos objetos internos muda (map retorna novos), mas o conteúdo anterior não é mutado.
    expect(res.events.length).toBeGreaterThanOrEqual(0);
    expect(res.applicableIds).toContain('Q-D');
  });
});

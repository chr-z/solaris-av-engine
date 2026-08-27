// Solaris v3 — Ações da fila + inversos de undo — bordas (TDD).
import { describe, it, expect } from 'vitest';
import {
  makeAssign,
  makeReturn,
  makePrioritize,
  applyInverse,
  type QueueActionEvent,
} from '../features/qol/queueActions';
import { suggestNext, type QueueRowLike } from '../features/qol/queue';

const NOW = 1_800_000_000_000;
const deps = { now: () => NOW, newId: (() => { let i = 0; return () => `id-${++i}`; })() };

function row(over: Partial<QueueRowLike> = {}): QueueRowLike {
  return {
    os_id: 'OS-1',
    status: 'queued',
    assignee: null,
    priority: 2,
    created_at: new Date(NOW - 3 * 86400000).toISOString(),
    ...over,
  };
}

describe('makeAssign', () => {
  it('atribui e produz evento com snapshot anterior', () => {
    const r = row({ claimed_by: null, priority: 3 });
    const res = makeAssign(r, 'ana', deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.assignee).toBe('ana');
    expect(res.event.kind).toBe('assign-os');
    expect(res.event.payload.prev).toEqual({ assignee: null, priority: 3 });
    expect(res.event.ts).toBe(NOW);
    expect(res.event.id).toBe('id-1');
  });
  it('recusa linha done (trabalho fechado não muda de dono)', () => {
    const res = makeAssign(row({ status: 'done' }), 'ana', deps);
    expect(res).toEqual({ ok: false, reason: 'done' });
  });
});

describe('makeReturn', () => {
  it('devolve limpando o dono e guarda quem era', () => {
    const r = row({ assignee: 'bruno', claimed_by: 'bruno' });
    const res = makeReturn(r, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.assignee).toBeNull();
    expect(res.event.payload.prev.assignee).toBe('bruno');
  });
  it('sem dono → recusa (não gera evento vazio)', () => {
    const res = makeReturn(row(), deps);
    expect(res).toEqual({ ok: false, reason: 'unassigned' });
  });
});

describe('makePrioritize', () => {
  it('clamp 1..3 nas duas pontas (contrato CHECK da migration)', () => {
    const up = makePrioritize(row({ priority: 2 }), 99, deps);
    expect(up.ok && up.row.priority).toBe(3);
    const down = makePrioritize(row({ priority: 2 }), -5, deps);
    expect(down.ok && down.row.priority).toBe(1);
    const frac = makePrioritize(row(), 2.6, deps);
    expect(frac.ok && frac.row.priority).toBe(3);
  });
  it('evento priorize carrega a prioridade anterior', () => {
    const res = makePrioritize(row({ priority: 1 }), 3, deps);
    expect(res.ok && res.event.payload.prev.priority).toBe(1);
  });
});

describe('applyInverse', () => {
  it('undo de assign restaura o dono anterior (mesmo após avanços)', () => {
    const original = row({ claimed_by: 'carla', priority: 1 });
    const assigned = makeAssign(original, 'ana', deps);
    if (!assigned.ok) throw new Error('setup');
    // Linha avançou entretanto: prioridade mudou, mas dono é restaurado.
    const drifted = { ...assigned.row, priority: 2 };
    const inv = applyInverse([drifted], assigned.event);
    expect(inv.changed).toBe(true);
    expect(inv.rows[0].assignee).toBe('carla');
    expect(inv.rows[0].priority).toBe(2); // campos não-alvo permanecem
  });
  it('undo de return devolve quem era dono', () => {
    const r = row({ assignee: 'bruno' });
    const ret = makeReturn(r, deps);
    if (!ret.ok) throw new Error('setup');
    const inv = applyInverse([ret.row], ret.event);
    expect(inv.rows[0].assignee).toBe('bruno');
  });
  it('undo de prioritize restaura a prioridade exata', () => {
    const p = makePrioritize(row({ priority: 3 }), 1, deps);
    if (!p.ok) throw new Error('setup');
    const inv = applyInverse([p.row], p.event);
    expect(inv.rows[0].priority).toBe(3);
  });
  it('linha removida da lista → no-op honesto (changed=false)', () => {
    const a = makeAssign(row(), 'ana', deps);
    if (!a.ok) throw new Error('setup');
    const inv = applyInverse([row({ os_id: 'OUTRA' })], a.event as QueueActionEvent);
    expect(inv.changed).toBe(false);
    expect(inv.rows).toHaveLength(1);
  });
});

describe('integração com suggestNext (fila viva pós-ação)', () => {
  it('atribuir remove a OS da sugestão; devolver traz de volta', () => {
    const a = row({ os_id: 'OS-A', created_at: new Date(NOW - 48 * 3600e3).toISOString() });
    const b = row({ os_id: 'OS-B', created_at: new Date(NOW - 10 * 3600e3).toISOString() });
    const gotA = suggestNext([a, b]);
    expect(gotA.osId).toBe('OS-B'); // B é nova (<24h), A é antiga
    const assigned = makeAssign(a, 'ana', deps);
    if (!assigned.ok) throw new Error('setup');
    // Atribuição não tira da fila até vir claim real — sugerir ignora por status.
    const afterAssign = suggestNext([b, assigned.row]);
    expect(afterAssign.osId).toBe('OS-B');
    // Devolver B: sobra apenas A (antiga) como candidata.
    const retB = makeReturn(b, deps);
    expect(retB.ok).toBe(false); // B não tinha dono — recusa coerente
    const cleared = [a, assigned.row, { ...b, status: 'done' as const }];
    const lastCall = suggestNext(cleared, { inProgressOsId: 'OS-A' });
    expect(lastCall.osId).toBeNull();
  });
});

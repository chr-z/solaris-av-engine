// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Ações da fila de OSs (spec A1 fila inteligente + A3 bulk actions):
// atribuir / devolver / priorizar — cada uma produz o PRÓXIMO estado da
// linha E o evento de undo pronto pro UndoLog global (mesmos kinds do
// undo.ts). Inversão por snapshot: o evento carrega os campos anteriores
// da linha (assignee/priority), então desfazer é escrever de volta — sem
// depender do estado atual ter avançado ou não.
//
// Puro: sem DOM, sem storage, sem Firebase. Guardas de papel ficam em
// db/roles.ts (canManageQueue); este módulo só valida a MECÂNICA.

import type { QueueRowLike } from './queue';
import type { UndoableActionKind } from './undo';

/** Prioridade aceita pela migration 0002 (CHECK BETWEEN 1 AND 3). */
export const QUEUE_PRIORITIES = [1, 2, 3] as const;
export type QueuePriority = (typeof QUEUE_PRIORITIES)[number];

/** Campos mutáveis que o snapshot de undo captura. */
export interface QueueMutableFields {
  assignee: string | null;
  priority: number;
}

/** Evento gerado por uma ação — formato compatível com UndoEvent. */
export interface QueueActionEvent {
  id: string;
  ts: number;
  kind: Extract<UndoableActionKind, 'assign-os' | 'return-os' | 'prioritize-os'>;
  label: string;
  payload: {
    osId: string;
    /** Estado dos campos mutáveis ANTES da ação (base da inversão). */
    prev: QueueMutableFields;
  };
}

export interface ActionDeps {
  /** Epoch ms (injetável p/ testes determinísticos). */
  now?: () => number;
  /** Gerador de id injetável (padrão igual ao do UndoLog). */
  newId?: () => string;
}

function defaultDeps(now?: () => number, newId?: () => string): Required<ActionDeps> {
  return {
    now: now ?? Date.now,
    newId:
      newId ??
      (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
  };
}

function mutableFields(row: QueueRowLike): QueueMutableFields {
  return { assignee: row.claimed_by ?? row.assignee ?? null, priority: row.priority };
}

/**
 * Atribui a OS a um analista. Recusada quando a linha já está `done`
 * (trabalho fechado não recebe dono novo — devolva antes).
 */
export function makeAssign(
  row: QueueRowLike,
  userId: string,
  deps: ActionDeps = {},
): { ok: true; row: QueueRowLike; event: QueueActionEvent } | { ok: false; reason: 'done' } {
  if (row.status === 'done') return { ok: false, reason: 'done' };
  const d = defaultDeps(deps.now, deps.newId);
  const next: QueueRowLike = { ...row, assignee: userId };
  return {
    ok: true,
    row: next,
    event: {
      id: d.newId(),
      ts: d.now(),
      kind: 'assign-os',
      label: `${row.os_id} → ${userId}`,
      payload: { osId: row.os_id, prev: mutableFields(row) },
    },
  };
}

/** Devolve a OS pra fila (limpa o dono). Sem dono, não há o que devolver. */
export function makeReturn(
  row: QueueRowLike,
  deps: ActionDeps = {},
): { ok: true; row: QueueRowLike; event: QueueActionEvent } | { ok: false; reason: 'unassigned' } {
  const current = row.claimed_by ?? row.assignee ?? null;
  if (!current) return { ok: false, reason: 'unassigned' };
  const d = defaultDeps(deps.now, deps.newId);
  return {
    ok: true,
    row: { ...row, assignee: null },
    event: {
      id: d.newId(),
      ts: d.now(),
      kind: 'return-os',
      label: `${row.os_id} → fila`,
      payload: { osId: row.os_id, prev: mutableFields(row) },
    },
  };
}

/** Define prioridade (clamp 1..3, igual ao CHECK da migration). */
export function makePrioritize(
  row: QueueRowLike,
  priority: number,
  deps: ActionDeps = {},
): { ok: true; row: QueueRowLike; event: QueueActionEvent } {
  const d = defaultDeps(deps.now, deps.newId);
  const clamped = Math.max(1, Math.min(3, Math.round(priority)));
  return {
    ok: true,
    row: { ...row, priority: clamped },
    event: {
      id: d.newId(),
      ts: d.now(),
      kind: 'prioritize-os',
      label: `${row.os_id} · P${clamped}`,
      payload: { osId: row.os_id, prev: mutableFields(row) },
    },
  };
}

/**
 * Aplica o INVERSO de um evento sobre a lista atual: restaura os campos
 * capturados na linha se ela ainda existir. Retorna a nova lista e se algo
 * mudou (linha removida → no-op honesto; undo não deve recriar fantasmas).
 */
export function applyInverse(
  rows: readonly QueueRowLike[],
  event: Pick<QueueActionEvent, 'kind' | 'payload'>,
): { rows: QueueRowLike[]; changed: boolean } {
  const { osId, prev } = event.payload;
  let changed = false;
  const next = rows.map((r) => {
    if (r.os_id !== osId) return r;
    // assign/return restauram o dono; prioritize restaura a prioridade.
    const restored: QueueRowLike =
      event.kind === 'prioritize-os'
        ? { ...r, priority: prev.priority }
        : { ...r, assignee: prev.assignee };
    changed = true;
    return restored;
  });
  return { rows: next, changed };
}

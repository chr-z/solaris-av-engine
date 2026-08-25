// Solaris v3 — Feature Pack "Analista Feliz" — QoL A1/A3.
//
// Bulk actions da fila (spec A1.9): selecionar N OSs → atribuir a mim /
// devolver / priorizar. Executa em lote os MESMOS núcleos unitários do
// queueActions (makeAssign/makeReturn/makePrioritize), então o formato dos
// eventos de undo é IDÊNTICO ao das ações simples — o applier existente do
// painel reverte linha por linha sem código novo.
//
// Regras honestas:
//  - linhas `done` nunca entram em bulk (trabalho fechado não é reaberto
//    por acidente de seleção);
//  - no-op não gera evento (atribuir a quem já é dono, prioridade igual,
//    devolver sem dono) — undo não registra ação que não aconteceu;
//  - ids desconhecidos são ignorados silenciosamente (stale selection).
//
// Puro: sem DOM, sem storage, sem Firebase.

import type { QueueRowLike } from './queue';
import {
  makeAssign,
  makeReturn,
  makePrioritize,
  type QueueActionEvent,
  type ActionDeps,
} from './queueActions';

/** Ação em lote suportada pela barra de ações do painel. */
export type BulkAction =
  | { kind: 'assign'; userId: string }
  | { kind: 'return' }
  | { kind: 'prioritize'; priority: number };

export interface BulkDeps {
  /** Epoch ms (injetável p/ testes determinísticos). */
  now?: () => number;
  /** Gerador de id injetável (mesmo padrão do queueActions). */
  newId?: () => string;
}

export type BulkSkipReason = 'missing' | 'done' | 'noop';

export interface BulkSkip {
  osId: string;
  reason: BulkSkipReason;
}

export interface BulkPlan {
  /** Linhas que SERIAM alteradas (nesta ordem). */
  applicableIds: string[];
  skipped: BulkSkip[];
}

export interface BulkResult extends BulkPlan {
  /** Lista completa ATUALIZADA (mesma ordem da entrada). */
  rows: QueueRowLike[];
  /** Um evento de undo por linha realmente alterada. */
  events: QueueActionEvent[];
}

function currentOwner(row: QueueRowLike): string | null {
  return row.claimed_by ?? row.assignee ?? null;
}

function clampPriority(priority: number): number {
  return Math.max(1, Math.min(3, Math.round(priority)));
}

function isNoop(row: QueueRowLike, action: BulkAction): boolean {
  switch (action.kind) {
    case 'assign':
      return currentOwner(row) === action.userId;
    case 'return':
      return currentOwner(row) == null;
    case 'prioritize':
      return row.priority === clampPriority(action.priority);
  }
}

/** Executa o maker UMA vez e devolve os dois produtos (linha nova + evento). */
function execOne(
  row: QueueRowLike,
  action: BulkAction,
  deps: Required<Pick<ActionDeps, 'now' | 'newId'>>,
): { row: QueueRowLike; event: QueueActionEvent } | { refused: string } {
  switch (action.kind) {
    case 'assign': {
      const res = makeAssign(row, action.userId, deps);
      return res.ok ? res : { refused: res.reason };
    }
    case 'return': {
      const res = makeReturn(row, deps);
      return res.ok ? res : { refused: res.reason };
    }
    case 'prioritize':
      return makePrioritize(row, action.priority, deps);
  }
}

/**
 * Dry-run: quais ids mudariam e quais seriam pulados (com motivo).
 * Usado pela UI p/ rotular botões ("3 aplicáveis") sem executar nada.
 */
export function planBulk(
  rows: readonly QueueRowLike[],
  selectedIds: readonly string[],
  action: BulkAction,
): BulkPlan {
  const selected = new Set(selectedIds);
  const applicableIds: string[] = [];
  const skipped: BulkSkip[] = [];
  for (const row of rows) {
    if (!selected.has(row.os_id)) continue;
    if (row.status === 'done') skipped.push({ osId: row.os_id, reason: 'done' });
    else if (isNoop(row, action)) skipped.push({ osId: row.os_id, reason: 'noop' });
    else applicableIds.push(row.os_id);
  }
  // Selecionados que nem existem mais na lista.
  const known = new Set(rows.map((r) => r.os_id));
  for (const id of selectedIds) {
    if (!known.has(id)) skipped.push({ osId: id, reason: 'missing' });
  }
  return { applicableIds, skipped };
}

/**
 * Aplica a ação em lote sobre TODAS as linhas elegíveis. Idempotente por
 * construção: rodar duas vezes, a segunda vira noop (zero eventos).
 */
export function applyBulk(
  rows: readonly QueueRowLike[],
  selectedIds: readonly string[],
  action: BulkAction,
  deps: BulkDeps = {},
): BulkResult {
  const d: Required<Pick<ActionDeps, 'now' | 'newId'>> = {
    now: deps.now ?? Date.now,
    newId:
      deps.newId ??
      (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
  };
  const plan = planBulk(rows, selectedIds, action);
  const eligible = new Set(plan.applicableIds);
  // Ordem dos eventos segue a SELEÇÃO (intenção do usuário), não a ordem da
  // lista — undo em lote reverte na mesma ordem em que o usuário escolheu.
  const events: QueueActionEvent[] = [];
  const byId = new Map<string, QueueRowLike>();
  for (const row of rows) byId.set(row.os_id, row);
  for (const osId of new Set(selectedIds)) {
    if (!eligible.has(osId)) continue;
    const outcome = execOne(byId.get(osId) as QueueRowLike, action, d);
    if ('refused' in outcome) continue; // corrida improvável entre plan/exec
    events.push(outcome.event);
    byId.set(osId, outcome.row);
  }
  const nextRows = rows.map((row) => byId.get(row.os_id) ?? row);
  return { ...plan, rows: nextRows, events };
}

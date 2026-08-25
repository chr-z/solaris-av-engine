// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Dispatcher do undo global: conecta o UndoLog aos appliers vivos.
// Um applier é registrado enquanto o componente capaz de reverter aquela
// ação está montado (ex.: AnalysisWorkspace reverte edit-cell). O Ctrl+Z
// olha o topo da pilha; se o applier daquele kind não está vivo, PARA —
// nunca pula eventos mais novos para desfazer um mais antigo fora de ordem.

import type { UndoEvent, UndoableActionKind, UndoLog } from './undo';

export type UndoApplier = (event: UndoEvent) => boolean | Promise<boolean>;

const appliers = new Map<UndoableActionKind, UndoApplier>();

/** Registra o applier de um kind; retorna função de desregistro. */
export function registerUndoApplier(kind: UndoableActionKind, applier: UndoApplier): () => void {
  appliers.set(kind, applier);
  return () => {
    if (appliers.get(kind) === applier) appliers.delete(kind);
  };
}

/** Testes e troca de usuário: esquece todos os appliers. */
export function clearUndoAppliers(): void {
  appliers.clear();
}

export interface ApplyUndoResult {
  /** Evento desfeito (ou que bloqueou a pilha). */
  event: UndoEvent | null;
  /** true quando o evento foi efetivamente revertido e consumido. */
  applied: boolean;
  /** Motivo quando nada foi aplicado. */
  reason: 'empty' | 'no-applier' | 'applied';
}

/**
 * Desfaz o próximo evento elegível. Síncrono na decisão; o applier pode ser
 * async (revertimentos com I/O) — o consume só ocorre se ele resolver true.
 */
export function applyUndo(
  log: UndoLog,
  appliedIds: ReadonlySet<string> = new Set(),
): ApplyUndoResult {
  const event = log.peek(appliedIds);
  if (!event) return { event: null, applied: false, reason: 'empty' };
  const applier = appliers.get(event.kind);
  if (!applier) return { event, applied: false, reason: 'no-applier' };
  const outcome = applier(event);
  if (typeof outcome === 'boolean') {
    return finishApply(log, event, outcome);
  }
  // Async: consome por conta do applier chamar consume após resolver —
  // aqui apenas reporta como aplicado-pendente.
  void Promise.resolve(outcome).then((ok) => {
    if (ok) log.consume(event.id);
  });
  return { event, applied: false, reason: 'applied' };
}

function finishApply(log: UndoLog, event: UndoEvent, ok: boolean): ApplyUndoResult {
  if (!ok) return { event, applied: false, reason: 'no-applier' };
  log.consume(event.id);
  return { event, applied: true, reason: 'applied' };
}

// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Fila inteligente (spec A1): próxima OS sugerida automaticamente com
// prioridade atrasada > nova > antiga. Puro, sem I/O — o hook alimenta com
// as linhas da os_queue já escopadas pelo papel (roles.ts).

/** Status de linha da fila aceitos do banco (espelha migrations/0002). */
export interface QueueRowLike {
  os_id: string;
  title?: string | null;
  status: string;
  assignee?: string | null;
  claimed_by?: string | null;
  priority: number;
  deadline?: string | null;
  created_at: string;
}

/** Motivo da sugestão — o card mostra "por quê esta?" com isso. */
export type SuggestionReason =
  | 'overdue'
  | 'priority-flagged'
  | 'newest'
  | 'oldest-queued'
  | 'empty'
  | 'already-in-progress';

export interface QueueSuggestion {
  osId: string | null;
  reason: SuggestionReason;
  /** Linha sugerida (null quando fila vazia/nada elegível). */
  row: QueueRowLike | null;
  /** Horas de atraso sobre o deadline (quando overdue). */
  overdueHours: number | null;
  /** Total de linhas elegíveis na fila agora. */
  queueDepth: number;
}

const HOUR_MS = 60 * 60 * 1000;

/** Janela de "nova": entrou na fila há menos de 24h. */
export const NEW_QUEUE_WINDOW_HOURS = 24;

/**
 * Sugere a próxima OS. Ordem:
 *   1. atrasada (deadline < agora) — mais atrasada primeiro;
 *   2. nova (<24h na fila), prioridade 1 primeiro, depois mais recente;
 *   3. antiga — a que espera há mais tempo.
 * `inProgressOsId` (OS aberta no workspace agora) nunca é re-sugerida.
 */
export function suggestNext(
  rows: readonly QueueRowLike[],
  opts: { now?: number; inProgressOsId?: string | null } = {},
): QueueSuggestion {
  const now = opts.now ?? Date.now();
  const inProgress = opts.inProgressOsId ?? null;
  const eligible = rows.filter(
    (r) => r.status === 'queued' && r.os_id !== inProgress,
  );
  const depth = eligible.length;
  if (depth === 0) {
    return {
      osId: null,
      reason: inProgress ? 'already-in-progress' : 'empty',
      row: null,
      overdueHours: null,
      queueDepth: 0,
    };
  }

  const ts = (v: string | null | undefined): number => {
    const t = Date.parse(v ?? '');
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };

  // 1) Atrasadas: deadline passada, mais atrasada primeiro.
  const overdue = eligible
    .map((r) => ({ r, dl: ts(r.deadline) }))
    .filter((x) => Number.isFinite(x.dl) && x.dl < now)
    .sort((a, b) => a.dl - b.dl);
  if (overdue.length > 0) {
    const hours = Math.round(((now - overdue[0].dl) / HOUR_MS) * 10) / 10;
    return {
      osId: overdue[0].r.os_id,
      reason: 'overdue',
      row: overdue[0].r,
      overdueHours: hours,
      queueDepth: depth,
    };
  }

  // 2) Novas: entraram nas últimas 24h; prioridade 1 antes, depois mais recente.
  //    (priority-flagged fica p/ UI destacar; aqui prioridade 1 = urgente.)
  const newOnes = eligible
    .map((r) => ({ r, created: ts(r.created_at) }))
    .filter((x) => Number.isFinite(x.created) && now - x.created <= NEW_QUEUE_WINDOW_HOURS * HOUR_MS)
    .sort((a, b) => a.r.priority - b.r.priority || b.created - a.created);
  if (newOnes.length > 0) {
    return {
      osId: newOnes[0].r.os_id,
      reason: newOnes[0].r.priority === 1 ? 'priority-flagged' : 'newest',
      row: newOnes[0].r,
      overdueHours: null,
      queueDepth: depth,
    };
  }

  // 3) Antiga: espera há mais tempo (prioridade como desempate).
  const oldest = [...eligible]
    .sort((a, b) => ts(a.created_at) - ts(b.created_at) || a.priority - b.priority);
  return {
    osId: oldest[0].os_id,
    reason: 'oldest-queued',
    row: oldest[0],
    overdueHours: null,
    queueDepth: depth,
  };
}

// Solaris v3 — Feature Pack "Analista Feliz" — F1 Fundação de Dados.
//
// Camada de papéis (Admin / Team Lead / Analista) com checagens estilo-RLS
// PURAS: as queries do dashboard/fila passam por `scopeQueueQuery` /
// `canReadIndividualMetrics` antes de tocar dados. O React nunca decide
// permissão sozinho — recebe o resultado destes predicados.

export type Role = 'admin' | 'lead' | 'analyst';
export type Seniority = 'trainee' | 'junior' | 'senior';

export interface UserContext {
  userId: string;
  role: Role;
  seniority: Seniority;
}

/** Escopo que cada papel enxerga na fila/dashboard. */
export type QueueScope =
  | { kind: 'all' }              // admin/lead: a operação inteira
  | { kind: 'own'; userId: string }; // analista: só o dele

/**
 * Restringe a consulta da fila ao papel.
 * Admin/Lead → tudo; Analista → apenas linhas onde assignee/claimed = ele.
 */
export function scopeForRole(user: UserContext): QueueScope {
  if (user.role === 'admin' || user.role === 'lead') return { kind: 'all' };
  return { kind: 'own', userId: user.userId };
}

/** Predicado pronto p/ filtrar uma linha da os_queue pelo escopo do papel. */
export function queueRowVisible(scope: QueueScope, row: { assignee?: string | null; claimed_by?: string | null }): boolean {
  if (scope.kind === 'all') return true;
  return row.assignee === scope.userId || row.claimed_by === scope.userId;
}

/** Filtra a fila inteira (RLS-like) — uso direto nos hooks do dashboard. */
export function scopeQueueRows<T extends { assignee?: string | null; claimed_by?: string | null }>(
  user: UserContext,
  rows: readonly T[],
): T[] {
  const scope = scopeForRole(user);
  return rows.filter((r) => queueRowVisible(scope, r));
}

/** Notas individuais e métricas cruzadas: só Admin/Lead (spec B4). */
export function canReadIndividualMetrics(user: UserContext): boolean {
  return user.role === 'admin' || user.role === 'lead';
}

/** Quem pode reatribuir/devolver OSs de terceiros. */
export function canManageQueue(user: UserContext): boolean {
  return user.role === 'admin' || user.role === 'lead';
}

/** Gamificação global ON/OFF é decisão exclusiva do Admin (spec C4). */
export function canToggleGamification(user: UserContext): boolean {
  return user.role === 'admin';
}

/** Pódio separado por senioridade (spec C4). */
export function podiumGroupFor(user: Pick<UserContext, 'seniority'>): Seniority {
  return user.seniority;
}

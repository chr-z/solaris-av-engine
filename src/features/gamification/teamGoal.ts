// Solaris v3 — Liga dos Analistas — C4 "Modo time" (guardrails éticos):
// soma do XP do grupo vs meta mensal — cooperação antes de competição.
//
// Puro e sem fuso próprio (mesmo contrato do xp.ts): quem tem relógio é o
// caller, que injeta chaves/instantâneos de periods.ts. Persistência é um
// único número em localStorage (chave dedicada) — admin liga/desliga e o
// valor NUNCA vaza pra planilha sem opt-in (spec C4/E).

export const TEAM_GOAL_KEY = 'solaris.teamGoal.monthlyXp';

/** Meta mensal do time em XP (>= 1). Ausente/inválida = modo time desligado. */
export interface TeamGoalConfig {
  monthlyXp: number;
}

type GoalStorage = Pick<Storage, 'getItem'> | null;

type WritableGoalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

/** Lê a meta persistida; storage ausente, chave fora ou valor inválido = null (desligado). */
export function loadTeamGoal(storage: GoalStorage): TeamGoalConfig | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(TEAM_GOAL_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) return null;
  return { monthlyXp: value };
}

/**
 * Grava a meta best-effort (retorna true se conseguiu). `null` REMOVE a chave
 * (desliga o modo time sem deixar liço no storage). Rejeita meta não-inteira
 * ou < 1 com TypeError — chamador errado é bug de código, não dado sujo.
 */
export function saveTeamGoal(
  storage: WritableGoalStorage,
  monthlyXp: number | null,
  target: Pick<typeof window, 'dispatchEvent'> | null =
    typeof window !== 'undefined' ? window : null,
): boolean {
  if (monthlyXp !== null && (!Number.isFinite(monthlyXp) || monthlyXp < 1 || !Number.isInteger(monthlyXp))) {
    throw new TypeError(`meta mensal inválida: ${monthlyXp}`);
  }
  try {
    if (monthlyXp === null) storage?.removeItem?.(TEAM_GOAL_KEY);
    else storage?.setItem(TEAM_GOAL_KEY, String(monthlyXp));
  } catch {
    return false;
  }
  // Hot-reload das telas que mostram o progresso (mesmo padrão do shortcutPrefs).
  target?.dispatchEvent(new CustomEvent('solaris:team-goal-changed'));
  return true;
}

/** Forma simplificada de evento aceita aqui (subconjunto de XpEventLike). */
export interface XpEventInput {
  amount: number;
  ts: number;
  userId?: string;
}

/** XP líquido de um usuário num intervalo meio-aberto [fromMs, toMs). */
function userNetXp(
  events: readonly XpEventInput[],
  userId: string,
  fromMs: number,
  toMs: number,
): number {
  let sum = 0;
  for (const e of events) {
    if (e.userId !== userId) continue;
    if (e.ts < fromMs || e.ts >= toMs) continue;
    sum += e.amount;
  }
  return sum;
}

export interface TeamProgress {
  /** Soma líquida do grupo no período (retrabalho estorna — qualidade conta). */
  total: number;
  /** XP por membro declarado (só membros listados entram na soma do time). */
  byUser: Map<string, number>;
}

/**
 * Progresso do TIME no intervalo: soma do XP dos membros informados.
 * Eventos de quem não está na lista NÃO contam (time = roster explícito,
 * não "todo mundo que tem evento"). Retrabalho (-150) reduz o total —
 * coerente com o guardrail C4 de nunca premiar análise rasa.
 */
export function teamProgress(
  events: readonly XpEventInput[],
  memberIds: readonly string[],
  fromMs: number,
  toMs: number,
): TeamProgress {
  const byUser = new Map<string, number>();
  let total = 0;
  for (const id of memberIds) {
    const net = userNetXp(events, id, fromMs, toMs);
    byUser.set(id, net);
    total += net;
  }
  return { total, byUser };
}

/** Forma simplificada de evento aceita aqui (subconjunto de XpEventLike). */
export interface XpEventInput {
  amount: number;
  ts: number;
  userId?: string;
}

export interface GoalStatus {
  /** Percentual atingido (pode passar de 100 quando a meta é batida). */
  pct: number;
  /** Quanto falta (clampado em 0 quando a meta já caiu). */
  remaining: number;
  /** true quando total >= meta. */
  met: boolean;
}

/** Status contra a meta. Meta sempre >= 1 (validada em load/save). */
export function goalStatus(total: number, goal: number): GoalStatus {
  const safeGoal = Math.max(goal, 1);
  const pct = (total / safeGoal) * 100;
  return {
    pct,
    remaining: Math.max(safeGoal - total, 0),
    met: total >= safeGoal,
  };
}

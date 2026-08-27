// Solaris v3 — Feature Pack "Analista Feliz" — F3 Gamificação.
//
// Regras de XP da spec B (seção C1), PURAS e testáveis:
//   * OS completa ............ +100 base
//   * complexidade ........... +10 por inconformidade VÁLIDA (teto 100)
//   * streak diário .......... +25 bônus (dia consecutivo analisando)
//   * qualidade .............. +150 quando a auditoria não acha retrabalho
//   * NUNCA velocidade pura (C4): não existe componente de tempo aqui.
//
// xp_events.amount pode ser NEGATIVO (estorno de auditoria) — o saldo é
// event-sourced: soma dos amounts por usuário.

import type { Seniority } from '../db/roles';

/** Motivos espelham o CHECK constraint da migration (schema.ts). */
export type XpReason =
  | 'os_complete'
  | 'complexity_bonus'
  | 'streak_bonus'
  | 'quality_bonus'
  | 'adjustment'      // admin ajusta manualmente (positivo ou negativo)
  | 'rework_penalty'; // auditoria achou retrabalho → estorno

export const XP_BASE_PER_OS = 100;
export const XP_PER_INCONFORMITY = 10;
export const COMPLEXITY_BONUS_CAP = 100;
export const XP_STREAK_BONUS = 25;
export const XP_QUALITY_BONUS = 150;
export const REWORK_PENALTY = -150; // estorna o quality_bonus esquecido

export interface XpEventLike {
  userId: string;
  amount: number;
  reason: XpReason;
  ts: number; // epoch ms
}

export interface CompletionInput {
  /** Inconformidades marcadas que PASSARAM pela auditoria/validação. */
  validInconformities: number;
  /** Auditoria confirmou zero retrabalho nesta OS? */
  zeroRework: boolean;
  /** Analista já tinha analisado no dia anterior (streak vivo)? */
  hadStreak: boolean;
}

/**
 * Eventos de XP gerados por uma análise concluída, NA ORDEM CANÔNICA
 * (base → complexidade → streak → qualidade). Retorna só amount+reason:
 * quem persiste carimba user_id/ts ao gravar na tabela xp_events.
 */
export function eventsForCompletion(
  input: CompletionInput,
): Array<{ amount: number; reason: XpReason }> {
  const out: Array<{ amount: number; reason: XpReason }> = [
    { amount: XP_BASE_PER_OS, reason: 'os_complete' },
  ];
  if (input.validInconformities > 0) {
    out.push({
      amount: Math.min(input.validInconformities, COMPLEXITY_BONUS_CAP / XP_PER_INCONFORMITY) * XP_PER_INCONFORMITY,
      reason: 'complexity_bonus',
    });
  }
  if (input.hadStreak) out.push({ amount: XP_STREAK_BONUS, reason: 'streak_bonus' });
  if (input.zeroRework) out.push({ amount: XP_QUALITY_BONUS, reason: 'quality_bonus' });
  return out.map((e) => ({ ...e }));
}

/** Saldo total de um usuário = soma event-sourced dos amounts. */
export function totalXp(events: readonly XpEventLike[], userId?: string): number {
  let sum = 0;
  for (const e of events) {
    if (userId !== undefined && e.userId !== userId) continue;
    sum += e.amount;
  }
  return sum;
}

/** XP acumulado dentro de um intervalo meio-aberto [fromMs, toMs). */
export function xpInRange(
  events: readonly XpEventLike[],
  fromMs: number,
  toMs: number,
  userId?: string,
): number {
  let sum = 0;
  for (const e of events) {
    if (userId !== undefined && e.userId !== userId) continue;
    if (e.ts < fromMs || e.ts >= toMs) continue;
    sum += e.amount;
  }
  return sum;
}

/** Contagem de eventos de retrabalho num intervalo (p/ desempate do pódio). */
export function reworkCount(
  events: readonly XpEventLike[],
  fromMs: number,
  toMs: number,
  userId?: string,
): number {
  let n = 0;
  for (const e of events) {
    if (userId !== undefined && e.userId !== userId) continue;
    if (e.reason !== 'rework_penalty') continue;
    if (e.ts < fromMs || e.ts >= toMs) continue;
    n++;
  }
  return n;
}

/**
 * Streak DIÁRIO de dias consecutivos com ≥1 evento positivo terminando no
 * dia-chave informado (inclusive). Dias-chave são strings 'YYYY-MM-DD' —
 * quem calcula é periods.localDayKey no fuso do pódio (o caller injeta,
 * então este módulo não sabe fuso nenhum).
 */
export function currentStreak(dayKeysWithActivity: readonly string[], todayKey: string): number {
  const active = new Set(dayKeysWithActivity);
  // hoje ainda pode não ter atividade sem quebrar o streak ontem↔hoje:
  // âncora = hoje se tem atividade, senão ontem.
  const prevKey = (key: string): string => {
    const [y, m, d] = key.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d) - MS_PER_DAY_LOCAL;
    return new Date(t).toISOString().slice(0, 10);
  };
  let cursor = active.has(todayKey) ? todayKey : prevKey(todayKey);
  let streak = 0;
  while (active.has(cursor)) {
    streak++;
    cursor = prevKey(cursor);
  }
  return streak;
}

const MS_PER_DAY_LOCAL = 86_400_000;

/** Streak quebrou? (não analisou nem hoje nem ontem → zerado) */
export function streakIsBroken(dayKeysWithActivity: readonly string[], todayKey: string): boolean {
  return currentStreak(dayKeysWithActivity, todayKey) === 0;
}

/** Fração 0–1 dentro do nível atual — DELEGADO a levels.levelProgress. */
export { levelProgress } from './levels';

/** Pódio separado por senioridade (spec C4) — validação barata pro chamador. */
export function podiumGroupOf(seniority: Seniority): Seniority {
  return seniority;
}

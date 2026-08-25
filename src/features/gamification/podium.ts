// Solaris v3 — Feature Pack "Analista Feliz" — F3 Gamificação.
//
// Pódios (spec C2): Analista da Semana / Mês / Ano.
//   * Semana abre segunda 00h e reset é na virada, fuso do pódio (periods.ts).
//   * Empate em XP desempata por MENOR retrabalho (spec C2); persistindo
//     empate, alfabético por userId → ordem determinística (testes estáveis).
//   * Ranking SEPARADO por senioridade (spec C4): Trainee compete com Trainee.
//   * Snapshot congelado quando o período vira (podium_history da migration).
//
// PURA: recebe xp_events-like + papéis; devolve rankings/snapshots. O chamador
// decide onde guardar; nada aqui toca rede/disco.

import type { Seniority } from '../db/roles';
import {
  closedPeriodRange,
  type PodiumClockConfig,
} from './periods';
import { reworkCount, xpInRange, type XpEventLike } from './xp';

export type PeriodType = 'week' | 'month' | 'year';

export interface AnalystInfo {
  userId: string;
  name: string;
  seniority: Seniority;
}

export interface PodiumEntry {
  rank: number;
  userId: string;
  name: string;
  xp: number;
  /** Eventos de retrabalho no período (critério de desempate). */
  reworkCount: number;
  /** Compartilhamento de posição (empate absoluto pós-desempate). */
  tied: boolean;
}

/**
 * Ranking de um período FECHADO (ou corrente) num grupo de senioridade.
 * `events` pode conter usuários fora de `analysts` — são ignorados.
 * Usuários sem XP nenhum não aparecem (pódio é por mérito do período).
 */
export function podiumFor(
  period: { type: PeriodType; key: string },
  events: readonly XpEventLike[],
  analysts: readonly AnalystInfo[],
  cfg: PodiumClockConfig,
  opts?: { group?: Seniority | 'all' },
): PodiumEntry[] {
  const { fromMs, toMs } = closedPeriodRange(period.type, period.key, cfg);
  const group = opts?.group ?? 'all';
  const inGroup = analysts.filter((a) => group === 'all' || a.seniority === group);

  const scored = inGroup
    .map((a) => ({
      userId: a.userId,
      name: a.name,
      xp: xpInRange(events, fromMs, toMs, a.userId),
      reworkCount: reworkCount(events, fromMs, toMs, a.userId),
    }))
    .filter((r) => r.xp !== 0 || r.reworkCount !== 0);

  scored.sort((x, y) =>
    y.xp - x.xp          // mais XP primeiro
    || x.reworkCount - y.reworkCount // empate: menor retrabalho
    || (x.userId < y.userId ? -1 : x.userId > y.userId ? 1 : 0), // determinístico
  );

  // Ranks densos com marcação de empate: mesmos (xp, rework) = mesma posição.
  const entries: PodiumEntry[] = [];
  let prevRank = 0;
  let prevXp = Number.NaN;
  let prevRework = Number.NaN;
  for (const r of scored) {
    const tied = entries.length > 0 && r.xp === prevXp && r.reworkCount === prevRework;
    const rank = tied ? prevRank : entries.length + 1;
    entries.push({ userId: r.userId, name: r.name, xp: r.xp, reworkCount: r.reworkCount, rank, tied });
    prevRank = rank;
    prevXp = r.xp;
    prevRework = r.reworkCount;
  }
  return entries;
}

/** Top-3 pronto pra UI (🥇🥈🥉) — preserva empates (dois 🥈 possíveis). */
export function podiumTop3(entries: readonly PodiumEntry[]): PodiumEntry[] {
  return entries.filter((e) => e.rank <= 3);
}

/**
 * Snapshot congelável do pódio fechado (linha(s) de podium_history).
 * Só ranqueia quem tem atividade; ranks além do 10º não são persistidos
 * (CHECK da migration limita rank 1..10).
 */
export function frozenPodiumRows(
  period: { type: PeriodType; key: string },
  events: readonly XpEventLike[],
  analysts: readonly AnalystInfo[],
  cfg: PodiumClockConfig,
): Array<{ period_type: PeriodType; period_key: string; user_id: string; rank: number; xp: number; rework_count: number }> {
  return podiumFor(period, events, analysts, cfg)
    .slice(0, 10)
    .map((e) => ({
      period_type: period.type,
      period_key: period.key,
      user_id: e.userId,
      rank: e.rank,
      xp: e.xp,
      rework_count: e.reworkCount,
    }));
}

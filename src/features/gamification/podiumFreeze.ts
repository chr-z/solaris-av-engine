// Solaris v3 — F4 UI de Gamificação.
//
// Congelamento de pódios (spec C2 "histórico eterno"): quando o período vira
// (segunda 00h / dia 1º / 1º jan no fuso do pódio), o ranking FECHADO é
// congelado em podium_history. PURA: decide e produz linhas; o chamador grava.
//
// `lastFrozen[type]` guarda a chave do período JÁ CONGELADO mais recente.
// Se o app ficou offline por N semanas/meses, TODOS os períodos fechados
// intermediários são congelados em ordem (event-sourcing permite: os eventos
// continuam no store). Idempotente por construção.

import type { PodiumClockConfig } from './periods';
import { currentPeriodKey, nextPeriodKey, shouldClosePeriod } from './periods';
import type { PeriodType } from './podium';
import { frozenPodiumRows, podiumFor } from './podium';
import type { AnalystInfo, PodiumEntry } from './podium';
import type { XpEventLike } from './xp';
import type { ProfileState } from './profileStore';

const ALL_TYPES: readonly PeriodType[] = ['week', 'month', 'year'];

export interface FrozenPeriodResult {
  state: ProfileState;
  /** Períodos recém-congelados nesta chamada (disparo de UI "fechou o mês"). */
  newlyFrozen: Array<{ type: PeriodType; key: string; topUserId: string | null }>;
}

/**
 * Fecha os períodos vencidos e devolve o estado atualizado.
 * Rodar duas vezes no mesmo instante não duplica nada.
 */
export function freezeDuePeriods(
  state: ProfileState,
  events: readonly XpEventLike[],
  analysts: readonly AnalystInfo[],
  nowMs: number,
  cfg: PodiumClockConfig,
): FrozenPeriodResult {
  const next: ProfileState = {
    ...state,
    achievements: { ...state.achievements },
    lastFrozen: { ...state.lastFrozen },
    podiumHistory: Object.fromEntries(Object.entries(state.podiumHistory)),
  };
  const newlyFrozen: FrozenPeriodResult['newlyFrozen'] = [];

  for (const type of ALL_TYPES) {
    const cur = currentPeriodKey(type, nowMs, cfg);
    let cursor = state.lastFrozen[type] ?? null;

    // Primeiro uso: só estabelece o baseline (nada histórico pra fechar —
    // sem eventos anteriores confiáveis, congelaria pódios vazios inventados).
    if (cursor === null) {
      next.lastFrozen[type] = cur;
      continue;
    }

    while (shouldClosePeriod(type, cursor, nowMs, cfg)) {
      const rows = frozenPodiumRows({ type, key: cursor }, events, analysts, cfg);
      const top = rows.find((r) => r.rank === 1) ?? null;
      next.podiumHistory[`${type}:${cursor}`] = rows.map((r) => ({
        userId: r.user_id,
        name: analysts.find((a) => a.userId === r.user_id)?.name ?? r.user_id,
        rank: r.rank,
        xp: r.xp,
        reworkCount: r.rework_count,
      }));
      newlyFrozen.push({ type, key: cursor, topUserId: top?.user_id ?? null });
      cursor = nextPeriodKey(type, cursor, cfg);
      next.lastFrozen[type] = cursor;
    }
  }
  return { state: next, newlyFrozen };
}

/** Pódio AO VIVO do período corrente (3 colunas 🥇🥈🥉 da UI). */
export function livePodium(
  events: readonly XpEventLike[],
  analysts: readonly AnalystInfo[],
  nowMs: number,
  cfg: PodiumClockConfig,
  group: AnalystInfo['seniority'] | 'all' = 'all',
): PodiumEntry[] {
  return livePodiumFor('week', events, analysts, nowMs, cfg, group);
}

/**
 * Pódio AO VIVO de QUALQUER tipo de período (Semana/Mês/Ano — spec C2).
 * Mesmo contrato do livePodium; a chave corrente é derivada do relógio do
 * pódio, nunca do host.
 */
export function livePodiumFor(
  type: PeriodType,
  events: readonly XpEventLike[],
  analysts: readonly AnalystInfo[],
  nowMs: number,
  cfg: PodiumClockConfig,
  group: AnalystInfo['seniority'] | 'all' = 'all',
): PodiumEntry[] {
  return podiumFor(
    { type, key: currentPeriodKey(type, nowMs, cfg) },
    events,
    analysts,
    cfg,
    { group },
  );
}

/** Histórico navegável ordenado do mais recente pro mais antigo. */
export function historyKeys(state: ProfileState): Array<{ type: PeriodType; key: string }> {
  return Object.keys(state.podiumHistory)
    .map((k) => {
      const sep = k.indexOf(':');
      return { type: k.slice(0, sep) as PeriodType, key: k.slice(sep + 1) };
    })
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : b.type.localeCompare(a.type)));
}

/**
 * Lista de analistas derivada dos PRÓPRIOS eventos (era offline/local do
 * store). Senioridade default 'junior'; quando o F5 trouxer users_roles do
 * backend, este é o único ponto de troca. Nome resolvido p/ quem está logado;
 * os demais caem no próprio userId até haver diretório.
 */
export function analystsFromEvents(
  events: readonly XpEventLike[],
  current?: { id: string; name: string },
): AnalystInfo[] {
  const ids = new Set<string>();
  for (const e of events) ids.add(e.userId);
  if (current?.id) ids.add(current.id);
  return [...ids].sort().map((userId) => ({
    userId,
    name: current && userId === current.id ? current.name : userId,
    seniority: 'junior' as const,
  }));
}

// Solaris v3 — F4 UI de Gamificação.
//
// Deriva o AchievementSnapshot (contrato do achievements.ts) e os dias-chave
// de atividade DIRETO dos eventos persistidos — uma única fonte de verdade
// (o store), zero estado paralelo. PURA.

import type { AchievementSnapshot } from './achievements';
import { evaluateAchievements, newAchievements as diffNew } from './achievements';
import { localParts, localDayKey, SAO_PAULO_CLOCK, type PodiumClockConfig } from './periods';
import { MS_PER_DAY } from './periods';
import type { StoredXpEvent } from './profileStore';

/** Dias-chave ('YYYY-MM-DD' no fuso) com ≥1 evento `os_complete` do usuário. */
export function completionDayKeys(
  events: readonly StoredXpEvent[],
  cfg: PodiumClockConfig = SAO_PAULO_CLOCK,
): string[] {
  const days = new Set<string>();
  for (const e of events) {
    if (e.reason !== 'os_complete') continue;
    days.add(localDayKey(e.ts, cfg));
  }
  return [...days].sort();
}

export interface DerivedActivity {
  snapshot: AchievementSnapshot;
  /** Total de OSs completas na carreira. */
  totalCompleted: number;
}

/**
 * Snapshot completo da atividade. `bestAvgSecByOs` é opcional (fonte futura:
 * timer por OS); sem ele, Velocista simplesmente não desbloqueia — nunca o
 * contrário (inventar tempo seria pontuar velocidade sem dado).
 */
export function deriveActivity(
  events: readonly StoredXpEvent[],
  cfg: PodiumClockConfig = SAO_PAULO_CLOCK,
): DerivedActivity {
  let totalCompleted = 0;
  const perDay = new Map<string, number>();
  const lateDays = new Set<string>();
  const earlyDays = new Set<string>();

  for (const e of events) {
    if (e.reason !== 'os_complete') continue;
    totalCompleted += 1;
    const key = localDayKey(e.ts, cfg);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
    const hour = localParts(e.ts, cfg).hour;
    if (hour >= 23) lateDays.add(key);
    else if (hour < 7) earlyDays.add(key);
  }

  const maxInOneDay = [...perDay.values()].reduce((m, n) => Math.max(m, n), 0);

  // Sequência limpa: rework_penalty ESTORNA o quality_bonus da MESMA OS
  // (mesmo id-base). Uma OS com estorno quebra a corrida; contagem corrente =
  // conclusões consecutivas após a última quebra.
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  let currentCleanRun = 0;
  let bestCleanRun = 0;
  for (const e of sorted) {
    if (e.reason === 'os_complete') {
      currentCleanRun += 1;
      bestCleanRun = Math.max(bestCleanRun, currentCleanRun);
    } else if (e.reason === 'rework_penalty') {
      currentCleanRun = 0;
    }
  }

  return {
    totalCompleted,
    snapshot: {
      totalCompleted,
      maxInOneDay,
      lateNightDays: [...lateDays],
      earlyMorningDays: [...earlyDays],
      currentCleanRun,
      bestCleanRun,
      bestQualityMaintainingAvgSec: null,
      helpCommentsSent: 0,
    },
  };
}

/**
 * Conquistas avaliadas agora − já persistidas = chaves NOVAS (toast).
 * Não grava nada: o chamador mescla e persiste em uma passada.
 */
export function newlyEarned(
  events: readonly StoredXpEvent[],
  storedAchievements: Readonly<Record<string, number>>,
  nowMs: number,
  cfg: PodiumClockConfig = SAO_PAULO_CLOCK,
): { evaluatedKeys: string[]; freshKeys: string[] } {
  const { snapshot } = deriveActivity(events, cfg);
  const evaluated = evaluateAchievements(snapshot);
  const stored = new Set(Object.keys(storedAchievements));
  const fresh = diffNew(evaluated, stored);
  return {
    evaluatedKeys: [...evaluated].sort(),
    freshKeys: [...fresh].sort(),
  };
}

/** Ontem (chave de dia) de um instante no fuso do pódio. */
export function yesterdayKeyOf(nowMs: number, cfg: PodiumClockConfig = SAO_PAULO_CLOCK): string {
  return localDayKey(nowMs - MS_PER_DAY, cfg);
}

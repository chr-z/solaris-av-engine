// Solaris v3 — F4 UI de Gamificação.
//
// Premiação de conclusão (spec C1): decide os eventos de XP de uma análise
// concluída SEM duplicar (id determinístico por OS+motivo), paga bônus de
// streak só na PRIMEIRA conclusão do dia com atividade no dia anterior, e
// detecta level-up comparando o saldo antes/depois. PURA — o chamador grava.
//
// NUNCA pontua velocidade pura (spec C4): não há componente de tempo aqui.

import {
  eventsForCompletion,
  totalXp,
  levelProgress,
} from './xp';
import { levelForXp, type LevelId } from './levels';
import { eventIdFor, type StoredXpEvent } from './profileStore';

export interface CompletionContext {
  osId: string;
  userId: string;
  nowMs: number;
  /** Marcações válidas na linha (regras ativas com célula 'TRUE'). */
  validInconformities: number;
  /** Auditoria ainda não existe no cliente → true = análise limpa. */
  zeroRework?: boolean;
  /**
   * Chaves de dia ('YYYY-MM-DD', fuso do pódio) com conclusões ANTERIORES
   * deste usuário — derivadas dos eventos já persistidos.
   */
  priorDayKeys: readonly string[];
  /** Chave de hoje e de ontem no fuso do pódio (periods.localDayKey). */
  todayKey: string;
  yesterdayKey: string;
}

export interface AwardDecision {
  /** Eventos NOVOS a persistir (vazio = nada a fazer). */
  events: StoredXpEvent[];
  beforeXp: number;
  afterXp: number;
  levelBefore: LevelId;
  levelAfter: LevelId;
  /** Id do nível alcançado quando houve level-up nesta conclusão. */
  leveledUpTo: LevelId | null;
  isFirstCompletionToday: boolean;
  streakBonusPaid: boolean;
  /** Motivo do no-op (eventos vazios). */
  noop?: 'already-awarded';
}

/**
 * Primeira conclusão desta OS? O par (osId, 'os_complete') é a assinatura —
 * salvar a mesma OS concluída duas vezes não paga de novo (idempotência).
 */
export function isOsAlreadyAwarded(
  existing: readonly StoredXpEvent[],
  osId: string,
): boolean {
  const signature = eventIdFor(osId, 'os_complete');
  return existing.some((e) => e.id === signature);
}

/**
 * Recebe os eventos já persistidos do usuário + o contexto da conclusão e
 * devolve a decisão inteira (testável sem nenhum I/O).
 */
export function awardForCompletion(
  existing: readonly StoredXpEvent[],
  ctx: CompletionContext,
): AwardDecision {
  const beforeXp = totalXp(existing);
  const levelBefore = levelForXp(beforeXp).id;

  if (isOsAlreadyAwarded(existing, ctx.osId)) {
    return {
      events: [],
      beforeXp,
      afterXp: beforeXp,
      levelBefore,
      levelAfter: levelBefore,
      leveledUpTo: null,
      isFirstCompletionToday: false,
      streakBonusPaid: false,
      noop: 'already-awarded',
    };
  }

  const isFirstCompletionToday = !ctx.priorDayKeys.includes(ctx.todayKey);
  const hadStreak = isFirstCompletionToday && ctx.priorDayKeys.includes(ctx.yesterdayKey);

  const generated = eventsForCompletion({
    validInconformities: Math.max(0, Math.trunc(ctx.validInconformities)),
    zeroRework: ctx.zeroRework ?? true,
    hadStreak,
  });

  const events: StoredXpEvent[] = generated.map((g) => ({
    id: eventIdFor(ctx.osId, g.reason),
    userId: ctx.userId,
    amount: g.amount,
    reason: g.reason,
    ts: ctx.nowMs,
    meta: { osId: ctx.osId, zeroRework: ctx.zeroRework ?? true },
  }));

  const afterXp = totalXp([...existing, ...events]);
  const levelAfter = levelForXp(afterXp).id;

  return {
    events,
    beforeXp,
    afterXp,
    levelBefore,
    levelAfter,
    leveledUpTo: levelAfter !== levelBefore ? levelAfter : null,
    isFirstCompletionToday,
    streakBonusPaid: hadStreak,
  };
}

/** Fração/nível pós-premiação — conveniência p/ barra animada do perfil. */
export function progressAfter(decision: AwardDecision) {
  return levelProgress(decision.afterXp);
}

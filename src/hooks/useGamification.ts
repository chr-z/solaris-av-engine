// Solaris v3 — F4 UI de Gamificação.
//
// Ponte React da gamificação via useSyncExternalStore: o STORAGE é a fonte
// da verdade e o React apenas assina as mudanças (offline-first, tudo em
// localStorage). Troca de usuário e pós-premiação recarregam sem NENHUM
// effect — zero cascata de renders (regras do React Compiler).

import { useCallback, useState } from 'react';
import {
  emptyProfile,
  parseProfile,
  saveProfile,
  PROFILE_KEY_PREFIX,
  type ProfileState,
  type StorageLike,
  type StoredXpEvent,
} from '../features/gamification/profileStore';
import {
  awardForCompletion,
  type CompletionContext,
  type AwardDecision,
} from '../features/gamification/xpAward';
import {
  newlyEarned,
  yesterdayKeyOf,
} from '../features/gamification/achievementTracker';
import { freezeDuePeriods } from '../features/gamification/podiumFreeze';
import type { AnalystInfo } from '../features/gamification/podium';
import { localDayKey, SAO_PAULO_CLOCK } from '../features/gamification/periods';
import { totalXp } from '../features/gamification/xp';

/** Assinantes das mudanças do store de gamificação nesta aba. */
const listeners = new Set<() => void>();
function emitChange() {
  for (const l of listeners) l();
}

// Cache de snapshot por raw-string: getSnapshot precisa devolver valor
// ESTÁVEL entre chamadas (identidade), senão o React entra em loop.
let snapRaw = '\u0000';
let snapVal: ProfileState = emptyProfile();

export interface GamificationSession {
  profile: ProfileState;
  events: StoredXpEvent[];
  totalXp: number;
  /**
   * Premia a conclusão de uma OS (XP + conquistas + congelamento de pódios
   * vencidos). Devolve a decisão ou null quando nada mudou (já premiada /
   * sem usuário). Idempotente por OS — re-salvar não paga duas vezes.
   */
  completeOs: (
    input: Pick<CompletionContext, 'osId' | 'validInconformities'> &
      Partial<Pick<CompletionContext, 'zeroRework'>>,
    analysts?: readonly AnalystInfo[],
  ) => AwardDecision | null;
  /** Conquistas recém-desbloqueadas pendentes de toast. */
  freshAchievements: string[];
  consumeFresh: () => void;
}

export function useGamification(
  storage: StorageLike,
  userId: string | null,
): GamificationSession {
  const [freshAchievements, setFreshAchievements] = useState<string[]>([]);

  const subscribe = useCallback((onChange: () => void) => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const getSnapshot = useCallback((): ProfileState => {
    const raw = userId ? (storage.getItem(PROFILE_KEY_PREFIX + userId) ?? '') : '';
    if (raw !== snapRaw || snapVal === null) {
      snapRaw = raw;
      snapVal = userId ? parseProfile(raw) : emptyProfile();
    }
    return snapVal;
  }, [storage, userId]);

  const profile = useSyncExternalStoreShim(subscribe, getSnapshot);

  const completeOs = useCallback<GamificationSession['completeOs']>(
    (input, analysts = []) => {
      if (!userId) return null;
      const stored = loadFresh(storage, userId);
      const nowMs = Date.now();

      const dayKeys = new Set<string>();
      for (const e of stored.events) {
        if (e.reason === 'os_complete') dayKeys.add(localDayKey(e.ts, SAO_PAULO_CLOCK));
      }

      const decision = awardForCompletion(stored.events, {
        osId: input.osId,
        validInconformities: input.validInconformities,
        zeroRework: input.zeroRework,
        userId,
        nowMs,
        priorDayKeys: [...dayKeys],
        todayKey: localDayKey(nowMs, SAO_PAULO_CLOCK),
        yesterdayKey: yesterdayKeyOf(nowMs),
      });
      if (decision.events.length === 0) return null;

      // Merge idempotente contra o storage (outra aba pode ter gravado).
      const knownIds = new Set(stored.events.map((e) => e.id));
      const freshEvents = decision.events.filter((e) => !knownIds.has(e.id));
      if (freshEvents.length === 0) return null;

      // Congela pódios vencidos ANTES de gravar (mesma escrita, uma passada).
      const frozen = freezeDuePeriods(
        stored,
        [...stored.events, ...freshEvents],
        analysts,
        nowMs,
        SAO_PAULO_CLOCK,
      );

      const nextState: ProfileState = {
        ...frozen.state,
        events: [...frozen.state.events, ...freshEvents].sort((a, b) => a.ts - b.ts),
      };

      // Conquistas avaliadas sobre o estado PÓS-eventos; carimbadas na MESMA
      // escrita (toast só p/ chaves novas).
      const { freshKeys } = newlyEarned(
        nextState.events,
        nextState.achievements,
        nowMs,
        SAO_PAULO_CLOCK,
      );
      if (freshKeys.length > 0) {
        const stamped = { ...nextState.achievements };
        for (const k of freshKeys) if (!(k in stamped)) stamped[k] = nowMs;
        saveProfile(storage, userId, { ...nextState, achievements: stamped });
      } else {
        saveProfile(storage, userId, nextState);
      }
      invalidateSnap();
      emitChange();
      // Painel da Liga aberto na mesma aba re-lê o storage na hora.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('solaris:gamification'));
      }
      setFreshAchievements(freshKeys);

      return { ...decision, events: freshEvents };
    },
    [storage, userId],
  );

  const consumeFresh = useCallback(() => setFreshAchievements([]), []);

  const xpTotal = totalXp(profile.events);

  return {
    profile,
    events: profile.events,
    totalXp: xpTotal,
    completeOs,
    freshAchievements,
    consumeFresh,
  };
}

// ── internals ────────────────────────────────────────────────────────────

function loadFresh(storage: StorageLike, userId: string): ProfileState {
  return parseProfile(storage.getItem(PROFILE_KEY_PREFIX + userId));
}

function invalidateSnap(): void {
  snapRaw = '\u0000';
}

/**
 * Shim mínimo de useSyncExternalStore com import estático — mantido local
 * para deixar explícito o contrato (subscribe/getSnapshot) nos testes.
 */
import { useSyncExternalStore } from 'react';
function useSyncExternalStoreShim(
  subscribe: (onChange: () => void) => () => void,
  getSnapshot: () => ProfileState,
): ProfileState {
  return useSyncExternalStore(subscribe, getSnapshot, () => emptyProfile());
}

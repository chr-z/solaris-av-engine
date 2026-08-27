// Solaris v3 — Feature Pack "Analista Feliz" — F4 UI de Gamificação.
//
// Store OFFLINE-FIRST do perfil de gamificação (spec C + E): tudo vive em
// localStorage por usuário e sincroniza depois quando houver backend
// (mesma filosofia do resto do app). Event-sourced: o saldo de XP é a soma
// dos eventos; conquistas são chaves idempotentes (user+key, igual à tabela
// achievements da migration 0002).
//
// PURA na lógica: funções de merge/diff/testáveis separadas do I/O mínimo.

import type { XpEventLike, XpReason } from './xp';

/** Evento persistido: id determinístico garante idempotência por OS+motivo. */
export interface StoredXpEvent extends XpEventLike {
  /** `${osId}:${reason}` — gravar duas vezes o mesmo par é um no-op. */
  id: string;
  /** Metadados opcionais da conclusão (zero retrabalho declarado no save). */
  meta?: { osId?: string; zeroRework?: boolean };
}

export interface ProfileState {
  /** Versão do formato (migrações futuras). */
  v: 1;
  events: StoredXpEvent[];
  /** Conquistas já desbloqueadas com instante (espelho de `achievements`). */
  achievements: Record<string, number>;
  /**
   * Snapshots congelados de pódios fechados (espelho de `podium_history`):
   * chave `${periodType}:${periodKey}` → linhas ranqueadas.
   */
  podiumHistory: Record<
    string,
    Array<{ userId: string; name: string; rank: number; xp: number; reworkCount: number }>
  >;
  /** Último período congelado por tipo — evita recongelar o mesmo. */
  lastFrozen: Partial<Record<'week' | 'month' | 'year', string>>;
}

export function emptyProfile(): ProfileState {
  return { v: 1, events: [], achievements: {}, podiumHistory: {}, lastFrozen: {} };
}

export const PROFILE_KEY_PREFIX = 'solaris.gamification.profile.';
export const GAMIFICATION_ENABLED_KEY = 'solaris.gamification.enabled';

function storageKey(userId: string): string {
  return PROFILE_KEY_PREFIX + userId;
}

/** Id determinístico de evento: mesma OS + motivo = mesmo evento (nunca duplica). */
export function eventIdFor(osId: string, reason: XpReason): string {
  return `${osId}:${reason}`;
}

/**
 * Merge idempotente: eventos novos entram só se o id é inédito; existentes
 * preservam o payload original (primeiro write vence — sem drift de dados).
 */
export function mergeEvents(
  existing: readonly StoredXpEvent[],
  incoming: readonly StoredXpEvent[],
): { events: StoredXpEvent[]; added: StoredXpEvent[] } {
  const byId = new Map<string, StoredXpEvent>();
  for (const e of existing) byId.set(e.id, e);
  const added: StoredXpEvent[] = [];
  for (const e of incoming) {
    if (byId.has(e.id)) continue;
    byId.set(e.id, e);
    added.push(e);
  }
  return { events: [...byId.values()].sort((a, b) => a.ts - b.ts), added };
}

/** Diferença conquista nova = avaliado − já salvo (toast só pro novo). */
export function newAchievementKeys(
  evaluated: ReadonlySet<string>,
  stored: Readonly<Record<string, number>>,
): string[] {
  return [...evaluated].filter((k) => !(k in stored)).sort();
}

/** Parse tolerante: storage corrompido/legado devolve perfil vazio, nunca throw. */
export function parseProfile(raw: string | null): ProfileState {
  if (!raw) return emptyProfile();
  try {
    const obj = JSON.parse(raw) as Partial<ProfileState>;
    if (!obj || typeof obj !== 'object') return emptyProfile();
    return {
      v: 1,
      events: Array.isArray(obj.events) ? obj.events.filter((e) => e && typeof e.amount === 'number') : [],
      achievements: obj.achievements && typeof obj.achievements === 'object' ? obj.achievements : {},
      podiumHistory: obj.podiumHistory && typeof obj.podiumHistory === 'object' ? obj.podiumHistory : {},
      lastFrozen: obj.lastFrozen && typeof obj.lastFrozen === 'object' ? obj.lastFrozen : {},
    };
  } catch {
    return emptyProfile();
  }
}

// ── I/O mínimo (injetável nos testes via storageLike) ────────────────────

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function loadProfile(storage: StorageLike, userId: string): ProfileState {
  return parseProfile(storage.getItem(storageKey(userId)));
}

export function saveProfile(storage: StorageLike, userId: string, state: ProfileState): void {
  storage.setItem(storageKey(userId), JSON.stringify(state));
}

/** Flag global ON/OFF (admin desliga p/ todo o time; default ligado). */
export function isGamificationEnabled(storage: StorageLike): boolean {
  return storage.getItem(GAMIFICATION_ENABLED_KEY) !== '0';
}

export function setGamificationEnabled(storage: StorageLike, enabled: boolean): void {
  if (enabled) {
    if (storage.removeItem) storage.removeItem(GAMIFICATION_ENABLED_KEY);
    else storage.setItem(GAMIFICATION_ENABLED_KEY, '1');
  } else {
    storage.setItem(GAMIFICATION_ENABLED_KEY, '0');
  }
}

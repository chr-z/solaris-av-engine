// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Singleton do UndoLog ligado ao localStorage. Um log só por sessão —
// eventos de qualquer superfície (workspace, fila futura) entram na mesma
// pilha cronológica, que é o que o "undo global 24h" pede.

import { UndoLog } from './undo';

export const UNDO_STORAGE_KEY = 'solaris.qol.undo';

let instance: UndoLog | null = null;

export function getUndoLog(): UndoLog {
  if (instance) return instance;
  if (typeof window !== 'undefined' && window.localStorage) {
    instance = new UndoLog({
      read: () => window.localStorage.getItem(UNDO_STORAGE_KEY),
      write: (payload) => window.localStorage.setItem(UNDO_STORAGE_KEY, payload),
    });
  } else {
    // Ambiente sem storage (testes SSR-like): log volátil em memória.
    instance = new UndoLog({ read: () => null, write: () => {} });
  }
  return instance;
}

/** Logout/troca de usuário: zera memória e storage. */
export function resetUndoLog(): void {
  instance?.clear();
  instance = null;
}

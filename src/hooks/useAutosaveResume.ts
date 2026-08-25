// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Hook de auto-save + retomada (spec A1): envolve o AutosaveController puro
// com o ciclo de vida React. Uma instância por OS aberta (key do workspace
// garante remontagem). Grava em 200ms debounced; flush em beforeunload,
// visibilitychange e unmount; markCleaned quando a planilha confirma.

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  AutosaveController,
  loadAutosave,
  type AutosaveEntry,
} from '../features/qol/autosave';
import { planResume, type ResumeDecision } from '../features/qol/resume';

export const AUTOSAVE_KEY_PREFIX = 'solaris.qol.autosave.';

function storageKey(osId: string): string {
  return AUTOSAVE_KEY_PREFIX + osId;
}

/**
 * @param osId      Identificador estável da OS (W.O. da linha).
 * @param durationSec Duração conhecida do vídeo carregado (null = ainda não).
 * @param onOfficialSave Chame quando a análise for salva na planilha.
 */
export function useAutosaveResume(
  osId: string | null,
  durationSec: number | null,
  onOfficialSave?: () => void,
) {
  /** Última gravação confirmada — badge "salvo ✓". */
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const controllerRef = useRef<AutosaveController<unknown> | null>(null);
  if (!controllerRef.current && osId !== null && typeof window !== 'undefined') {
    controllerRef.current = new AutosaveController<unknown>({
      read: () => window.localStorage.getItem(storageKey(osId)),
      write: (payload) => window.localStorage.setItem(storageKey(osId), payload),
      clear: () => window.localStorage.removeItem(storageKey(osId)),
      delayMs: 200,
      onSaved: () => setLastSavedAt(Date.now()),
    });
  }

  const getController = useCallback((): AutosaveController<unknown> | null =>
    controllerRef.current, []);

  // Retomada: decisão única quando os inputs estabilizam.
  const resumeRef = useRef<ResumeDecision>({ shouldSeek: false, positionSec: 0, overlay: null, reason: 'no-draft' });
  const resumePlannedRef = useRef(false);

  const planOnce = useCallback((): ResumeDecision => {
    if (!resumePlannedRef.current && osId !== null && typeof window !== 'undefined') {
      const entry = loadAutosave(() => window.localStorage.getItem(storageKey(osId)));
      resumeRef.current = planResume({ entry, durationSec: null });
      resumePlannedRef.current = true;
    }
    return resumeRef.current;
  }, [osId]);

  const resetResumePlan = useCallback(() => {
    resumePlannedRef.current = false;
    resumeRef.current = { shouldSeek: false, positionSec: 0, overlay: null, reason: 'no-draft' };
  }, []);

  /**
   * Marcação/célula mudou → agenda save. Barato: só atualiza pending.
   */
  const scheduleSave = useCallback((data: unknown, positionSec: number) => {
    controllerRef.current?.schedule(data, positionSec);
  }, []);

  /** Flush imediato (troca de OS/unload). */
  const flushNow = useCallback(() => {
    controllerRef.current?.flush();
  }, []);

  /** Análise oficialmente salva → limpa rascunho. */
  const markCleaned = useCallback(() => {
    controllerRef.current?.markCleaned();
    setLastSavedAt(null);
  }, []);

  // Flush de emergência ao fechar/aba oculta.
  useEffect(() => {
    const flush = () => controllerRef.current?.flush();
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  // Unmount da OS: grava o pendente antes de morrer.
  useEffect(() => () => {
    controllerRef.current?.flush();
  }, [osId]);

  return {
    lastSavedAt,
    scheduleSave,
    flushNow,
    markCleaned,
    planOnce,
    resetResumePlan,
    /** Decisão pronta p/ o player aplicar (chamado no loadedmetadata). */
    planResumeForOs: planOnce,
  } as const;
}

/** Helper p/ testes e uso fora do hook: chave de storage de uma OS. */
export function autosaveKeyFor(osId: string): string {
  return AUTOSAVE_KEY_PREFIX + osId;
}

export type { AutosaveEntry };

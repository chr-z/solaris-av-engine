// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core (A1 notas rápidas).
//
// Envolve o ScratchpadController puro com o ciclo de vida React, na mesma
// linha do useAutosaveResume: uma instância por OS aberta (a key do workspace
// garante remontagem), debounce 200ms, flush determinístico em beforeunload/
// visibilitychange/unmount e limpeza quando a análise é confirmada.
//
// Conformidade react-hooks v7: o controller nasce fora do render
// (contexto de evento/efeito), refs nunca lidas durante o corpo.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScratchpadController,
  clampScratchText,
  loadScratch,
} from '../features/qol/scratchpad';

export const SCRATCH_KEY_PREFIX = 'solaris.qol.scratch.';

function storageKey(osId: string): string {
  return SCRATCH_KEY_PREFIX + osId;
}

/**
 * @param osId Identificador estável da OS (W.O. da linha); null = guest/sem OS.
 * @param enabled Liga/desliga o painel (ex.: modo foco esconde, mas persiste).
 * @param onCleaned Disparado junto à limpeza por análise oficial salva.
 */
export function useScratchpad(
  osId: string | null,
  enabled: boolean,
  onCleaned?: () => void,
) {
  /** Última gravação confirmada — badge discreto "salvo ✓" da nota. */
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  /** Nota truncada no limite defensivo em algum momento da sessão. */
  const [truncated, setTruncated] = useState(false);

  const controllerRef = useRef<ScratchpadController | null>(null);
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; });
  const cleanedRef = useRef(onCleaned);
  useEffect(() => { cleanedRef.current = onCleaned; });

  /** Cria o controller na primeira necessidade (fora do render). */
  const ensureController = useCallback((): ScratchpadController | null => {
    if (!enabledRef.current || osId === null || typeof window === 'undefined') {
      return null;
    }
    if (!controllerRef.current) {
      controllerRef.current = new ScratchpadController({
        read: () => window.localStorage.getItem(storageKey(osId)),
        write: (payload) => window.localStorage.setItem(storageKey(osId), payload),
        clear: () => window.localStorage.removeItem(storageKey(osId)),
        delayMs: 200,
        onSaved: () => setLastSavedAt(Date.now()),
      });
    }
    return controllerRef.current;
  }, [osId]);

  /**
   * Carga PURA da nota persistida (inicializador de estado / testes).
   * Sem setState: badges nascem zerados porque a montagem é por OS (key).
   */
  const loadOnce = useCallback((): string => {
    if (osId === null || typeof window === 'undefined') return '';
    const entry = loadScratch(() => window.localStorage.getItem(storageKey(osId)));
    return entry?.text ?? '';
  }, [osId]);

  /** Edição chegou → agenda gravação debounced (com clamp defensivo). */
  const scheduleSave = useCallback((text: string) => {
    const clamped = clampScratchText(text);
    setTruncated(clamped.truncated);
    ensureController()?.schedule(clamped.text);
  }, [ensureController]);

  /** Flush imediato (unload/troca de OS/unmount). */
  const flushNow = useCallback(() => {
    ensureController()?.flush();
  }, [ensureController]);

  /** Análise oficialmente salva na planilha → rascunho pessoal sai do storage. */
  const markCleaned = useCallback(() => {
    ensureController()?.markCleaned();
    setLastSavedAt(null);
    cleanedRef.current?.();
  }, [ensureController]);

  // Flush de emergência ao fechar/aba oculta (mesma régua do auto-save).
  useEffect(() => {
    const flush = () => controllerRef.current?.flush();
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  // Análise oficial confirmada em outro componente (handleSave) → limpa aqui.
  // Limpeza NÃO depende do controller ter nascido: nota escrita em sessão
  // anterior precisa sair mesmo sem edição nova nesta.
  useEffect(() => {
    const clean = () => {
      controllerRef.current?.markCleaned();
      if (osId !== null && typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(storageKey(osId));
        } catch {
          /* best-effort */
        }
      }
      setLastSavedAt(null);
    };
    window.addEventListener('solaris:scratch-cleaned', clean);
    return () => window.removeEventListener('solaris:scratch-cleaned', clean);
  }, [osId]);

  // Unmount/troca de OS: grava o pendente antes de morrer.
  useEffect(() => () => { controllerRef.current?.flush(); }, [osId]);

  return { lastSavedAt, truncated, loadOnce, scheduleSave, flushNow, markCleaned } as const;
}

/** Helper p/ testes e uso fora do hook: chave de storage da nota. */
export function scratchKeyFor(osId: string): string {
  return SCRATCH_KEY_PREFIX + osId;
}

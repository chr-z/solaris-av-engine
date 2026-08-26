// Solaris v3 — QoL A1 — hook React do remapeamento de atalhos.
//
// Fonte única de verdade do mapa efetivo: carrega do storage na montagem,
// re-carrega quando qualquer camada grava (evento solaris:shortcuts-changed)
// e devolve as ShortcutDef EFETIVAS p/ matching + ajuda. Gravação é
// validate → commit → save (o evento de hot-reload sai por conseqüência).
//
// Estado derivado em render (padrão da casa, anti-cascata): sem ref-em-render
// nem setState em efeito.

import { useEffect, useState } from 'react';
import {
  loadShortcutMap,
  saveShortcutMap,
  applyShortcutMap,
  validateBinding,
  commitBinding,
  resolveKey,
  type ShortcutMap,
} from '../features/qol/shortcutPrefs';
import { ANALYST_SHORTCUTS } from '../utils/shortcuts';

interface UseShortcutPrefsOptions {
  /** Storage injetável (jsdom/localStorage real/Tauri store). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export interface ShortcutPrefsApi {
  /** Mapa cru id→tecla (só entradas fora do padrão). */
  map: ShortcutMap;
  /** Definições com keys/display resolvidos — passe pro matching e pro help. */
  effectiveDefs: typeof ANALYST_SHORTCUTS;
}

/**
 * Assina as mudanças do mapa: gravações passam por persistBinding OU
 * acontecem noutra camada — ambas terminam recarregando do storage.
 */
export function useShortcutPrefs({ storage }: UseShortcutPrefsOptions = {}): ShortcutPrefsApi {
  const [stableStorage] = useState(storage ?? null);
  const [map, setMap] = useState<ShortcutMap>(() => loadShortcutMap(stableStorage));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reload = () => setMap(loadShortcutMap(stableStorage));
    window.addEventListener('solaris:shortcuts-changed', reload);
    return () => window.removeEventListener('solaris:shortcuts-changed', reload);
  }, [stableStorage]);

  // Derivados em render — map muda ⇒ defs mudam junto, zero effect.
  const effectiveDefs = applyShortcutMap(map);

  return { map, effectiveDefs };
}

/** Tecla efetiva fora do hook (componentes pontuais). */
export function keyForId(map: ShortcutMap, id: string): string {
  return resolveKey(id, map);
}

/**
 * Grava uma atribuição validando contra o mapa atual; retorna o veredito
 * pra UI exibir o motivo quando recusa. Sucesso dispara o evento global.
 */
export function persistBinding(
  map: ShortcutMap,
  id: string,
  key: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof window !== 'undefined'
    ? window.localStorage
    : null,
) {
  const verdict = validateBinding(id, key, map);
  if (!verdict.ok) return verdict;
  saveShortcutMap(storage, commitBinding(map, id, key)); // dispara solaris:shortcuts-changed
  return verdict;
}

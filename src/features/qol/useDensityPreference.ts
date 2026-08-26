// Solaris v3 — F2 QoL — hook de densidade persistente (confortável/compacta).
//
// Fonte externa canônica via useSyncExternalStore (mesmo padrão do
// useThemePreference): sem setState em effect, sem leitura impura no render.
// A classe de densidade é aplicada por EFEITO declarado, nunca imperativamente
// dentro do setter — aba cruzada e outra aba do mesmo perfil refletem ao vivo.

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  applyDensityToDocument,
  readStoredDensity,
  sanitizeDensityPref,
  DENSITY_STORAGE_KEY,
  type DensityPreference,
} from './density';

const CHANGE_EVENT = 'solaris:density-changed';

function subscribeToDensity(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Preferência gravada; re-lida a cada notificação (aba cruzada incluída). */
function getDensitySnapshot(): DensityPreference {
  return readStoredDensity();
}

/** Sem hidratação/SSR neste app: decorativo → sempre o default confortável. */
function getDensityServerSnapshot(): DensityPreference {
  return 'comfortable';
}

export interface DensityApi {
  pref: DensityPreference;
  isCompact: boolean;
  setPref: (next: DensityPreference) => void;
}

/** Estado de densidade da sessão. Persistência best-effort + classe via efeito. */
export function useDensityPreference(): DensityApi {
  const pref = useSyncExternalStore(subscribeToDensity, getDensitySnapshot, getDensityServerSnapshot);
  const isCompact = pref === 'compact';

  useEffect(() => {
    applyDensityToDocument(pref);
  }, [pref]);

  const setPref = useCallback((next: DensityPreference) => {
    const safe = sanitizeDensityPref(next);
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, safe);
    } catch {
      // quota/incógnito: a escolha vale pra esta sessão do mesmo jeito
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { pref, isCompact, setPref };
}

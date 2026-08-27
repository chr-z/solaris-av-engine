// Solaris v3 — F2 QoL — hook de tema persistente (system/light/dark).
//
// Fonte externa canônica via useSyncExternalStore (mesmo padrão do
// AchievementToast): sem setState em effect, sem leitura impura no render.
// A classe 'dark' é aplicada por EFEITO declarado (pref + sistema atuais),
// nunca imperativamente dentro do setter — sobrevive a mudança do sistema.

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  applyThemeToDocument,
  DARK_MEDIA_QUERY,
  readStoredTheme,
  resolveDark,
  sanitizeThemePref,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from './theme';

const CHANGE_EVENT = 'solaris:theme-changed';

function subscribeToTheme(onChange: () => void): () => void {
  const mql =
    typeof window.matchMedia === 'function' ? window.matchMedia(DARK_MEDIA_QUERY) : null;
  mql?.addEventListener('change', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    mql?.removeEventListener('change', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Preferência gravada; re-lida a cada notificação (aba cruzada incluída). */
function getThemeSnapshot(): ThemePreference {
  return readStoredTheme();
}

/** Sem hidratação/SSR neste app: decorativo → sempre o fallback escuro-first. */
function getThemeServerSnapshot(): ThemePreference {
  return 'system';
}

export interface ThemeApi {
  pref: ThemePreference;
  isDark: boolean;
  setPref: (next: ThemePreference) => void;
}

/**
 * Estado de tema da sessão. Persistência best-effort + aplicação no
 * <html> por efeito. O menu de UI vive em components/Layout/ThemeMenu.
 */
export function useThemePreference(): ThemeApi {
  const pref = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getThemeServerSnapshot);
  const isDark = resolveDark(pref, systemPrefersDark());

  useEffect(() => {
    applyThemeToDocument(isDark);
  }, [isDark]);

  const setPref = useCallback((next: ThemePreference) => {
    const safe = sanitizeThemePref(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, safe);
    } catch {
      // quota/incógnito: a escolha vale pra esta sessão do mesmo jeito
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { pref, isDark, setPref };
}

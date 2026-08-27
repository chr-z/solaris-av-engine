// Solaris v3 — Feature Pack "Analista Feliz" — A2 Tema claro/escuro/sistema.
//
// Núcleo puro (sanitização/resolução) + helpers imperativos mínimos de DOM
// claramente separados. O app é dark-first: sem preferência gravada, segue o
// sistema; fallback de ambiente sem matchMedia = escuro (comportamento atual).
//
// Persistência: localStorage best-effort (quota/privacidade nunca derrubam a UI).
// Zero dependências. O hook/menu React vive em components/Layout (convenção da casa).

/** Chave única de preferência (valor: 'system' | 'light' | 'dark'). */
export const THEME_STORAGE_KEY = 'solaris.theme';

export type ThemePreference = 'system' | 'light' | 'dark';

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * Qualquer lixo vira 'system' (nunca quebra por storage corrompido/antigo).
 * String vazia/null/undefined/número → 'system'.
 */
export function sanitizeThemePref(raw: unknown): ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/** Resolução honesta: só o sistema decide quando a preferência É o sistema. */
export function resolveDark(pref: ThemePreference, systemDark: boolean): boolean {
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return systemDark;
}

/** Leitura tolerante do storage; ambiente sem localStorage → 'system'. */
export function readStoredTheme(
  read: () => string | null = () =>
    typeof localStorage === 'undefined' ? null : localStorage.getItem(THEME_STORAGE_KEY),
): ThemePreference {
  try {
    return sanitizeThemePref(read());
  } catch {
    return 'system';
  }
}

/** Escrita best-effort; quota/incógnito falham em silêncio (UI continua de pé). */
export function writeStoredTheme(
  pref: ThemePreference,
  write: (value: string) => void = (value) => {
    localStorage.setItem(THEME_STORAGE_KEY, value);
  },
): void {
  try {
    write(pref);
  } catch {
    // best-effort por design
  }
}

/** Consulta o sistema; sem matchMedia (jsdom antigo/SSR) assume escuro. */
export function systemPrefersDark(
  query: (q: string) => boolean = (q) =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(q).matches,
): boolean {
  try {
    return query(DARK_MEDIA_QUERY);
  } catch {
    return true;
  }
}

/** Aplica a classe no <html> (tailwind darkMode:'class'). Idempotente. */
export function applyThemeToDocument(dark: boolean, el: { classList: DOMTokenList } = document.documentElement): void {
  el.classList.toggle('dark', dark);
}

/** Estado inicial da pintura: lê storage + sistema e aplica uma vez. */
export function applyInitialTheme(): void {
  applyThemeToDocument(resolveDark(readStoredTheme(), systemPrefersDark()));
}

/**
 * SOLARIS i18n core — pure, framework-free logic (testable without JSX transforms).
 * The React bindings live in I18nContext.tsx.
 */
import { dictionaries } from './translations';

export type Locale = keyof typeof dictionaries; // 'en' | 'pt'

export const STORAGE_KEY = 'solaris.locale';
export const DEFAULT_LOCALE: Locale = 'pt';

export function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && stored in dictionaries) return stored as Locale;
  } catch {
    /* storage unavailable — fall through to browser language */
  }
  const browserLang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : '';
  if (!browserLang) return DEFAULT_LOCALE;
  return browserLang.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage unavailable — persistence is best-effort */
  }
}

/** Interpolates `{token}` placeholders; missing tokens resolve to ''. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
    const value = params[token];
    return value === undefined || value === null ? '' : String(value);
  });
}

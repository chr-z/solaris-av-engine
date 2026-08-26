// Solaris v3 — Feature Pack "Analista Feliz" — A2 Densidade confortável/compacta.
//
// Núcleo puro (sanitização) — mesmo desenho do theme.ts: persistência
// localStorage best-effort, lixo nunca derruba a UI, zero dependências.
// A aplicação visual é declarativa (classe no <html> via efeito do hook),
// espelhando exatamente o contrato do tema claro/escuro.
//
// Compacto = tabelas/listas com padding vertical reduzido e fontes um passo
// abaixo (CSS em styles/index.css mira `html.solaris-density-compact`).

/** Chave única de preferência (valor: 'comfortable' | 'compact'). */
export const DENSITY_STORAGE_KEY = 'solaris.density';

export type DensityPreference = 'comfortable' | 'compact';

/** Classe aplicada no <html> quando a densidade compacta está ativa. */
export const COMPACT_CLASS = 'solaris-density-compact';

/** Qualquer lixo vira 'comfortable' (default da casa). */
export function sanitizeDensityPref(raw: unknown): DensityPreference {
  return raw === 'compact' ? 'compact' : 'comfortable';
}

/** Leitura tolerante do storage; ambiente sem localStorage → 'comfortable'. */
export function readStoredDensity(
  read: () => string | null = () =>
    typeof localStorage === 'undefined' ? null : localStorage.getItem(DENSITY_STORAGE_KEY),
): DensityPreference {
  try {
    return sanitizeDensityPref(read());
  } catch {
    return 'comfortable';
  }
}

/** Escrita best-effort; quota/incógnito falham em silêncio (UI continua de pé). */
export function writeStoredDensity(
  pref: DensityPreference,
  write: (value: string) => void = (value) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, value);
  },
): void {
  try {
    write(pref);
  } catch {
    // best-effort por design
  }
}

/**
 * Aplica/reflete a classe no <html>. Idempotente por design: chamar com o
 * mesmo valor não muda nada; 'comfortable' SEMPRE remove a classe.
 */
export function applyDensityToDocument(
  pref: DensityPreference,
  el: { classList: DOMTokenList } = document.documentElement,
): void {
  el.classList.toggle(COMPACT_CLASS, pref === 'compact');
}

/** Pintura inicial da densidade (espelho de applyInitialTheme do tema). */
export function applyInitialDensity(): void {
  applyDensityToDocument(readStoredDensity());
}

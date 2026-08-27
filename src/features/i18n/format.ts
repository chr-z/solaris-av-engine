// Solaris v3 — Feature Pack "Analista Feliz" — Troca tecnológica D #3
// (date-fns + Intl) na forma honesta pro nosso domínio:
//
// O CÁLCULO de calendário (chaves de semana/mês/ano, reset segunda 00h,
// fuso fixo -03:00) JÁ É PURA E TESTADA em ../gamification/periods.ts —
// reintroduzi-lo via date-fns seria dependência nova (~70KB min) resolvendo
// problema que não temos. O GAP real era FORMATAÇÃO: chaves cruas tipo
// "week · 2026-08-24" vazando pra UI (histórico de pódios, spec C2 pede
// literalmente "Março/2026 — quem ganhou?") e chamadas toLocale*() que
// dependem do relógio/fuso DO HOST (jsdom, desktop, nuvem — cada um dá um
// resultado). Este módulo fecha os dois com Intl nativo (zero bytes de
// bundle) ancorado no MESMO fuso fixo do pódio.
//
// Regras:
// - Nunca usa métodos locais do host nem timeZone implícito: toda formatação
//   passa por timeZone:'UTC' sobre um instante deslocado pelo offset do
//   PodiumClockConfig (mesma técnica de localParts em periods.ts).
// - Formatters são caros de construir → cache por (tag+opções).
// - Total: entrada inválida (NaN/Infinity) devolve '—', nunca lança.

import type { PodiumClockConfig } from '../gamification/periods';
import { localParts } from '../gamification/periods';

export type FormatLocale = 'pt' | 'en';

const localeTag = (lang: FormatLocale): string => (lang === 'pt' ? 'pt-BR' : 'en-US');

const INVALID = '—';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(tag: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tag}|${JSON.stringify(options)}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(tag, { ...options, timeZone: 'UTC' });
    formatterCache.set(key, fmt);
  }
  return fmt;
}

function shiftedDate(epochMs: number, cfg: PodiumClockConfig): Date | null {
  if (!Number.isFinite(epochMs)) return null;
  return new Date(epochMs + cfg.tzOffsetMinutes * 60_000);
}

/**
 * Hora curta HH:MM no fuso FIXO configurado (não o do host).
 * Ex.: 02:30 UTC com cfg -180min ⇒ '23:30' do dia anterior.
 */
export function formatClockInTz(epochMs: number, lang: FormatLocale, cfg: PodiumClockConfig): string {
  const d = shiftedDate(epochMs, cfg);
  if (!d) return INVALID;
  return cachedFormatter(localeTag(lang), { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** Data curta DD/MM/YYYY (pt) ou MM/DD/YYYY (en) no fuso fixo. */
export function formatDateInTz(epochMs: number, lang: FormatLocale, cfg: PodiumClockConfig): string {
  const d = shiftedDate(epochMs, cfg);
  if (!d) return INVALID;
  return cachedFormatter(localeTag(lang), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** Data + hora juntas no fuso fixo — badge de auto-save, feeds de eventos. */
export function formatTimestampInTz(
  epochMs: number,
  lang: FormatLocale,
  cfg: PodiumClockConfig,
): string {
  if (!Number.isFinite(epochMs)) return INVALID;
  return `${formatDateInTz(epochMs, lang, cfg)} ${formatClockInTz(epochMs, lang, cfg)}`;
}

export type PeriodKeyType = 'week' | 'month' | 'year';

/**
 * Constrói Date UTC a partir de partes de chave VALIDANDO FAIXA e
 * round-trip. Sem isso, Date.UTC(2026, 12, 99) silenciosamente rola
 * para setembro/2027 e o rótulo INVENTA um período que nunca existiu.
 * Devolve null em qualquer parte impossível (mês 13, dia 99, 30 de fev).
 */
function utcDateFromKeyParts(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null; // ex.: 30 de fevereiro — rollover detectado
  }
  return d;
}

const WEEK_PREFIX: Record<FormatLocale, string> = {
  pt: 'Semana de',
  en: 'Week of',
};

/**
 * Rótulo humano i18n de uma chave de período vinda de periods.ts/
 * podiumFreeze.ts (podium_history, histórico navegável da Liga).
 *   month '2026-03' → pt 'março de 2026' / en 'March 2026'
 *   year  '2026'    → '2026'
 *   week  '2026-08-24' → pt 'Semana de 24/08/2026' / en 'Week of 08/24/2026'
 * Chave malformada devolve a chave crua (nunca inventa período).
 */
export function formatPeriodLabel(
  type: PeriodKeyType,
  key: string,
  lang: FormatLocale,
): string {
  if (type === 'year') {
    return /^\d{4}$/.test(key) ? key : key;
  }

  if (type === 'month') {
    const m = key.match(/^(\d{4})-(\d{2})$/);
    if (!m) return key;
    // Dia 15 evita bordas de mês em qualquer fuso.
    const d = utcDateFromKeyParts(Number(m[1]), Number(m[2]), 15);
    if (!d) return key;
    return cachedFormatter(localeTag(lang), { month: 'long', year: 'numeric' }).format(d);
  }

  // week: chave é o dia local em que a semana começou ('YYYY-MM-DD').
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return key;
  const d = utcDateFromKeyParts(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!d) return key;
  const pretty = cachedFormatter(localeTag(lang), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
  return `${WEEK_PREFIX[lang]} ${pretty}`;
}

/**
 * Rótulo curto do MÊS corrente no fuso do pódio — cabeçalho de cards/pódios
 * ao vivo (ex.: 'agosto de 2026'). Deriva do instante, nunca do host.
 */
export function currentMonthLabel(epochMs: number, lang: FormatLocale, cfg: PodiumClockConfig): string {
  const p = localParts(epochMs, cfg);
  return formatPeriodLabel('month', `${p.year}-${String(p.month).padStart(2, '0')}`, lang);
}

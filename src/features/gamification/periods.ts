// Solaris v3 — Feature Pack "Analista Feliz" — F3 Gamificação.
//
// Períodos de pódio (Semana/Mês/Ano) em fuso FIXO configurável — padrão
// America/São_Paulo (UTC-03:00, sem horário de verão vigente). Tudo PURO:
// recebe epoch ms e devolve chaves/instantes determinísticos. Nada de
// métodos locais do host (getDay/getHours), senão o reset da segunda 00h
// vira loteria dependendo do relógio da máquina (spec C2).

export interface PodiumClockConfig {
  /** Offset do fuso em minutos a SOMAR ao UTC (ex.: -180 p/ UTC-03:00). */
  tzOffsetMinutes: number;
  /** Dia que abre a semana (0=domingo, 1=segunda). Spec C2: segunda. */
  weekStartsOn: 0 | 1;
}

/** Fuso canônico do Gran/Solaris (decisão F3: fixo, não do host). */
export const SAO_PAULO_CLOCK: PodiumClockConfig = {
  tzOffsetMinutes: -180,
  weekStartsOn: 1,
};

export const MS_PER_DAY = 86_400_000;

export interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;   // 1–31
  weekday: number; // 0=domingo … 6=sábado (no fuso configurado)
  hour: number;
  minute: number;
  second: number;
}

/** Partes de calendário no fuso do pódio (nunca as do host). */
export function localParts(epochMs: number, cfg: PodiumClockConfig): LocalParts {
  const shifted = new Date(epochMs + cfg.tzOffsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

function p2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' do dia local em que o instante cai. */
export function localDayKey(epochMs: number, cfg: PodiumClockConfig): string {
  const p = localParts(epochMs, cfg);
  return `${p.year}-${p2(p.month)}-${p2(p.day)}`;
}

/**
 * Chave da semana ABERTA no instante = dia local em que a semana começou.
 * Segunda 00:00 local abre semana nova; domingo 23:59 ainda é a semana anterior.
 * Formato: 'YYYY-MM-DD' (a data do início da semana).
 */
export function weekKey(epochMs: number, cfg: PodiumClockConfig): string {
  const p = localParts(epochMs, cfg);
  const backDays = (p.weekday - cfg.weekStartsOn + 7) % 7;
  return localDayKey(epochMs - backDays * MS_PER_DAY, cfg);
}

/** Chave do mês civil local: 'YYYY-MM'. */
export function monthKey(epochMs: number, cfg: PodiumClockConfig): string {
  const p = localParts(epochMs, cfg);
  return `${p.year}-${p2(p.month)}`;
}

/** Chave do ano civil local: 'YYYY'. */
export function yearKey(epochMs: number, cfg: PodiumClockConfig): string {
  return String(localParts(epochMs, cfg).year);
}

/** Epoch ms do início LOCAL (00:00) de um dia-chave 'YYYY-MM-DD'. */
export function dayStartInstant(key: string, cfg: PodiumClockConfig): number {
  const d = parseDayKey(key);
  return Date.UTC(d.year, d.month - 1, d.day) - cfg.tzOffsetMinutes * 60_000;
}

export function parseDayKey(key: string): { year: number; month: number; day: number } {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`dayKey inválido: ${key}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Instante em que a semana-chave começou (segunda 00:00 local). */
export function weekStartInstant(key: string, cfg: PodiumClockConfig): number {
  return dayStartInstant(key, cfg);
}

/** Instante em que o mês-chave começou (dia 1, 00:00 local). */
export function monthStartInstant(key: string, cfg: PodiumClockConfig): number {
  const m = key.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`monthKey inválido: ${key}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) - cfg.tzOffsetMinutes * 60_000;
}

/** Instante em que o ano-chave começou (1º jan, 00:00 local). */
export function yearStartInstant(key: string, cfg: PodiumClockConfig): number {
  if (!/^\d{4}$/.test(key)) throw new Error(`yearKey inválido: ${key}`);
  return Date.UTC(Number(key), 0, 1) - cfg.tzOffsetMinutes * 60_000;
}

/** Próxima chave do mesmo tipo (semana seguinte/mês seguinte/ano seguinte). */
export function nextPeriodKey(
  type: 'week' | 'month' | 'year',
  key: string,
  cfg: PodiumClockConfig,
): string {
  if (type === 'week') return localDayKey(weekStartInstant(key, cfg) + 7 * MS_PER_DAY, cfg);
  if (type === 'month') {
    const m = key.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new Error(`monthKey inválido: ${key}`);
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return mo === 12 ? `${y + 1}-01` : `${y}-${p2(mo + 1)}`;
  }
  return String(Number(key) + 1);
}

/** Intervalo meio-aberto [início, próximo início) de um período FECHADO. */
export function closedPeriodRange(
  type: 'week' | 'month' | 'year',
  key: string,
  cfg: PodiumClockConfig,
): { fromMs: number; toMs: number } {
  const from =
    type === 'week'
      ? weekStartInstant(key, cfg)
      : type === 'month'
        ? monthStartInstant(key, cfg)
        : yearStartInstant(key, cfg);
  const next = nextPeriodKey(type, key, cfg);
  const to =
    type === 'week'
      ? weekStartInstant(next, cfg)
      : type === 'month'
        ? monthStartInstant(next, cfg)
        : yearStartInstant(next, cfg);
  return { fromMs: from, toMs: to };
}

/** Chave do período corrente agora (p/ detectar virada e congelar snapshot). */
export function currentPeriodKey(
  type: 'week' | 'month' | 'year',
  epochMs: number,
  cfg: PodiumClockConfig,
): string {
  if (type === 'week') return weekKey(epochMs, cfg);
  if (type === 'month') return monthKey(epochMs, cfg);
  return yearKey(epochMs, cfg);
}

/** O período armazenado (chave aberta) já virou? → hora de congelar o pódio. */
export function shouldClosePeriod(
  type: 'week' | 'month' | 'year',
  openKey: string,
  nowMs: number,
  cfg: PodiumClockConfig,
): boolean {
  return currentPeriodKey(type, nowMs, cfg) !== openKey;
}

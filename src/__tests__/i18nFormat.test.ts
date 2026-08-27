// Solaris v3 — Testes da troca D #3 (Intl puro, fuso fixo do pódio).
// Contrato central: NENHUMA saída depende do relógio/fuso do HOST —
// valores exatos abaixo provam isso no jsdom (que herda o TZ da máquina).

import { describe, it, expect } from 'vitest';
import {
  formatClockInTz,
  formatDateInTz,
  formatTimestampInTz,
  formatPeriodLabel,
  currentMonthLabel,
} from '../features/i18n/format';
import { SAO_PAULO_CLOCK, weekKey, monthKey } from '../features/gamification/periods';

const CFG = SAO_PAULO_CLOCK; // UTC-03:00, semana abre na segunda

describe('formatClockInTz (fuso fixo, nunca o do host)', () => {
  it('desloca 02:30Z para 23:30 do dia anterior em UTC-03:00', () => {
    // 2026-08-25T02:30:00Z == 23:30 de 24/08 em São Paulo
    const t = Date.UTC(2026, 7, 25, 2, 30);
    expect(formatClockInTz(t, 'pt', CFG)).toBe('23:30');
    // ICU moderno: hour12:false devolve relógio de 24h mesmo em en-US
    // (comportamento desejado pra ferramenta QC — sem ambiguidade AM/PM).
    expect(formatClockInTz(t, 'en', CFG)).toBe('23:30');
  });

  it('meia-noite local (03:00Z) formata 00:00', () => {
    const t = Date.UTC(2026, 7, 25, 3, 0);
    expect(formatClockInTz(t, 'pt', CFG)).toBe('00:00');
  });

  it('entrada inválida devolve travessão, nunca lança', () => {
    expect(formatClockInTz(NaN, 'pt', CFG)).toBe('—');
    expect(formatClockInTz(Infinity, 'en', CFG)).toBe('—');
  });
});

describe('formatDateInTz / formatTimestampInTz', () => {
  const t = Date.UTC(2026, 2, 1, 0, 45); // 28/02/2026 21:45 em São Paulo

  it('data curta por idioma (DD/MM vs MM/DD)', () => {
    expect(formatDateInTz(t, 'pt', CFG)).toBe('28/02/2026');
    expect(formatDateInTz(t, 'en', CFG)).toBe('02/28/2026');
  });

  it('timestamp composto data+hora no fuso fixo', () => {
    expect(formatTimestampInTz(t, 'pt', CFG)).toBe('28/02/2026 21:45');
    expect(formatTimestampInTz(t, 'en', CFG)).toBe('02/28/2026 21:45');
  });

  it('inválido → travessão nos dois formatos', () => {
    expect(formatTimestampInTz(Number.NaN, 'pt', CFG)).toBe('—');
  });
});

describe('formatPeriodLabel (chaves cruas do podium_history → humano)', () => {
  it("month '2026-03' vira 'março de 2026' (pt) e 'March 2026' (en)", () => {
    expect(formatPeriodLabel('month', '2026-03', 'pt')).toBe('março de 2026');
    expect(formatPeriodLabel('month', '2026-03', 'en')).toBe('March 2026');
  });

  it("year '2026' passa direto", () => {
    expect(formatPeriodLabel('year', '2026', 'pt')).toBe('2026');
    expect(formatPeriodLabel('year', '2026', 'en')).toBe('2026');
  });

  it("week '2026-08-24' ganha prefixo i18n ('Semana de'/'Week of')", () => {
    expect(formatPeriodLabel('week', '2026-08-24', 'pt')).toBe('Semana de 24/08/2026');
    expect(formatPeriodLabel('week', '2026-08-24', 'en')).toBe('Week of 08/24/2026');
  });

  it('chave malformada volta crua — nunca inventa período', () => {
    expect(formatPeriodLabel('month', 'lixo', 'pt')).toBe('lixo');
    expect(formatPeriodLabel('week', '2026-13-99', 'en')).toBe('2026-13-99');
    expect(formatPeriodLabel('year', 'seculo-XX', 'pt')).toBe('seculo-XX');
  });
});

describe('integração com periods.ts (mesmo fuso, chaves e rótulos coerentes)', () => {
  it('rótulo do mês corrente bate com monthKey derivado', () => {
    // 2026-09-01T01:30Z ainda é agosto em São Paulo (31/08 22:30).
    const t = Date.UTC(2026, 8, 1, 1, 30);
    expect(monthKey(t, CFG)).toBe('2026-08');
    expect(currentMonthLabel(t, 'pt', CFG)).toBe('agosto de 2026');
    expect(currentMonthLabel(t, 'en', CFG)).toBe('August 2026');
  });

  it('weekKey → rótulo ida-e-volta sem surpresa', () => {
    // Quarta-feira 26/08/2026 cai na semana que abreu segunda 24/08.
    const t = Date.UTC(2026, 7, 26, 15, 0);
    expect(weekKey(t, CFG)).toBe('2026-08-24');
    expect(formatPeriodLabel('week', weekKey(t, CFG), 'pt')).toBe('Semana de 24/08/2026');
  });
});

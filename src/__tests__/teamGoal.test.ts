// Solaris v3 — C4 modo time: testes do núcleo teamGoal.ts
import { describe, it, expect, vi } from 'vitest';
import {
  TEAM_GOAL_KEY,
  loadTeamGoal,
  saveTeamGoal,
  teamProgress,
  goalStatus,
  type XpEventInput,
} from '../features/gamification/teamGoal';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

const T0 = Date.UTC(2026, 7, 3, 12, 0, 0); // 03/08/2026 (segunda)
const HOUR = 3_600_000;

function ev(amount: number, ts: number, userId?: string): XpEventInput {
  return { amount, ts, userId };
}

describe('loadTeamGoal', () => {
  it('storage nulo / chave ausente → desligado (null)', () => {
    expect(loadTeamGoal(null)).toBeNull();
    expect(loadTeamGoal(fakeStorage())).toBeNull();
  });

  it('valor válido vira config inteira', () => {
    expect(loadTeamGoal(fakeStorage({ [TEAM_GOAL_KEY]: '5000' }))).toEqual({ monthlyXp: 5000 });
  });

  it('lixo rejeitado: zero, negativo, decimal, NaN-string', () => {
    const s = (v: string) => fakeStorage({ [TEAM_GOAL_KEY]: v });
    expect(loadTeamGoal(s('0'))).toBeNull();
    expect(loadTeamGoal(s('-100'))).toBeNull();
    expect(loadTeamGoal(s('12.5'))).toBeNull();
    expect(loadTeamGoal(s('muito-xp'))).toBeNull();
  });
});

describe('saveTeamGoal', () => {
  it('grava inteiro e dispara evento de hot-reload', () => {
    const s = fakeStorage();
    const target = { dispatchEvent: vi.fn() };
    expect(saveTeamGoal(s as unknown as Storage, 8000, target as unknown as Window)).toBe(true);
    expect(s.getItem(TEAM_GOAL_KEY)).toBe('8000');
    expect(target.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('null remove a chave (desliga sem lixo no storage)', () => {
    const s = fakeStorage({ [TEAM_GOAL_KEY]: '8000' });
    expect(saveTeamGoal(s as unknown as Storage, null, null)).toBe(true);
    expect(s.getItem(TEAM_GOAL_KEY)).toBeNull();
  });

  it('meta inválida lança TypeError ANTES de tocar storage e sem evento', () => {
    const s = fakeStorage();
    const target = { dispatchEvent: vi.fn() };
    expect(() => saveTeamGoal(s as unknown as Storage, 0, target as unknown as Window)).toThrow(TypeError);
    expect(() => saveTeamGoal(s as unknown as Storage, -5, target as unknown as Window)).toThrow(TypeError);
    expect(() => saveTeamGoal(s as unknown as Storage, 99.9, target as unknown as Window)).toThrow(TypeError);
    expect(s.getItem(TEAM_GOAL_KEY)).toBeNull();
    expect(target.dispatchEvent).not.toHaveBeenCalled();
  });

  it('setItem que lança → retorna false (best-effort), não explode', () => {
    const boom = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined };
    expect(saveTeamGoal(boom as unknown as Storage, 100, null)).toBe(false);
  });
});

describe('teamProgress', () => {
  const events: XpEventInput[] = [
    ev(100, T0 + 1 * HOUR, 'ana'),
    ev(150, T0 + 2 * HOUR, 'ana'), // quality bonus
    ev(100, T0 + 3 * HOUR, 'bruno'),
    ev(-150, T0 + 4 * HOUR, 'bruno'), // retrabalho estorna
    ev(100, T0 + 5 * HOUR, 'carla'),
    ev(999, T0 - 1 * HOUR, 'ana'), // antes da janela
    ev(999, T0 + 99 * HOUR, 'ana'), // depois da janela
    ev(500, T0 + 6 * HOUR, 'zeca'), // fora do roster
  ];

  it('soma SÓ membros do roster dentro da janela; retrabalho reduz', () => {
    const r = teamProgress(events, ['ana', 'bruno'], T0, T0 + 48 * HOUR);
    expect(r.byUser.get('ana')).toBe(250);
    expect(r.byUser.get('bruno')).toBe(-50); // 100 - 150
    expect(r.total).toBe(200);
  });

  it('roster vazio = time zero; roster com fantasma = 0 pro membro', () => {
    expect(teamProgress(events, [], T0, T0 + 48 * HOUR).total).toBe(0);
    const r = teamProgress(events, ['fantasma'], T0, T0 + 48 * HOUR);
    expect(r.byUser.get('fantasma')).toBe(0);
    expect(r.total).toBe(0);
  });

  it('janela meio-aberta: limite inferior entra, superior não', () => {
    const r = teamProgress([ev(100, T0, 'ana'), ev(100, T0 + 48 * HOUR, 'ana')], ['ana'], T0, T0 + 48 * HOUR);
    expect(r.total).toBe(100);
  });

  it('evento sem userId nunca conta pra ninguém', () => {
    const r = teamProgress([ev(100, T0 + 1 * HOUR)], ['ana'], T0, T0 + 2 * HOUR);
    expect(r.byUser.get('ana')).toBe(0);
    expect(r.total).toBe(0);
  });
});

describe('goalStatus', () => {
  it('parcial, batida exata e superação', () => {
    const parcial = goalStatus(300, 1000);
    expect(parcial.pct).toBeCloseTo(30);
    expect(parcial.remaining).toBe(700);
    expect(parcial.met).toBe(false);

    const exata = goalStatus(1000, 1000);
    expect(exata.met).toBe(true);
    expect(exata.remaining).toBe(0);

    const acima = goalStatus(1250, 1000);
    expect(acima.met).toBe(true);
    expect(acima.remaining).toBe(0);
    expect(acima.pct).toBeCloseTo(125);
  });

  it('defensivo: meta 0 tratada como 1 (nunca divide por zero)', () => {
    const r = goalStatus(5, 0);
    expect(r.pct).toBe(500);
    expect(r.met).toBe(true);
  });
});

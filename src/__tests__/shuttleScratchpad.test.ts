// Solaris v3 — A2 shuttle + A1 scratchpad — bordas (TDD fixado).
import { describe, it, expect } from 'vitest';
import { pulseShuttle, INITIAL_SHUTTLE_STATE, rateAt, formatRate, SHUTTLE_RATES, type ShuttleState } from '../features/qol/shuttle';
import { SCRATCH_CHAR_LIMIT, loadScratch, clampScratchText, ScratchpadController } from '../features/qol/scratchpad';

describe('A2 shuttle', () => {
  it('inicia em 1x', () => expect(rateAt(INITIAL_SHUTTLE_STATE.index)).toBe(1));
  it('mesma direção sobe até topo, clamp', () => {
    let s = INITIAL_SHUTTLE_STATE;
    for (let i = 0; i < 10; i++) s = pulseShuttle(s, 'up');
    expect(s.index).toBe(SHUTTLE_RATES.length - 1);
  });
  it('troca de direção reseta ao 1x (não desenha degrau extra)', () => {
    const before: ShuttleState = { index: 4, lastDirection: 'up' };
    const s = pulseShuttle(before, 'down');
    expect(rateAt(s.index)).toBe(1);
  });
  it('formatRate resolve pt-BR', () => {
    expect(formatRate(0.5)).toBe('0,5×');
    expect(formatRate(1)).toBe('1×');
  });
});

describe('A1 scratchpad', () => {
  const now = () => 1_800_000_000_000;
  it('nota expirada (>30d) rejeitada', () => {
    const old = JSON.stringify({ text: 'x', savedAt: now() - 31 * 86400000 });
    expect(loadScratch(() => old, now)).toBeNull();
  });
  it('clamp truncado com flag', () => {
    const res = clampScratchText('b'.repeat(SCRATCH_CHAR_LIMIT + 5));
    expect(res.text.length).toBe(SCRATCH_CHAR_LIMIT);
    expect(res.truncated).toBe(true);
  });
  it('controller flush grava único', () => {
    const w: string[] = [];
    const c = new ScratchpadController({ read: () => null, write: (p) => w.push(p), schedule: (f) => { setTimeout(f, 10); return () => {}; }, now });
    c.schedule('t');
    c.flush();
    expect(w.length).toBe(1);
    expect(JSON.parse(w[0]).text).toBe('t');
  });
});

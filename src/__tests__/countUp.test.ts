import { describe, it, expect } from 'vitest';
import { easeOutCubic, countFrame } from '../utils/countUp';

describe('easeOutCubic', () => {
    it('é 0 em t=0 e exatamente 1 em t=1', () => {
        expect(easeOutCubic(0)).toBe(0);
        expect(easeOutCubic(1)).toBe(1);
    });

    it('acelera no início (t=0.5 já está a 87.5% do caminho)', () => {
        expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    });

    it('faz clamp de t fora de [0,1]', () => {
        expect(easeOutCubic(-0.5)).toBe(0);
        expect(easeOutCubic(2)).toBe(1);
    });
});

describe('countFrame', () => {
    it('faz snap EXATAMENTE no destino quando elapsed >= duração', () => {
        // sem resíduo de float: o último frame é idêntico ao texto estático
        expect(countFrame(900, 900, 0, 115)).toBe(115);
        expect(countFrame(1500, 900, 0, 42.7)).toBe(42.7);
    });

    it('interpola com ease-out no meio da animação', () => {
        // metade do tempo → 87.5% do valor (from=0)
        expect(countFrame(450, 900, 0, 100)).toBeCloseTo(87.5);
    });

    it('vai direto ao destino com duração <= 0 (reduced-motion / opt-out)', () => {
        expect(countFrame(0, 0, 0, 77)).toBe(77);
        expect(countFrame(5, -1, 0, 77)).toBe(77);
    });

    it('destino não finito vira 0 (guard)', () => {
        expect(countFrame(100, 900, 0, NaN)).toBe(0);
        expect(countFrame(100, 900, 0, Infinity)).toBe(0);
    });

    it('retorna o destino imediatamente quando destino == origem', () => {
        expect(countFrame(0, 900, 33, 33)).toBe(33);
    });

    it('elapsed negativo é tratado como frame inicial', () => {
        expect(countFrame(-10, 900, 0, 100)).toBeCloseTo(0);
    });

    it('interpola de origem não-zero corretamente', () => {
        // from=20, to=120: no meio do tempo, 20 + 100*0.875 = 107.5
        expect(countFrame(450, 900, 20, 120)).toBeCloseTo(107.5);
    });
});

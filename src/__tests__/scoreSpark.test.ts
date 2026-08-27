import { describe, it, expect } from 'vitest';
import {
    categoryFractions,
    sparkPoints,
    SCORE_SPARK_W,
    SCORE_SPARK_H,
} from '../utils/scoreSpark';

describe('scoreSpark: categoryFractions', () => {
    it('frações nota/máximo na ordem recebida (seed 2025 real)', () => {
        const cats = [
            { maxScore: 1.27, finalScore: 1.27 },
            { maxScore: 0.87, finalScore: 0.435 },
            { maxScore: 1.22, finalScore: 0 },
            { maxScore: 0.7, finalScore: 0.7 },
            { maxScore: 0.94, finalScore: 0.47 },
        ];
        expect(categoryFractions(cats)).toEqual([1, 0.5, 0, 1, 0.5]);
    });

    it('máximo <= 0 ou não finito → fração 0 (nunca NaN/Infinity)', () => {
        expect(categoryFractions([{ maxScore: 0, finalScore: 0 }])).toEqual([0]);
        expect(
            categoryFractions([{ maxScore: -1, finalScore: 0.5 }]),
        ).toEqual([0]);
        expect(
            categoryFrationsNaN(),
        );
    });

    it('nota não finita → 0; nota acima do máximo → clamp em 1', () => {
        expect(
            categoryFractions([{ maxScore: 1.2, finalScore: NaN }]),
        ).toEqual([0]);
        expect(
            categoryFractions([{ maxScore: 1.2, finalScore: Infinity }]),
        ).toEqual([0]);
        expect(
            categoryFractions([{ maxScore: 1.2, finalScore: 9 }]),
        ).toEqual([1]);
    });

    it('lista vazia → []', () => {
        expect(categoryFractions([])).toEqual([]);
    });
});

// helper local do teste (evita asserção morta dentro de it anterior)
function categoryFrationsNaN(): void {
    const r = categoryFractions([
        { maxScore: Number.NaN, finalScore: Number.NaN },
    ]);
    expect(r).toEqual([0]);
}

describe('scoreSpark: sparkPoints', () => {
    it('ponta esquerda = categoria mais penalizada no chão; direita no topo', () => {
        // [0, 0.5, 1] em W=56 H=18 → x uniformes 0/28/56, y invertido com pad 2
        const pts = sparkPoints([0, 0.5, 1]);
        expect(pts).toBe('0,16 28,9 56,2');
    });

    it('um único ponto fica centralizado horizontalmente', () => {
        expect(sparkPoints([1])).toBe('28,2');
        expect(sparkPoints([0])).toBe('28,16');
    });

    it('sem categorias → string vazia (sparkline oculta)', () => {
        expect(sparkPoints([])).toBe('');
    });

    it('dimensões inválidas → string vazia', () => {
        expect(sparkPoints([0.5], 0, 18)).toBe('');
        expect(sparkPoints([0.5], 56, -1)).toBe('');
        expect(sparkPoints([0.5], Number.NaN, 18)).toBe('');
    });

    it('frações fora de 0..1 são clampadas no desenho', () => {
        expect(sparkPoints([-3, 7])).toBe('0,16 56,2');
    });

    it('usa as dimensões default exportadas', () => {
        expect(SCORE_SPARK_W).toBe(56);
        expect(SCORE_SPARK_H).toBe(18);
        // 5 pontos (seed): x = 0,14,28,42,56
        const five = sparkPoints([0, 1, 0, 1, 0]);
        expect(five.split(' ')).toHaveLength(5);
        expect(five.startsWith('0,')).toBe(true);
        expect(five.endsWith(',16')).toBe(true);
    });
});

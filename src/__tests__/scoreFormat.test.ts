import { describe, it, expect } from 'vitest';
import {
    SCORE_RING_CIRCUMFERENCE,
    ringDash,
    ringRotation,
    scoreBandColor,
    formatScore,
    parseScore,
    scoreBandClass,
} from '../utils/scoreFormat';

describe('ringDash', () => {
    it('is 0 for non-finite or negative scores', () => {
        expect(ringDash(NaN)).toBe(0);
        expect(ringDash(-1)).toBe(0);
        // clamp superior: qualquer coisa acima de 5 satura no anel cheio
        expect(ringDash(6)).toBe(SCORE_RING_CIRCUMFERENCE);
    });

    it('is the full circumference for a perfect 5', () => {
        expect(ringDash(5)).toBeCloseTo(SCORE_RING_CIRCUMFERENCE);
    });

    it('scales linearly with the score', () => {
        expect(ringDash(2.5)).toBeCloseTo(SCORE_RING_CIRCUMFERENCE / 2);
        expect(ringDash(4.55)).toBeCloseTo((4.55 / 5) * SCORE_RING_CIRCUMFERENCE);
    });
});

describe('scoreBandColor', () => {
    it('maps bands to semantic colors', () => {
        expect(scoreBandColor(4.8)).toBe('ok');
        expect(scoreBandColor(4)).toBe('ok');
        expect(scoreBandColor(3.99)).toBe('warn');
        expect(scoreBandColor(3)).toBe('warn');
        expect(scoreBandColor(2.99)).toBe('fail');
        expect(scoreBandColor(NaN)).toBe('fail');
    });
});

describe('formatScore / parseScore', () => {
    it('formats with comma decimals (sheet convention)', () => {
        expect(formatScore(4.55)).toBe('4,55');
        expect(formatScore('4.55')).toBe('4,55');
        expect(formatScore('4,55')).toBe('4,55');
        expect(formatScore(0)).toBe('0,00');
    });

    it('returns null for garbage input', () => {
        expect(formatScore(null)).toBeNull();
        expect(formatScore(undefined)).toBeNull();
        expect(formatScore('n/a')).toBeNull();
        expect(formatScore('')).toBeNull();
    });

    it('parses tolerant input', () => {
        expect(parseScore(' 4,55 ')).toBeCloseTo(4.55);
        expect(parseScore(3)).toBe(3);
        expect(parseScore('oops')).toBeNull();
    });
});

describe('scoreBandClass (tick 12 — badge semântico na lista)', () => {
    it('maps tiers exactly like scoreBandColor', () => {
        // Mesmos cortes do anel: >=4 ok, >=3 warn, senão fail
        expect(scoreBandClass('5.00')).toBe('badge-ok');
        expect(scoreBandClass('4.60')).toBe('badge-ok');
        expect(scoreBandClass('3.99')).toBe('badge-warn');
        expect(scoreBandClass('3.00')).toBe('badge-warn');
        expect(scoreBandClass('2.99')).toBe('badge-fail');
        expect(scoreBandClass('0')).toBe('badge-fail');
    });

    it('parses sheet-formatted values (vírgula decimal)', () => {
        expect(scoreBandClass('4,55')).toBe('badge-ok');
        expect(scoreBandClass(' 3,20 ')).toBe('badge-warn');
        expect(scoreBandClass('1,10')).toBe('badge-fail');
    });

    it('returns empty class for non-numeric/garbage (never invents color)', () => {
        expect(scoreBandClass(null)).toBe('');
        expect(scoreBandClass(undefined)).toBe('');
        expect(scoreBandClass('')).toBe('');
        expect(scoreBandClass('n/a')).toBe('');
        expect(scoreBandClass('oops')).toBe('');
    });
});

describe('ringRotation', () => {
    it('starts at 12 o clock', () => {
        expect(ringRotation()).toBe(-90);
    });
});

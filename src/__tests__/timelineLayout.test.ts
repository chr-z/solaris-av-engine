import { describe, it, expect } from 'vitest';
import {
    layoutTimelinePins,
    rulerStepSeconds,
    TIMELINE_PIN_LANES,
} from '../utils/timelineLayout';

describe('layoutTimelinePins', () => {
    it('returns empty for no pins', () => {
        expect(layoutTimelinePins([], 100, 1000)).toEqual([]);
    });

    it('sorts output by time regardless of input order', () => {
        const out = layoutTimelinePins(
            [
                { id: 'b', time: 50 },
                { id: 'a', time: 10 },
            ],
            100,
            1000,
        );
        expect(out.map((p) => p.id)).toEqual(['a', 'b']);
    });

    it('clamps position to [0,1] even for out-of-range times', () => {
        const out = layoutTimelinePins(
            [
                { id: 'neg', time: -5 },
                { id: 'far', time: 999 },
                { id: 'mid', time: 50 },
            ],
            100,
            800,
        );
        const byId = Object.fromEntries(out.map((p) => [p.id, p]));
        expect(byId['neg'].position).toBe(0);
        expect(byId['mid'].position).toBeCloseTo(0.5);
        expect(byId['far'].position).toBe(1);
    });

    it('handles non-positive duration without NaN', () => {
        const out = layoutTimelinePins([{ id: 'x', time: 3 }], 0, 500);
        expect(out[0].position).toBe(0);
        expect(Number.isNaN(out[0].position)).toBe(false);
    });

    it('stacks close pins into different lanes (min gap respected per lane)', () => {
        // 3 pins muito próximos (< minGap na mesma lane) → uma lane cada.
        const pins = [
            { id: 'p1', time: 10 },
            { id: 'p2', time: 10.2 },
            { id: 'p3', time: 10.4 },
        ];
        const out = layoutTimelinePins(pins, 60, 600, 10); // 1s == 10px
        const lanes = new Set(out.map((p) => p.lane));
        expect(lanes.size).toBe(3);
        // Nenhum par na MESMA lane pode estar mais próximo que o gap.
        for (let i = 0; i < TIMELINE_PIN_LANES; i++) {
            const inLane = out.filter((p) => p.lane === i).map((p) => p.position * 600);
            for (let j = 1; j < inLane.length; j++) {
                expect(inLane[j] - inLane[j - 1]).toBeGreaterThanOrEqual(10);
            }
        }
    });

    it('degrades gracefully on overflow (more pins than lanes fit): lanes stay in range', () => {
        const pins = [
            { id: 'p1', time: 10 },
            { id: 'p2', time: 10.2 },
            { id: 'p3', time: 10.4 },
            { id: 'p4', time: 10.6 }, // não cabe em lane nenhuma → reusa a mais velha
        ];
        const out = layoutTimelinePins(pins, 60, 600, 10);
        expect(out).toHaveLength(4);
        for (const p of out) {
            expect(p.lane).toBeGreaterThanOrEqual(0);
            expect(p.lane).toBeLessThan(TIMELINE_PIN_LANES);
        }
        // Os 3 primeiros ainda ficaram em lanes distintas…
        expect(new Set(out.slice(0, 3).map((p) => p.lane)).size).toBe(3);
        // …e o 4º reutilizou a lane mais antiga (a do primeiro).
        expect(out[3].lane).toBe(out[0].lane);
    });

    it('reuses the same lane when pins are far apart', () => {
        const out = layoutTimelinePins(
            [
                { id: 'a', time: 0 },
                { id: 'b', time: 30 },
                { id: 'c', time: 59 },
            ],
            60,
            1200,
            10,
        );
        expect(new Set(out.map((p) => p.lane)).size).toBe(1);
    });

    it('never exceeds the configured lane count', () => {
        const pins = Array.from({ length: 40 }, (_, i) => ({ id: `k${i}`, time: i * 0.5 }));
        const out = layoutTimelinePins(pins, 20, 400, 12);
        const maxLane = Math.max(...out.map((p) => p.lane));
        expect(maxLane).toBeLessThan(TIMELINE_PIN_LANES);
        expect(maxLane).toBeGreaterThanOrEqual(0);
    });
});

describe('rulerStepSeconds', () => {
    it('picks the largest step that still yields at least minTicks marks', () => {
        // 300s: 60 dá 5 marcas; 120 daria só 2.5 → maior válido é 60.
        expect(rulerStepSeconds(300, 4)).toBe(60);
        // 90s: 15 dá 6 marcas; 30 daria só 3 → 15.
        expect(rulerStepSeconds(90, 4)).toBe(15);
    });

    it('falls back to the smallest step for tiny durations', () => {
        expect(rulerStepSeconds(3, 4)).toBe(1);
    });

    it('is safe for zero duration', () => {
        expect(rulerStepSeconds(0)).toBe(1);
        expect(Number.isFinite(rulerStepSeconds(0))).toBe(true);
    });
});

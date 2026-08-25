import { describe, it, expect } from 'vitest';
import { humanizeError, humanizeSaveError } from '../utils/humanErrors';

describe('humanizeError', () => {
    it('never returns the raw message', () => {
        const raws = [
            'TypeError: Cannot read properties of undefined',
            'Failed to fetch',
            'net::ERR_NETWORK_CHANGED',
            'User not authenticated. Please sign in.',
            'Secure Drive playback requires Google Authentication.',
            '',
            null,
            undefined,
        ];
        for (const raw of raws) {
            const out = humanizeError(raw);
            expect(out.title.length).toBeGreaterThan(0);
            expect(out.hint.length).toBeGreaterThan(0);
            if (raw) {
                // nenhuma frase devolvida contém o texto cru integral
                expect(out.title).not.toBe(raw);
                expect(out.hint).not.toBe(raw);
            }
            expect(out.title.toLowerCase()).not.toContain('typeerror');
            expect(out.title).not.toMatch(/error:/i);
        }
    });

    it('maps known causes to friendly copy', () => {
        expect(humanizeError('This video is private').title).toMatch(/private/i);
        expect(
            humanizeError('Secure Drive playback requires Google Authentication.').hint,
        ).toMatch(/sign in|youtube/i);
        expect(humanizeError('Failed to fetch').hint).toMatch(/retry|internet/i);
    });
});

describe('humanizeSaveError', () => {
    it('is reassuring and actionable (permission case)', () => {
        const out = humanizeSaveError('Missing or insufficient permissions');
        expect(out.title).not.toMatch(/permission/i);
        expect(out.hint).toMatch(/access|stays on screen/i);
        // e mantém a promessa de não perder o trabalho
        expect(out.hint + ' ' + out.title).toMatch(/still|stays/i);
    });

    it('covers the generic failure with a retry hint', () => {
        const out = humanizeSaveError();
        expect(out.hint.toLowerCase()).toContain('save again');
    });
});

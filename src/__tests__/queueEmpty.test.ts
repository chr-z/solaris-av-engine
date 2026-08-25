import { describe, it, expect } from 'vitest';
import { en, pt } from '../i18n/translations';

/**
 * R3 fila — estados vazios com dica contextual.
 * Fonte única: dicionários i18n (paridade já garantida por i18n.test.ts).
 */
const KEYS = [
    'queue.empty.search',
    'queue.empty.searchHint',
    'queue.empty.pending',
    'queue.empty.pendingHint',
    'queue.empty.completed',
    'queue.empty.completedHint',
    'queue.empty.special',
    'queue.empty.specialHint',
    'queue.empty.all',
    'queue.empty.allHint',
] as const;

describe('queue empty-state copy', () => {
    it('exists in both locales with human, non-empty text', () => {
        for (const key of KEYS) {
            expect(en[key].length).toBeGreaterThan(0);
            expect(pt[key].length).toBeGreaterThan(0);
            // nunca soa como erro técnico
            expect(en[key].toLowerCase()).not.toContain('error');
        }
    });

    it('distinguishes filtered search from truly empty queue', () => {
        expect(en['queue.empty.search']).not.toBe(en['queue.empty.pending']);
        // dica do filtro aponta pra limpar, nos dois idiomas
        expect(en['queue.empty.searchHint'].toLowerCase()).toContain('clear');
        expect(pt['queue.empty.searchHint'].toLowerCase()).toContain('limpe');
    });

    it('has a distinct title per queue section', () => {
        const titles = new Set([
            en['queue.empty.pending'],
            en['queue.empty.completed'],
            en['queue.empty.special'],
        ]);
        expect(titles.size).toBe(3);
    });

    it('keeps the MVP vocabulary for the whole-list empty state', () => {
        // essência intacta: mesma frase-chave do MVP
        expect(en['queue.empty.all']).toMatch(/No Work Orders found\./);
    });
});

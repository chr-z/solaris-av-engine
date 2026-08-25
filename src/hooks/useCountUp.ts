import { useEffect, useRef, useState } from 'react';
import { countFrame } from '../utils/countUp';

export interface CountUpOptions {
    /** Duração total da animação em ms (padrão 900). <=0 vai direto ao destino. */
    durationMs?: number;
}

function prefersReducedMotion(): boolean {
    return (
        typeof window !== 'undefined' &&
        !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
}

/**
 * Momento wow #2 da spec v3: contagem animada de 0 até o valor alvo.
 *
 * Usada no diálogo de confirmação do relatório QC (linhas analisadas, erros,
 * tempo médio) — os números sobem de 0 até o total com ease-out cúbico.
 *
 * - prefers-reduced-motion: sem frames intermediários, estado final direto
 *   (tokens.css também zera as transitions CSS);
 * - o ÚLTIMO frame é exatamente o destino (utils/countUp.ts garante o snap),
 *   então o texto final é idêntico ao que era renderizado sem animação;
 * - trocar o alvo reinicia a contagem a partir de 0.
 */
export function useCountUp(target: number, options?: CountUpOptions): number {
    const durationMs = options?.durationMs ?? 900;
    const rafRef = useRef(0);

    const [value, setValue] = useState(() => {
        if (prefersReducedMotion() || durationMs <= 0 || !Number.isFinite(target)) {
            return Number.isFinite(target) ? target : 0;
        }
        return 0;
    });

    useEffect(() => {
        if (prefersReducedMotion() || durationMs <= 0 || !Number.isFinite(target)) {
            setValue(Number.isFinite(target) ? target : 0);
            return;
        }

        const start = performance.now();
        const tick = (now: number) => {
            const next = countFrame(now - start, durationMs, 0, target);
            setValue(next);
            // O util faz snap exato no destino: parar quando chegamos lá.
            if (next !== target) {
                rafRef.current = requestAnimationFrame(tick);
            }
        };
        rafRef.current = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(rafRef.current);
    }, [target, durationMs]);

    return value;
}

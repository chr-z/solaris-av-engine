import React, { useEffect, useRef, useState } from 'react';
import {
    SCORE_RING_RADIUS,
    SCORE_RING_STROKE,
    SCORE_RING_CIRCUMFERENCE,
    ringDash,
    ringRotation,
    scoreBandColor,
    formatScore,
    parseScore,
} from '../../utils/scoreFormat';

interface ScoreRingProps {
    /** Nota final (0–5). Aceita "4,55" ou 4.55. */
    score: number | string | null | undefined;
    /** Tamanho externo do anel em px (padrão 88). */
    size?: number;
    label?: string;
}

const BAND_VAR: Record<'ok' | 'warn' | 'fail', string> = {
    ok: 'var(--color-ok)',
    warn: 'var(--color-warn)',
    fail: 'var(--color-fail)',
};

/**
 * Momento wow #3 da spec v3: anel de progresso SVG animado.
 * - arco cresce de 0 até a fração da nota (stroke-dashoffset, 600ms ease-out);
 * - número anima de 0 até o valor (contagem);
 * - cor semântica: verde ≥4, amarelo ≥3, vermelho abaixo (mesma leitura do MVP);
 * - prefers-reduced-motion: sem animação, estado final direto (tokens.css já
 *   zera as transitions; aqui também pulamos os frames da contagem).
 */
const ScoreRing: React.FC<ScoreRingProps> = ({ score, size = 88, label }) => {
    const numeric = parseScore(score) ?? 0;
    const band = scoreBandColor(numeric);
    const dash = ringDash(numeric);

    const [displayValue, setDisplayValue] = useState(() => numeric);
    const rafRef = useRef<number>(0);

    // Anima contagem e arco quando a nota muda (inclui a primeira render).
    useEffect(() => {
        const reduceMotion =
            typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        if (reduceMotion || numeric === displayValue) {
            setDisplayValue(numeric);
            return;
        }

        const from = 0;
        const start = performance.now();
        const durationMs = 700;

        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / durationMs);
            // ease-out cúbico
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplayValue(from + (numeric - from) * eased);
            if (t < 1) {
                rafRef.current = requestAnimationFrame(tick);
            }
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [numeric]);

    const shownText = formatScore(displayValue) ?? '0,00';
    const offset = SCORE_RING_CIRCUMFERENCE - dash;

    return (
        <div
            className="relative inline-flex items-center justify-center select-none"
            style={{ width: size, height: size }}
            role="img"
            aria-label={`${label ? label + ': ' : ''}${formatScore(numeric) ?? '0,00'} of 5`}
        >
            <svg
                width={size}
                height={size}
                viewBox="0 0 80 80"
                aria-hidden="true"
                focusable="false"
            >
                {/* trilho */}
                <circle
                    cx="40"
                    cy="40"
                    r={SCORE_RING_RADIUS}
                    fill="none"
                    stroke="var(--color-border)"
                    strokeWidth={SCORE_RING_STROKE}
                />
                {/* arco de progresso — cor via CSS var p/ herdar tema claro futuro */}
                <circle
                    cx="40"
                    cy="40"
                    r={SCORE_RING_RADIUS}
                    fill="none"
                    stroke={BAND_VAR[band]}
                    strokeWidth={SCORE_RING_STROKE}
                    strokeLinecap="round"
                    strokeDasharray={SCORE_RING_CIRCUMFERENCE}
                    /* transição só de propriedade de traço; tokens.css zera sob reduced-motion */
                    style={{
                        strokeDashoffset: offset,
                        transition: 'stroke-dashoffset 600ms ease-out',
                        transform: `rotate(${ringRotation()}deg)`,
                        transformOrigin: '50% 50%',
                    }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono font-bold text-lg leading-none tnum">
                    {shownText}
                </span>
                {label && (
                    <span className="text-2xs uppercase tracking-wider text-ink-secondary mt-1">
                        {label}
                    </span>
                )}
            </div>
        </div>
    );
};

export default ScoreRing;

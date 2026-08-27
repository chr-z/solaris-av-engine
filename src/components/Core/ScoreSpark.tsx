import React from 'react';
import {
    categoryFractions,
    sparkPoints,
    SCORE_SPARK_W,
    SCORE_SPARK_H,
} from '../../utils/scoreSpark';

interface ScoreSparkProps {
    /** Breakdown por categoria do ScoringEngine (ordem do seed). */
    categories: ReadonlyArray<{ maxScore: number; finalScore: number }>;
    /** Largura/dimensão externa em px (default = viewBox, nítido). */
    width?: number;
}

/**
 * Tick 9 redesign — micro-sparkline da spec ("pill com número tabular +
 * micro-sparkline da tendência"). A "tendência" é o perfil das notas POR
 * CATEGORIA do ScoringEngine (não existe série temporal no domínio; dado real
 * já computado). Decorativa: aria-hidden + title nativo com o resumo.
 *
 * - linha com gradiente accent da marca (tokens), 1.5px;
 * - ponto final marca a categoria mais fraca (menor fração) — leitura
 *   instantânea de onde a nota caiu;
 * - reduced-motion herda o corte global de transitions do tokens.css.
 */
const ScoreSpark: React.FC<ScoreSparkProps> = ({ categories, width }) => {
    const fractions = categoryFractions(categories);
    const points = sparkPoints(fractions);
    if (!points) return null;

    // Categoria mais fraca → ponto final do traço (leitura instantânea).
    let weakIdx = -1;
    for (let i = 0; i < fractions.length; i++) {
        if (
            weakIdx === -1 ||
            fractions[i] < fractions[weakIdx]
        ) {
            weakIdx = i;
        }
    }
    const stepX = SCORE_SPARK_W / Math.max(1, fractions.length - 1);
    const usable = SCORE_SPARK_H - 4; // PAD_Y*2 do util
    const dotX =
        fractions.length === 1
            ? SCORE_SPARK_W / 2
            : stepX * weakIdx;
    const dotY = SCORE_SPARK_H - 2 - usable * fractions[weakIdx];

    const w = width ?? SCORE_SPARK_W;

    return (
        <svg
            width={w}
            height={SCORE_SPARK_H}
            viewBox={`0 0 ${SCORE_SPARK_W} ${SCORE_SPARK_H}`}
            aria-hidden="true"
            focusable="false"
            className="flex-shrink-0"
        >
            <defs>
                <linearGradient id="scoreSparkGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--color-accent-from)" />
                    <stop offset="100%" stopColor="var(--color-accent-to)" />
                </linearGradient>
            </defs>
            <polyline
                points={points}
                fill="none"
                stroke="url(#scoreSparkGrad)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {weakIdx > -1 && (
                <circle
                    cx={dotX}
                    cy={dotY}
                    r="2"
                    fill="var(--color-accent-to)"
                />
            )}
        </svg>
    );
};

export default ScoreSpark;

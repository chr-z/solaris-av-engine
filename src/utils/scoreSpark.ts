// Solaris v3 redesign (tick 9) — micro-sparkline dos badges de score (spec:
// "Badges de score: pill com número tabular + micro-sparkline da tendência").
//
// Não existe série temporal de análises anteriores no domínio (e inventá-la
// seria mudança funcional). A leitura honesta da spec: a "tendência" é o
// PERFIL das notas por categoria do ScoringEngine — dado real já computado a
// cada marcação. A linha mostra as 5 frações nota/máximo por categoria
// (ENQUADRAMENTO, ILUMINAÇÃO, OUTROS, CENÁRIO, ÁUDIO), normalizadas porque os
// máximos diferem (1.27 … 0.70). Analista vê ONDE a nota caiu sem ler números.
//
// Matemática pura e determinística (padrão do repo: utils/ sem DOM), igual a
// countUp.ts/scoreFormat.ts, para testar sem jsdom.

export interface SparkCategoryInput {
    maxScore: number;
    finalScore: number;
}

/** Dimensões do desenho (px, viewBox do SVG decorativo). */
export const SCORE_SPARK_W = 56;
export const SCORE_SPARK_H = 18;

/** Padding interno vertical pra linha não colar nas bordas. */
const PAD_Y = 2;

/**
 * Fração 0..1 por categoria (nota/máximo), na ordem recebida.
 * Guards: valor não finito ou máximo <= 0 → 0 (desenha no chão, nunca NaN);
 * nota acima do máximo → clamp em 1.
 */
export function categoryFractions(
    categories: ReadonlyArray<SparkCategoryInput>,
): number[] {
    return categories.map(({ maxScore, finalScore }) => {
        if (!Number.isFinite(maxScore) || maxScore <= 0) return 0;
        if (!Number.isFinite(finalScore)) return 0;
        const frac = finalScore / maxScore;
        if (!Number.isFinite(frac)) return 0;
        return Math.min(1, Math.max(0, frac));
    });
}

/**
 * String de pontos "x,y x,y ..." pra um <polyline>, espaçado uniformemente
 * na largura, com y invertido (fração 1 = topo). 0 categorias → ''.
 * Um único ponto é desenhado centralizado (linha degenerada ainda visível).
 */
export function sparkPoints(
    fractions: ReadonlyArray<number>,
    width: number = SCORE_SPARK_W,
    height: number = SCORE_SPARK_H,
): string {
    if (!Array.isArray(fractions) || fractions.length === 0) return '';
    if (!Number.isFinite(width) || width <= 0) return '';
    if (!Number.isFinite(height) || height <= 0) return '';

    const usable = height - PAD_Y * 2;
    const n = fractions.length;

    if (n === 1) {
        const y = height - PAD_Y - usable * clamp01(fractions[0]);
        const cx = width / 2;
        return `${round2(cx)},${round2(y)}`;
    }

    const stepX = width / (n - 1);
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
        const x = stepX * i;
        const y = height - PAD_Y - usable * clamp01(fractions[i]);
        pts.push(`${round2(x)},${round2(y)}`);
    }
    return pts.join(' ');
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

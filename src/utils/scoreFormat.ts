// Solaris v3 (R3) — geometria do anel de score + formatação.
//
// O ScoreRing é um <circle> SVG com stroke-dasharray animado. Toda a
// matemática vive aqui para ser testável sem DOM (jsdom não mede SVG).

export const SCORE_RING_RADIUS = 34;
export const SCORE_RING_STROKE = 5;
/** Circunferência do anel (usada no stroke-dasharray). */
export const SCORE_RING_CIRCUMFERENCE =
    2 * Math.PI * SCORE_RING_RADIUS;

/**
 * Comprimento do arco preenchido (0..circunferência).
 * Guardas: score negativo → 0; NaN/undefined → 0.
 */
export function ringDash(score: number): number {
    if (!Number.isFinite(score) || score <= 0) return 0;
    return Math.min(SCORE_RING_CIRCUMFERENCE, (score / 5) * SCORE_RING_CIRCUMFERENCE);
}

/** Rotação inicial do arco: começa às 12h (-90°). */
export function ringRotation(): number {
    return -90;
}

/** Cor semântica do anel conforme a nota (verde=ótimo, amarelo=atenção, vermelho=ruim). */
export function scoreBandColor(score: number): 'ok' | 'warn' | 'fail' {
    if (!Number.isFinite(score)) return 'fail';
    if (score >= 4) return 'ok';
    if (score >= 3) return 'warn';
    return 'fail';
}

/**
 * Formata o score como "4,55" (vírgula decimal, padrão da planilha).
 * Entradas legíveis: aceita número ou string já formatada ("4,55"/"4.55").
 * Não-numérico → null (o componente decide o fallback visual).
 */
export function formatScore(value: number | string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const n = typeof value === 'string'
        ? parseFloat(value.trim().replace(',', '.'))
        : value;
    if (!Number.isFinite(n)) return null;
    return n.toFixed(2).replace('.', ',');
}

/** Parse tolerante → número (null se não der). Espaço e vírgula ok. */
export function parseScore(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const n = typeof value === 'string'
        ? parseFloat(value.trim().replace(',', '.'))
        : value;
    return Number.isFinite(n) ? n : null;
}

/**
 * Classe do badge semântico pro valor de score cru da planilha (tick 12):
 * parseia e devolve "badge-ok"/"badge-warn"/"badge-fail" conforme o tier
 * (mesmos cortes do scoreBandColor). Não-numérico/vazio → '' (badge neutro,
 * sem inventar cor pra dado que o domínio não reconhece).
 */
export function scoreBandClass(value: number | string | null | undefined): string {
    const n = parseScore(value);
    return n === null ? '' : `badge-${scoreBandColor(n)}`;
}

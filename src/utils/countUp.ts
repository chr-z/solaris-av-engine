// Solaris v3 — momento wow #2: contagem dos achados anima de 0 até o total
// ao concluir a análise (diálogo de confirmação do relatório QC).
//
// Toda a matemática vive aqui para ser testável sem DOM (jsdom não mede
// frames de rAF), mesma filosofia de utils/scoreFormat.ts.

/** Progresso 0..1 → curva ease-out cúbica (rápido no início, suave no fim). */
export function easeOutCubic(t: number): number {
    const clamped = Math.min(1, Math.max(0, t));
    return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Um frame da contagem: interpolado de `from` até `to` após `elapsedMs`
 * de uma animação de `durationMs`.
 *
 * Garantias:
 * - t >= duração → EXATAMENTE `to` (snap final; nenhum resíduo de float,
 *   para o último frame renderizado ser idêntico ao texto estático antigo);
 * - duração <= 0 (reduced-motion / opt-out) → direto ao destino;
 * - destino não finito (NaN/Infinity) → 0, guard defensivo.
 */
export function countFrame(
    elapsedMs: number,
    durationMs: number,
    from: number,
    to: number
): number {
    if (!Number.isFinite(to)) return 0;
    if (
        !Number.isFinite(from) ||
        durationMs <= 0 ||
        elapsedMs >= durationMs ||
        to === from
    ) {
        return to;
    }
    const t = Math.max(0, elapsedMs) / durationMs;
    return from + (to - from) * easeOutCubic(t);
}

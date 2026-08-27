// Solaris v3 (R3) — layout de pins da timeline redesenhada.
//
// Pins de marcadores de tempo precisam "empilhar" quando ficam muito
// próximos horizontalmente (senão se sobrepõem e ficam inclicáveis).
// Algoritmo puro e determinístico para ser testável sem DOM:
//
// - pins são ordenados por tempo;
// - cada pin entra na lane cujo último pin está mais longe dele
//   (greedy: lane disponível mais "velha");
// - uma lane comporta um novo pin só se a distância em pixels entre
//   eles for >= minGapPx;
// - com todas as lanes ocupadas, volta para a lane mais velha
//   (round-robin determinístico).

export interface TimelinePinInput {
    id: string;
    /** segundos desde o início do vídeo */
    time: number;
}

export interface LaidOutPin<T extends TimelinePinInput> extends TimelinePinInput {
    /** índice da pilha vertical (0 = linha base da timeline) */
    lane: number;
    /** posição horizontal normalizada 0..1 (clampada) */
    position: number;
}

/** Número máximo de lanes de empilhamento desenhadas na timeline. */
export const TIMELINE_PIN_LANES = 3;

/**
 * Distribui pins em lanes de empilhamento.
 *
 * @param pins       lista arbitrária (não precisa vir ordenada)
 * @param duration   duração do vídeo em segundos (>0)
 * @param widthPx    largura útil da timeline em pixels
 * @param minGapPx   distância mínima, em pixels, entre pins na mesma lane
 */
export function layoutTimelinePins<T extends TimelinePinInput>(
    pins: T[],
    duration: number,
    widthPx: number,
    minGapPx = 10,
): LaidOutPin<T>[] {
    if (pins.length === 0) return [];

    const sorted = [...pins].sort((a, b) => a.time - b.time);
    // Guardas: dimensões inválidas → tudo na lane 0, posição clampada.
    const usableWidth = widthPx > 0 ? widthPx : 0;
    const dur = duration > 0 ? duration : 0;

    // Último pixel ocupado por cada lane (-Infinity = lane livre).
    const laneLastPx: number[] = new Array(TIMELINE_PIN_LANES).fill(-Infinity);

    return sorted.map((pin) => {
        const position = dur > 0 ? Math.min(1, Math.max(0, pin.time / dur)) : 0;
        const px = position * usableWidth;

        // Escolhe a lane com o "último uso" mais antigo que respeite o gap;
        // se nenhuma respeita, usa a mais antiga de todas (round-robin justo).
        let bestLane = 0;
        let oldestLane = 0;
        for (let lane = 1; lane < TIMELINE_PIN_LANES; lane++) {
            if (laneLastPx[lane] < laneLastPx[oldestLane]) oldestLane = lane;
        }
        bestLane = oldestLane;
        for (let lane = 0; lane < TIMELINE_PIN_LANES; lane++) {
            if (px - laneLastPx[lane] >= minGapPx && laneLastPx[lane] > laneLastPx[bestLane]) {
                bestLane = lane;
            }
        }

        laneLastPx[bestLane] = px;
        return { ...pin, lane: bestLane, position };
    });
}

/**
 * Passo "bonito" da régua de tempo: o MAIOR incremento padrão que ainda
 * produza pelo menos `minTicks` marcas dentro da duração dada.
 * Duração curtíssima demais para qualquer passo → volta pro menor (1s),
 * que é a régua mais informativa possível.
 */
const RULER_STEPS_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function rulerStepSeconds(duration: number, minTicks = 4): number {
    const dur = duration > 0 ? duration : 0;
    let best = RULER_STEPS_SECONDS[0];
    for (const step of RULER_STEPS_SECONDS) {
        // Ascendente: o último passo que satisfaz é o maior válido.
        if (dur / step >= minTicks) best = step;
    }
    return best;
}

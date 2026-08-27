// Solaris v3 — Feature Pack "Analista Feliz" — A2 Conforto físico.
//
// Velocidade adaptativa (spec A2): "shuttle aprende o ritmo do analista".
// Cada pulso na MESMA direção sobe/desce um degrau da escada; mudar de
// direção volta ao passo base (1x) antes de continuar — nunca há salto
// brusco 4x→0.5x por acidente. É conforto de navegação: NÃO alimenta
// XP/métricas (spec C4 — velocidade pura nunca é pontuada).
//
// Núcleo puro: sem DOM, sem player — só estado e transições testáveis.

/** Escada de velocidades do shuttle (índice inicial = 1 → 1x). */
export const SHUTTLE_RATES = [0.5, 1, 1.5, 2, 3, 4] as const;

export type ShuttleDirection = 'up' | 'down';

export interface ShuttleState {
  /** Índice atual em SHUTTLE_RATES. */
  index: number;
  /** Última direção pulsada (null = acabou de abrir/resetar). */
  lastDirection: ShuttleDirection | null;
}

/** Estado inicial: 1x, sem direção. */
export const INITIAL_SHUTTLE_STATE: ShuttleState = { index: 1, lastDirection: null };

/** Índice base (passo 1x) usado ao trocar de direção. */
export const SHUTTLE_BASE_INDEX: number = INITIAL_SHUTTLE_STATE.index;

/** Mantém o índice dentro da escada (clamp, sem wrap). */
export function clampShuttleIndex(index: number): number {
  return Math.max(0, Math.min(SHUTTLE_RATES.length - 1, index));
}

/**
 * Um pulso do analista (< desacelera, > acelera).
 * Regras:
 *   - mesma direção → anda um degrau (clamp nas pontas);
 *   - direção OPOSTA → reseta pro passo base (1x) NESTE pulso, sem
 *     descer outro degrau junto — previsibilidade acima de tudo.
 */
export function pulseShuttle(state: ShuttleState, direction: ShuttleDirection): ShuttleState {
  if (state.lastDirection !== null && state.lastDirection !== direction) {
    return { index: SHUTTLE_BASE_INDEX, lastDirection: direction };
  }
  const delta = direction === 'up' ? 1 : -1;
  return { index: clampShuttleIndex(state.index + delta), lastDirection: direction };
}

/** Clique no botão circular da barra: cicla pela escada com wrap. */
export function cycleShuttle(state: ShuttleState): ShuttleState {
  const next = (state.index + 1) % SHUTTLE_RATES.length;
  return { index: next, lastDirection: next >= state.index ? 'up' : 'down' };
}

/** Velocidade numérica do índice (segura p/ índice fora da faixa). */
export function rateAt(index: number): number {
  return SHUTTLE_RATES[clampShuttleIndex(index)];
}

/** Rótulo compacto exibido no botão ("0.5×", "1×", "1.5×"…). */
export function formatRate(rate: number): string {
  const clean = Number.isFinite(rate) ? rate : 1;
  return `${clean.toString().replace('.', ',')}×`;
}

// Solaris v3 — Feature Pack "Analista Feliz" — A2 Pomodoro (núcleo puro).
//
// Timer de pausa opcional com lembrete gentil (spec A2): 25min de foco → aviso.
// SEM DOM: storage, clock e agendador injetáveis (mesma filosofia do
// AutosaveController/ScratchpadController). Zero dependências.
//
// Modelo: só o INSTANTE DE FIM fica persistido (epoch ms). Tudo o resto é
// derivado — recarregar a página no meio do bloco retoma o mesmo fim
// (crash-safe de graça), sem estado duplo pra dessincronizar.

export const POMODORO_KEY = 'solaris.pomodoro';

/** Duração padrão do bloco de foco (spec A2: 25min), em segundos. */
export const POMODORO_DEFAULT_SECONDS = 25 * 60;

/** Bloco terminado há mais tempo que isso já era → descarta (recomeço limpo). */
export const POMODORO_STALE_MS = 5 * 60 * 1000;

export type PomodoroPhase = 'idle' | 'running' | 'expired';

export interface PomodoroSnapshot {
  phase: PomodoroPhase;
  /** Segundos restantes do bloco (0 fora de 'running'). */
  remainingSeconds: number;
  /** Epoch ms do fim programado (null fora de 'running'). */
  endsAtMs: number | null;
}

export const IDLE_POMODORO: PomodoroSnapshot = Object.freeze({
  phase: 'idle',
  remainingSeconds: 0,
  endsAtMs: null,
});

interface StoredPayload {
  v: 1;
  endsAtMs: number;
}

/**
 * Deriva o estado real a partir do instante salvo. Tolerante: null, JSON
 * quebrado, payload estranho ou fim >STALE no passado → idle (nunca throw).
 */
export function derivePomodoro(raw: string | null, nowMs: number): PomodoroSnapshot {
  if (!raw) return IDLE_POMODORO;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return IDLE_POMODORO;
  }
  if (typeof parsed !== 'object' || parsed === null) return IDLE_POMODORO;
  const endsAtMs = (parsed as { endsAtMs?: unknown }).endsAtMs;
  if (typeof endsAtMs !== 'number' || !Number.isFinite(endsAtMs)) return IDLE_POMODORO;
  if (nowMs >= endsAtMs + POMODORO_STALE_MS) return IDLE_POMODORO; // velho demais
  if (nowMs >= endsAtMs) {
    return { phase: 'expired', remainingSeconds: 0, endsAtMs };
  }
  return {
    phase: 'running',
    remainingSeconds: Math.ceil((endsAtMs - nowMs) / 1000),
    endsAtMs,
  };
}

/** Relógio mm:ss do badge (clamp defensivo: nunca negativo nem >99:59). */
export function formatPomodoroClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.min(99 * 60 + 59, Math.floor(totalSeconds)));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface PomodoroDeps {
  read?: () => string | null;
  write?: (payload: string) => void;
  clear?: () => void;
  now?: () => number;
  /** Agendador injetável; padrão setTimeout global. Retorna cancelador. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Disparado UMA vez quando o bloco corrente termina (aviso gentil). */
  onExpire?: () => void;
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

/**
 * Controlador do timer. start() sempre inicia um bloco NOVO e completo;
 * resume() rearma o aviso de um bloco persistido sem reiniciá-lo (uso no mount).
 */
export class PomodoroController {
  private readonly deps: Required<PomodoroDeps>;
  private cancelTimer: (() => void) | null = null;
  private readonly listeners = new Set<(s: PomodoroSnapshot) => void>();

  constructor(deps: PomodoroDeps = {}) {
    this.deps = {
      read:
        deps.read ??
        (() => {
          try {
            return typeof localStorage === 'undefined' ? null : localStorage.getItem(POMODORO_KEY);
          } catch {
            return null;
          }
        }),
      write: deps.write ?? ((payload) => {
        try {
          localStorage.setItem(POMODORO_KEY, payload);
        } catch {
          // best-effort por design
        }
      }),
      clear: deps.clear ?? (() => {
        try {
          localStorage.removeItem(POMODORO_KEY);
        } catch {
          // best-effort por design
        }
      }),
      now: deps.now ?? Date.now,
      schedule: deps.schedule ?? defaultSchedule,
      onExpire: deps.onExpire ?? (() => {}),
    };
  }

  snapshot(): PomodoroSnapshot {
    return derivePomodoro(this.safeRead(), this.deps.now());
  }

  /** Inicia um bloco novo de 25min (reinício explícito, também usado no pós-expira). */
  start(): PomodoroSnapshot {
    this.disarm();
    const endsAtMs = this.deps.now() + POMODORO_DEFAULT_SECONDS * 1000;
    const payload: StoredPayload = { v: 1, endsAtMs };
    this.deps.write(JSON.stringify(payload));
    this.arm(endsAtMs);
    return this.snapshot();
  }

  /**
   * Rearma o aviso de um bloco persistido ainda válido (reload/crash).
   * Não reinicia o relógio; idle/expired/stale não faz nada.
   */
  resume(): PomodoroSnapshot {
    const snap = this.snapshot();
    if (snap.phase === 'running' && snap.endsAtMs !== null) {
      this.disarm();
      this.arm(snap.endsAtMs);
    }
    return snap;
  }

  /** Cancela e limpa (duplo-stop seguro). */
  stop(): PomodoroSnapshot {
    this.disarm();
    this.deps.clear();
    this.notify(IDLE_POMODORO);
    return IDLE_POMODORO;
  }

  subscribe(fn: (s: PomodoroSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private safeRead(): string | null {
    try {
      return this.deps.read();
    } catch {
      return null;
    }
  }

  private arm(endsAtMs: number): void {
    const delay = Math.max(0, endsAtMs - this.deps.now());
    this.cancelTimer = this.deps.schedule(() => {
      this.cancelTimer = null;
      this.deps.onExpire();
      this.notify(this.snapshot());
    }, delay);
  }

  private disarm(): void {
    if (this.cancelTimer) {
      this.cancelTimer();
      this.cancelTimer = null;
    }
  }

  private notify(s: PomodoroSnapshot): void {
    for (const fn of this.listeners) fn(s);
  }
}

// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Auto-save debounced (spec A1): marcação feita = salva em 200ms.
// Núcleo PURO (injetável): sem window/localStorage direto — o caller fornece
// load/save e clock, então roda em Vitest, web e Tauri standalone igual.
//
// Contrato de crash-safety: `flush()` grava imediatamente (usado no
// beforeunload/visibilitychange) e `markCleaned()` apaga o rascunho quando a
// análise foi salva oficialmente na planilha.

export interface AutosaveEntry<T> {
  /** Payload parcial da análise (marcações atuais). */
  data: T;
  /** Posição do player (segundos) p/ retomada — ver resume.ts. */
  positionSec: number;
  /** Epoch ms do agendamento. */
  savedAt: number;
}

export interface AutosaveDeps<T> {
  /** Persistência bruta (localStorage/Tauri store). Recebe JSON serializado. */
  read: () => string | null;
  write: (payload: string) => void;
  clear?: () => void;
  /** Clock injetável p/ testes. */
  now?: () => number;
  /** Atraso do debounce em ms (spec: 200). */
  delayMs?: number;
  /** Agendador injetável; padrão setTimeout global. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

const DEFAULT_DELAY_MS = 200;

/**
 * Timer debounceado com flush determinístico. Uma instância por OS aberta.
 * Uso típico no hook React: `useRef(new AutosaveController(deps))`.
 */
export class AutosaveController<T> {
  private timerCancel: (() => void) | null = null;
  private pending: AutosaveEntry<T> | null = null;
  private readonly deps: Required<Pick<AutosaveDeps<T>, 'now'>> & AutosaveDeps<T>;

  constructor(deps: AutosaveDeps<T>) {
    this.deps = { now: Date.now, ...deps };
  }

  get delayMs(): number {
    return this.deps.delayMs ?? DEFAULT_DELAY_MS;
  }

  /**
   * Marcação chegou → (re)agenda o save em `delayMs`. Chamadas rápidas em
   * sequência colapsam numa única escrita (debounce real, não throttle).
   */
  schedule(data: T, positionSec: number): void {
    this.pending = { data, positionSec, savedAt: this.deps.now() };
    if (this.timerCancel) this.timerCancel(); // reinicia a janela
    const schedule = this.deps.schedule ?? ((fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
    this.timerCancel = schedule(() => this.flush(), this.delayMs);
  }

  /** Grava já o que estiver pendente (beforeunload, troca de OS, unmount). */
  flush(): AutosaveEntry<T> | null {
    if (this.timerCancel) {
      this.timerCancel();
      this.timerCancel = null;
    }
    if (!this.pending) return null;
    const entry = this.pending;
    this.pending = null;
    try {
      this.deps.write(JSON.stringify(entry));
    } catch {
      /* quota/privacidade: auto-save é best-effort, nunca derruba a análise */
    }
    return entry;
  }

  /** Análise foi salva oficialmente → rascunho obsoleto sai do storage. */
  markCleaned(): void {
    if (this.timerCancel) {
      this.timerCancel();
      this.timerCancel = null;
    }
    this.pending = null;
    try {
      this.deps.clear?.();
    } catch {
      /* best-effort */
    }
  }

  /** Descarta timer/pending SEM gravar (descarte explícito do analista). */
  dispose(): void {
    if (this.timerCancel) {
      this.timerCancel();
      this.timerCancel = null;
    }
    this.pending = null;
  }

  /** Há gravação pendente não persistida? (badge "salvando…") */
  get isPending(): boolean {
    return this.pending !== null || this.timerCancel !== null;
  }
}

/** Lê o rascunho persistido; retorna null se ausente/corrompido. */
export function loadAutosave<T>(read: () => string | null): AutosaveEntry<T> | null {
  let raw: string | null = null;
  try {
    raw = read();
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AutosaveEntry<T>;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('data' in parsed) ||
      typeof parsed.savedAt !== 'number' ||
      typeof parsed.positionSec !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null; // JSON truncado por crash: descarta, não trava
  }
}

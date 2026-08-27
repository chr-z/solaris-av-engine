// Solaris v3 — Feature Pack "Analista Feliz" — A1 Notas rápidas.
//
// Scratchpad por OS (spec A1): rascunho PESSOAL do analista, NÃO vai pra
// planilha nem para o dashboard — é best-effort local, como o auto-save.
//
// Reutiliza a mesma filosofia do AutosaveController: debounce real
// (não throttle), flush determinístico em troca de OS/unmount, escrita
// tolerante a falha (quota/privacidade nunca derrubam a análise).
//
// Núcleo puro, sem DOM: persistência e clock injetáveis.

/** Janela de validade: notas mais velhas que isso não voltam. */
export const SCRATCH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

/** Limite defensivo por nota (evita quota blowup acidental). */
export const SCRATCH_CHAR_LIMIT = 20_000;

export interface ScratchEntry {
  /** Texto atual da nota. */
  text: string;
  /** Epoch ms da última edição. */
  savedAt: number;
}

export interface ScratchDeps {
  read: () => string | null;
  write: (payload: string) => void;
  /** Remoção do storage (markCleaned). Opcional p/ stores sem delete. */
  clear?: () => void;
  /** Clock injetável p/ testes e validade. */
  now?: () => number;
  /** Debounce em ms (padrão: mesmo espírito do auto-save, 200). */
  delayMs?: number;
  /** Agendador injetável; padrão setTimeout global. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Disparado após cada gravação confirmada (badge "salvo ✓", telemetria). */
  onSaved?: (entry: ScratchEntry) => void;
}

const DEFAULT_DELAY_MS = 200;

function parseScratch(raw: string | null): ScratchEntry | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ScratchEntry>;
    if (typeof parsed.text !== 'string' || typeof parsed.savedAt !== 'number') return null;
    return { text: parsed.text, savedAt: parsed.savedAt };
  } catch {
    return null; // payload corrompido = sem nota, sem crash
  }
}

/**
 * Lê a nota persistida. Retorna null se ausente, corrompida, expirada,
 * acima do limite ou com tipo inesperado.
 */
export function loadScratch(
  read: () => string | null,
  now: () => number = Date.now
): ScratchEntry | null {
  const entry = parseScratch(read());
  if (!entry) return null;
  if (now() - entry.savedAt > SCRATCH_MAX_AGE_MS) return null;
  if (entry.text.length > SCRATCH_CHAR_LIMIT) return null;
  return entry;
}

/** Trunca no limite com aviso explícito (nunca silenciosamente). */
export function clampScratchText(text: string): { text: string; truncated: boolean } {
  if (text.length <= SCRATCH_CHAR_LIMIT) return { text, truncated: false };
  return { text: text.slice(0, SCRATCH_CHAR_LIMIT), truncated: true };
}

/**
 * Timer debounced com flush determinístico. Uma instância por OS aberta.
 * Mesma superfície do AutosaveController (schedule/flush/markCleaned/dispose).
 */
export class ScratchpadController {
  private timerCancel: (() => void) | null = null;
  private pending: ScratchEntry | null = null;
  private readonly deps: Required<Pick<ScratchDeps, 'now'>> & ScratchDeps;

  constructor(deps: ScratchDeps) {
    this.deps = { now: Date.now, ...deps };
  }

  get delayMs(): number {
    return this.deps.delayMs ?? DEFAULT_DELAY_MS;
  }

  /** Edição chegou → (re)agenda gravação em `delayMs` (debounce real). */
  schedule(text: string, atMs?: number): void {
    this.pending = { text, savedAt: atMs ?? this.deps.now() };
    if (this.timerCancel) this.timerCancel(); // reinicia a janela
    const schedule = this.deps.schedule ?? ((fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
    this.timerCancel = schedule(() => this.flush(), this.delayMs);
  }

  /** Grava já o pendente (troca de OS, unmount, beforeunload). */
  flush(): ScratchEntry | null {
    if (this.timerCancel) {
      this.timerCancel();
      this.timerCancel = null;
    }
    if (!this.pending) return null;
    const entry = this.pending;
    this.pending = null;
    try {
      this.deps.write(JSON.stringify(entry));
      this.deps.onSaved?.(entry);
    } catch {
      /* quota/privacidade: best-effort, nunca derruba a análise */
    }
    return entry;
  }

  /** OS resolvida/apagada → rascunho sai do storage. */
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

  /** Descarta timer/pending SEM gravar. */
  dispose(): void {
    if (this.timerCancel) {
      this.timerCancel();
      this.timerCancel = null;
    }
    this.pending = null;
  }

  /** Há gravação pendente não persistida? */
  get isPending(): boolean {
    return this.pending !== null || this.timerCancel !== null;
  }
}

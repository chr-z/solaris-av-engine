// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Undo global 24h (spec A3): event sourcing simples em localStorage.
// Cada ação do próprio usuário gera um evento invertível; Ctrl+Z desfaz o
// topo. Puro: storage e clock injetáveis → testável sem jsdom tricks.

export type UndoableActionKind =
  | 'assign-os'      // atribuiu OS a si/alguém
  | 'return-os'      // devolveu OS pra fila
  | 'prioritize-os'  // mudou prioridade
  | 'edit-cell';     // editou célula da análise

/** Um evento do log. `payload` carrega o bastante p/ inverter a ação. */
export interface UndoEvent {
  id: string;
  /** Momento da ação (epoch ms). */
  ts: number;
  kind: UndoableActionKind;
  label: string;
  payload: Record<string, unknown>;
}

export interface UndoDeps {
  read: () => string | null;
  write: (payload: string) => void;
  now?: () => number;
  /** Gerador de id injetável (padrão crypto/contador determinístico). */
  newId?: () => string;
  /** Capacidade máxima do log (padrão 100). */
  maxEvents?: number;
}

export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

const DEFAULT_MAX_EVENTS = 100;

function defaultId(): string {
  // Suficiente p/ ordenar eventos criados no mesmo ms.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Log imutável em memória + operações puras sobre ele. */
export class UndoLog {
  private deps: Required<Pick<UndoDeps, 'now' | 'newId' | 'maxEvents'>> & UndoDeps;
  private events: UndoEvent[];

  constructor(deps: UndoDeps) {
    this.deps = { now: Date.now, newId: defaultId, maxEvents: DEFAULT_MAX_EVENTS, ...deps };
    this.events = parseLog(this.deps.read());
  }

  /** Eventos dentro da janela de 24h (o resto é podado na gravação). */
  get undoable(): readonly UndoEvent[] {
    const cutoff = this.deps.now() - UNDO_WINDOW_MS;
    return this.events.filter((e) => e.ts >= cutoff);
  }

  /** Registra ação própria. Persiste já (crash-safe). */
  record(kind: UndoableActionKind, label: string, payload: Record<string, unknown> = {}): UndoEvent {
    const ev: UndoEvent = { id: this.deps.newId(), ts: this.deps.now(), kind, label, payload };
    const cutoff = this.deps.now() - UNDO_WINDOW_MS;
    this.events = [
      ...this.events.filter((e) => e.ts >= cutoff),
      ev,
    ].slice(-this.deps.maxEvents); // mantém os mais recentes
    this.persist();
    return ev;
  }

  /**
   * Evento a ser desfeito pelo próximo Ctrl+Z (topo da pilha própria).
   * `appliedIds` marca eventos já revertidos — undo nunca repete.
   */
  peek(appliedIds: ReadonlySet<string> = new Set()): UndoEvent | null {
    const list = this.undoable;
    for (let i = list.length - 1; i >= 0; i--) {
      if (!appliedIds.has(list[i].id)) return list[i];
    }
    return null;
  }

  /** Remove permanentemente um evento do log (após reverter com sucesso). */
  consume(id: string): void {
    this.events = this.events.filter((e) => e.id !== id);
    this.persist();
  }

  /** Limpa tudo (logout, troca de usuário). */
  clear(): void {
    this.events = [];
    try {
      this.deps.write('[]');
    } catch {
      /* best-effort */
    }
  }

  private persist(): void {
    try {
      this.deps.write(JSON.stringify(this.events));
    } catch {
      /* quota: log é best-effort, não pode derrubar a ação original */
    }
  }
}

/** Lê o log persistido; corrompido/truncado → log vazio (nunca lança). */
export function parseLog(raw: string | null): UndoEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is UndoEvent =>
        e !== null &&
        typeof e === 'object' &&
        typeof (e as UndoEvent).id === 'string' &&
        typeof (e as UndoEvent).ts === 'number' &&
        typeof (e as UndoEvent).kind === 'string',
    );
  } catch {
    return [];
  }
}

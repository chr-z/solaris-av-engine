/**
 * SOLARIS — stub offline do Firebase para builds STANDALONE (desktop Tauri).
 *
 * Em `vite build --mode standalone`, o vite.config aponta os aliases
 * `firebase/compat/*` para ESTE arquivo: nenhuma linha do SDK real entra no
 * bundle, o app abre sem rede e toda a API usada pelos consumidores vira
 * no-op local determinístico.
 *
 * Modelo de dados: UMA árvore JSON em memória (igual ao RTDB). Cada ref lê/
 * escreve o subtree do seu caminho — filhos aparecem automaticamente na
 * leitura do pai, `push()` grava num caminho filho, `set(null)` remove o nó.
 *
 * - Auth: sessão sempre nula; `signInWithPopup` rejeita com
 *   `auth/standalone-mode` (nenhuma janela/popup é aberta).
 *
 * Contrato: o TypeScript continua resolvendo os TIPOS do pacote real (alias só
 * vale em runtime/bundler), então a superfície abaixo precisa apenas ser
 * compatível com as CHAMADAS feitas pelo app — refs, snapshots `.val()`,
 * thenables e funções de unsubscribe.
 */

type Listener = { event: string; cb: (snap: StubDataSnapshot) => void };

/** Árvore JSON única do processo (raiz do "banco" local). */
const TREE: { root: unknown } = { root: {} };
/** Cache de refs por caminho (identidade estável p/ listeners). */
const REFS = new Map<string, StubReference>();

/** Marcador sentinela de timestamp do servidor (resolvido no write). */
const SERVER_TIMESTAMP = { '.sv': 'stub-timestamp' } as const;

function isServerTimestamp(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === 'object' &&
    '.sv' in (v as Record<string, unknown>)
  );
}

function resolveValue(v: unknown): unknown {
  if (v === SERVER_TIMESTAMP || isServerTimestamp(v)) return Date.now();
  return v;
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/** Lê o subtree em `path` (null quando ausente). */
function getIn(path: string): unknown {
  let cur: unknown = TREE.root;
  for (const seg of segmentsOf(path)) {
    if (
      cur !== null &&
      typeof cur === 'object' &&
      seg in (cur as Record<string, unknown>)
    ) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return null;
    }
  }
  return cur === undefined ? null : cur;
}

/** Escreve `value` no subtree `path`; null/remove apaga o nó. */
function setIn(path: string, value: unknown): void {
  const segs = segmentsOf(path);
  if (segs.length === 0) {
    TREE.root = value;
    return;
  }
  if (TREE.root === null || typeof TREE.root !== 'object') {
    TREE.root = {};
  }
  let cur = TREE.root as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    const next = cur[s];
    if (next === null || next === undefined || typeof next !== 'object') {
      cur[s] = {};
    }
    cur = cur[s] as Record<string, unknown>;
  }
  const last = segs[segs.length - 1];
  if (value === null || value === undefined) delete cur[last];
  else cur[last] = resolveValue(value);
}

/** Snapshot mínimo usado pelo app: .val(), .key, .exists(). */
export class StubDataSnapshot {
  constructor(
    private readonly value: unknown,
    public readonly key: string | null,
  ) {}
  val(): unknown {
    return this.value;
  }
  exists(): boolean {
    return this.value !== null && this.value !== undefined;
  }
}

export class StubReference {
  readonly key: string | null;
  private listeners: Listener[] = [];

  constructor(readonly path: string) {
    const segs = segmentsOf(path);
    this.key = segs.length > 0 ? segs[segs.length - 1] : null;
  }

  private current(): unknown {
    return getIn(this.path);
  }

  private emit(): void {
    const snap = new StubDataSnapshot(this.current(), this.key);
    for (const l of [...this.listeners]) {
      try {
        l.cb(snap);
      } catch {
        /* listener isolado não derruba os demais */
      }
    }
  }

  on(event: string, cb: (snap: StubDataSnapshot) => void): () => void {
    this.listeners.push({ event, cb });
    if (event === 'value' || event === 'once_value') {
      // Disparo inicial agendado com o estado atual (contrato RTDB).
      queueMicrotask(() => {
        if (this.listeners.some((l) => l.cb === cb)) {
          cb(new StubDataSnapshot(this.current(), this.key));
        }
      });
    }
    return () => this.off(event, cb);
  }

  off(event?: string, cb?: (snap: StubDataSnapshot) => void): void {
    if (event === undefined) {
      this.listeners = [];
      return;
    }
    this.listeners =
      cb === undefined
        ? this.listeners.filter((l) => l.event !== event)
        : this.listeners.filter((l) => !(l.event === event && l.cb === cb));
  }

  once(
    event: string,
    cb?: (snap: StubDataSnapshot) => void,
  ): Promise<StubDataSnapshot> {
    const p = Promise.resolve().then(
      () => new StubDataSnapshot(this.current(), this.key),
    );
    if (cb) void p.then(cb);
    return p;
  }

  /**
   * Leitura one-shot (compat: firebase/compat/database Reference.get).
   * Usado pelo workspace (localFilePath), locks do App e fluxos admin.
   * Sem isto o painel de análise crashava com "ref(...).get is not a
   * function" na seleção de W.O. em standalone (achado pelo probe E2E
   * dentro do exe, 25/08).
   */
  get(): Promise<StubDataSnapshot> {
    return this.once('value');
  }

  set(value: unknown): Promise<void> {
    setIn(this.path, value);
    this.emit();
    return Promise.resolve();
  }

  update(values: Record<string, unknown>): Promise<void> {
    const cur = this.current();
    const base =
      cur && typeof cur === 'object' && !Array.isArray(cur)
        ? { ...(cur as Record<string, unknown>) }
        : {};
    for (const [k, v] of Object.entries(values)) base[k] = resolveValue(v);
    setIn(this.path, base);
    this.emit();
    return Promise.resolve();
  }

  remove(): Promise<void> {
    return this.set(null);
  }

  /** Thenable reference: retorno serve como ref E como promise (uso do app). */
  push(value?: unknown): StubReference & Promise<StubReference> {
    const key = `stub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const child = getRef(`${this.path}/${key}`);
    const promise =
      value === undefined
        ? Promise.resolve(child)
        : child.set(value).then(() => child);
    return Object.assign(child, promise) as StubReference & Promise<StubReference>;
  }

  child(path: string): StubReference {
    return getRef(`${this.path}/${path}`);
  }

  transaction(
    fn: (cur: unknown) => unknown,
  ): Promise<{ committed: boolean; snapshot: StubDataSnapshot }> {
    const next = resolveValue(fn(this.current()));
    setIn(this.path, next === undefined ? null : next);
    this.emit();
    return Promise.resolve({
      committed: true,
      snapshot: new StubDataSnapshot(this.current(), this.key),
    });
  }

  onDisconnect(): { set: (v: unknown) => Promise<void>; remove: () => Promise<void> } {
    return {
      set: (_v: unknown) => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
  }

  toString(): string {
    return this.path;
  }
}

export function getRef(path: string): StubReference {
  const norm = segmentsOf(path).join('/');
  let ref = REFS.get(norm);
  if (!ref) {
    ref = new StubReference(norm);
    REFS.set(norm, ref);
  }
  return ref;
}

/** Superfície `firebase.database()` no modo standalone. */
export const stubDatabase = {
  ref(path: string = ''): StubReference {
    return getRef(path);
  },
  goOffline(): void {
    /* no-op: já estamos offline por definição */
  },
  goOnline(): void {
    /* no-op: não há rede para conectar */
  },
};

interface StubUserLike {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
}

/** Superfície `firebase.auth()` no modo standalone — sessão sempre nula. */
export const stubAuth = {
  currentUser: null as StubUserLike | null,
  onAuthStateChanged(cb: (user: StubUserLike | null) => void): () => void {
    queueMicrotask(() => cb(null));
    return () => undefined;
  },
  signInWithPopup(_provider?: unknown): Promise<never> {
    return Promise.reject({
      code: 'auth/standalone-mode',
      message: 'Login Google indisponível no modo standalone/desktop.',
    });
  },
  signOut(): Promise<void> {
    return Promise.resolve();
  },
};

/** Classe marcadora usada por `new firebase.auth.GoogleAuthProvider()`. */
export class StubGoogleAuthProvider {
  private scopes: string[] = [];
  addScope(scope: string): this {
    this.scopes.push(scope);
    return this;
  }
  getScopes(): string[] {
    return [...this.scopes];
  }
}

/** Espelho do default export de 'firebase/compat/app' sob stub. */
const firebaseStub: {
  apps: unknown[];
  initializeApp: (...args: unknown[]) => void;
  database: (() => typeof stubDatabase) & { ServerValue: { TIMESTAMP: unknown } };
  auth: (() => typeof stubAuth) & { GoogleAuthProvider: typeof StubGoogleAuthProvider };
} = {
  apps: [],
  initializeApp(): void {
    /* no-op: nenhuma config de nuvem é aplicada */
  },
  database: (() => stubDatabase) as never,
  auth: (() => stubAuth) as never,
};
(firebaseStub.database as { ServerValue: { TIMESTAMP: unknown } }).ServerValue = {
  TIMESTAMP: SERVER_TIMESTAMP,
};
(firebaseStub.auth as { GoogleAuthProvider: typeof StubGoogleAuthProvider }).GoogleAuthProvider =
  StubGoogleAuthProvider;

export default firebaseStub;

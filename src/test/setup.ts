/**
 * Vitest global setup — restores a working Web Storage API.
 *
 * Node >= 22 exposes an experimental global `localStorage` / `sessionStorage`
 * that resolves to `undefined` unless the process is launched with
 * `--localstorage-file`. Vitest's jsdom environment only copies jsdom's own
 * `window` keys onto `globalThis` when the key is absent, so Node's dead global
 * shadows jsdom's working implementation and every storage-backed test throws
 * `Cannot read properties of undefined (reading 'getItem' | 'clear' | ...)`.
 *
 * Defining a spec-compliant in-memory Storage when the global is missing keeps
 * the suite identical on Node 20 (CI) and Node 22+ (local dev), without
 * touching product code or requiring a version-specific Node flag.
 */

class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  getItem(key: string): string | null {
    const value = this.#entries.get(String(key));
    return value === undefined ? null : value;
  }

  key(index: number): string | null {
    return Array.from(this.#entries.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.#entries.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }
}

function ensureStorage(name: 'localStorage' | 'sessionStorage'): void {
  const existing = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
  if (existing && typeof existing.getItem === 'function') return;
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: false,
  });
}

ensureStorage('localStorage');
ensureStorage('sessionStorage');

export {};

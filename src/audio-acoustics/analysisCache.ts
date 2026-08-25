/**
 * Solaris Acoustics — cache de relatórios por identidade de mídia.
 *
 * Spec (SOLARIS_AUDIO_ACOUSTICS.md §Performance): "Cache por fingerprint de
 * arquivo (nunca re-analisa o mesmo bloco)".
 *
 * - LRU em memória (Map preserva ordem de inserção → primeiro = mais velho);
 * - persistência opcional injetável (localStorage no browser, fake em testes);
 * - entradas corrompidas/versão antiga viram MISS e são removidas — nunca
 *   propagam lixo para o painel;
 * - determinístico e sem dependências.
 */
import type { AcousticReport } from './audioAcoustics';

/** Versão do formato serializado — mude para invalidar caches antigos. */
const CACHE_VERSION = 1;

interface StoredEntry {
  v: number;
  cachedAt: number;
  report: AcousticReport;
}

/** Superconjunto mínimo do Storage (DOM Storage satisfaz). */
export interface CacheStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AnalysisCacheOptions {
  /** Persistência externa; null = só memória. Padrão: localStorage se houver. */
  storage?: CacheStorageLike | null;
  /** Máximo de entradas em memória (LRU). Padrão 24. */
  maxEntries?: number;
  /** Prefixo das chaves persistentes. */
  namespace?: string;
}

export interface AnalysisCache {
  /** Relatório em cache para a mídia (memória OU storage) ou undefined. */
  get(mediaKey: string): AcousticReport | undefined;
  /** Idade da entrada (ms) ou undefined se ausente — para UI ("em cache"). */
  ageMs(mediaKey: string): number | undefined;
  set(mediaKey: string, report: AcousticReport): void;
  has(mediaKey: string): boolean;
  clear(): void;
  size(): number;
}

function defaultStorage(): CacheStorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: CacheStorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  } catch {
    /* ambientes sem storage */
  }
  return null;
}

export function createAnalysisCache(opts: AnalysisCacheOptions = {}): AnalysisCache {
  const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
  const maxEntries = Math.max(1, opts.maxEntries ?? 24);
  const ns = opts.namespace ?? 'solaris.acoustics.cache.v1';
  const mem = new Map<string, StoredEntry>();

  const keyOf = (mediaKey: string): string => `${ns}.${encodeURIComponent(mediaKey)}`;

  function readPersisted(mediaKey: string): StoredEntry | undefined {
    if (!storage) return undefined;
    let raw: string | null = null;
    try {
      raw = storage.getItem(keyOf(mediaKey));
    } catch {
      return undefined;
    }
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as StoredEntry;
      if (parsed && parsed.v === CACHE_VERSION && parsed.report && typeof parsed.report.overallScore === 'number') {
        return parsed;
      }
      // Formato estranho/antigo: não é confiável — descarta.
      storage.removeItem(keyOf(mediaKey));
      return undefined;
    } catch {
      try {
        storage.removeItem(keyOf(mediaKey));
      } catch {
        /* ignore */
      }
      return undefined;
    }
  }

  function evictOverflow(): void {
    while (mem.size > maxEntries) {
      const oldest = mem.keys().next();
      if (oldest.done) break;
      mem.delete(oldest.value);
    }
  }

  return {
    get(mediaKey: string): AcousticReport | undefined {
      const k = keyOf(mediaKey);
      const hit = mem.get(k) ?? readPersisted(mediaKey);
      if (!hit) return undefined;
      if (mem.has(k)) {
        // Refresh LRU.
        const e = mem.get(k)!;
        mem.delete(k);
        mem.set(k, e);
      } else {
        mem.set(k, hit);
        evictOverflow();
      }
      return hit.report;
    },

    ageMs(mediaKey: string): number | undefined {
      const k = keyOf(mediaKey);
      const hit = mem.get(k) ?? readPersisted(mediaKey);
      if (!hit) return undefined;
      return Math.max(0, Date.now() - hit.cachedAt);
    },

    set(mediaKey: string, report: AcousticReport): void {
      const k = keyOf(mediaKey);
      const entry: StoredEntry = { v: CACHE_VERSION, cachedAt: Date.now(), report };
      mem.delete(k); // re-inserção move para o fim da fila
      mem.set(k, entry);
      evictOverflow();
      if (storage) {
        try {
          storage.setItem(k, JSON.stringify(entry));
        } catch {
          /* quota cheia / modo privado: cache fica só em memória */
        }
      }
    },

    has(mediaKey: string): boolean {
      return this.get(mediaKey) !== undefined;
    },

    clear(): void {
      // Remove também as chaves persistentes deste namespace conhecidas na memória…
      if (storage) {
        for (const k of Array.from(mem.keys())) {
          try {
            storage.removeItem(k);
          } catch {
            /* ignore */
          }
        }
      }
      mem.clear();
    },

    size(): number {
      return mem.size;
    },
  };
}

/**
 * Fingerprint estável de mídia: URLs entram como estão; arquivos locais pelo
 * tripé nome/tamanho/mtime (o que existe antes de decodificar nada).
 */
export function makeMediaFingerprint(
  media: { url: string } | { name: string; size: number; lastModified: number }
): string {
  if ('url' in media) return `url:${media.url}`;
  return `file:${media.name}:${media.size}:${media.lastModified}`;
}

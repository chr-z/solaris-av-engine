// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Busca universal Ctrl+K (spec A1): pula para qualquer OS, analista, estúdio
// ou setting. Núcleo puro: indexação + ranking sem dependências — o modal
// React é só uma casca lazy sobre este motor.

/** Tipos de destino que o Ctrl+K alcança. */
export type CommandKind = 'os' | 'analyst' | 'studio' | 'setting';

export interface CommandEntry {
  /** Identificador estável (os_id / uid / chave de setting). */
  id: string;
  kind: CommandKind;
  /** Rótulo principal exibido. */
  title: string;
  /** Contexto secundário (estúdio da OS, papel do analista...). */
  subtitle?: string;
}

export interface IndexedDoc {
  id: string;
  kind: CommandKind;
  title: string;
  subtitle?: string;
  /** Termos extras pesquisáveis (número da OS, apelido etc). */
  keywords?: readonly string[];
}

export interface ScoredResult {
  entry: CommandEntry;
  score: number;
}

/**
 * Índice de busca: reconstruído quando a lista de fontes muda; consulta é
 * síncrona e barata (O(docs) por tecla — centenas de OSs é nada).
 */
export class CommandIndex {
  private docs: IndexedDoc[] = [];

  constructor(docs: Iterable<IndexedDoc> = []) {
    this.docs = [...docs];
  }

  setDocs(docs: Iterable<IndexedDoc>): void {
    this.docs = [...docs];
  }

  get size(): number {
    return this.docs.length;
  }

  /**
   * Ranking por prefixo > palavra > substring > fuzzy subsequence.
   * Empates: título mais curto primeiro, depois ordem estável.
   * `limit` padrão 8 — altura ideal p/ o dropdown do Ctrl+K.
   */
  search(query: string, limit = 8): ScoredResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: ScoredResult[] = [];
    for (const doc of this.docs) {
      const s = scoreDoc(doc, q);
      if (s > 0) results.push({ entry: docToEntry(doc), score: s });
    }
    results.sort((a, b) =>
      b.score - a.score ||
      a.entry.title.length - b.entry.title.length,
    );
    return results.slice(0, limit);
  }
}

function docToEntry(doc: IndexedDoc): CommandEntry {
  return { id: doc.id, kind: doc.kind, title: doc.title, subtitle: doc.subtitle };
}

function scoreDoc(doc: IndexedDoc, q: string): number {
  const fields: Array<string | undefined> = [
    doc.title,
    doc.subtitle,
    ...(doc.keywords ?? []),
  ];
  let best = 0;
  for (const field of fields) {
    if (!field) continue;
    best = Math.max(best, scoreField(field.toLowerCase(), q));
  }
  // Boost leve p/ tipo (OSs primeiro — é o fluxo principal).
  if (best > 0 && doc.kind === 'os') best += 1;
  return best;
}

function scoreField(text: string, q: string): number {
  if (text === q) return 100;
  const idx = text.indexOf(q);
  if (idx >= 0) {
    let score = idx === 0 ? 80 : 60 - Math.min(20, idx); // prefixo > meio
    if (/[\s\-_/#]/.test(text[idx - 1] ?? ' ')) score += 4; // início de palavra
    return score;
  }
  // Fuzzy: todos os chars de q aparecem em ordem em text?
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = text.indexOf(q[qi], ti);
    if (found === -1) return 0;
    ti = found + 1;
  }
  return 20; // subsequence fraca mas útil ("12345" acha "OS-12345")
}

/** Agrupa resultados por tipo p/ o modal renderizar cabeçalhos de seção. */
export function groupResultsByKind(results: readonly ScoredResult[]): Map<CommandKind, ScoredResult[]> {
  const groups = new Map<CommandKind, ScoredResult[]>();
  for (const r of results) {
    const list = groups.get(r.entry.kind) ?? [];
    list.push(r);
    groups.set(r.entry.kind, list);
  }
  return groups;
}

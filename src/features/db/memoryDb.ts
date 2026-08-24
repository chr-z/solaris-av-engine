// Solaris v3 — Feature Pack "Analista Feliz" — F1 Fundação de Dados.
//
// Banco em memória mínimo p/ testes e modo standalone/offline-first:
// entende APENAS o subconjunto SQL que o feature pack usa (CREATE TABLE,
// CREATE INDEX, INSERT OR REPLACE, UPDATE ... WHERE, SELECT * FROM t [WHERE]).
// Não é um SQLite — é a referência executável do contrato das tabelas.

import { applyFeatureMigrations } from './migrate';

export type Row = Record<string, string | number | null>;

interface Table {
  columns: string[];
  pk: string[] | null;
  autoinc: string | null;
  rows: Row[];
}

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

/** Comparação tolerante de literais (número vs string numérica). */
export function valuesEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const na = typeof a === 'number' ? a : Number(a);
  const nb = typeof b === 'number' ? b : Number(b);
  return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb;
}

function parseWhere(where: string): (row: Row) => boolean {
  const m = where.match(new RegExp(`^\\s*(${IDENT})\\s*=\\s*(.+)$`));
  if (!m) throw new Error(`where não suportado: ${where}`);
  const col = m[1];
  const lit = m[2].trim();
  const str = lit.match(/^'(.*)'$/s);
  const value: string | number = str ? str[1] : Number(lit);
  return (row) => valuesEq(row[col], value);
}

/**
 * Extrai o prefixo da tabela de um CREATE TABLE, lidando com parênteses
 * aninhados (CHECK com IN (...), PRIMARY KEY composta etc).
 */
export function parseCreateTable(
  sql: string,
): { name: string; body: string } | null {
  const m = sql.match(new RegExp(`^\\s*CREATE TABLE IF NOT EXISTS (${IDENT})\\s*\\(`));
  if (!m) return null;
  let depth = 1; // já dentro do parêntese de abertura do corpo
  const start = sql.indexOf('(', m.index!) + 1;
  for (let i = start; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') {
      depth--;
      if (depth === 0) return { name: m[1], body: sql.slice(start, i) };
    }
  }
  return null;
}

export class MemoryDb {
  private tables = new Map<string, Table>();
  private autoincCounters = new Map<string, number>();

  constructor() {
    applyFeatureMigrations({ exec: (sql) => this.exec(sql) });
  }

  /** Nomes de tabelas criadas (ordem de criação). */
  tableNames(): string[] {
    return [...this.tables.keys()];
  }

  /** Todas as linhas da tabela (cópia rasa por linha). */
  selectAll(table: string): Row[] {
    const t = this.table(table);
    return t.rows.map((r) => ({ ...r }));
  }

  private table(name: string): Table {
    const t = this.tables.get(name);
    if (!t) throw new Error(`tabela inexistente: ${name}`);
    return t;
  }

  exec(sql: string): void {
    const clean = stripLineComments(sql).trim();
    if (!clean) return;

    if (/^CREATE TABLE IF NOT EXISTS /i.test(clean)) {
      const parsed = parseCreateTable(clean);
      if (!parsed) throw new Error(`CREATE TABLE malformado: ${clean}`);
      if (this.tables.has(parsed.name)) return; // idempotente
      const columns: string[] = [];
      let pk: string[] | null = null;
      let autoinc: string | null = null;
      // divide o corpo em definições no nível superior (vírgulas fora de parênteses)
      const defs: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of parsed.body) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
          defs.push(cur.trim());
          cur = '';
        } else cur += ch;
      }
      if (cur.trim()) defs.push(cur.trim());
      for (const def of defs) {
        const upper = def.toUpperCase();
        if (upper.startsWith('PRIMARY KEY')) {
          const inner = def.slice(def.indexOf('(') + 1, def.lastIndexOf(')'));
          pk = inner.split(',').map((c) => c.trim());
        } else {
          const cm = def.match(new RegExp(`^(${IDENT})`));
          if (!cm) continue;
          columns.push(cm[1]);
          if (/INTEGER PRIMARY KEY AUTOINCREMENT/i.test(def)) autoinc = cm[1];
          else if (/PRIMARY KEY/i.test(def)) pk = [cm[1]]; // PK em coluna (SQLite aceita)
        }
      }
      this.tables.set(parsed.name, { columns, pk, autoinc, rows: [] });
      return;
    }

    const idx = clean.match(new RegExp(`^CREATE (UNIQUE )?INDEX IF NOT EXISTS (${IDENT}) ON (${IDENT})`, 'i'));
    if (idx) return; // índices são semântica física; em memória são no-op

    const ins = clean.match(new RegExp(`^INSERT (OR REPLACE |OR IGNORE )?INTO (${IDENT})(?:\\s*\\(([^)]*)\\))?\\s*VALUES\\s*\\(([\\s\\S]*)\\)$`, 'i'));
    if (ins) {
      const [, orOpt, table, colList, valsPart] = ins;
      const t = this.table(table);
      const values = this.splitTopLevel(valsPart).map((v) => this.parseLiteral(v));
      const cols = colList
        ? colList.split(',').map((c) => c.trim())
        : t.autoinc
          ? [...t.columns.filter((c) => c !== t.autoinc)]
          : [...t.columns];
      const row: Row = {};
      t.columns.forEach((c) => (row[c] = null));
      cols.forEach((c, i) => (row[c] = values[i]));
      if (t.autoinc && !cols.includes(t.autoinc)) {
        const next = (this.autoincCounters.get(table) ?? 0) + 1;
        this.autoincCounters.set(table, next);
        row[t.autoinc] = next;
      }
      const keyOf = (r: Row): string =>
        t.pk ? JSON.stringify(t.pk.map((c) => r[c])) : '';
      const existingIdx = t.pk
        ? t.rows.findIndex((r) => keyOf(r) === keyOf(row))
        : -1;
      const replace = orOpt?.toUpperCase().includes('REPLACE') ?? false;
      const ignore = orOpt?.toUpperCase().includes('IGNORE') ?? false;
      if (existingIdx >= 0) {
        if (replace) t.rows[existingIdx] = row;
        else if (!ignore) throw new Error('constraint UNIQUE/PRIMARY KEY violada');
        return;
      }
      t.rows.push(row);
      return;
    }

    const upd = clean.match(new RegExp(`^UPDATE (${IDENT}) SET ([\\s\\S]+?) WHERE (.+)$`, 'i'));
    if (upd) {
      const [, table, setPart, wherePart] = upd;
      const t = this.table(table);
      const pred = parseWhere(wherePart);
      for (const row of t.rows) {
        if (!pred(row)) continue;
        for (const assign of this.splitTopLevel(setPart)) {
          const am = assign.match(new RegExp(`^(${IDENT})\\s*=\\s*(.+)$`));
          if (!am) continue;
          row[am[1]] = this.parseLiteral(am[2].trim());
        }
      }
      return;
    }

    const sel = clean.match(new RegExp(`^SELECT \\* FROM (${IDENT})(?: WHERE (.+))?$`, 'i'));
    if (sel) {
      // SELECT só existe aqui p/ depuração; queries reais usam selectAll/predicados JS
      return;
    }

    throw new Error(`statement não suportado pelo MemoryDb: ${clean.slice(0, 120)}`);
  }

  private splitTopLevel(s: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if ((ch === ',' || ch === ';') && depth === 0) {
        parts.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts.filter(Boolean);
  }

  private parseLiteral(tok: string): string | number | null {
    const t = tok.trim();
    if (t === 'NULL') return null;
    const sq = t.match(/^'([\s\S]*)'$/);
    if (sq) return sq[1];
    const n = Number(t);
    return Number.isNaN(n) ? (t as string) : n;
  }
}

// Solaris v3 — Feature Pack "Analista Feliz" — F1 Fundação de Dados.
//
// Migrador puro (sem I/O): divide o SQL em statements e aplica cada um via
// um DbExecutor injetável. O mesmo runner atende:
//   * D1/Cloudflare  → batch() com prepared statements
//   * better-sqlite3 / Tauri SQL plugin → exec direto
//   * memória (testes, modo standalone) → MemoryDb deste pacote
//
// Idempotente por construção: todo statement é IF NOT EXISTS / re-executável.

import { MIGRATION_ANALISTA_FELIZ } from './schema';

export interface DbExecutor {
  /** Executa um único statement DDL/DML. */
  exec(sql: string): void;
}

/** Linhas que são só comentário SQL saem antes do split. */
function stripCommentLines(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

/** Statement SQL "simples" (sem BEGIN/COMMIT aninhados). */
export function splitSqlStatements(sql: string): string[] {
  return stripCommentLines(sql)
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Aplica todas as migrations do feature pack. Retorna os statements
 * executados (para log/auditoria). Nunca lança em re-run: statements são
 * idempotentes; erros de executor são propagados ao chamador decidir.
 */
export function applyFeatureMigrations(db: DbExecutor): { applied: string[] } {
  const statements = splitSqlStatements(MIGRATION_ANALISTA_FELIZ);
  for (const stmt of statements) db.exec(stmt);
  return { applied: statements };
}

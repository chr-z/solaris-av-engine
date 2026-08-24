// Solaris v3 — Feature Pack "Analista Feliz" — F1 Fundação de Dados.
// Ponto de entrada da camada de dados (schema, migrador, memória e papéis).

export { MIGRATION_ANALISTA_FELIZ } from './schema';
export { applyFeatureMigrations, splitSqlStatements } from './migrate';
export type { DbExecutor } from './migrate';
export {
  MemoryDb,
  parseCreateTable,
  valuesEq,
} from './memoryDb';
export type { Row } from './memoryDb';
export {
  scopeForRole,
  queueRowVisible,
  scopeQueueRows,
  canReadIndividualMetrics,
  canManageQueue,
  canToggleGamification,
  podiumGroupFor,
} from './roles';
export type { Role, Seniority, UserContext, QueueScope } from './roles';

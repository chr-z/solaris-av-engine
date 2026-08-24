// Solaris v3 — F1 Fundação de Dados — testes do pacote.
// Cobre: sincronia SQL↔TS, split de statements, migrador (idempotente,
// executor quebrado), MemoryDb (DDL/DML/contraintes) e camada de papéis.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MIGRATION_ANALISTA_FELIZ,
  applyFeatureMigrations,
  splitSqlStatements,
  MemoryDb,
  parseCreateTable,
  valuesEq,
  scopeForRole,
  queueRowVisible,
  scopeQueueRows,
  canReadIndividualMetrics,
  canManageQueue,
  canToggleGamification,
} from '../features/db';
import type { DbExecutor } from '../features/db';

const REPO_ROOT = join(__dirname, '..', '..');
const admin = { userId: 'u-admin', role: 'admin' as const, seniority: 'senior' as const };
const lead = { userId: 'u-lead', role: 'lead' as const, seniority: 'senior' as const };
const ana = { userId: 'u-ana', role: 'analyst' as const, seniority: 'trainee' as const };

describe('F1 schema: arquivo .sql e template TS são gêmeos', () => {
  it('migrations/0002_analista_feliz.sql === MIGRATION_ANALISTA_FELIZ', () => {
    const file = readFileSync(
      join(REPO_ROOT, 'migrations', '0002_analista_feliz.sql'),
      'utf8',
    );
    expect(file.trim()).toBe(MIGRATION_ANALISTA_FELIZ.trim());
    expect(file).toContain('users_roles');
  });

  it('declara as 5 tabelas do pacote', () => {
    for (const t of ['users_roles', 'os_queue', 'xp_events', 'achievements', 'podium_history']) {
      expect(MIGRATION_ANALISTA_FELIZ).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
  });
});

describe('splitSqlStatements', () => {
  it('divide por ; no fim de linha e descarta vazios/comentários puros', () => {
    const stmts = splitSqlStatements('CREATE TABLE a (x TEXT);\n-- só comentário\n;\nINSERT INTO a VALUES (1);');
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toBe('CREATE TABLE a (x TEXT)');
    expect(stmts[1]).toBe('INSERT INTO a VALUES (1)');
  });
});

describe('applyFeatureMigrations', () => {
  it('aplica todos os statements em ordem via executor injetado', () => {
    const log: string[] = [];
    const res = applyFeatureMigrations({ exec: (s) => void log.push(s) });
    expect(log.length).toBe(14); // 5 CREATE TABLE + 9 índices
    expect(res.applied).toEqual(log);
    expect(log.some((s) => s.startsWith('CREATE TABLE IF NOT EXISTS xp_events'))).toBe(true);
  });

  it('é idempotente num executor real (re-run não lança)', () => {
    const db = new MemoryDb();
    // o constructor já aplicou; aplicar de novo direto no mesmo db:
    expect(() => applyFeatureMigrations({ exec: (s) => db.exec(s) })).not.toThrow();
    expect(db.tableNames()).toHaveLength(5);
  });

  it('propaga erro de executor quebrado', () => {
    const bad: DbExecutor = { exec: () => { throw new Error('boom'); } };
    expect(() => applyFeatureMigrations(bad)).toThrow('boom');
  });
});

describe('MemoryDb: DDL', () => {
  it('cria exatamente as 5 tabelas do feature pack', () => {
    expect(new MemoryDb().tableNames()).toEqual([
      'users_roles',
      'os_queue',
      'xp_events',
      'achievements',
      'podium_history',
    ]);
  });

  it('parseCreateTable extrai nome e corpo com parênteses aninhados', () => {
    const parsed = parseCreateTable(`CREATE TABLE IF NOT EXISTS t (a TEXT CHECK (a IN ('x','y')), b INTEGER)`);
    expect(parsed?.name).toBe('t');
    expect(parsed?.body).toContain("CHECK (a IN ('x','y'))");
    expect(parseCreateTable('SELECT 1')).toBeNull();
  });

  it('valuesEq compara número vs string numérica, mas não string vs null', () => {
    expect(valuesEq('3', 3)).toBe(true);
    expect(valuesEq(null, 'null')).toBe(false);
    expect(valuesEq('abc', 'abc')).toBe(true);
  });
});

describe('MemoryDb: DML e constraints', () => {
  it('INSERT OR REPLACE respeita PK composta (achievements idempotente)', () => {
    const db = new MemoryDb();
    db.exec(`INSERT OR REPLACE INTO achievements (user_id, key, unlocked_at) VALUES ('u1','first_os','2026-08-24T10:00:00Z')`);
    db.exec(`INSERT OR REPLACE INTO achievements (user_id, key, unlocked_at) VALUES ('u1','first_os','2026-08-24T11:00:00Z')`);
    const rows = db.selectAll('achievements');
    expect(rows).toHaveLength(1);
    expect(rows[0].unlocked_at).toBe('2026-08-24T11:00:00Z');
  });

  it('INSERT simples sem OR REPLACE viola PK duplicada', () => {
    const db = new MemoryDb();
    db.exec(`INSERT INTO users_roles (user_id, role, created_at, updated_at) VALUES ('u1','admin','t','t')`);
    expect(() =>
      db.exec(`INSERT INTO users_roles (user_id, role, created_at, updated_at) VALUES ('u1','analyst','t','t')`),
    ).toThrow();
    expect(db.selectAll('users_roles')).toHaveLength(1);
  });

  it('AUTOINCREMENT atribui id sequencial ao xp_events', () => {
    const db = new MemoryDb();
    db.exec(`INSERT INTO xp_events (user_id, amount, reason, ts) VALUES ('u1',100,'os_complete','t1')`);
    db.exec(`INSERT INTO xp_events (user_id, amount, reason, ts) VALUES ('u2',25,'streak_bonus','t2')`);
    const rows = db.selectAll('xp_events');
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
    expect(rows[0].amount).toBe(100);
  });

  it('UPDATE ... WHERE atinge apenas linhas correspondentes', () => {
    const db = new MemoryDb();
    db.exec(`INSERT INTO os_queue (os_id, status, created_at, updated_at) VALUES ('OS-1','queued','t','t')`);
    db.exec(`INSERT INTO os_queue (os_id, status, created_at, updated_at) VALUES ('OS-2','queued','t','t')`);
    db.exec(`UPDATE os_queue SET status='done' WHERE os_id='OS-1'`);
    const byId = Object.fromEntries(db.selectAll('os_queue').map((r) => [r.os_id, r.status]));
    expect(byId['OS-1']).toBe('done');
    expect(byId['OS-2']).toBe('queued');
  });
});

describe('papéis (RLS-like)', () => {
  const fila = [
    { os_id: 'A', assignee: 'u-ana', claimed_by: null },
    { os_id: 'B', assignee: 'u-other', claimed_by: null },
    { os_id: 'C', assignee: null, claimed_by: 'u-ana' },
    { os_id: 'D', assignee: null, claimed_by: null },
  ];

  it('admin/lead enxergam tudo; analista só o seu (assignee ou claimed)', () => {
    expect(scopeForRole(admin)).toEqual({ kind: 'all' });
    expect(scopeForRole(lead)).toEqual({ kind: 'all' });
    expect(scopeForRole(ana)).toEqual({ kind: 'own', userId: 'u-ana' });
    expect(scopeQueueRows(lead, fila)).toHaveLength(4);
    expect(scopeQueueRows(admin, fila)).toHaveLength(4);
    const visiveis = scopeQueueRows(ana, fila);
    expect(visiveis.map((r) => r.os_id)).toEqual(['A', 'C']);
  });

  it('queueRowVisible cobre claimed_by mesmo sem assignee', () => {
    expect(queueRowVisible(scopeForRole(ana), { assignee: null, claimed_by: 'u-ana' })).toBe(true);
    expect(queueRowVisible(scopeForRole(ana), { assignee: 'u-ana', claimed_by: 'x' })).toBe(true);
    expect(queueRowVisible(scopeForRole(ana), { assignee: 'outro', claimed_by: null })).toBe(false);
  });

  it('métricas individuais: sim p/ admin/lead, não p/ analista', () => {
    expect(canReadIndividualMetrics(admin)).toBe(true);
    expect(canReadIndividualMetrics(lead)).toBe(true);
    expect(canReadIndividualMetrics(ana)).toBe(false);
  });

  it('gestão de fila é admin+lead; toggle de gamificação é só admin', () => {
    expect(canManageQueue(lead)).toBe(true);
    expect(canManageQueue(ana)).toBe(false);
    expect(canToggleGamification(admin)).toBe(true);
    expect(canToggleGamification(lead)).toBe(false);
    expect(canToggleGamification(ana)).toBe(false);
  });
});

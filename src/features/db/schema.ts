// Solaris v3 — Feature Pack "Analista Feliz" — F1 Fundação de Dados.
//
// Fonte única do schema incremental das features (QoL/dashboard/gamificação).
// Este template literal DEVE permanecer idêntico ao arquivo canônico
// migrations/0002_analista_feliz.sql na raiz do repo — o teste
// __tests__/featuresMigrations.test.ts compara os dois para garantir sincronia.

export const MIGRATION_ANALISTA_FELIZ = /* SQL */ `
-- Solaris v3 — Feature Pack "Analista Feliz" — F1 Fundação de Dados
-- Schema incremental, versionado e idempotente (CREATE IF NOT EXISTS).
-- Alvo: D1 (Cloudflare) / SQLite local do desktop Tauri.
--
-- Convenções:
--   * ids de usuário = string (uid Firebase/Supabase; 'local' no modo offline).
--   * timestamps ISO-8601 UTC (TEXT), gerados pelo app p/ portabilidade D1.
--   * xp_events.amount pode ser negativo (ajustes/estornos de auditoria).
--   * NUNCA pontuar velocidade pura (spec C4) — reason enum reflete isso.

-- ── Papéis ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users_roles (
  user_id   TEXT PRIMARY KEY,
  name      TEXT,
  role      TEXT NOT NULL DEFAULT 'analyst'
            CHECK (role IN ('admin','lead','analyst')),
  seniority TEXT NOT NULL DEFAULT 'trainee'
            CHECK (seniority IN ('trainee','junior','senior')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_roles_role ON users_roles(role);

-- ── Fila de OSs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS os_queue (
  os_id       TEXT PRIMARY KEY,
  title       TEXT,
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','in_analysis','done','returned')),
  assignee    TEXT REFERENCES users_roles(user_id),
  priority    INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  deadline    TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  started_at  TEXT,
  completed_at TEXT,
  claimed_by  TEXT REFERENCES users_roles(user_id),
  claimed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_os_queue_status ON os_queue(status);
CREATE INDEX IF NOT EXISTS idx_os_queue_assignee ON os_queue(assignee);
CREATE INDEX IF NOT EXISTS idx_os_queue_deadline ON os_queue(deadline);
CREATE INDEX IF NOT EXISTS idx_os_queue_completed ON os_queue(completed_at);

-- ── XP (event-sourced: saldo = soma de amount por usuário) ────────────
CREATE TABLE IF NOT EXISTS xp_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  amount  INTEGER NOT NULL CHECK (amount BETWEEN -500 AND 1000),
  reason  TEXT NOT NULL CHECK (reason IN
          ('os_complete','complexity_bonus','streak_bonus','quality_bonus',
           'adjustment','rework_penalty')),
  ts      TEXT NOT NULL,
  meta    TEXT
);

CREATE INDEX IF NOT EXISTS idx_xp_user_ts ON xp_events(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_xp_ts ON xp_events(ts);

-- ── Conquistas (idempotente por par user+key) ─────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
  user_id     TEXT NOT NULL,
  key         TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_ach_key ON achievements(key);

-- ── Histórico de pódios (snapshot congelado a cada período fechado) ────
CREATE TABLE IF NOT EXISTS podium_history (
  period_type TEXT NOT NULL CHECK (period_type IN ('week','month','year')),
  period_key  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  rank        INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 10),
  xp          INTEGER NOT NULL,
  rework_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (period_type, period_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_podium_period ON podium_history(period_type, period_key, rank);
`;

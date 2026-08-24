-- Solaris v3 desktop — schema incremental (spec SOLARIS_V3_SATURNO.md)
-- Aplicado idempotentemente pelo core Tauri no boot (migrations numeradas).

-- v3: cache de OSs do Saturno + aprendizado da triagem + invariantes.

CREATE TABLE IF NOT EXISTS saturno_os_cache (
  os_id      TEXT PRIMARY KEY,
  professor  TEXT,
  operador   TEXT,
  data       TEXT,          -- ISO yyyy-mm-dd quando parseável
  estudio    TEXT,
  tipo       TEXT,
  kit        TEXT,
  mic        TEXT,
  evento     TEXT,
  fundo      TEXT,
  streaming  TEXT,
  uniforme   TEXT,
  alfred_path TEXT,         -- caminho declarado (camada 1 do matching)
  raw_json   TEXT NOT NULL, -- payload original (auditoria/re-parse futuro)
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_decisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  assinatura_pasta TEXT NOT NULL,  -- assinatura normalizada da pasta (layer key)
  os_id           TEXT NOT NULL,
  decided_by      TEXT NOT NULL DEFAULT 'human' CHECK (decided_by IN ('human','auto')),
  decided_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assinatura_pasta)        -- última decisão vence (UPSERT)
);

-- Auditoria de toda atribuição automática (invariante: nada silencioso).
CREATE TABLE IF NOT EXISTS matching_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  block_path   TEXT NOT NULL,
  os_id        TEXT NOT NULL,
  layer        TEXT NOT NULL CHECK (layer IN ('declared-path','filename-os','window','manual')),
  confidence   REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  decided_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_matching_audit_block ON matching_audit(block_path);

-- INVARIANTE central: um bloco nunca pertence a duas OSs.
-- block_path é a chave; tentativa de reuso em outra OS viola o UNIQUE.
CREATE TABLE IF NOT EXISTS os_blocks (
  os_id      TEXT NOT NULL,
  block_path TEXT NOT NULL,
  layer      TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (block_path),                 -- unicidade global do bloco
  FOREIGN KEY (os_id) REFERENCES saturno_os_cache(os_id)
);
CREATE INDEX IF NOT EXISTS idx_os_blocks_os ON os_blocks(os_id);

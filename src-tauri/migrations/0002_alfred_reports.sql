-- 0002_alfred_reports.sql — cache persistente do scan Alfred (desktop).
--
-- Linha ÚNICA (id fixo = 1): cada scan sobrescreve o anterior. O relatório
-- completo (OSs + órfãos + candidatos de janela) vai serializado em JSON —
-- o schema do report é domínio do scan_alfred.rs e evolui junto dele; aqui
-- só interessa recuperar o último estado conhecido da varredura.
CREATE TABLE IF NOT EXISTS alfred_reports (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    root TEXT NOT NULL,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    scanned_dirs INTEGER NOT NULL DEFAULT 0,
    skipped_permission_errors INTEGER NOT NULL DEFAULT 0,
    report_json TEXT NOT NULL
);

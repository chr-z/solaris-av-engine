//! db.rs — camada SQLite do Solaris desktop (spec SOLARIS_V3_SATURNO.md).
//!
//! Abre/cria o banco local (dados nunca saem da rede do cliente), aplica as
//! migrations idempotentemente e expõe operações de cache de OS, decisão de
//! triagem e atribuição de blocos com o invariante de unicidade no próprio
//! banco (PRIMARY KEY em block_path → dupla atribuição vira erro do SQLite).

use rusqlite::Connection;
use std::path::Path;

const MIGRATIONS: &[(&str, &str)] = &[(
    "0001_saturno_matching",
    include_str!("../migrations/0001_saturno_matching.sql"),
)];

pub fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    apply_migrations(&conn)?;
    Ok(conn)
}

/// Migrations idempotentes: tabela _migrations marca o que já rodou.
/// O SQL das migrations é todo escrito com IF NOT EXISTS / UPSERT, então
/// re-executar é seguro.
fn apply_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
             name TEXT PRIMARY KEY,
             applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         );",
    )?;
    for (name, sql) in MIGRATIONS {
        let done: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM _migrations WHERE name = ?1",
                [name],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n > 0)?;
        if !done {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT OR IGNORE INTO _migrations(name) VALUES (?1)",
                [name],
            )?;
        }
    }
    Ok(())
}

#[derive(Debug)]
pub struct OsCacheRow<'a> {
    pub os_id: &'a str,
    pub professor: Option<&'a str>,
    pub operador: Option<&'a str>,
    pub data: Option<&'a str>,
    pub estudio: Option<&'a str>,
    pub alfred_path: Option<&'a str>,
    pub raw_json: &'a str,
}

pub fn upsert_os_cache(conn: &Connection, row: &OsCacheRow) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO saturno_os_cache
             (os_id, professor, operador, data, estudio, alfred_path, raw_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(os_id) DO UPDATE SET
             professor = excluded.professor,
             operador = excluded.operador,
             data = excluded.data,
             estudio = excluded.estudio,
             alfred_path = excluded.alfred_path,
             raw_json = excluded.raw_json,
             fetched_at = datetime('now')",
        rusqlite::params![
            row.os_id,
            row.professor,
            row.operador,
            row.data,
            row.estudio,
            row.alfred_path,
            row.raw_json
        ],
    )
}

/// Decisão aprendida da triagem: assinatura normalizada de pasta → OS (UPSERT).
pub fn learn_folder_decision(
    conn: &Connection,
    assinatura_pasta: &str,
    os_id: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO matching_decisions (assinatura_pasta, os_id, decided_by)
         VALUES (?1, ?2, 'human')
         ON CONFLICT(assinatura_pasta) DO UPDATE SET
             os_id = excluded.os_id,
             decided_by = 'human',
             decided_at = datetime('now')",
        rusqlite::params![assinatura_pasta, os_id],
    )
}

pub fn load_learned_decisions(conn: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT assinatura_pasta, os_id FROM matching_decisions")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

/// Atribui bloco a OS respeitando unicidade global (erro se bloco já tem dono).
pub fn assign_block(
    conn: &Connection,
    os_id: &str,
    block_path: &str,
    layer: &str,
) -> Result<usize, rusqlite::Error> {
    let n = conn.execute(
        "INSERT INTO os_blocks (os_id, block_path, layer) VALUES (?1, ?2, ?3)",
        rusqlite::params![os_id, block_path, layer],
    )?;
    conn.execute(
        "INSERT INTO matching_audit (block_path, os_id, layer, confidence)
         VALUES (?1, ?2, ?3,
                 CASE ?3 WHEN 'declared-path' THEN 1.0
                         WHEN 'manual' THEN 1.0
                         WHEN 'filename-os' THEN 0.9
                         ELSE 0.7 END)",
        rusqlite::params![block_path, os_id, layer],
    )?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        open_db(Path::new(":memory:")).unwrap()
    }

    #[test]
    fn migrations_sao_idempotentes() {
        let conn = mem_db();
        // Reabrir/aplicar de novo não pode falhar nem duplicar.
        apply_migrations(&conn).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='saturno_os_cache'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn upsert_de_os_e_decisao_aprendida_ultima_vence() {
        let conn = mem_db();
        upsert_os_cache(
            &conn,
            &OsCacheRow {
                os_id: "12345",
                professor: Some("Duda"),
                operador: Some("Léo"),
                data: Some("2026-07-14"),
                estudio: Some("SEDE-11"),
                alfred_path: None,
                raw_json: "{}",
            },
        )
        .unwrap();
        learn_folder_decision(&conn, "sede11|2026-07-14", "12345").unwrap();
        learn_folder_decision(&conn, "sede11|2026-07-14", "67890").unwrap(); // nova triagem
        let learned = load_learned_decisions(&conn).unwrap();
        assert_eq!(learned, vec![("sede11|2026-07-14".to_string(), "67890".to_string())]);
    }

    #[test]
    fn bloco_nunca_em_duas_oss_constraint() {
        let conn = mem_db();
        upsert_os_cache(
            &conn,
            &OsCacheRow {
                os_id: "A",
                professor: None,
                operador: None,
                data: None,
                estudio: None,
                alfred_path: None,
                raw_json: "{}",
            },
        )
        .unwrap();
        upsert_os_cache(
            &conn,
            &OsCacheRow {
                os_id: "B",
                professor: None,
                operador: None,
                data: None,
                estudio: None,
                alfred_path: None,
                raw_json: "{}",
            },
        )
        .unwrap();
        assign_block(&conn, "A", "/v/bloco.mp4", "window").unwrap();
        let dupla = assign_block(&conn, "B", "/v/bloco.mp4", "filename-os");
        assert!(dupla.is_err(), "UNIQUE de block_path deve impedir dupla atribuição");
        // Mesma OS re-atribuir o mesmo bloco também falha (PK), idempotência fica no front.
        let repete = assign_block(&conn, "A", "/v/bloco.mp4", "window");
        assert!(repete.is_err());
        // Auditoria registrou exatamente uma entrada.
        let audit: i64 = conn
            .query_row("SELECT COUNT(*) FROM matching_audit", [], |r| r.get(0))
            .unwrap();
        assert_eq!(audit, 1);
    }
}

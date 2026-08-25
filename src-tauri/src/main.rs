// src-tauri — Solaris desktop (on-premise). Ponto de entrada Tauri v2.
//
// Módulos:
// - scan_alfred: varredura tolerante da RAIZ_ALFRED + candidatos de janela
// - db: cache SQLite local (OSs Saturno, decisões de triagem, blocos)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod scan_alfred;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub root: String,
    #[serde(default)]
    pub max_depth: Option<u32>,
    /// Caminhos de OS declarados pelo Saturno (camada 1 do matching).
    #[serde(default)]
    pub declared_os_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ScanResponse {
    pub report: scan_alfred::AlfredScanReport,
}

/// Comando Tauri: escaneia a RAIZ_ALFRED e devolve OSs + órfãos + candidatos
/// de janela temporal pro front resolver as camadas de confiança.
/// `async` roda na thread-pool do runtime — a janela não congela durante
/// varreduras grandes de rede (UNC).
#[tauri::command]
async fn scan_alfred_command(req: ScanRequest) -> Result<ScanResponse, String> {
    let root = std::path::PathBuf::from(&req.root);
    if !root.is_dir() {
        return Err(format!("RAIZ_ALFRED não existe ou não é pasta: {}", req.root));
    }
    let opts = scan_alfred::ScanOptions {
        max_depth: req.max_depth.unwrap_or(8).clamp(1, 20),
        declared_os_paths: &req.declared_os_paths,
    };
    Ok(ScanResponse {
        report: scan_alfred::scan_alfred(&root, &opts),
    })
}

/// Resposta do seletor nativo de pastas. `path = None` ⇒ usuário cancelou.
#[derive(Debug, Serialize)]
pub struct FolderPickResponse {
    pub path: Option<String>,
}

/// Comando Tauri: diálogo nativo de seleção de pasta (Admin → Fontes).
/// Começa em `start_path` quando existe (senão no pai existente mais próximo).
#[tauri::command]
async fn pick_folder_command(
    title: Option<String>,
    start_path: Option<String>,
) -> Result<FolderPickResponse, String> {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(t) = title.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        dialog = dialog.set_title(t.to_string());
    }
    if let Some(start) = start_path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let p = std::path::PathBuf::from(start);
        // Caminhos UNC/raízes podem não existir ainda — cai pro pai existente.
        let dir = if p.is_dir() {
            Some(p)
        } else {
            p.parent().filter(|parent| parent.is_dir()).map(Into::into)
        };
        if let Some(d) = dir {
            dialog = dialog.set_directory(d);
        }
    }
    let picked = dialog
        .pick_folder()
        .await
        .map(|handle| handle.path().to_string_lossy().into_owned());
    Ok(FolderPickResponse { path: picked })
}

/// Caminho do SQLite local (dados nunca saem da rede do cliente): fica na
/// pasta de dados do app — `%APPDATA%\<identifier>\solaris.sqlite3` no
/// Windows. Fallback: temp dir (não deve acontecer no desktop real).
fn db_path() -> Result<std::path::PathBuf, String> {
    let base = match dirs::data_dir() {
        Some(d) => d,
        None => std::env::temp_dir(),
    };
    Ok(base.join("dev.chr-z.solaris").join("solaris.sqlite3"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveReportRequest {
    pub report: scan_alfred::AlfredScanReport,
}

/// Comando Tauri: persiste o relatório do último scan Alfred no SQLite local.
/// O banco é aberto por operação (WAL + UPSERT id=1) — sem estado compartilhado
/// entre comandos, cada varredura substitui a anterior.
#[tauri::command]
async fn save_last_report_command(req: SaveReportRequest) -> Result<SaveReportResponse, String> {
    let path = db_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("falha ao criar pasta de dados: {}", e))?;
    }
    let conn = db::open_db(&path).map_err(|e| format!("falha ao abrir o SQLite: {}", e))?;
    let report_json = serde_json::to_string(&req.report)
        .map_err(|e| format!("falha ao serializar o relatório: {}", e))?;
    let row = db::AlfredReportRow {
        root: &req.report.root,
        scanned_dirs: req.report.scanned_dirs,
        skipped_permission_errors: req.report.skipped_permission_errors,
        report_json: &report_json,
    };
    db::save_alfred_report(&conn, &row)
        .map_err(|e| format!("falha ao salvar o relatório: {}", e))?;
    Ok(SaveReportResponse {})
}

#[derive(Debug, Serialize)]
pub struct SaveReportResponse {}

/// Resposta do último relatório persistido. `report = None` ⇒ ainda não há
/// nenhum scan salvo neste computador.
#[derive(Debug, Serialize)]
pub struct LoadReportResponse {
    pub report: Option<scan_alfred::AlfredScanReport>,
    /// Momento da gravação (UTC, datetime do SQLite).
    pub scanned_at: Option<String>,
}

/// Comando Tauri: recupera o último relatório de scan persistido — a UI usa
/// isso pra restaurar o estado da varredura ao reabrir o app.
#[tauri::command]
async fn load_last_report_command() -> Result<LoadReportResponse, String> {
    let path = db_path()?;
    if !path.exists() {
        return Ok(LoadReportResponse {
            report: None,
            scanned_at: None,
        });
    }
    let conn = db::open_db(&path).map_err(|e| format!("falha ao abrir o SQLite: {}", e))?;
    match db::load_last_alfred_report(&conn)
        .map_err(|e| format!("falha ao ler o relatório: {}", e))?
    {
        None => Ok(LoadReportResponse {
            report: None,
            scanned_at: None,
        }),
        Some(row) => {
            let report = serde_json::from_str(&row.report_json)
                .map_err(|e| format!("relatório salvo ilegível: {}", e))?;
            Ok(LoadReportResponse {
                report: Some(report),
                scanned_at: Some(row.scanned_at),
            })
        }
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_alfred_command,
            pick_folder_command,
            save_last_report_command,
            load_last_report_command
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Solaris desktop")
}

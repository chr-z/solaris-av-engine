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
#[tauri::command]
fn scan_alfred_command(req: ScanRequest) -> Result<ScanResponse, String> {
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan_alfred_command])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Solaris desktop");
}

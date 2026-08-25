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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_alfred_command,
            pick_folder_command
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Solaris desktop")
}

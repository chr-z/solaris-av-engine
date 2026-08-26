//! Configuração de runtime lida pelo core Tauri (P3 — flag STANDALONE_MODE).
//!
//! O sabor standalone já nasce sem nuvem pelo alias do Vite (compile-time).
//! Este módulo cobre o caso LITERAL da diretiva: um FLAG DE RUNTIME que liga
//! o modo sem nuvem em qualquer artefato (ex.: deploy web on-premise na rede
//! do cliente), sem rebuild:
//!
//! 1. Variável de ambiente `STANDALONE_MODE`
//!    (`1/true/yes/on` ⇒ standalone; `0/false/no/off` ⇒ cloud;
//!     ausente ou valor não reconhecido ⇒ sem opinião);
//! 2. Arquivo de config local `<APPDATA>/dev.chr-z.solaris/config.local.json`
//!    com o campo opcional `"standaloneMode": true|false`
//!    (arquivo ausente, JSON malformado ou campo fora de tipo ⇒ sem opinião).
//!
//! Precedência: env > arquivo. A APLICAÇÃO da opinião fica no front
//! (runtimeMode.applyRemoteModeOpinion) com guarda anti-rebaixamento: nenhum
//! flag pode desligar o modo standalone de um artefato que JÁ nasceu sem
//! nuvem (build flag / runtime Tauri) — nesse artefato os SDKs de nuvem nem
//! existem no bundle.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Identificador do app — mesma pasta do SQLite (%APPDATA%\\dev.chr-z.solaris).
const APP_ID_DIR: &str = "dev.chr-z.solaris";
/// Nome do arquivo de config local consultado (documentado pro suporte).
pub const CONFIG_FILE_NAME: &str = "config.local.json";
/// Nome da variável de ambiente reconhecida.
pub const ENV_VAR_NAME: &str = "STANDALONE_MODE";

/// Shape do arquivo de config local. Campos desconhecidos são ignorados.
#[derive(Debug, Default, Deserialize, PartialEq)]
pub struct LocalConfigFile {
    /// Modo forçado por arquivo: `true` = standalone, `false` = cloud,
    /// ausente = sem opinião. Tipo errado ⇒ arquivo inteiro vira sem opinião
    /// (tolerante: config ruim nunca derruba o app).
    #[serde(rename = "standaloneMode")]
    pub standalone_mode: Option<bool>,
}

/// De onde veio a opinião efetiva (para diagnóstico/badge de suporte).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeConfigSource {
    Env,
    File,
}

/// Resposta do comando `get_runtime_config_command` (serde → camelCase pro JS).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigResponse {
    /// Opinião efetiva: `null` = sem opinião; `true` = standalone;
    /// `false` = cloud. O front decide como aplicar (com anti-rebaixamento).
    pub standalone: Option<bool>,
    /// Origem da opinião quando existe.
    pub source: Option<RuntimeConfigSource>,
    /// Caminho do arquivo consultado (sempre presente, p/ suporte).
    pub config_path: String,
}

/// Resposta do comando de escrita da config local (serde → camelCase pro JS).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetModeWriteResponse {
    /// Caminho do arquivo gravado (sempre presente, p/ suporte).
    pub config_path: String,
    /// Bytes efetivamente escritos (diagnóstico).
    pub bytes_written: u64,
}

/// Grava o arquivo de config local com a opinião pedida, criando a pasta pai
/// quando necessário. Escrita ATÔMICA (temp no mesmo diretório + rename):
/// uma falha no meio nunca deixa um arquivo pela metade — ou fica o conteúdo
/// anterior intacto, ou entra o novo completo.
pub fn write_local_config(path: &Path, standalone_mode: bool) -> Result<SetModeWriteResponse, String> {
    let body = format!(
        "{{\n  \"standaloneMode\": {}\n}}\n",
        if standalone_mode { "true" } else { "false" }
    );
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("falha ao criar pasta de dados: {}", e))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body.as_bytes())
        .map_err(|e| format!("falha ao gravar a config temporária: {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("falha ao promover a config temporária: {}", e)
    })?;
    Ok(SetModeWriteResponse {
        config_path: path.display().to_string(),
        bytes_written: body.len() as u64,
    })
}

/// Interpreta o valor bruto da env. Aceita caixa variada e espaços nas bordas.
pub fn parse_env_flag(raw: Option<&str>) -> Option<bool> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        Some(v) => match v.to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Some(true),
            "0" | "false" | "no" | "off" => Some(false),
            _ => None,
        },
        None => None,
    }
}

/// Lê e faz parse tolerante do arquivo de config. Qualquer falha (ausência,
/// permissão, JSON malformado, tipo errado) ⇒ `None` — nunca propaga erro.
pub fn read_local_config(path: &Path) -> Option<LocalConfigFile> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Pasta de dados do app (espelha db_path de main.rs sem puxar dependências).
fn app_data_dir() -> std::path::PathBuf {
    match std::env::var_os("APPDATA") {
        Some(v) if !v.is_empty() => std::path::PathBuf::from(v),
        _ => std::env::temp_dir(),
    }
    .join(APP_ID_DIR)
}

/// Caminho canônico do arquivo de config local.
pub fn config_path() -> std::path::PathBuf {
    app_data_dir().join(CONFIG_FILE_NAME)
}

/// Resolve a opinião combinando as fontes (env > arquivo).
pub fn load_with_sources(env_raw: Option<&str>, path: &Path) -> RuntimeConfigResponse {
    let from_env = parse_env_flag(env_raw);
    let from_file = read_local_config(path).and_then(|c| c.standalone_mode);
    let (standalone, source) = match (from_env, from_file) {
        // env vence: operador de plantão pode sobrepor o arquivo sem editar nada.
        (Some(e), _) => (Some(e), Some(RuntimeConfigSource::Env)),
        (None, Some(f)) => (Some(f), Some(RuntimeConfigSource::File)),
        (None, None) => (None, None),
    };
    RuntimeConfigResponse {
        standalone,
        source,
        config_path: path.display().to_string(),
    }
}

/// Ponto de entrada real (IO do ambiente).
pub fn load_runtime_config() -> RuntimeConfigResponse {
    load_with_sources(
        std::env::var(ENV_VAR_NAME).ok().as_deref(),
        &config_path(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_path(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "solaris_cfg_test_{}_{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        dir.join(CONFIG_FILE_NAME)
    }

    #[test]
    fn env_flag_aceita_variacoes_e_rejeita_lixo() {
        assert_eq!(parse_env_flag(Some("1")), Some(true));
        assert_eq!(parse_env_flag(Some(" true ")), Some(true));
        assert_eq!(parse_env_flag(Some("YES")), Some(true));
        assert_eq!(parse_env_flag(Some("on")), Some(true));
        assert_eq!(parse_env_flag(Some("0")), Some(false));
        assert_eq!(parse_env_flag(Some("False")), Some(false));
        assert_eq!(parse_env_flag(Some(" off")), Some(false));
        assert_eq!(parse_env_flag(Some("")), None);
        assert_eq!(parse_env_flag(Some("  ")), None);
        assert_eq!(parse_env_flag(Some("talvez")), None);
        assert_eq!(parse_env_flag(None), None);
    }

    #[test]
    fn env_vence_sobre_o_arquivo_nos_dois_sentidos() {
        let p = tmp_path("prec");
        std::fs::write(&p, r#"{"standaloneMode": false}"#).unwrap();
        // env standalone + arquivo cloud ⇒ env vence.
        let cfg = load_with_sources(Some("1"), &p);
        assert_eq!(cfg.standalone, Some(true));
        assert_eq!(cfg.source, Some(RuntimeConfigSource::Env));
        // env cloud + arquivo standalone ⇒ env vence.
        let cfg = load_with_sources(Some("0"), &p);
        assert_eq!(cfg.standalone, Some(false));
        assert_eq!(cfg.source, Some(RuntimeConfigSource::Env));
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }

    #[test]
    fn arquivo_so_fala_quando_env_calada() {
        let p = tmp_path("fileonly");
        std::fs::write(&p, r#"{"standaloneMode": true}"#).unwrap();
        let cfg = load_with_sources(None, &p);
        assert_eq!(cfg.standalone, Some(true));
        assert_eq!(cfg.source, Some(RuntimeConfigSource::File));
        assert!(cfg.config_path.ends_with(CONFIG_FILE_NAME));
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }

    #[test]
    fn sem_fontes_nao_tem_opiniao_mas_caminho_vai_pro_suporte() {
        let p = tmp_path("none");
        let cfg = load_with_sources(None, &p);
        assert_eq!(cfg.standalone, None);
        assert_eq!(cfg.source, None);
        assert!(!cfg.config_path.is_empty());
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }

    #[test]
    fn config_tolerante_arquivo_ausente_malformado_ou_tipo_errado() {
        let dir = tmp_path("tol").parent().unwrap().to_path_buf();
        // Ausente.
        assert_eq!(read_local_config(&dir.join(CONFIG_FILE_NAME)), None);
        // JSON malformado.
        let bad = dir.join(CONFIG_FILE_NAME);
        std::fs::write(&bad, "{ standaloneMode: sim }").unwrap();
        assert_eq!(read_local_config(&bad), None);
        // Tipo errado no campo (string em vez de bool) ⇒ sem opinião.
        std::fs::write(&bad, r#"{"standaloneMode": "sim"}"#).unwrap();
        assert_eq!(read_local_config(&bad), None);
        // Campo ausente mas JSON válido ⇒ sem opinião também.
        std::fs::write(&bad, r#"{"outraCoisa": 42}"#).unwrap();
        let cfg = load_with_sources(None, &bad);
        assert_eq!(cfg.standalone, None);
        // JSON válido falso.
        std::fs::write(&bad, r#"{"standaloneMode": false}"#).unwrap();
        let cfg = load_with_sources(None, &bad);
        assert_eq!(cfg.standalone, Some(false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resposta_serializa_em_camel_case_pro_front() {
        let p = tmp_path("serde");
        std::fs::write(&p, r#"{"standaloneMode": true}"#).unwrap();
        let json = serde_json::to_string(&load_with_sources(None, &p)).unwrap();
        assert!(json.contains("\"configPath\""), "campo camelCase: {}", json);
        assert!(json.contains("\"source\":\"file\""), "fonte: {}", json);
        assert!(!json.contains("config_path"), "sem snake_case: {}", json);
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }

    #[test]
    fn escrita_cria_pasta_e_arquivo_legivel_de_volta() {
        let dir = tmp_path("write").parent().unwrap().join("sub").join("dir");
        let p = dir.join(CONFIG_FILE_NAME);
        // Pasta ainda não existe — a escrita cria a cadeia inteira.
        let res = write_local_config(&p, true).expect("escrita deve funcionar");
        assert!(res.bytes_written > 0);
        assert_eq!(res.config_path, p.display().to_string());
        // Roundtrip: o que foi gravado é lido como opinião standalone.
        let cfg = read_local_config(&p).expect("arquivo gravado deve ser legível");
        assert_eq!(cfg.standalone_mode, Some(true));
        // Resposta serializa camelCase (contrato com o front).
        let json = serde_json::to_string(&res).unwrap();
        assert!(json.contains("\"configPath\""), "camelCase: {}", json);
        assert!(!json.contains("config_path"), "sem snake_case: {}", json);
        // Flip para cloud: sobrescreve e relê como false.
        write_local_config(&p, false).unwrap();
        let cfg = read_local_config(&p).unwrap();
        assert_eq!(cfg.standalone_mode, Some(false));
        let _ = std::fs::remove_dir_all(tmp_path("write").parent().unwrap());
    }

    #[test]
    fn escrita_atomica_nao_deixa_tmp_para_tras() {
        let p = tmp_path("atomic");
        write_local_config(&p, true).unwrap();
        let tmp = p.with_extension("json.tmp");
        assert!(!tmp.exists(), "temporário deve ser renomeado, não deixado");
        // Sobrescrita idempotente funciona (rename sobre arquivo existente).
        write_local_config(&p, false).unwrap();
        assert_eq!(
            read_local_config(&p).unwrap().standalone_mode,
            Some(false)
        );
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }
}

// scan_alfred.rs — Solaris v3 desktop core (spec: SOLARIS_V3_ALFRED.md)
//
// Varredura tolerante da RAIZ_ALFRED: ano/mês/estúdio/dia/OS-*/blocos.
// Retorna OSs detectadas + blocos órfãos + CANDIDATOS DE MATCH POR JANELA
// TEMPORAL (dia+estúdio) para o front resolver as camadas de confiança.
// Leitura-only; ignora system files; ffprobe opcional fica no Tauri layer.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Extensões de vídeo consideradas "bloco".
pub const VIDEO_EXTS: &[&str] = &["mp4", "mov", "mkv", "mxf"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockCandidate {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    /// epoch seconds (0 quando indisponível)
    pub mtime_epoch: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsScanResult {
    /// Número da OS extraído do nome da pasta ("OS-12345" → "12345").
    pub os_id: String,
    /// Caminho da pasta da OS (separador nativo do host).
    pub folder_path: String,
    /// Segmento de estúdio normalizado (lower, sem acento/separadores).
    pub studio_norm: String,
    /// Dia ISO yyyy-mm-dd quando inferível do caminho.
    pub day_iso: Option<String>,
    /// Caminho declarado pelo Saturno bate com esta pasta (match exato)?
    pub declared_path_match: bool,
    pub blocks: Vec<BlockCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrphanGroup {
    pub folder_path: String,
    pub studio_norm: String,
    pub day_iso: Option<String>,
    pub blocks: Vec<BlockCandidate>,
}

/// Candidato de match por janela temporal (camada 3): o front cruza com a
/// DATA+ESTÚDIO das OSs do Saturno. `confidence_hint` é dica de UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowMatchCandidate {
    /// OS detectada na mesma pasta-dia.
    pub os_id: String,
    /// Outras OSs concorrendo à mesma janela (conflito → triagem humana).
    pub conflicting_os_ids: Vec<String>,
    pub studio_norm: String,
    pub day_iso: Option<String>,
    pub block_paths: Vec<String>,
    /// "unique-window" | "conflict-window" (String p/ suportar roundtrip JSON)
    #[serde(default = "default_confidence_hint")]
    pub confidence_hint: String,
}

fn default_confidence_hint() -> String {
    "unique-window".to_string()
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct AlfredScanReport {
    pub root: String,
    pub scanned_dirs: u32,
    pub skipped_permission_errors: u32,
    pub oss: Vec<OsScanResult>,
    pub orphan_groups: Vec<OrphanGroup>,
    pub window_matches: Vec<WindowMatchCandidate>,
}

/// Normaliza estúdio: minúsculas, sem acento, separadores (- _ espaço . / \) somem.
/// "SEDE 11" == "SEDE-11" == "sede_11" == "sede11".
pub fn normalize_studio(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.trim().to_lowercase().chars() {
        match ch {
            '-' | '_' | ' ' | '.' | '/' | '\\' => {}
            'á' | 'à' | 'â' | 'ã' => out.push('a'),
            'é' | 'ê' | 'è' => out.push('e'),
            'í' | 'ì' | 'î' => out.push('i'),
            'ó' | 'ô' | 'õ' => out.push('o'),
            'ú' | 'ù' | 'û' => out.push('u'),
            'ç' => out.push('c'),
            c if c.is_ascii_alphanumeric() => out.push(c),
            _ => {}
        }
    }
    out
}

/// Extrai número de OS de nomes tipo "OS-12345", "os_12345", "OS 12345", "os12345".
pub fn extract_os_number(folder_name: &str) -> Option<String> {
    let lower = folder_name.to_lowercase();
    let rest = lower.strip_prefix("os")?;
    let digits_start = rest.find(|c: char| c.is_ascii_digit())?;
    if !rest[..digits_start]
        .chars()
        .all(|c| matches!(c, '-' | '_' | ' '))
    {
        return None;
    }
    let digits: String = rest[digits_start..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() || digits.len() > 12 {
        None
    } else {
        Some(digits)
    }
}

/// Reconhece dia ISO em segmento de caminho (2026-07-14, 2026-7-14).
pub fn parse_day_iso(segment: &str) -> Option<String> {
    let seg = segment.trim();
    let parts: Vec<&str> = seg.split('-').collect();
    if parts.len() == 3 {
        let (y, m, d) = (parts[0], parts[1], parts[2]);
        let all_digits =
            |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
        if y.len() == 4
            && all_digits(y)
            && m.len() <= 2
            && all_digits(m)
            && d.len() <= 2
            && all_digits(d)
        {
            return Some(format!("{y}-{m:0>2}-{d:0>2}"));
        }
    }
    None
}

/// Segmento puramente numérico curto (ano/mês/dia), não é estúdio.
fn is_numeric_segment(seg: &str) -> bool {
    !seg.is_empty() && seg.len() <= 4 && seg.chars().all(|c| c.is_ascii_digit())
}

fn is_system_entry(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(
        lower.as_str(),
        "$recycle.bin"
            | "system volume information"
            | "lost.dir"
            | ".fseventsd"
            | ".spotlight-v100"
            | ".trashes"
            | "thumbs.db"
            | "desktop.ini"
            | "papel velho"
            | "papeis velhos"
    ) || name.starts_with('.')
        || lower.starts_with("~$")
}

fn has_video_ext(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| VIDEO_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn block_candidate(path: &Path) -> BlockCandidate {
    let (size_bytes, mtime_epoch) = fs::metadata(path)
        .map(|md| {
            let mtime = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (md.len(), mtime)
        })
        .unwrap_or((0, 0));
    BlockCandidate {
        path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        size_bytes,
        mtime_epoch,
    }
}

/// Caminho declarado pelo Saturno casa com esta pasta? (camada 1, fonte da
/// verdade). Compara por sufixo normalizado (case/slash-insensitive).
pub fn path_declares_os(declared: &str, os_folder_abs: &Path, os_folder_name: &str) -> bool {
    let norm = |s: &str| {
        s.replace('\\', "/")
            .trim()
            .trim_end_matches('/')
            .to_lowercase()
    };
    let decl = norm(declared);
    if decl.is_empty() {
        return false;
    }
    // 1) O nome da pasta é o segmento final do declarado.
    let last_seg_decl = decl.rsplit('/').next().unwrap_or("");
    if last_seg_decl.eq_ignore_ascii_case(&os_folder_name.to_lowercase()) {
        return true;
    }
    // 2) Sufixo completo entre abs do host e o declarado.
    let abs = norm(&os_folder_abs.to_string_lossy());
    abs.ends_with(&decl) || decl.ends_with(&abs)
}

pub struct ScanOptions<'a> {
    pub max_depth: u32,
    /// Caminhos de OS declarados pelo Saturno (fonte da verdade, camada 1).
    pub declared_os_paths: &'a [String],
}

impl<'a> Default for ScanOptions<'a> {
    fn default() -> Self {
        ScanOptions {
            max_depth: 8,
            declared_os_paths: &[],
        }
    }
}

pub fn scan_alfred(root: &Path, opts: &ScanOptions) -> AlfredScanReport {
    let mut report = AlfredScanReport {
        root: root.to_string_lossy().into_owned(),
        ..Default::default()
    };
    let mut orphans_by_window: HashMap<(String, Option<String>), OrphanGroup> =
        HashMap::new();

    walk(
        root,
        0,
        opts.max_depth,
        opts,
        &mut report,
        &mut orphans_by_window,
    );

    // Ordenação estável pra relatório reproduzível.
    report.orphan_groups = orphans_by_window.into_values().collect();
    report.orphan_groups.sort_by(|a, b| a.folder_path.cmp(&b.folder_path));

    // Camada 3 (pré-resolução no front): agrupa blocos órfãos por janela
    // dia+estúdio e aponta as OSs na mesma janela (conflito → triagem).
    let oss_snapshot: Vec<(String, String, Option<String>)> = report
        .oss
        .iter()
        .map(|o| (o.os_id.clone(), o.studio_norm.clone(), o.day_iso.clone()))
        .collect();
    for group in &report.orphan_groups {
        let mut same_window: Vec<String> = oss_snapshot
            .iter()
            .filter(|(_, st, dy)| *st == group.studio_norm && *dy == group.day_iso)
            .map(|(id, _, _)| id.clone())
            .collect();
        same_window.sort();
        same_window.dedup();
        if same_window.is_empty() {
            continue;
        }
        report.window_matches.push(WindowMatchCandidate {
            os_id: same_window[0].clone(),
            conflicting_os_ids: same_window[1..].to_vec(),
            studio_norm: group.studio_norm.clone(),
            day_iso: group.day_iso.clone(),
            block_paths: group.blocks.iter().map(|b| b.path.clone()).collect(),
            confidence_hint: if same_window.len() > 1 {
                "conflict-window".to_string()
            } else {
                "unique-window".to_string()
            },
        });
    }

    report
}

fn walk(
    dir: &Path,
    depth: u32,
    max_depth: u32,
    opts: &ScanOptions,
    report: &mut AlfredScanReport,
    orphans: &mut HashMap<(String, Option<String>), OrphanGroup>,
) {
    if depth > max_depth {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(it) => it,
        Err(_) => {
            report.skipped_permission_errors += 1;
            return;
        }
    };

    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut child_os_dirs: Vec<PathBuf> = Vec::new();
    let mut loose_videos: Vec<PathBuf> = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_system_entry(&name) {
            continue;
        }
        let path = entry.path();
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => {
                dirs.push(path.clone());
                if extract_os_number(&name).is_some() {
                    child_os_dirs.push(path);
                }
            }
            Ok(_) if has_video_ext(&name) => loose_videos.push(path),
            _ => {}
        }
    }

    // Vídeos soltos nesta pasta (fora de pasta-OS) → fallback "sem OS",
    // agrupado por janela temporal dos antecessores.
    if !loose_videos.is_empty() && child_os_dirs.is_empty() {
        let (studio, day) = window_from_ancestors(dir);
        let key = (studio.clone(), day.clone());
        let group = orphans.entry(key).or_insert_with(|| OrphanGroup {
            folder_path: dir.to_string_lossy().into_owned(),
            studio_norm: studio,
            day_iso: day,
            blocks: Vec::new(),
        });
        group.blocks.extend(loose_videos.iter().map(|p| block_candidate(p)));
    }

    // Pastas-OS neste nível → registra OS + blocos diretos.
    for os_dir in child_os_dirs {
        let folder_name = os_dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let os_id = extract_os_number(&folder_name).unwrap_or_default();
        let (studio, day) = window_from_ancestors(&os_dir);
        let declared = opts
            .declared_os_paths
            .iter()
            .any(|d| path_declares_os(d, &os_dir, &folder_name));

        let mut result = OsScanResult {
            os_id,
            folder_path: os_dir.to_string_lossy().into_owned(),
            studio_norm: studio,
            day_iso: day,
            declared_path_match: declared,
            blocks: Vec::new(),
        };
        collect_blocks(&os_dir, 0, 2, &mut result.blocks);
        report.oss.push(result);

        // Não desce em subpastas-OS aninhadas dentro de pasta-OS (evita dupla
        // contagem); blocos dela já foram coletados.
        dirs.retain(|d| d != &os_dir);
    }

    dirs.sort();
    for d in dirs {
        report.scanned_dirs += 1;
        walk(&d, depth + 1, max_depth, opts, report, orphans);
    }
}

/// Blocos da OS: arquivos de vídeo na pasta e até 2 níveis abaixo,
/// ordenação natural (bloco_2 < bloco_10).
fn collect_blocks(dir: &Path, depth: u32, max_depth: u32, out: &mut Vec<BlockCandidate>) {
    if depth > max_depth {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(it) => it,
        Err(_) => return,
    };
    let mut files: Vec<BlockCandidate> = Vec::new();
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_system_entry(&name) {
            continue;
        }
        let path = entry.path();
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => subdirs.push(path),
            Ok(_) if has_video_ext(&name) => files.push(block_candidate(&path)),
            _ => {}
        }
    }
    files.sort_by(|a, b| nat_cmp(&a.file_name, &b.file_name));
    out.extend(files);
    subdirs.sort();
    for sd in subdirs {
        collect_blocks(&sd, depth + 1, max_depth, out);
    }
}

/// Ordenação natural byte-a-byte: "bloco_2" < "bloco_10", case-insensitive.
fn nat_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    let ab = a.as_bytes();
    let bb = b.as_bytes();
    let (mut i, mut j) = (0usize, 0usize);

    while i < ab.len() && j < bb.len() {
        let (ca, cb) = (ab[i], bb[j]);
        if ca.is_ascii_digit() && cb.is_ascii_digit() {
            let (ia, ib) = (i, j);
            while i < ab.len() && ab[i].is_ascii_digit() {
                i += 1;
            }
            while j < bb.len() && bb[j].is_ascii_digit() {
                j += 1;
            }
            // Recortes seguros: runs de ASCII dentro de UTF-8 válido.
            let sa = a[ia..i].trim_start_matches('0');
            let sb = b[ib..j].trim_start_matches('0');
            let ord = sa.len().cmp(&sb.len()).then_with(|| sa.cmp(sb));
            if ord != Ordering::Equal {
                return ord;
            }
        } else {
            let (la, lb) = (ca.to_ascii_lowercase(), cb.to_ascii_lowercase());
            if la != lb {
                return la.cmp(&lb);
            }
            i += 1;
            j += 1;
        }
    }
    (ab.len() - i).cmp(&(bb.len() - j))
}

/// Deriva (estúdio_normalizado, dia_iso) dos componentes do caminho:
/// padrão .../{ano}/{mês}/{ESTUDIO}/{dia}/... ; tolerante a ausências.
/// Ignora pastas-OS como candidatas a estúdio.
pub(crate) fn window_from_ancestors(p: &Path) -> (String, Option<String>) {
    let comps: Vec<String> = p
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .map(|s| s.to_string())
        .collect();

    let mut studio = String::from("(raiz)");
    let mut day: Option<String> = None;

    for (idx, comp) in comps.iter().enumerate() {
        // Dia ISO achado: estúdio = segmento imediatamente anterior (se não
        // for numérico nem pasta-OS); senão, o último não-numérico antes dele.
        if let Some(d) = parse_day_iso(comp) {
            day = Some(d);
            let mut k = idx;
            while k > 0 {
                k -= 1;
                let cand = &comps[k];
                if extract_os_number(cand).is_some() || is_numeric_segment(cand) {
                    continue;
                }
                studio = normalize_studio(cand);
                break;
            }
            break;
        }
        if extract_os_number(comp).is_none()
            && !is_numeric_segment(comp)
            && comp.len() > 1
        {
            studio = normalize_studio(comp);
        }
    }
    (studio, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normaliza_estudio_com_variacoes() {
        assert_eq!(normalize_studio("SEDE 11"), normalize_studio("SEDE-11"));
        assert_eq!(normalize_studio("sede11"), "sede11");
        assert_eq!(normalize_studio("Estúdio A"), "estudioa");
        assert_eq!(normalize_studio("HS_JOAO"), "hsjoao");
    }

    #[test]
    fn extrai_numero_de_variacoes_de_pasta() {
        assert_eq!(extract_os_number("OS-12345"), Some("12345".into()));
        assert_eq!(extract_os_number("os_12345"), Some("12345".into()));
        assert_eq!(extract_os_number("OS 12345"), Some("12345".into()));
        assert_eq!(extract_os_number("os12345"), Some("12345".into()));
        assert_eq!(extract_os_number("OrdemServico123"), None);
        assert_eq!(extract_os_number("OSX-1"), None);
        assert_eq!(extract_os_number("os9999999999999999999"), None);
    }

    #[test]
    fn parse_dias_iso_tolerante() {
        assert_eq!(
            parse_day_iso("2026-07-14"),
            Some("2026-07-14".to_string())
        );
        assert_eq!(parse_day_iso("2026-7-4"), Some("2026-07-04".to_string()));
        assert_eq!(parse_day_iso("SEDE-11"), None);
        assert_eq!(parse_day_iso("14-07-2026"), None);
    }

    #[test]
    fn ordenacao_natural_bloco2_menor_que_bloco10() {
        let mut nomes = vec!["bloco_10.mp4", "bloco_2.mp4", "bloco_1.mp4"];
        nomes.sort_by(|a, b| nat_cmp(a, b));
        assert_eq!(nomes, vec!["bloco_1.mp4", "bloco_2.mp4", "bloco_10.mp4"]);
        assert_eq!(
            nat_cmp("aula_pt1_final.mp4", "aula_pt10.mp4"),
            std::cmp::Ordering::Less
        );
        assert_eq!(nat_cmp("B.MP4", "b.mp4"), std::cmp::Ordering::Equal);
        assert_eq!(nat_cmp("abc", "abd"), std::cmp::Ordering::Less);
    }

    #[test]
    fn janela_temporal_do_caminho_padrao() {
        let p = Path::new("/Alfred/2026/07/SEDE-11/2026-07-14/OS-12345");
        let (studio, day) = window_from_ancestors(p);
        assert_eq!(studio, "sede11");
        assert_eq!(day, Some("2026-07-14".to_string()));
    }

    #[test]
    fn janela_sem_estudio_cai_no_placeholder() {
        let p = Path::new("/Alfred/2026/2026-07-14");
        let (studio, day) = window_from_ancestors(p);
        assert_eq!(day, Some("2026-07-14".to_string()));
        assert!(!studio.contains('-'));
    }
}

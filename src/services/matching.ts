/**
 * matching.ts — Matching em camadas OS↔blocos (SOLARIS_V3_SATURNO.md).
 *
 * Camadas de confiança:
 *  1. declared-path : caminho declarado pelo Saturno (fonte da verdade) → 100%
 *  2. filename-os   : número da OS no nome do arquivo do bloco
 *  3. window        : janela temporal dia+estúdio normalizados (via candidatos
 *                     pré-computados pelo scan_alfred Rust)
 *
 * Regras duras:
 *  - bloco NUNCA fica em duas OSs (assignedBlocks é autoridade; assignBlock
 *    devolve erro tipado em dupla atribuição);
 *  - conflito de janela (2+ OSs no mesmo dia+estúdio) → triagem humana,
 *    nunca auto-atribuição;
 *  - toda atribuição automática gera entrada de auditoria.
 */
import { normalizeStudioName } from './studio';

export type MatchLayer = 'declared-path' | 'filename-os' | 'window' | 'manual';

export interface MatchAuditEntry {
  block_path: string;
  os_id: string;
  layer: MatchLayer;
  /** 0..1 — declarado=1.0, nome=0.9, janela única=0.7 */
  confidence: number;
  decided_at: string;
}

export interface TriageItem {
  kind: 'conflict-window';
  studio_norm: string;
  day_iso: string | null;
  candidate_os_ids: string[];
  orphan_block_paths: string[];
}

export interface MatchResolution {
  /** os_id → blocos atribuídos (na ordem natural recebida do scan). */
  assignments: Map<string, string[]>;
  audit: MatchAuditEntry[];
  triageQueue: TriageItem[];
  unassignedOrphans: Set<string>;
}

export interface MatchOptions {
  /** Assinaturas aprendidas na triagem: pasta→OS. Sobrescreve camadas 2-3. */
  learnedFolderSignatures?: Map<string, string>;
  nowIso?: string;
}

export const DEFAULT_MATCH_OPTIONS: Required<Pick<MatchOptions, 'nowIso'>> = {
  nowIso: '',
};

/** Entrada espelhando OsScanResult do Rust (JSON via Tauri IPC). */
export interface ScanOsLike {
  os_id: string;
  folder_path: string;
  studio_norm: string;
  day_iso: string | null;
  declared_path_match: boolean;
  blocks: { path: string; file_name: string }[];
}

export interface WindowMatchLike {
  os_id: string;
  conflicting_os_ids: string[];
  studio_norm: string;
  day_iso: string | null;
  block_paths: string[];
  confidence_hint: 'unique-window' | 'conflict-window';
}

/** Número da OS contido no nome do arquivo? ("OS-12345_bloco_02.mp4") */
export function osNumberInFileName(
  fileName: string,
  osId: string,
): boolean {
  if (!osId) return false;
  const lower = fileName.toLowerCase();
  // "os" seguido opcionalmente de -_ espaço e exatamente o número.
  return new RegExp(`(?:^|[^0-9])os[-_ ]?${osId}(?![0-9])`, 'i').test(lower);
}

/**
 * Resolve o matching completo sobre o resultado do scan + registros Saturno.
 * Não consulta rede nem banco — pura sobre entradas, fácil de testar.
 */
export function resolveLayeredMatches(
  scannedOss: ScanOsLike[],
  windowMatches: WindowMatchLike[],
  opts: MatchOptions = {},
): MatchResolution {
  const now =
    opts.nowIso || DEFAULT_MATCH_OPTIONS.nowIso || new Date().toISOString();
  // Chaves de assinatura são normalizadas na entrada (case/slash-insensitive),
  // igual ao lookup por folder_path — "SEDE-11" e "sede_11" batem.
  const learned = new Map(
    [...(opts.learnedFolderSignatures ?? [])].map(([k, v]) => [
      normalizeStudioName(k),
      v,
    ]),
  );

  const assignments = new Map<string, string[]>();
  const audit: MatchAuditEntry[] = [];
  const taken = new Set<string>(); // blocos já atribuídos (invariante)
  const unassignedOrphans = new Set<string>();
  const triageQueue: TriageItem[] = [];

  const pushAssignment = (
    osId: string,
    blockPath: string,
    layer: MatchLayer,
    confidence: number,
  ) => {
    if (!assignments.has(osId)) assignments.set(osId, []);
    assignments.get(osId)!.push(blockPath);
    taken.add(blockPath);
    audit.push({
      block_path: blockPath,
      os_id: osId,
      layer,
      confidence,
      decided_at: now,
    });
  };

  const byId = new Map(scannedOss.map((o) => [o.os_id, o]));

  // ── Camada 1: caminho declarado pelo Saturno ────────────────────────
  for (const os of scannedOss) {
    if (!os.declared_path_match) continue;
    for (const b of os.blocks) {
      if (taken.has(b.path)) continue;
      pushAssignment(os.os_id, b.path, 'declared-path', 1.0);
    }
  }

  // ── Camada 1.5: assinatura aprendida na triagem (pasta → OS) ────────
  for (const os of scannedOss) {
    const learnedOs = learned.get(normalizeStudioName(os.folder_path));
    if (!learnedOs || learnedOs !== os.os_id) continue;
    for (const b of os.blocks) {
      if (taken.has(b.path)) continue;
      pushAssignment(os.os_id, b.path, 'manual', 1.0);
    }
  }

  // ── Camada 2: número da OS no nome do arquivo ───────────────────────
  // Blocos órfãos globais: tudo que ainda não foi atribuído.
  const allBlocks = new Map<string, string>(); // path → file_name
  for (const os of scannedOss) {
    for (const b of os.blocks) allBlocks.set(b.path, b.file_name);
  }
  for (const wm of windowMatches) {
    // paths de candidatos podem não estar nas OSs (vídeos soltos)
    for (const p of wm.block_paths) {
      if (!allBlocks.has(p)) allBlocks.set(p, p.split(/[\\/]/).pop() ?? p);
    }
  }

  for (const [path, fileName] of allBlocks) {
    if (taken.has(path)) continue;
    const owner = scannedOss.find((o) => osNumberInFileName(fileName, o.os_id));
    if (owner && !windowMatches.some((w) => w.conflicting_os_ids.includes(owner.os_id) && w.block_paths.includes(path))) {
      pushAssignment(owner.os_id, path, 'filename-os', 0.9);
    }
  }

  // ── Camada 3: janela temporal (candidatos do Rust) ──────────────────
  for (const wm of windowMatches) {
    const stillFree = wm.block_paths.filter((p) => !taken.has(p));
    if (stillFree.length === 0) continue;

    if (wm.conflicting_os_ids.length > 0 || wm.confidence_hint === 'conflict-window') {
      // CONFLITO → triagem humana. NUNCA auto-atribui.
      triageQueue.push({
        kind: 'conflict-window',
        studio_norm: wm.studio_norm,
        day_iso: wm.day_iso,
        candidate_os_ids: [wm.os_id, ...wm.conflicting_os_ids].sort(),
        orphan_block_paths: stillFree,
      });
      continue;
    }

    const target = byId.get(wm.os_id);
    if (!target) continue;
    // Janela única: auto-match com auditoria (confiança 0.7).
    for (const p of stillFree) {
      pushAssignment(target.os_id, p, 'window', 0.7);
    }
  }

  for (const [path] of allBlocks) {
    if (!taken.has(path)) unassignedOrphans.add(path);
  }

  return { assignments, audit, triageQueue, unassignedOrphans };
}

/**
 * Atribuição manual/da triagem com verificação do invariante:
 * lança se o bloco já pertence a outra OS. Persistir decisão aprendida
 * fica por conta do chamador (SQLite matching_decisions).
 */
export function assignBlock(
  resolution: MatchResolution,
  blockPath: string,
  targetOsId: string,
): void {
  const currentOwner = [...resolution.assignments.entries()].find(
    ([, blocks]) => blocks.includes(blockPath),
  );
  if (currentOwner && currentOwner[0] !== targetOsId) {
    throw new Error(
      `INVARIANT_VIOLATION: bloco ${blockPath} já pertence à OS ${currentOwner[0]}`,
    );
  }
  if (currentOwner) return; // idempotente
  if (!resolution.assignments.has(targetOsId)) {
    resolution.assignments.set(targetOsId, []);
  }
  resolution.assignments.get(targetOsId)!.push(blockPath);
  resolution.unassignedOrphans.delete(blockPath);
  resolution.audit.push({
    block_path: blockPath,
    os_id: targetOsId,
    layer: 'manual',
    confidence: 1.0,
    decided_at: new Date().toISOString(),
  });
}

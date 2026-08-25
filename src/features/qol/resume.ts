// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Retomar de onde parou (spec A1): reabrir OS volta exatamente no
// segundo/paleta onde saiu. Núcleo puro: decide SE retomar e PARA ONDE,
// dado o rascunho do auto-save e o estado atual do player.
//
// Regras de segurança:
//   * posição só é aplicada se o vídeo carregou duração compatível
//     (mudança silenciosa de mídia não pode jogar o analista num segundo
//     que não existe mais);
//   * paleta/overlay guardados junto para restaurar contexto visual.

import type { AutosaveEntry } from './autosave';

/** Janela de validade do rascunho: depois disso não retoma (análise velha). */
export const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export interface ResumeDecision {
  /** Aplicar seek para `positionSec`. */
  shouldSeek: boolean;
  positionSec: number;
  /** Restaurar overlay guardado no rascunho, se houver. */
  overlay: unknown | null;
  /** Motivo legível (telemetria/testes). */
  reason: 'resumed' | 'no-draft' | 'stale' | 'duration-mismatch';
}

export interface ResumeInput {
  entry: AutosaveEntry<unknown> | null;
  /** Duração conhecida do vídeo recém-carregado (null = ainda desconhecida). */
  durationSec: number | null;
  now?: number;
}

export function planResume({ entry, durationSec, now = Date.now() }: ResumeInput): ResumeDecision {
  if (!entry) {
    return { shouldSeek: false, positionSec: 0, overlay: null, reason: 'no-draft' };
  }
  if (now - entry.savedAt > RESUME_MAX_AGE_MS) {
    return { shouldSeek: false, positionSec: 0, overlay: null, reason: 'stale' };
  }
  // Duração conhecida e menor que a posição salva → mídia trocou: ignora.
  if (durationSec !== null && entry.positionSec > Math.max(0, durationSec - 0.5)) {
    return { shouldSeek: false, positionSec: 0, overlay: null, reason: 'duration-mismatch' };
  }
  return {
    shouldSeek: true,
    positionSec: Math.max(0, entry.positionSec),
    overlay: ('overlay' in entry ? (entry as { overlay?: unknown }).overlay : null) ?? null,
    reason: 'resumed',
  };
}

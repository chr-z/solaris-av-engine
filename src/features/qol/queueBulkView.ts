// Solaris v3 — Feature Pack "Analista Feliz" — QoL A1.9 (bulk actions).
//
// Ordenação da VISÃO de bulk da fila: a lista selecionável segue a MESMA
// prioridade da sugestão (spec A1: atrasada > nova > antiga), então o topo
// da lista é sempre o próximo trabalho que a fila recomenda — "selecionar
// os primeiros N" = atribuir os mais urgentes.
//
// Faixas (band):
//   - overdue: deadline < agora (mais atrasada primeiro);
//   - new: entrou nas últimas 24h (priority 1 antes, depois mais recente) —
//     mesma janela e desempate do suggestNext;
//   - old: resto (espera há mais tempo primeiro).
//
// Elegível pra bulk = só status 'queued' (done é trabalho fechado; em
// análise tem dono — bulk não reabre nem rouba linha em andamento).
//
// Puro: sem DOM, sem storage, sem Firebase.

import type { QueueRowLike } from './queue';
import { NEW_QUEUE_WINDOW_HOURS } from './queue';

export type BulkBand = 'overdue' | 'new' | 'old';

export interface BulkRow {
  row: QueueRowLike;
  band: BulkBand;
  /** Horas de atraso sobre o deadline (quando overdue), 1 casa decimal. */
  overdueHours: number | null;
}

const HOUR_MS = 60 * 60 * 1000;

const BAND_RANK: Record<BulkBand, number> = { overdue: 0, new: 1, old: 2 };

function ts(v: string | null | undefined): number {
  const t = Date.parse(v ?? '');
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Linhas elegíveis a bulk actions (só quem espera na fila). */
export function isBulkEligible(row: QueueRowLike): boolean {
  return row.status === 'queued';
}

/**
 * Visão ordenada da fila pra seleção em lote. Determinística: empates de
 * chave preservam a ordem de entrada (Array#sort é estável).
 */
export function bulkQueueView(
  rows: readonly QueueRowLike[],
  opts: { now?: number } = {},
): BulkRow[] {
  const now = opts.now ?? Date.now();
  const out: BulkRow[] = [];
  for (const row of rows) {
    if (!isBulkEligible(row)) continue;
    const dl = ts(row.deadline);
    if (Number.isFinite(dl) && dl < now) {
      out.push({
        row,
        band: 'overdue',
        overdueHours: Math.round(((now - dl) / HOUR_MS) * 10) / 10,
      });
      continue;
    }
    const created = ts(row.created_at);
    const isNew =
      Number.isFinite(created) && now - created <= NEW_QUEUE_WINDOW_HOURS * HOUR_MS;
    out.push({ row, band: isNew ? 'new' : 'old', overdueHours: null });
  }
  out.sort((a, b) => {
    const ra = BAND_RANK[a.band];
    const rb = BAND_RANK[b.band];
    if (ra !== rb) return ra - rb;
    switch (a.band) {
      case 'overdue':
        // Mais atrasada primeiro (deadline menor).
        return dlKey(a) - dlKey(b);
      case 'new':
        return (
          a.row.priority - b.row.priority ||
          ts(b.row.created_at) - ts(a.row.created_at)
        );
      case 'old':
        return (
          ts(a.row.created_at) - ts(b.row.created_at) ||
          a.row.priority - b.row.priority
        );
    }
  });
  return out;
}

function dlKey(b: BulkRow): number {
  return ts(b.row.deadline);
}

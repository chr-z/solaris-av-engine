// Solaris v3 — F2 — bulk actions da fila na UI do painel ao vivo (spec A1.9):
// selecionar N OSs → atribuir a mim / devolver / priorizar. A lista segue a
// MESMA prioridade da sugestão (atrasada > nova > antiga, via queueBulkView),
// então "selecionar os primeiros N" = pegar os mais urgentes.
//
// Undo: cada linha alterada grava o MESMO evento de undo das ações simples
// (kinds assign-os/return-os/prioritize-os) — o applier existente reverte
// linha por linha sem código novo; o botão Desfazer do card de fila já
// resolve o topo da pilha.

import React, { useMemo } from 'react';
import type { QueueRowLike } from '../../features/qol/queue';
import {
  applyBulk,
  planBulk,
  type BulkAction,
} from '../../features/qol/queueBulk';
import { bulkQueueView } from '../../features/qol/queueBulkView';

export interface QueueBulkBarLabels {
  title: string;
  selectAllTop: string;
  clear: string;
  selectedN: string;
  applicableN: string;
  skippedN: string;
  assignMe: string;
  returnToQueue: string;
  priority: string;
}

interface QueueBulkBarProps {
  rows: readonly QueueRowLike[];
  now: number;
  canManage: boolean;
  viewerId: string;
  labels: QueueBulkBarLabels;
  /** Aplica o resultado (linhas novas + eventos de undo). */
  onApply: (nextRows: QueueRowLike[], events: ReturnType<typeof applyBulk>['events']) => void;
}

export default function QueueBulkBar({
  rows,
  now,
  canManage,
  viewerId,
  labels,
  onApply,
}: QueueBulkBarProps): React.ReactElement | null {
  const view = useMemo(() => bulkQueueView(rows, { now }), [rows, now]);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());

  if (view.length === 0) return null;

  const toggle = (osId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(osId)) next.delete(osId);
      else next.add(osId);
      return next;
    });
  };

  const selectTop3 = () => {
    setSelectedIds(new Set(view.slice(0, 3).map((b) => b.row.os_id)));
  };

  const selectionList = [...selectedIds];
  // Plano é calculado sobre "atribuir" (ação primária) só p/ feedback; as
  // outras ações revalidam na execução via applyBulk (mesmos skips).
  const plan =
    selectionList.length > 0 && canManage
      ? planBulk(rows, selectionList, { kind: 'assign', userId: viewerId })
      : null;
  const applicableCount = plan?.applicableIds.length ?? 0;
  const skippedCount = plan?.skipped.length ?? 0;

  const runBulk = (action: BulkAction) => {
    if (!canManage || selectionList.length === 0) return;
    const res = applyBulk(rows, selectionList, action);
    if (res.events.length === 0) return;
    onApply(res.rows, res.events);
    setSelectedIds(new Set());
  };

  return (
    <div data-testid="bulk-bar" className="mt-2 rounded-md border border-gray-600/60 bg-gray-900/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-medium text-gray-300">{labels.title}</h4>
        <button
          type="button"
          data-testid="bulk-select-top"
          onClick={selectTop3}
          className="rounded px-1.5 py-0.5 text-xs text-gray-400 transition-colors hover:bg-gray-700/40"
        >
          {labels.selectAllTop}
        </button>
        <button
          type="button"
          data-testid="bulk-clear"
          disabled={selectionList.length === 0}
          onClick={() => setSelectedIds(new Set())}
          className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
            selectionList.length > 0
              ? 'text-gray-400 hover:bg-gray-700/40'
              : 'cursor-not-allowed opacity-50'
          }`}
        >
          {labels.clear}
        </button>
        {canManage && (
          <>
            <span data-testid="bulk-selection-count" className="text-xs text-gray-500">
              {labels.selectedN.replace('{n}', String(selectionList.length))}
              {applicableCount !== selectionList.length &&
                ` · ${labels.applicableN.replace('{n}', String(applicableCount))}`}
              {skippedCount > 0 && ` · ${labels.skippedN.replace('{n}', String(skippedCount))}`}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-testid="bulk-assign-btn"
                disabled={selectionList.length === 0}
                onClick={() => runBulk({ kind: 'assign', userId: viewerId })}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  selectionList.length > 0
                    ? 'text-green-300 hover:bg-green-500/10'
                    : 'cursor-not-allowed opacity-50'
                }`}
              >
                {labels.assignMe}
              </button>
              <button
                type="button"
                data-testid="bulk-return-btn"
                disabled={selectionList.length === 0}
                onClick={() => runBulk({ kind: 'return' })}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  selectionList.length > 0
                    ? 'text-yellow-300 hover:bg-yellow-500/10'
                    : 'cursor-not-allowed opacity-50'
                }`}
              >
                {labels.returnToQueue}
              </button>
              <label className="sr-only" htmlFor="bulk-priority-select">
                {labels.priority}
              </label>
              <select
                id="bulk-priority-select"
                data-testid="bulk-priority-select"
                value=""
                onChange={(e) => {
                  const p = Number(e.target.value);
                  if (p >= 1 && p <= 3) runBulk({ kind: 'prioritize', priority: p });
                }}
                disabled={selectionList.length === 0}
                className={`rounded-md border border-gray-600/60 bg-transparent px-1.5 py-1 text-xs ${
                  selectionList.length > 0 ? 'text-gray-300' : 'opacity-50'
                }`}
              >
                <option value="">{labels.priority}…</option>
                {[1, 2, 3].map((p) => (
                  <option key={p} value={p}>
                    P{p}
                  </option>
                ))}
              </select>
            </span>
          </>
        )}
      </div>
      <ul data-testid="bulk-list" className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto">
        {view.map((b) => {
          const checked = selectedIds.has(b.row.os_id);
          const badge =
            b.band === 'overdue' && b.overdueHours != null
              ? `+${b.overdueHours}h`
              : b.band;
          return (
            <li key={b.row.os_id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-gray-700/30">
                <input
                  type="checkbox"
                  data-testid={`bulk-check-${b.row.os_id}`}
                  checked={checked}
                  onChange={() => toggle(b.row.os_id)}
                  className="accent-solar-accent"
                />
                <span className="font-mono text-gray-200">{b.row.os_id}</span>
                <span
                  data-testid={`bulk-band-${b.row.os_id}`}
                  className={`rounded-full px-1.5 py-px text-[10px] ${
                    b.band === 'overdue'
                      ? 'bg-red-500/15 text-red-300'
                      : b.band === 'new'
                        ? 'bg-blue-500/15 text-blue-300'
                        : 'bg-gray-600/25 text-gray-400'
                  }`}
                >
                  {badge}
                </span>
                {b.row.priority === 1 && (
                  <span aria-hidden="true" className="text-[10px] text-red-300">
                    P1
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

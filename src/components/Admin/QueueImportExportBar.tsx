// Solaris v3 — Feature Pack "Analista Feliz" — QoL A3 (anti-fricção administrativa).
//
// Barra de importação/exportação da fila no painel ao vivo:
//   • Importar CSV/XLSX → valida via parseQueueImport, mostra resumo honesto
//     (adicionadas / puladas com motivo), um evento de undo SNAPSHOT único;
//   • Exportar CSV / Exportar XLSX → buildQueueCsv / buildSingleSheetXlsx.
//
// Gate canManageQueue (só admin/lead vê). Offline-first: leitura de arquivo
// é local (FileReader/ArrayBuffer), zero rede, zero dependência nova.
// Acessível: file input real (label + teclado), status em aria-live polite.

import React, { useCallback, useId, useRef, useState } from 'react';
import type { QueueRowLike } from '../../features/qol/queue';
import {
  parseQueueImport,
  buildQueueCsv,
  parseCsv,
  queueExportFilename,
  type QueueImportErrorReason,
} from '../../features/qol/queueImport';
import { readXlsxFirstSheetGrid } from '../../features/qol/queueImportXlsx';
import { buildSingleSheetXlsx } from '../../utils/dashboardXlsx';

export interface QueueIoLabels {
  title: string;
  importFile: string;
  exportCsv: string;
  exportXlsx: string;
  addedN: string; // '{n} adicionadas'
  skippedN: string; // '{n} puladas'
  reasonMissingOs: string;
  reasonDuplicate: string;
  reasonBadStatus: string;
  reasonBadPriority: string;
  reasonNoOsColumn: string;
  readFailed: string;
}

export interface QueueIoStrings {
  xlsxLabel: string; // nome da aba do workbook exportado
}

interface Props {
  rows: QueueRowLike[];
  canManage: boolean;
  labels: QueueIoLabels;
  sheetName: string;
  onImport: (nextRows: QueueRowLike[], imported: QueueRowLike[]) => void;
}

const REASON_KEY: Record<QueueImportErrorReason, keyof QueueIoLabels> = {
  'missing-os': 'reasonMissingOs',
  duplicate: 'reasonDuplicate',
  'bad-status': 'reasonBadStatus',
  'bad-priority': 'reasonBadPriority',
  'no-os-column': 'reasonNoOsColumn',
};

/** Resumo compacto por motivo: '2 duplicada · 1 status inválido'. */
function summarizeErrors(
  errors: Array<{ reason: QueueImportErrorReason }>,
  labels: QueueIoLabels,
): string {
  const counts = new Map<QueueImportErrorReason, number>();
  for (const e of errors) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, n]) => `${n} ${labels[REASON_KEY[reason]]}`)
    .join(' · ');
}

export default function QueueImportExportBar({
  rows,
  canManage,
  labels,
  sheetName,
  onImport,
}: Props): React.ReactElement | null {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Chave de reset: troca força o input nativo a aceitar re-envio do MESMO
  // arquivo (onChange não dispara de novo para o mesmo caminho).
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const handleFiles = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const name = file.name.toLowerCase();
        let grid: string[][];
        if (name.endsWith('.xlsx')) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          grid = await readXlsxFirstSheetGrid(bytes);
        } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
          grid = parseCsv(await file.text());
        } else {
          setStatus({ tone: 'err', text: labels.readFailed });
          return;
        }

        const result = parseQueueImport(grid, {
          existingIds: new Set(rows.map((r) => r.os_id)),
          nowMs: Date.now(),
        });

        if (result.errors.length === 1 && result.errors[0].reason === 'no-os-column') {
          setStatus({ tone: 'err', text: labels.reasonNoOsColumn });
          return;
        }
        if (result.rows.length === 0) {
          setStatus({
            tone: 'warn',
            text: `${labels.skippedN.replace('{n}', String(result.errors.length))}${
              result.errors.length > 0 ? ` (${summarizeErrors(result.errors, labels)})` : ''
            }`,
          });
          return;
        }
        onImport([...rows, ...result.rows], result.rows);
        setStatus({
          tone: result.errors.length > 0 ? 'warn' : 'ok',
          text:
            `${labels.addedN.replace('{n}', String(result.rows.length))}` +
            (result.errors.length > 0
              ? ` · ${labels.skippedN.replace('{n}', String(result.errors.length))} (${summarizeErrors(result.errors, labels)})`
              : ''),
        });
      } catch {
        setStatus({ tone: 'err', text: labels.readFailed });
      } finally {
        setBusy(false);
      }
    },
    [rows, labels, onImport],
  );

  const download = useCallback((data: BlobPart, mime: string, filename: string) => {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportXlsx = useCallback(() => {
    const header = ['os_id', 'title', 'status', 'assignee', 'claimed_by', 'priority', 'deadline', 'created_at'];
    const pick = (r: QueueRowLike): Array<string | null> => [
      r.os_id,
      r.title ?? null,
      r.status,
      r.assignee ?? null,
      r.claimed_by ?? null,
      String(r.priority),
      r.deadline ?? null,
      r.created_at,
    ];
    const escXml = (v: string): string =>
      v
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const cell = (ref: string, v: string | null): string => {
      if (v === null || v === '') return '';
      if (/^-?\d+(\.\d+)?$/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
    };
    const rowXml = (idx: number, values: Array<string | null>): string => {
      const cells = values
        .map((v, c) => cell(`${String.fromCharCode(65 + c)}${idx}`, v))
        .join('');
      return `<row r="${idx}">${cells}</row>`;
    };
    const sheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      rowXml(1, header) +
      rows.map((r, i) => rowXml(i + 2, pick(r))).join('') +
      '</sheetData></worksheet>';
    const bytes = buildSingleSheetXlsx(sheetName, sheet);
    download(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', queueExportFilename('xlsx'));
  }, [rows, sheetName, download]);

  if (!canManage) return null;

  return (
    <div
      data-testid="queue-io-bar"
      className="mt-3 rounded-lg border border-gray-600/60 bg-gray-900/30 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4
          data-testid="queue-io-title"
          className="text-xs font-medium uppercase tracking-wide text-gray-400"
        >
          {labels.title}
        </h4>
        <label
          htmlFor={inputId}
          className={`cursor-pointer rounded-md px-2.5 py-1.5 text-xs transition-colors ${
            busy
              ? 'cursor-wait text-gray-500'
              : 'text-solar-accent hover:bg-solar-accent/10'
          }`}
        >
          {labels.importFile}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          key={attempt}
          data-testid="queue-import-input"
          type="file"
          accept=".csv,.txt,.xlsx"
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void handleFiles(file);
            setAttempt((n) => n + 1);
          }}
        />
        <button
          type="button"
          data-testid="queue-export-csv-btn"
          onClick={() =>
            download(buildQueueCsv(rows), 'text/csv;charset=utf-8', queueExportFilename('csv'))
          }
          className="rounded-md px-2.5 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-600/20"
        >
          {labels.exportCsv}
        </button>
        <button
          type="button"
          data-testid="queue-export-xlsx-btn"
          onClick={handleExportXlsx}
          className="rounded-md px-2.5 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-600/20"
        >
          {labels.exportXlsx}
        </button>
      </div>
      {status && (
        <p
          data-testid="queue-io-status"
          aria-live="polite"
          className={`mt-2 text-xs ${
            status.tone === 'ok'
              ? 'text-green-400'
              : status.tone === 'warn'
                ? 'text-yellow-300'
                : 'text-red-400'
          }`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}


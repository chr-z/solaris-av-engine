// Solaris v3 — Feature Pack "Analista Feliz" — QoL A3.
// Testes jsdom da barra de import/export no painel ao vivo: gate de papel,
// fluxo CSV feliz com undo snapshot, erros honestos, XLSX ponta a ponta e
// paridade i18n EN/PT.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import type { DashboardEntryInput } from '../utils/dashboardData';
import LiveDashboardPanel from '../components/Admin/LiveDashboardPanel';
import type { QueueRowLike } from '../features/qol/queue';
import { resetUndoLog, getUndoLog } from '../features/qol/undoStore';

vi.mock('../components/EChartsLiveChart', () => ({
  default: () => <div data-testid="live-chart-stub" />,
}));

function entry(rowIndex: number): DashboardEntryInput {
  const headers = ['DATA', 'OS'];
  return {
    rowIndex,
    headers,
    cells: [{ value: '2026-08-25' }, { value: `OS-F${rowIndex}` }],
  };
}

const NOW = Date.UTC(2026, 7, 25, 15, 0, 0);

function queueFixtures(): QueueRowLike[] {
  return [
    {
      os_id: 'OS-OVER',
      title: 'Aula atrasada',
      status: 'queued',
      priority: 2,
      deadline: new Date(NOW - 3 * 3600_000).toISOString(),
      created_at: new Date(NOW - 80 * 3600_000).toISOString(),
    },
    {
      os_id: 'OS-NOVA',
      status: 'queued',
      priority: 1,
      created_at: new Date(NOW - 2 * 3600_000).toISOString(),
    },
  ];
}

function renderPanel(
  props: Partial<Parameters<typeof LiveDashboardPanel>[0]> = {},
  locale: 'en' | 'pt' = 'en',
) {
  return render(
    <I18nProvider initialLocale={locale}>
      <LiveDashboardPanel
        entries={[entry(2)]}
        viewer={{ id: 'boss-1', name: 'Boss' }}
        nowMs={NOW}
        {...props}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetUndoLog();
});

/** File fake com os pedaços que o componente usa. */
function makeFile(name: string, content: string): File {
  return {
    name,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
    text: async () => content,
  } as unknown as File;
}

async function importFile(name: string, content: string): Promise<void> {
  await screen.findByTestId('queue-import-input');
  const input = screen.getByTestId('queue-import-input') as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  fireEvent.change(input, { target: { files: [makeFile(name, content)] } });
}

describe('barra de import/export da fila', () => {
  it('existe mesmo com FILA VAZIA; analista não vê (gate de papel)', async () => {
    const analystView = renderPanel({ role: 'analyst' });
    await screen.findByTestId('live-kpi-today');
    expect(screen.queryByTestId('queue-io-status')).toBeNull();
    expect(screen.queryByTestId('queue-export-csv-btn')).toBeNull();
    analystView.unmount();

    renderPanel({}); // admin default
    await screen.findByTestId('queue-io-bar');
    expect(screen.getByTestId('queue-export-csv-btn')).toBeInTheDocument();
    // Barra existe fora do bloco condicional da fila (fila vazia aqui).
  });

  it('CSV feliz: adiciona linhas, status verde, undo snapshot único', async () => {
    const onQueueChange = vi.fn();
    renderPanel({ onQueueChange, queueRows: [] });
    const csv =
      'os_id,title,status,priority\nOS-I1,Aula um,,2\nOS-I2,Aula dois,FILA,ALTA';
    await importFile('lote.csv', csv);

    await waitFor(() => {
      expect(screen.getByTestId('queue-io-status').textContent).toContain('2 added');
    });
    expect(screen.getByTestId('queue-io-status')).toHaveClass('text-green-400');
    const rows = onQueueChange.mock.calls.at(-1)?.[0] as QueueRowLike[];
    expect(rows.map((r) => r.os_id)).toEqual(['OS-I1', 'OS-I2']);
    expect(rows[1]).toMatchObject({ status: 'queued', priority: 1 });

    // Undo snapshot: um evento só carrega as duas linhas.
    const log = getUndoLog();
    const evts = log.undoable.filter((e) => e.kind === 'import-queue');
    expect(evts).toHaveLength(1);
    expect((evts[0].payload as { rows: unknown[] }).rows).toHaveLength(2);
  });

  it('duplicata contra a fila viva é pulada com aviso amarelo', async () => {
    const onQueueChange = vi.fn();
    renderPanel({ onQueueChange, queueRows: queueFixtures() });
    const csv = 'os_id,priority\nOS-OVER,1\nOS-N9,2';
    await importFile('lote.csv', csv);
    await waitFor(() => {
      expect(screen.getByTestId('queue-io-status').textContent).toContain('skipped');
    });
    const text = screen.getByTestId('queue-io-status').textContent ?? '';
    expect(text).toContain('1 added');
    expect(text).toContain('duplicate OS');
    const rows = onQueueChange.mock.calls.at(-1)?.[0] as QueueRowLike[];
    expect(rows.some((r) => r.os_id === 'OS-N9')).toBe(true);
    expect(rows.filter((r) => r.os_id === 'OS-OVER')).toHaveLength(1);
  });

  it('arquivo sem coluna os_id mostra erro claro e não mexe na fila', async () => {
    const onQueueChange = vi.fn();
    renderPanel({ onQueueChange, queueRows: [] });
    await importFile('ruim.csv', 'nome,telefone\nx,123');
    await waitFor(() => {
      expect(screen.getByTestId('queue-io-status').textContent).toContain('os_id column');
    });
    expect(onQueueChange).not.toHaveBeenCalled();
  });

  it('XLSX real (writer do repo) importa ponta a ponta', async () => {
    const onQueueChange = vi.fn();
    renderPanel({ onQueueChange, queueRows: [] });
    const { buildSingleSheetXlsx } = await import('../utils/dashboardXlsx');
    const sheetXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>os_id</t></is></c><c r="B1" t="inlineStr"><is><t>prioridade</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>OS-XL</t></is></c><c r="B2"><v>3</v></c></row>' +
      '</sheetData></worksheet>';
    const bytes = buildSingleSheetXlsx('Fila', sheetXml);
    const file = {
      name: 'fila.xlsx',
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
    await screen.findByTestId('queue-import-input');
    const input = screen.getByTestId('queue-import-input') as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { files: [file as unknown as File] } });

    await waitFor(() => {
      expect(screen.getByTestId('queue-io-status').textContent).toContain('1 added');
    });
    const rows = onQueueChange.mock.calls.at(-1)?.[0] as QueueRowLike[];
    expect(rows.map((r) => r.os_id)).toEqual(['OS-XL']);
    expect(rows[0].priority).toBe(3);
  });

  it('i18n pt-BR: barra e rótulos em português (paridade)', async () => {
    renderPanel({}, 'pt');
    await screen.findByTestId('queue-io-bar');
    expect(screen.getByTestId('queue-io-title')).toHaveTextContent(
      'Importação / exportação de arquivo da fila',
    );
    expect(screen.getByTestId('queue-export-csv-btn')).toHaveTextContent('Exportar CSV');
  });
});

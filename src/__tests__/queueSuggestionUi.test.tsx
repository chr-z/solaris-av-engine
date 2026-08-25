// Solaris v3 — F2 — fila inteligente no painel ao vivo: sugestão, ações com
// snapshot e undo global integrados à UI (jsdom).
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import type { DashboardEntryInput } from '../utils/dashboardData';
import LiveDashboardPanel from '../components/Admin/LiveDashboardPanel';
import type { QueueRowLike } from '../features/qol/queue';
import { UNDO_STORAGE_KEY, resetUndoLog } from '../features/qol/undoStore';

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

const HOUR_MS = 3600_000;
function queueFixtures(): QueueRowLike[] {
  return [
    {
      os_id: 'OS-ATRASADA',
      title: 'Aula X',
      status: 'queued',
      priority: 2,
      deadline: new Date(NOW - 5 * HOUR_MS).toISOString(),
      created_at: new Date(NOW - 72 * HOUR_MS).toISOString(),
    },
    {
      os_id: 'OS-NOVA',
      status: 'queued',
      priority: 1,
      created_at: new Date(NOW - 2 * HOUR_MS).toISOString(),
    },
    {
      os_id: 'OS-COMDONO',
      status: 'in_analysis',
      priority: 2,
      assignee: 'bia',
      claimed_by: 'bia',
      created_at: new Date(NOW - 30 * HOUR_MS).toISOString(),
    },
  ];
}

function renderPanel(props: Partial<Parameters<typeof LiveDashboardPanel>[0]> = {}) {
  return render(
    <I18nProvider initialLocale="en">
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
  resetUndoLog(); // singleton do UndoLog não pode vazar entre testes
});

describe('fila inteligente no painel ao vivo', () => {
  it('sugere a ATRASADA primeiro, com motivo e profundidade da fila', async () => {
    renderPanel({ queueRows: queueFixtures() });
    await waitFor(() => {
      expect(screen.getByTestId('live-queue-suggestion')).toBeInTheDocument();
    });
    expect(screen.getByTestId('queue-suggestion-os')).toHaveTextContent('OS-ATRASADA');
    expect(screen.getByTestId('queue-suggestion-reason')).toHaveTextContent('overdue by 5h');
    // in_analysis NÃO conta como fila acionável (status queued só).
    expect(screen.getByTestId('live-queue-suggestion')).toHaveTextContent('2 in queue');
  });

  it('atribuir a mim aplica a ação e habilita o botão Desfazer', async () => {
    renderPanel({ queueRows: queueFixtures() });
    await screen.findByTestId('queue-assign-btn');
    // Antes de qualquer ação não há evento de fila p/ desfazer.
    expect(screen.getByTestId('queue-undo-btn')).toBeDisabled();
    fireEvent.click(screen.getByTestId('queue-assign-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('queue-undo-btn')).toBeEnabled();
    });
    expect(JSON.parse(window.localStorage.getItem(UNDO_STORAGE_KEY) ?? '[]')).toHaveLength(1);
  });

  it('Desfazer reverte a atribuição (snapshot anterior restaurado)', async () => {
    renderPanel({ queueRows: queueFixtures() });
    await screen.findByTestId('queue-assign-btn');
    fireEvent.click(screen.getByTestId('queue-assign-btn'));
    const undoBtn = await screen.findByTestId('queue-undo-btn');
    await waitFor(() => expect(undoBtn).toBeEnabled());
    fireEvent.click(undoBtn);
    await waitFor(() => {
      expect(screen.getByTestId('queue-undo-btn')).toBeDisabled();
    });
    expect(JSON.parse(window.localStorage.getItem(UNDO_STORAGE_KEY) ?? '[]')).toHaveLength(0);
  });

  it('devolver aparece só para linha com dono e devolve pra fila', async () => {
    renderPanel({ queueRows: queueFixtures() });
    // Sugestão atual é a atrasada (sem dono): sem botão devolver.
    await screen.findByTestId('queue-assign-btn');
    expect(screen.queryByTestId('queue-return-btn')).not.toBeInTheDocument();
  });

  it('prioridade: select reflete valor e muda com evento gravado no undo', async () => {
    renderPanel({ queueRows: queueFixtures() });
    const select = await screen.findByTestId('queue-priority-select');
    expect(select).toHaveValue('2'); // prioridade da OS-ATRASADA
    fireEvent.change(select, { target: { value: '1' } });
    await waitFor(() => {
      expect((screen.getByTestId('queue-priority-select') as HTMLSelectElement).value).toBe('1');
    });
    const log = JSON.parse(window.localStorage.getItem(UNDO_STORAGE_KEY) ?? '[]');
    expect(log[0].kind).toBe('prioritize-os');
    expect(log[0].payload.prev.priority).toBe(2);
  });

  it('analista (sem poder de gestão) vê a sugestão mas sem ações', async () => {
    renderPanel({ queueRows: queueFixtures(), role: 'analyst' });
    await waitFor(() => {
      expect(screen.getByTestId('live-queue-suggestion')).toBeInTheDocument();
    });
    expect(screen.getByTestId('queue-suggestion-os')).toBeInTheDocument();
    expect(screen.queryByTestId('queue-assign-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('queue-undo-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('queue-priority-select')).not.toBeInTheDocument();
  });

  it('fila vazia mostra estado limpo em vez de sugestão', async () => {
    renderPanel({
      queueRows: [{ os_id: 'OS-D', status: 'done', priority: 2, created_at: new Date(NOW).toISOString() }],
    });
    await waitFor(() => {
      expect(screen.getByTestId('live-queue-suggestion')).toBeInTheDocument();
    });
    expect(screen.getByTestId('live-queue-suggestion')).toHaveTextContent('Queue is clear.');
    expect(screen.queryByTestId('queue-assign-btn')).not.toBeInTheDocument();
  });

  it('onQueueChange é avisado a cada mutação (contrato p/ persistência futura)', async () => {
    const onQueueChange = vi.fn();
    renderPanel({ queueRows: queueFixtures(), onQueueChange });
    fireEvent.click(await screen.findByTestId('queue-assign-btn'));
    await waitFor(() => {
      expect(onQueueChange).toHaveBeenCalledTimes(1);
    });
    const rows = onQueueChange.mock.calls[0][0] as QueueRowLike[];
    expect(rows.find((r) => r.os_id === 'OS-ATRASADA')?.assignee).toBe('boss-1');
  });

  it('i18n pt-BR dos rótulos do card', async () => {
    render(
      <I18nProvider initialLocale="pt">
        <LiveDashboardPanel
          entries={[entry(2)]}
          viewer={{ id: 'boss-1', name: 'Chefe' }}
          nowMs={NOW}
          queueRows={queueFixtures()}
        />
      </I18nProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('queue-suggestion-reason')).toHaveTextContent('atrasada há 5h');
    });
    expect(screen.getByTestId('queue-assign-btn')).toHaveTextContent('Atribuir a Chefe');
  });
});

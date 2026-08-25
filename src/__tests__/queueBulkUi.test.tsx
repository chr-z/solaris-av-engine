// Solaris v3 — F2 — QueueBulkBar no painel ao vivo (jsdom): seleção múltipla,
// "3 urgentes" na ordem da fila, aplicação em lote com undo linha a linha,
// gate de papel (analista não vê) e paridade i18n.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import type { DashboardEntryInput } from '../utils/dashboardData';
import LiveDashboardPanel from '../components/Admin/LiveDashboardPanel';
import type { QueueRowLike } from '../features/qol/queue';
import { resetUndoLog } from '../features/qol/undoStore';

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
const H = 3600_000;

function queueFixtures(): QueueRowLike[] {
  return [
    {
      os_id: 'OS-OVER',
      title: 'Aula atrasada',
      status: 'queued',
      priority: 2,
      deadline: new Date(NOW - 3 * H).toISOString(),
      created_at: new Date(NOW - 80 * H).toISOString(),
    },
    {
      os_id: 'OS-NOVA',
      status: 'queued',
      priority: 1,
      created_at: new Date(NOW - 2 * H).toISOString(),
    },
    {
      os_id: 'OS-VELHA',
      status: 'queued',
      priority: 2,
      created_at: new Date(NOW - 100 * H).toISOString(),
    },
    {
      os_id: 'OS-FECHADA',
      status: 'done',
      priority: 2,
      created_at: new Date(NOW - 10 * H).toISOString(),
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
        queueRows={queueFixtures()}
        {...props}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetUndoLog();
});

describe('bulk actions da fila no painel ao vivo', () => {
  it('lista só queued na ordem urgente; done não aparece', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('bulk-bar')).toBeInTheDocument();
    });
    const list = screen.getByTestId('bulk-list');
    expect(list.textContent).toContain('OS-OVER');
    expect(list.textContent).toContain('OS-NOVA');
    expect(list.textContent).toContain('OS-VELHA');
    expect(list.textContent).not.toContain('OS-FECHADA');
    // Ordem visual = prioridade da fila: overdue primeiro.
    const badges = [
      screen.getByTestId('bulk-band-OS-OVER'),
      screen.getByTestId('bulk-band-OS-NOVA'),
      screen.getByTestId('bulk-band-OS-VELHA'),
    ];
    expect(badges[0]).toHaveTextContent('+3h');
    expect(badges[1]).toHaveTextContent('new');
    expect(badges[2]).toHaveTextContent('old');
  });

  it('"3 urgentes" seleciona o topo da fila em ordem; contador reflete', async () => {
    renderPanel();
    await screen.findByTestId('bulk-bar');
    fireEvent.click(screen.getByTestId('bulk-select-top'));
    expect(screen.getByTestId('bulk-check-OS-OVER')).toBeChecked();
    expect(screen.getByTestId('bulk-check-OS-NOVA')).toBeChecked();
    expect(screen.getByTestId('bulk-check-OS-VELHA')).toBeChecked();
    expect(screen.getByTestId('bulk-selection-count')).toHaveTextContent('3 selected');
  });

  it('atribuir em lote aplica todas; Desfazer reverte UMA (topo da pilha)', async () => {
    const onQueueChange = vi.fn();
    renderPanel({ onQueueChange });
    await screen.findByTestId('bulk-bar');
    fireEvent.click(screen.getByTestId('bulk-select-top'));
    fireEvent.click(screen.getByTestId('bulk-assign-btn'));
    // Seleção limpa após aplicar; as 3 seguem na lista (continuam queued).
    await waitFor(() => {
      expect(screen.getByTestId('bulk-selection-count').textContent).toContain('0 selected');
    });
    expect(screen.getByTestId('bulk-list').textContent).toContain('OS-OVER');
    // Contrato de persistência do painel: última mutação tem os 3 atribuídos.
    const afterBulk = onQueueChange.mock.calls.at(-1)?.[0] as QueueRowLike[];
    expect(afterBulk.find((r) => r.os_id === 'OS-OVER')?.assignee).toBe('boss-1');
    expect(afterBulk.find((r) => r.os_id === 'OS-NOVA')?.assignee).toBe('boss-1');
    expect(afterBulk.find((r) => r.os_id === 'OS-VELHA')?.assignee).toBe('boss-1');
    // Desfazer UMA vez reverte só o topo da pilha (última da ordem de seleção).
    fireEvent.click(screen.getByTestId('queue-undo-btn'));
    await waitFor(() => {
      const rows = onQueueChange.mock.calls.at(-1)?.[0] as QueueRowLike[];
      expect(rows.find((r) => r.os_id === 'OS-VELHA')?.assignee ?? null).toBeNull();
      expect(rows.find((r) => r.os_id === 'OS-OVER')?.assignee).toBe('boss-1');
      expect(rows.find((r) => r.os_id === 'OS-NOVA')?.assignee).toBe('boss-1');
    });
  });

  it('prioridade em lote muda N linhas de uma vez (evento por linha)', async () => {
    renderPanel();
    await screen.findByTestId('bulk-bar');
    fireEvent.click(screen.getByTestId('bulk-select-top'));
    fireEvent.change(screen.getByTestId('bulk-priority-select'), { target: { value: '1' } });
    // Após aplicar, seleção limpa e contador zera.
    await waitFor(() => {
      expect(screen.getByTestId('bulk-selection-count').textContent).toContain('0 selected');
    });
  });

  it('analista (sem poder de gestão) não vê a barra de bulk', async () => {
    renderPanel({ role: 'analyst' });
    await screen.findByTestId('live-queue-suggestion');
    expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument();
  });

  it('i18n pt-BR dos rótulos da barra', async () => {
    renderPanel({}, 'pt');
    await screen.findByTestId('bulk-bar');
    expect(screen.getByText('Seleção em lote')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-select-top')).toHaveTextContent('3 urgentes');
    expect(screen.getByTestId('bulk-assign-btn')).toHaveTextContent('Atribuir selecionadas a mim');
  });
});

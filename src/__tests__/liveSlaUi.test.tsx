// Solaris v3 — F5 — card "SLA médio" (spec B1) na UI do painel ao vivo.
// Verifica valor/sub por estado da fila: com conclusão, com atraso, vazio.

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import type { DashboardEntryInput } from '../utils/dashboardData';
import LiveDashboardPanel from '../components/Admin/LiveDashboardPanel';
import type { QueueRowLike } from '../features/qol/queue';

vi.mock('../components/EChartsLiveChart', () => ({
  default: () => <div data-testid="live-chart-stub" />,
}));

function entry(rowIndex: number): DashboardEntryInput {
  return {
    rowIndex,
    headers: ['DATA', 'OS'],
    cells: [{ value: '2026-08-25' }, { value: `OS-F${rowIndex}` }],
  };
}

const NOW = Date.UTC(2026, 7, 25, 15, 0, 0);
const HOUR_MS = 3600_000;

function renderPanel(props: Partial<Parameters<typeof LiveDashboardPanel>[0]> = {}) {
  return render(
    <I18nProvider initialLocale="en">
      <LiveDashboardPanel
        entries={[entry(2)]}
        viewer={null}
        nowMs={NOW}
        {...props}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('KPI SLA (B1)', () => {
  it('mostra média de conclusão e contagem de atrasadas', async () => {
    const rows: QueueRowLike[] = [
      {
        os_id: 'OS-DONE',
        status: 'done',
        priority: 2,
        created_at: new Date(NOW - 10 * HOUR_MS).toISOString(),
        completed_at: new Date(NOW - 4 * HOUR_MS).toISOString(), // 6h p/ concluir
      },
      {
        os_id: 'OS-LATE',
        status: 'queued',
        priority: 2,
        deadline: new Date(NOW - 3 * HOUR_MS).toISOString(),
        created_at: new Date(NOW - 48 * HOUR_MS).toISOString(),
      },
    ];
    renderPanel({ queueRows: rows });
    await waitFor(() => {
      const card = screen.getByTestId('live-kpi-sla');
      expect(card).toHaveTextContent('SLA');
      // média de conclusão = 6h; sub = 1 atrasada · 3h
      expect(card).toHaveTextContent('6h per O.S.');
      expect(card).toHaveTextContent('1 overdue · avg 3h late');
    });
  });

  it('fila sem atraso mostra "no overdue"', async () => {
    const rows: QueueRowLike[] = [
      {
        os_id: 'OK-1',
        status: 'queued',
        priority: 2,
        created_at: new Date(NOW - HOUR_MS).toISOString(),
      },
    ];
    renderPanel({ queueRows: rows });
    await waitFor(() => {
      expect(screen.getByTestId('live-kpi-sla')).toHaveTextContent(
        'no overdue O.S.',
      );
    });
  });

  it('sem timestamps → "—" (nunca zero inventado)', async () => {
    const rows: QueueRowLike[] = [
      {
        os_id: 'SEM-TS',
        status: 'done',
        priority: 2,
        created_at: '',
        completed_at: null,
      },
    ];
    renderPanel({ queueRows: rows });
    await waitFor(() => {
      const card = screen.getByTestId('live-kpi-sla');
      expect(card).toHaveTextContent('—');
      expect(card).toHaveTextContent('no overdue O.S.');
    });
  });

  it('sem fila nenhuma → card existe com em-dash', async () => {
    renderPanel({ queueRows: [] });
    await waitFor(() => {
      const card = screen.getByTestId('live-kpi-sla');
      expect(card).toBeInTheDocument();
      expect(card).toHaveTextContent('—');
    });
  });

  it('i18n pt-BR: rótulos traduzidos', async () => {
    const rows: QueueRowLike[] = [
      {
        os_id: 'OS-LATE-PT',
        status: 'queued',
        priority: 2,
        deadline: new Date(NOW - 2 * HOUR_MS).toISOString(),
        created_at: new Date(NOW - 5 * HOUR_MS).toISOString(),
      },
    ];
    render(
      <I18nProvider initialLocale="pt">
        <LiveDashboardPanel entries={[entry(2)]} viewer={null} nowMs={NOW} queueRows={rows} />
      </I18nProvider>,
    );
    await waitFor(() => {
      const card = screen.getByTestId('live-kpi-sla');
      expect(card).toHaveTextContent('atrasadas');
    });
  });
});

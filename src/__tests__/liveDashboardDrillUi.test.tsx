// Solaris v3 — F5/B2 — drill-down do analista na UI do painel ao vivo.
// Cobre: card clicável abre histórico completo, voltar restaura, semana/tempo
// médio aparecem nos dados, e papéis respeitam privacidade (B2/B4).

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import type { DashboardEntryInput } from '../utils/dashboardData';
import LiveDashboardPanel from '../components/Admin/LiveDashboardPanel';
import type { QueueRowLike } from '../features/qol/queue';

vi.mock('../components/EChartsLiveChart', () => ({
  default: () => <div data-testid="live-chart-stub" />,
}));

function entry(rowIndex: number, fields: Record<string, string>): DashboardEntryInput {
  const headers = Object.keys(fields);
  const cells = headers.map((h) => ({ value: fields[h] }));
  return { rowIndex, headers, cells };
}

const H = {
  date: 'DATA',
  wo: 'OS',
  studio: 'ESTÚDIO',
  event: 'EVENTO',
  instructor: 'PROFESSOR',
  analyst: 'ANALISTA',
  score: 'FINAL SCORE',
};

function makeEntries(): DashboardEntryInput[] {
  return [
    entry(2, {
      [H.date]: '2026-08-25', // hoje (segunda da semana é 24/08)
      [H.wo]: 'OS-1',
      [H.studio]: 'Estúdio A',
      [H.event]: 'Aula 1',
      [H.instructor]: 'Prof. X',
      [H.analyst]: 'ana',
      [H.score]: '90',
    }),
    entry(3, {
      [H.date]: '2026-08-24', // segunda desta semana
      [H.wo]: 'OS-2',
      [H.studio]: 'Estúdio B',
      [H.event]: 'Aula 2',
      [H.instructor]: 'Prof. Y',
      [H.analyst]: 'ana',
      [H.score]: '80',
    }),
    entry(4, {
      [H.date]: '2026-08-20', // semana ANTERIOR
      [H.wo]: 'OS-3',
      [H.studio]: 'Estúdio A',
      [H.event]: 'Aula 3',
      [H.instructor]: 'Prof. X',
      [H.analyst]: 'ana',
      [H.score]: '70',
    }),
    entry(5, {
      [H.date]: '2026-08-25',
      [H.wo]: 'OS-9',
      [H.studio]: 'Estúdio C',
      [H.event]: 'Aula 9',
      [H.instructor]: 'Prof. Z',
      [H.analyst]: 'bia',
      [H.score]: '',
    }),
  ];
}

const NOW = Date.UTC(2026, 7, 25, 15, 0, 0); // terça 12h SP
const HOUR_MS = 3_600_000;

const QUEUE_ROWS: QueueRowLike[] = [
  {
    os_id: 'OS-Q1',
    status: 'done',
    priority: 2,
    assignee: 'ana',
    created_at: new Date(NOW - 10 * HOUR_MS).toISOString(),
    completed_at: new Date(NOW - 6 * HOUR_MS).toISOString(), // 4h p/ concluir
  },
  {
    os_id: 'OS-Q2',
    status: 'queued',
    priority: 2,
    created_at: new Date(NOW - HOUR_MS).toISOString(),
  },
];

function renderPanel(props: Partial<Parameters<typeof LiveDashboardPanel>[0]> = {}) {
  return render(
    <I18nProvider initialLocale="en">
      <LiveDashboardPanel
        entries={makeEntries()}
        viewer={null}
        nowMs={NOW}
        queueRows={QUEUE_ROWS}
        {...props}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

async function openAnaDrill(
  props: Partial<Parameters<typeof LiveDashboardPanel>[0]> = {},
): Promise<void> {
  renderPanel(props);
  await waitFor(() => {
    expect(screen.getAllByTestId('live-analyst-card').length).toBeGreaterThan(0);
  });
  fireEvent.click(screen.getByLabelText("Open ana's full history"));
  await waitFor(() => {
    expect(screen.getByTestId('analyst-drilldown')).toBeInTheDocument();
  });
}

describe('drill-down do analista (UI)', () => {
  it('card vira botão com semana e tempo médio visíveis pro admin', async () => {
    renderPanel();
    await waitFor(() => {
      const cards = screen.getAllByTestId('live-analyst-card');
      expect(cards[0]).toHaveTextContent('1 today');
    });
    const anaCard = screen.getByLabelText("Open ana's full history");
    expect(anaCard).toHaveTextContent('2 this week'); // 24/08 + 25/08
    expect(anaCard).toHaveTextContent('4h/O.S.'); // da fila real
  });

  it('clique no card abre o histórico completo com meses e O.S. recentes', async () => {
    await openAnaDrill();
    const drill = screen.getByTestId('analyst-drilldown');
    expect(drill).toHaveTextContent('ana — full history');
    // KPIs do topo do drill
    expect(drill).toHaveTextContent('Analyzed');
    // Histórico mensal: só agosto tem atividade neste dataset
    const months = screen.getByTestId('drill-months');
    expect(months).toHaveTextContent('2026-08');
    expect(months.textContent).not.toContain('2026-07');
    // O.S. recentes incluem as três da planilha
    const recent = screen.getByTestId('drill-recent-os');
    expect(recent).toHaveTextContent('OS-1');
    expect(recent).toHaveTextContent('OS-2');
    expect(recent).toHaveTextContent('OS-3');
    // Tempo médio vem da fila real: 4h
    expect(screen.getByTestId('drill-avg-time')).toHaveTextContent('4h per O.S.');
  });

  it('"Back to overview" fecha o drill sem recarregar o painel', async () => {
    await openAnaDrill();
    fireEvent.click(screen.getByTestId('drill-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('analyst-drilldown')).not.toBeInTheDocument();
    });
    // Painel segue vivo por trás
    expect(screen.getByTestId('live-analyst-cards')).toBeInTheDocument();
  });

  it('analista abrindo o próprio drill não vê métricas individuais alheias ao papel', async () => {
    await openAnaDrill({ role: 'analyst', viewer: { id: 'ana', name: 'Ana' } });
    // Tempo médio é métrica individual → mascarado mesmo com dado presente
    expect(screen.getByTestId('drill-avg-time')).toHaveTextContent('—');
    expect(screen.getByTestId('analyst-drilldown')).toHaveTextContent(
      'Individual metrics visible to admins/leads only.',
    );
    // Contagens agregadas (hoje/semana/total) seguem visíveis pra dono delas
    expect(screen.getByTestId('drill-recent-os')).toHaveTextContent('OS-1');
  });

  it('card de analista sem fila real não inventa tempo médio', async () => {
    renderPanel({ queueRows: [] });
    await waitFor(() => {
      expect(screen.getAllByTestId('live-analyst-card').length).toBeGreaterThan(0);
    });
    expect(screen.getByLabelText("Open ana's full history").textContent).not.toContain('h/O.S.');
  });
});

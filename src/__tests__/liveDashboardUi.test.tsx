// Solaris v3 — F5 — testes de UI do painel ao vivo (jsdom, sem canvas real).
// Cobre: KPIs renderizados, toggle Planilhas/Ao vivo no gate, privacidade por
// papel na tabela de qualidade, feed com dedupe e fallback offline dos charts.

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import type { DashboardEntryInput } from '../utils/dashboardData';
import LiveDashboardPanel, {
  ChartFallback,
} from '../components/Admin/LiveDashboardPanel';

// echarts não roda em jsdom — mocka o módulo inteiro do chart lazy.
vi.mock('../components/EChartsLiveChart', () => ({
  default: () => <div data-testid="live-chart-stub" />,
}));

function entry(
  rowIndex: number,
  fields: Record<string, string>,
): DashboardEntryInput {
  // cells é array POSICIONAL (RowData = CellData[]) alinhado com headers.
  const headers = Object.keys(fields);
  const cells = headers.map((h) => ({ value: fields[h] }));
  return { rowIndex, headers, cells };
}

// Nomes de coluna precisam bater com o header-map do dashboardData
// ('DATA', 'OS'/'WO', 'ESTÚDIO', 'EVENTO', 'PROFESSOR', 'ANALISTA', 'FINAL SCORE').
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
      [H.date]: '2026-08-25',
      [H.wo]: 'OS-1',
      [H.studio]: 'Estúdio A',
      [H.event]: 'Aula 1',
      [H.instructor]: 'Prof. X',
      [H.analyst]: 'ana',
      [H.score]: '90',
    }),
    entry(3, {
      [H.date]: '2026-08-25',
      [H.wo]: 'OS-2',
      [H.studio]: 'Estúdio B',
      [H.event]: 'Aula 2',
      [H.instructor]: 'Prof. Y',
      [H.analyst]: 'bia',
      [H.score]: '',
    }),
    entry(4, {
      [H.date]: '2026-08-20',
      [H.wo]: 'OS-3',
      [H.studio]: 'Estúdio A',
      [H.event]: 'Aula 3',
      [H.instructor]: 'Prof. X',
      [H.analyst]: 'ana',
      [H.score]: '70',
    }),
  ];
}

const NOW = Date.UTC(2026, 7, 25, 15, 0, 0); // 12:00 de SP em 25/08/2026

function renderPanel(props?: Partial<Parameters<typeof LiveDashboardPanel>[0]>) {
  return render(
    <I18nProvider initialLocale="en">
      <LiveDashboardPanel entries={makeEntries()} viewer={null} nowMs={NOW} {...props} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('LiveDashboardPanel', () => {
  it('renderiza KPIs de hoje a partir das entradas herdadas', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('live-kpi-today')).toHaveTextContent('2');
    });
    // 1 concluída hoje (90) + pendente OS-2
    expect(screen.getByTestId('live-kpi-analyzing')).toHaveTextContent('0');
    expect(screen.getByTestId('live-kpi-queue')).toHaveTextContent('1');
    expect(screen.getByTestId('live-kpi-avg')).toHaveTextContent('80');
  });

  it('mostra badge demo quando as entradas vêm vazias e carrega demo', async () => {
    render(
      <I18nProvider initialLocale="en">
        <LiveDashboardPanel entries={[]} viewer={null} nowMs={NOW} />
      </I18nProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('live-source')).toBeInTheDocument();
    });
  });

  it('respeita papel: analista só vê a própria linha na qualidade', async () => {
    renderPanel({ role: 'analyst', viewer: { id: 'ana', name: 'Ana' } });
    await waitFor(() => {
      const table = screen.getByTestId('live-quality');
      expect(table).toHaveTextContent('ana');
      expect(table).not.toHaveTextContent('bia');
    });
  });

  it('admin vê todos os analistas na qualidade', async () => {
    renderPanel({ role: 'admin', viewer: { id: 'boss', name: 'Boss' } });
    await waitFor(() => {
      const table = screen.getByTestId('live-quality');
      expect(table).toHaveTextContent('ana');
      expect(table).toHaveTextContent('bia');
    });
  });

  it('feed exibe eventos injetados via fetchEvents (fallback polling path)', async () => {
    renderPanel({
      fetchEvents: vi.fn().mockResolvedValue([
        { id: 'e1', ts: NOW - 60_000, text: 'Ana terminou OS-12345' },
      ]),
    });
    await waitFor(() => {
      expect(screen.getByTestId('live-feed')).toHaveTextContent(
        'Ana terminou OS-12345',
      );
    });
  });

  it('ChartFallback é o placeholder do Suspense', () => {
    render(<ChartFallback />);
    expect(screen.getByTestId('chart-fallback')).toBeInTheDocument();
  });
});

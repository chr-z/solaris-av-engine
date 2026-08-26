// Solaris v3 — F5/B3 — UI da tabela de qualidade cruzada completa.
// Cobre: colunas Rework/Avg time/vs team com dados reais (eventos XP +
// fila), máscara por papel (B4) e ausência honesta (— nunca zero inventado).

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
    entry(2, { [H.date]: '2026-08-25', [H.wo]: 'OS-1', [H.studio]: 'A', [H.event]: 'E1', [H.instructor]: 'P1', [H.analyst]: 'ana', [H.score]: '90' }),
    entry(3, { [H.date]: '2026-08-24', [H.wo]: 'OS-2', [H.studio]: 'B', [H.event]: 'E2', [H.instructor]: 'P2', [H.analyst]: 'ana', [H.score]: '80' }),
    entry(4, { [H.date]: '2026-08-25', [H.wo]: 'OS-3', [H.studio]: 'C', [H.event]: 'E3', [H.instructor]: 'P3', [H.analyst]: 'bia', [H.score]: '70' }),
  ];
}

const NOW = Date.UTC(2026, 7, 25, 15, 0, 0);
const HOUR_MS = 3_600_000;

const QUEUE_ROWS: QueueRowLike[] = [
  {
    os_id: 'OS-Q1',
    status: 'done',
    priority: 2,
    assignee: 'ana',
    created_at: new Date(NOW - 10 * HOUR_MS).toISOString(),
    completed_at: new Date(NOW - 8 * HOUR_MS).toISOString(), // ana: 2h
  },
  {
    os_id: 'OS-Q2',
    status: 'done',
    priority: 2,
    assignee: 'bia',
    created_at: new Date(NOW - 14 * HOUR_MS).toISOString(),
    completed_at: new Date(NOW - 8 * HOUR_MS).toISOString(), // bia: 6h
  },
];

/** Perfil gamificado mínimo com eventos de auditoria (fonte real do B3). */
function seedProfile(userId: string, events: Array<{ amount: number; reason: string }>): void {
  window.localStorage.setItem(
    `solaris.gamification.profile.${userId}`,
    JSON.stringify({
      v: 1,
      events: events.map((e, i) => ({
        id: `${userId}-${i}`,
        userId,
        amount: e.amount,
        reason: e.reason,
        ts: NOW,
      })),
      achievements: {},
      podiumHistory: {},
      lastFrozen: {},
    }),
  );
}

type Props = Partial<Parameters<typeof LiveDashboardPanel>[0]>;

function renderPanel(props: Props = {}) {
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

describe('qualidade cruzada completa (UI)', () => {
  it('admin vê retrabalho auditado, tempo/O.S. e comparação com o time', async () => {
    seedProfile('ana', [
      { amount: 150, reason: 'quality_bonus' },
      { amount: -150, reason: 'rework_penalty' },
    ]);
    seedProfile('bia', [{ amount: 150, reason: 'quality_bonus' }]);
    renderPanel({ role: 'admin', viewer: { id: 'boss', name: 'Boss' } });
    const table = await screen.findByTestId('live-quality');
    // ana: 1 estorno em 2 auditorias = 50%; 2h vs time 4h = 50% mais rápida
    expect(screen.getByTestId('quality-rework-ana')).toHaveTextContent(
      '50% (1 ok / 1 rework)',
    );
    expect(table).toHaveTextContent('−50% faster');
    // bia: zero estornos em 1 auditoria = 0% (dado real, não "—"); 6h = +50%
    expect(screen.getByTestId('quality-rework-bia')).toHaveTextContent(
      '0% (1 ok / 0 rework)',
    );
    expect(table).toHaveTextContent('+50% slower');
    // Cabeçalhos novos presentes
    expect(table).toHaveTextContent('Rework (audit)');
    expect(table).toHaveTextContent('vs team');
  });

  it('sem eventos nem timestamps: colunas mostram — (nunca zero inventado)', async () => {
    renderPanel({ role: 'admin', viewer: { id: 'boss', name: 'Boss' }, queueRows: [] });
    await screen.findByTestId('live-quality');
    expect(screen.getByTestId('quality-rework-ana')).toHaveTextContent('—');
  });

  it('analista não vê métricas individuais dos colegas nem as próprias na tabela', async () => {
    seedProfile('ana', [{ amount: 150, reason: 'quality_bonus' }]);
    renderPanel({ role: 'analyst', viewer: { id: 'ana', name: 'Ana' } });
    const table = await screen.findByTestId('live-quality');
    // Privacidade B4: só a própria linha existe…
    expect(table).toHaveTextContent('ana');
    expect(table).not.toHaveTextContent('bia');
    // …e mesmo nela as métricas individuais ficam mascaradas
    expect(screen.getByTestId('quality-rework-ana')).toHaveTextContent('—');
  });
});

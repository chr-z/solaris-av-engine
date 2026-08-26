// Solaris v3 — C4 modo time — UI da seção "Meta do mês" na Liga (jsdom).
// Cobre: não-admin sem meta, admin define/remove meta, inválido com alert,
// retrabalho reduzindo o total do time e hot-reload por evento custom.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import LeaguePanel from '../components/Gamification/LeaguePanel';
import {
  emptyProfile,
  PROFILE_KEY_PREFIX,
  type StoredXpEvent,
} from '../features/gamification/profileStore';
import { TEAM_GOAL_KEY } from '../features/gamification/teamGoal';
import {
  currentPeriodKey,
  closedPeriodRange,
  SAO_PAULO_CLOCK,
} from '../features/gamification/periods';

// vi.mock é hoisted: estado compartilhado via vi.hoisted (padrão vitest 4).
const roleState = vi.hoisted(() => ({ admin: false }));
vi.mock('../hooks/useAdminRole', () => ({
  useAdminRole: () => ({
    isAdmin: roleState.admin,
    source: 'local-fallback',
    loading: false,
  }),
}));

const HOUR = 3_600_000;

// Instante DENTRO do mês corrente (independente da data em que roda):
const RANGE = closedPeriodRange('month', currentPeriodKey('month', Date.now(), SAO_PAULO_CLOCK), SAO_PAULO_CLOCK);
const MID = RANGE.fromMs + 12 * HOUR;

const EVENTS: StoredXpEvent[] = [
  { id: 'e1', amount: 100, reason: 'os_complete', ts: MID, userId: 'u1' },
  { id: 'e2', amount: 150, reason: 'quality_bonus', ts: MID + HOUR, userId: 'u1' },
  { id: 'e3', amount: -150, reason: 'rework_penalty', ts: MID + 2 * HOUR, userId: 'u1' }, // retrabalho
  { id: 'e4', amount: 100, reason: 'os_complete', ts: MID + 3 * HOUR, userId: 'u2' },
  { id: 'e5', amount: 500, reason: 'os_complete', ts: RANGE.fromMs - HOUR, userId: 'u2' }, // mês anterior
];

function seedProfile() {
  const profile = { ...emptyProfile(), events: EVENTS };
  window.localStorage.setItem(PROFILE_KEY_PREFIX + 'u1', JSON.stringify(profile));
}

function mount() {
  return render(
    <I18nProvider initialLocale="pt">
      <LeaguePanel userProfile={{ id: 'u1', name: 'Ana' }} />
    </I18nProvider>,
  );
}

describe('LeaguePanel — seção Meta do mês (modo time C4)', () => {
  beforeEach(() => {
    cleanup();
    roleState.admin = false;
    window.localStorage.clear();
    seedProfile();
  });

  it('sem meta e sem admin: mostra vazio e NÃO renderiza formulário', () => {
    mount();
    expect(screen.getByTestId('league-team-nogoal')).toHaveTextContent(/nenhuma meta/i);
    expect(screen.queryByTestId('league-team-form')).toBeNull();
  });

  it('admin define meta 400: total líquido 200 → 50%, faltam 200, barra aria-valuenow=50', () => {
    roleState.admin = true;
    mount();
    const input = screen.getByLabelText(/meta mensal/i);
    fireEvent.change(input, { target: { value: '400' } });
    fireEvent.submit(screen.getByTestId('league-team-form'));

    expect(window.localStorage.getItem(TEAM_GOAL_KEY)).toBe('400');
    expect(screen.getByTestId('league-team-progress')).toHaveTextContent('50% de 400 XP');
    expect(screen.getByTestId('league-team-progress')).toHaveTextContent('Faltam 200 XP');
    expect(screen.getByRole('progressbar', { name: /meta do mês/i })).toHaveAttribute('aria-valuenow', '50');
  });

  it('admin digita lixo: alert de inteiro >= 1 e nada gravado', () => {
    roleState.admin = true;
    mount();
    const input = screen.getByLabelText(/meta mensal/i);
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.submit(screen.getByTestId('league-team-form'));
    expect(screen.getByRole('alert')).toHaveTextContent(/inteiro/i);
    expect(window.localStorage.getItem(TEAM_GOAL_KEY)).toBeNull();
  });

  it('admin remove a meta: volta ao estado vazio', () => {
    window.localStorage.setItem(TEAM_GOAL_KEY, '400');
    roleState.admin = true;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Remover meta' }));
    expect(window.localStorage.getItem(TEAM_GOAL_KEY)).toBeNull();
    expect(screen.getByTestId('league-team-nogoal')).toBeInTheDocument();
  });

  it('hot-reload: evento solaris:team-goal-changed re-lê a meta do storage', async () => {
    roleState.admin = true;
    mount();
    expect(screen.getByTestId('league-team-nogoal')).toBeInTheDocument();

    // Outra aba/processo grava direto e avisa pelo evento custom:
    window.localStorage.setItem(TEAM_GOAL_KEY, '200');
    window.dispatchEvent(new CustomEvent('solaris:team-goal-changed'));

    // 200 líquido vs meta 200 → batida:
    expect(await screen.findByTestId('league-team-progress')).toHaveTextContent(/meta batida/i);
  });
});

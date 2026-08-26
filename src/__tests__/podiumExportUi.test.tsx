// Solaris v3 — C4/E — UI do opt-in de compartilhamento de pódio (jsdom).
// Cobre: toggle só p/ admin, export buttons SÓ com opt-in ON, download real
// de CSV/XLSX (URL.createObjectURL mockado), e OFF por padrão.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import LeaguePanel from '../components/Gamification/LeaguePanel';
import {
  emptyProfile,
  PROFILE_KEY_PREFIX,
  type ProfileState,
} from '../features/gamification/profileStore';
import { PODIUM_SHARE_OPTIN_KEY } from '../features/gamification/podiumSharePref';

const roleState = vi.hoisted(() => ({ admin: false }));
vi.mock('../hooks/useAdminRole', () => ({
  useAdminRole: () => ({
    isAdmin: roleState.admin,
    source: 'local-fallback',
    loading: false,
  }),
}));

// jsdom não baixa arquivos — captura o que SERIA baixado.
let downloads: Array<{ name: string; blob: Blob }> = [];
beforeEach(() => {
  downloads = [];
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLAnchorElement.prototype.click = function click() {
    downloads.push({ name: this.download, blob: new Blob() });
  };
});
afterEach(() => {
  cleanup();
});

/** Perfil com um pódio congelado + XP suficiente pra liga ligada. */
function seedProfileWithHistory(): void {
  const profile: ProfileState = {
    ...emptyProfile(),
    events: [
      { id: 'e1', amount: 300, reason: 'os_complete', ts: Date.now(), userId: 'u1' },
    ],
    podiumHistory: {
      'month:2026-08': [
        { userId: 'u1', name: 'Ana', rank: 1, xp: 1200, reworkCount: 0 },
        { userId: 'u2', name: 'Bia', rank: 2, xp: 900, reworkCount: 1 },
      ],
    },
  };
  window.localStorage.setItem(PROFILE_KEY_PREFIX + 'u1', JSON.stringify(profile));
}

function mount() {
  return render(
    <I18nProvider initialLocale="en">
      <LeaguePanel userProfile={{ id: 'u1', name: 'Ana' }} />
    </I18nProvider>,
  );
}

describe('LeaguePanel — podium share opt-in (C4/E)', () => {
  beforeEach(() => {
    cleanup();
    roleState.admin = false;
    window.localStorage.clear();
    seedProfileWithHistory();
  });

  it('default OFF: sem admin não há toggle nem botões', () => {
    mount();
    expect(screen.queryByTestId('podium-share-toggle')).toBeNull();
    expect(screen.queryByTestId(/podium-export-csv-/)).toBeNull();
  });

  it('admin vê o toggle desligado; histórico sem botões enquanto OFF', () => {
    roleState.admin = true;
    mount();
    const toggle = screen.getByTestId('podium-share-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByTestId('league-history')).toBeInTheDocument();
    expect(screen.queryByTestId(/podium-export-csv-/)).toBeNull();
  });

  it('admin liga opt-in → botões aparecem; desligar → somem', () => {
    roleState.admin = true;
    mount();
    const toggle = screen.getByTestId('podium-share-toggle') as HTMLInputElement;
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(
      window.localStorage.getItem(PODIUM_SHARE_OPTIN_KEY),
    ).toBe('1');
    expect(
      screen.getByTestId('podium-export-csv-month-2026-08'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('podium-export-xlsx-month-2026-08'),
    ).toBeInTheDocument();

    fireEvent.click(toggle); // desligar
    expect(toggle.checked).toBe(false);
    expect(
      window.localStorage.getItem(PODIUM_SHARE_OPTIN_KEY),
    ).toBeNull();
    expect(screen.queryByTestId(/podium-export-csv-/)).toBeNull();
  });

  it('export CSV baixa arquivo com nome estável e linhas ranqueadas', () => {
    roleState.admin = true;
    mount();
    fireEvent.click(screen.getByTestId('podium-share-toggle'));
    fireEvent.click(screen.getByTestId('podium-export-csv-month-2026-08'));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('solaris-podium_month_2026-08.csv');
  });

  it('export XLSX baixa com nome gêmeo do CSV', () => {
    roleState.admin = true;
    mount();
    fireEvent.click(screen.getByTestId('podium-share-toggle'));
    fireEvent.click(screen.getByTestId('podium-export-xlsx-month-2026-08'));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('solaris-podium_month_2026-08.xlsx');
  });

  it('analista NÃO exporta mesmo se a chave estiver suja no storage', () => {
    window.localStorage.setItem(PODIUM_SHARE_OPTIN_KEY, '1');
    mount(); // isAdmin = false
    expect(screen.queryByTestId(/podium-export-csv-/)).toBeNull();
  });
});

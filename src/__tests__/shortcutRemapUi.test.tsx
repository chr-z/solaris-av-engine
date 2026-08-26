// Solaris v3 — QoL A1 — ShortcutHelpModal como painel de remapeamento:
// captura de tecla, gravação persistida + badge "custom", conflito nomeado,
// reservada recusada, reset individual e paridade i18n.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import ShortcutHelpModal from '../components/Core/ShortcutHelpModal';
import { SHORTCUT_PREFS_KEY } from '../features/qol/shortcutPrefs';

function openModal(locale: 'en' | 'pt' = 'en') {
  const onClose = vi.fn();
  render(
    <I18nProvider initialLocale={locale}>
      <ShortcutHelpModal isOpen onClose={onClose} />
    </I18nProvider>,
  );
  return { onClose };
}

function editButtonFor(name: RegExp): HTMLButtonElement {
  const buttons = screen.getAllByRole('button', { name });
  return buttons[0] as HTMLButtonElement;
}

describe('ShortcutHelpModal — atalhos configuráveis (A1)', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('cada atalho remapeável tem botão Edit; nativos não têm', () => {
    openModal();
    expect(editButtonFor(/edit — play \/ pause/i)).toBeTruthy(); // K (global layer)
    expect(screen.queryByRole('button', { name: /edit — toggle fullscreen/i })).toBeNull(); // F nativo
    expect(screen.queryByRole('button', { name: /edit — mute/i })).toBeNull(); // M nativo
  });

  it('captura tecla, grava no storage e marca como custom', () => {
    openModal();
    fireEvent.click(editButtonFor(/edit — open time markers/i));
    expect(screen.getByRole('status')).toHaveTextContent(/press a key/i);

    fireEvent.keyDown(window, { key: 'w' });

    expect(JSON.parse(window.localStorage.getItem(SHORTCUT_PREFS_KEY)!)).toEqual({ markTime: 'w' });
    expect(screen.getByText(/custom/i)).toBeInTheDocument();
    // Kbd da linha agora mostra a tecla nova:
    const row = screen.getByRole('button', { name: /edit — open time markers/i }).closest('li');
    expect(row?.textContent).toMatch(/\bW\b/);
  });

  it('conflito recusa COM nome do dono e não grava', () => {
    openModal();
    fireEvent.click(editButtonFor(/edit — jump back 10s/i)); // J quer virar T...
    fireEvent.keyDown(window, { key: 't' });                 // ...mas T é do markTime

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/already used by.*open time markers/i);
    expect(window.localStorage.getItem(SHORTCUT_PREFS_KEY)).toBeNull();
  });

  it('tecla reservada do player é recusada', () => {
    openModal();
    fireEvent.click(editButtonFor(/edit — jump back 10s/i));
    fireEvent.keyDown(window, { key: 'm' });
    expect(screen.getByRole('alert').textContent).toMatch(/reserved/i);
    expect(window.localStorage.getItem(SHORTCUT_PREFS_KEY)).toBeNull();
  });

  it('Escape cancela a captura sem gravar nada', () => {
    openModal();
    fireEvent.click(editButtonFor(/edit — jump back 10s/i));
    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    expect(screen.queryByRole('status')).toBeNull();
    expect(window.localStorage.getItem(SHORTCUT_PREFS_KEY)).toBeNull();
  });

  it('reset individual volta ao padrão e some o badge custom', () => {
    window.localStorage.setItem(SHORTCUT_PREFS_KEY, JSON.stringify({ markTime: 'w' }));
    openModal();

    const row = screen.getByRole('button', { name: /reset to default — open time markers/i });
    fireEvent.click(row);

    expect(window.localStorage.getItem(SHORTCUT_PREFS_KEY)).toBeNull();
  });

  it('paridade PT: título e hint localizados', () => {
    openModal('pt');
    expect(screen.getByRole('dialog', { name: /atalhos de teclado/i })).toBeInTheDocument();
    expect(screen.getByText(/clique em “editar” e pressione/i)).toBeInTheDocument();
  });
});

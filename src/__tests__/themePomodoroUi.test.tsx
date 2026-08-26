// Solaris v3 — F2 QoL A2 — UI jsdom: menu de tema e badge Pomodoro.
// (O Header é coberto por tsc/build: montá-lo em jsdom puxaria Firebase/Realtime.)
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import ThemeMenu from '../components/Layout/ThemeMenu';
import PomodoroBadge, {
  getPomodoroController,
} from '../components/Layout/PomodoroBadge';

const KEY = 'solaris.theme';
const PKEY = 'solaris.pomodoro';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  getPomodoroController().stop();
  cleanup();
});

const ui = (node: React.ReactNode) => (
  <I18nProvider initialLocale="en">{node}</I18nProvider>
);

describe('ThemeMenu', () => {
  it('renderiza radiogroup com 3 opções e system ativo por padrão', () => {
    render(ui(<ThemeMenu />));
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    const opts = screen.getAllByRole('radio');
    expect(opts.length).toBe(3);
    expect(screen.getByTitle('Follow system')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTitle('Light theme')).toHaveAttribute('aria-checked', 'false');
    // jsdom: sistema sem preferência escura → classe ausente
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('clique em dark persiste e aplica a classe no <html>', () => {
    render(ui(<ThemeMenu />));
    fireEvent.click(screen.getByTitle('Dark theme'));
    expect(window.localStorage.getItem(KEY)).toBe('dark');
    expect(screen.getByTitle('Dark theme')).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('light persiste e remove a classe (preferência vence o fallback)', () => {
    document.documentElement.classList.add('dark');
    render(ui(<ThemeMenu />));
    fireEvent.click(screen.getByTitle('Light theme'));
    expect(window.localStorage.getItem(KEY)).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('setas movem o foco entre opções (roving tabindex)', () => {
    render(ui(<ThemeMenu />));
    const groupEl = () => screen.getByRole('radiogroup', { name: 'Theme' });
    const systemBtn = screen.getByTitle('Follow system');
    systemBtn.focus();
    expect(document.activeElement).toBe(systemBtn);
    fireEvent.keyDown(groupEl(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByTitle('Light theme'));
    fireEvent.keyDown(groupEl(), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(systemBtn);
  });
});

describe('PomodoroBadge', () => {
  it('ocioso mostra ☕; start roda o relógio; para volta ao ☕', () => {
    render(ui(<PomodoroBadge controller={getPomodoroController()} />));
    expect(screen.getByTestId('pomodoro-badge')).toHaveTextContent('☕');

    fireEvent.click(screen.getByTestId('pomodoro-badge')); // abre popover
    fireEvent.click(screen.getByTestId('pomodoro-start'));
    expect(JSON.parse(window.localStorage.getItem(PKEY)!).endsAtMs).toBeGreaterThan(Date.now());
    expect(screen.getByTestId('pomodoro-badge').textContent).toMatch(/\d\d:\d\d/);

    fireEvent.click(screen.getByTestId('pomodoro-badge')); // reabre
    fireEvent.click(screen.getByTestId('pomodoro-stop'));
    expect(window.localStorage.getItem(PKEY)).toBeNull();
    expect(screen.getByTestId('pomodoro-badge')).toHaveTextContent('☕');
  });

  it('reload retoma o MESMO bloco (crash-safe, sem reiniciar)', () => {
    const endsAt = Date.now() + 19 * 60 * 1000 + 40_000;
    window.localStorage.setItem(PKEY, JSON.stringify({ v: 1, endsAtMs: endsAt }));
    render(ui(<PomodoroBadge controller={getPomodoroController()} />));
    expect(screen.getByTestId('pomodoro-badge').textContent).toMatch(/\d\d:\d\d/);
    fireEvent.click(screen.getByTestId('pomodoro-badge'));
    expect(screen.getByTestId('pomodoro-clock').textContent).toMatch(/^19:/);
    expect(getPomodoroController().snapshot().endsAtMs).toBe(endsAt);
  });

  it('expirado mostra ⏰ com lembrete gentil e permite reiniciar', () => {
    window.localStorage.setItem(
      PKEY,
      JSON.stringify({ v: 1, endsAtMs: Date.now() - 60_000 }), // expirou há 1min
    );
    render(ui(<PomodoroBadge controller={getPomodoroController()} />));
    expect(screen.getByTestId('pomodoro-badge')).toHaveTextContent('⏰');
    fireEvent.click(screen.getByTestId('pomodoro-badge'));
    expect(screen.getByTestId('pomodoro-status')).toHaveTextContent(/take a short break/i);
    fireEvent.click(screen.getByTestId('pomodoro-start')); // reinicia
    expect(screen.getByTestId('pomodoro-badge').textContent).toMatch(/\d\d:\d\d/);
  });
});

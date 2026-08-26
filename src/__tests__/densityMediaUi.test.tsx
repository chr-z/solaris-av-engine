// Solaris v3 — F2 QoL A2 — UI jsdom: menu de densidade e painel de conforto
// de mídia. (O Header/VideoPlayer inteiros são cobertos por tsc/build: montá-los
// em jsdom puxaria Firebase/Realtime — mesma decisão do themePomodoroUi.)
import React, { useState } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import DensityMenu from '../components/Layout/DensityMenu';
import MediaComfortToggle from '../components/Layout/MediaComfortToggle';
import type { MediaComfortApi } from '../features/qol/useMediaComfort';
import type { MediaComfortPrefs } from '../features/qol/mediaComfort';

const DKEY = 'solaris.density';
const MKEY = 'solaris.mediaComfort';
const COMPACT_CLASS = 'solaris-density-compact';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove(COMPACT_CLASS);
  cleanup();
});

const ui = (node: React.ReactNode) => (
  <I18nProvider initialLocale="en">{node}</I18nProvider>
);

describe('DensityMenu', () => {
  it('radiogroup com 2 opções; confortável ativa por padrão', () => {
    render(ui(<DensityMenu />));
    const group = screen.getByRole('radiogroup', { name: 'Interface density' });
    expect(group).toBeInTheDocument();
    const opts = screen.getAllByRole('radio');
    expect(opts.length).toBe(2);
    expect(screen.getByTitle('Comfortable density')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTitle('Compact density')).toHaveAttribute('aria-checked', 'false');
    expect(document.documentElement.classList.contains(COMPACT_CLASS)).toBe(false);
  });

  it('clique em compacta persiste e aplica a classe no <html>', () => {
    render(ui(<DensityMenu />));
    fireEvent.click(screen.getByTitle('Compact density'));
    expect(window.localStorage.getItem(DKEY)).toBe('compact');
    expect(screen.getByTitle('Compact density')).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.classList.contains(COMPACT_CLASS)).toBe(true);
  });

  it('voltar pra confortável remove a classe', () => {
    localStorage.setItem(DKEY, 'compact');
    document.documentElement.classList.add(COMPACT_CLASS);
    render(ui(<DensityMenu />));
    fireEvent.click(screen.getByTitle('Comfortable density'));
    expect(window.localStorage.getItem(DKEY)).toBe('comfortable');
    expect(document.documentElement.classList.contains(COMPACT_CLASS)).toBe(false);
  });

  it('setas movem o foco entre as duas opções (roving tabindex)', () => {
    render(ui(<DensityMenu />));
    const groupEl = () => screen.getByRole('radiogroup', { name: 'Interface density' });
    const comfortableBtn = screen.getByTitle('Comfortable density');
    comfortableBtn.focus();
    expect(document.activeElement).toBe(comfortableBtn);
    fireEvent.keyDown(groupEl(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByTitle('Compact density'));
    fireEvent.keyDown(groupEl(), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(comfortableBtn);
  });
});

/* ── painel de conforto de mídia ───────────────────────────────────────── */

/** Harness com o MESMO contrato do useMediaComfort (estado reativo real). */
function Harness(props: {
  prefs?: Partial<MediaComfortPrefs>;
  hasEnvelope?: boolean;
  onApi?: (api: MediaComfortApi) => void;
}) {
  const [prefs, setPrefs] = useState<MediaComfortPrefs>({
    silenceSkip: 'off',
    minSilenceSeconds: 2,
    normalize: false,
    ...props.prefs,
  });
  const api: MediaComfortApi = {
    prefs,
    setPrefs: (next) => {
      try {
        localStorage.setItem(MKEY, JSON.stringify(next));
      } catch { /* best-effort */ }
      setPrefs(next);
    },
    silences: [],
    gain: 1,
    hasEnvelope: props.hasEnvelope ?? true,
  };
  props.onApi?.(api);
  return <MediaComfortToggle api={api} />;
}

const openPanel = () => {
  fireEvent.click(screen.getByTestId('media-comfort-trigger'));
};

describe('MediaComfortToggle', () => {
  it('painel só existe depois do clique no gatilho (portal do Popover)', () => {
    render(ui(<Harness />));
    expect(screen.queryByTestId('media-comfort-panel')).not.toBeInTheDocument();
    openPanel();
    expect(screen.getByTestId('media-comfort-panel')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Skip long silences' }),
    ).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByRole('switch', { name: 'Gentle volume normalize' }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('ligar skip grava prefs e reflete checked; popover fecha após o toggle', () => {
    render(ui(<Harness />));
    openPanel();
    fireEvent.click(screen.getByRole('switch', { name: 'Skip long silences' }));
    const stored = JSON.parse(window.localStorage.getItem(MKEY) ?? '{}');
    expect(stored.silenceSkip).toBe('skip');
    // popover fechou; reabrir mostra estado novo
    expect(screen.queryByTestId('media-comfort-panel')).not.toBeInTheDocument();
    openPanel();
    expect(
      screen.getByRole('switch', { name: 'Skip long silences' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('ligar normalize grava prefs e reflete checked', () => {
    render(ui(<Harness />));
    openPanel();
    fireEvent.click(screen.getByRole('switch', { name: 'Gentle volume normalize' }));
    const stored = JSON.parse(window.localStorage.getItem(MKEY) ?? '{}');
    expect(stored.normalize).toBe(true);
    openPanel(); // reabre (fechou no toggle)
    expect(
      screen.getByRole('switch', { name: 'Gentle volume normalize' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('interpolação i18n do mínimo de silêncio aparece no painel', () => {
    render(ui(<Harness prefs={{ minSilenceSeconds: 2 }} />));
    openPanel();
    expect(screen.getByText(/Pauses of 2s or more are skipped automatically\./)).toBeInTheDocument();
  });

  it('sem envelope: aviso honesto aparece no lugar da promessa vazia', () => {
    render(ui(<Harness hasEnvelope={false} />));
    openPanel();
    expect(screen.getByTestId('media-comfort-no-envelope')).toHaveTextContent(
      /Waveform not available yet/,
    );
  });

  it('com envelope: aviso ausente', () => {
    render(ui(<Harness hasEnvelope />));
    openPanel();
    expect(screen.queryByTestId('media-comfort-no-envelope')).not.toBeInTheDocument();
  });

  it('gatilho destaca (classe âmbar) quando qualquer recurso está ligado', () => {
    render(ui(<Harness prefs={{ silenceSkip: 'skip' }} />));
    const trigger = screen.getByTestId('media-comfort-trigger');
    expect(trigger.className).toContain('text-amber-300');
  });
});

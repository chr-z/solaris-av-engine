// Solaris v3 — F2 QoL A1: wiring do ScratchpadPanel (notas rápidas por OS).
// Provamos o CONTRATO de produto: colapsado por padrão, abre com nota
// persistida (retomada), gravação debounced em localStorage com badge,
// limpeza no evento de análise oficial e exclusão do guest.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ScratchpadPanel } from '../components/Analysis/ScratchpadPanel';
import { I18nProvider } from '../i18n/I18nContext';
import { dictionaries } from '../i18n/translations';
import { SCRATCH_KEY_PREFIX } from '../hooks/useScratchpad';

function renderPanel(props: Partial<Parameters<typeof ScratchpadPanel>[0]> = {}) {
  const onCleaned = vi.fn();
  const view = render(
    <I18nProvider initialLocale="en">
      <ScratchpadPanel osId="OS-123" {...props} onCleaned={onCleaned} />
    </I18nProvider>,
  );
  return { ...view, onCleaned };
}

describe('F2 ScratchpadPanel — notas rápidas privadas (A1)', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('nasce colapsado; expandir revela textarea + hint de privacidade', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /scratchpad/i })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /scratchpad/i }));
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box).toBeTruthy();
    expect(box.value).toBe('');
    expect(screen.getByText(/never sent to the sheet/i)).toBeTruthy();
  });

  it('digitar agenda gravação debounced (200ms) com badge "saved"', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /scratchpad/i }));

    act(() => {
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'checar gain de 1kHz' },
      });
      // Antes da janela de debounce: nada persistido ainda.
      vi.advanceTimersByTime(150);
    });
    expect(window.localStorage.getItem(SCRATCH_KEY_PREFIX + 'OS-123')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(100); // cruza os 200ms
    });
    const raw = window.localStorage.getItem(SCRATCH_KEY_PREFIX + 'OS-123');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { text: string; savedAt: number };
    expect(parsed.text).toBe('checar gain de 1kHz');
    expect(typeof parsed.savedAt).toBe('number');
    expect(screen.getByText(/saved/)).toBeTruthy(); // badge discreto
  });

  it('nota persistida → painel nasce aberto (retomada de contexto)', () => {
    window.localStorage.setItem(
      SCRATCH_KEY_PREFIX + 'OS-123',
      JSON.stringify({ text: 'nota antiga', savedAt: Date.now() }),
    );
    renderPanel();
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.value).toBe('nota antiga');
  });

  it('evento de análise oficial limpa a nota do storage', () => {
    window.localStorage.setItem(
      SCRATCH_KEY_PREFIX + 'OS-123',
      JSON.stringify({ text: 'rascunho', savedAt: Date.now() }),
    );
    renderPanel();
    expect(window.localStorage.getItem(SCRATCH_KEY_PREFIX + 'OS-123')).toBeTruthy();

    act(() => {
      window.dispatchEvent(new CustomEvent('solaris:scratch-cleaned'));
    });
    expect(window.localStorage.getItem(SCRATCH_KEY_PREFIX + 'OS-123')).toBeNull();
  });

  it('guest (osId null) não monta painel algum', () => {
    render(
      <I18nProvider initialLocale="en">
        <ScratchpadPanel osId={null} />
      </I18nProvider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('visible=false esconde o painel sem apagar nota existente', () => {
    window.localStorage.setItem(
      SCRATCH_KEY_PREFIX + 'OS-123',
      JSON.stringify({ text: 'modo foco mantém', savedAt: Date.now() }),
    );
    renderPanel({ visible: false });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(window.localStorage.getItem(SCRATCH_KEY_PREFIX + 'OS-123')).toBeTruthy();
  });

  it('chaves i18n novas existem em EN e PT (paridade)', () => {
    for (const key of [
      'qol.scratch.title',
      'qol.scratch.placeholder',
      'qol.scratch.hint',
      'qol.scratch.truncated',
    ] as const) {
      expect(dictionaries.en[key]).toBeTruthy();
      expect(dictionaries.pt[key]).toBeTruthy();
    }
    expect(dictionaries.pt['qol.scratch.hint']).toContain('planilha');
  });

  it('troca de OS reinicia a carga (texto novo, sem vazamento entre OSs)', () => {
    window.localStorage.setItem(
      SCRATCH_KEY_PREFIX + 'OS-A',
      JSON.stringify({ text: 'da OS A', savedAt: Date.now() }),
    );
    const { rerender } = render(
      <I18nProvider initialLocale="en">
        <ScratchpadPanel osId="OS-A" />
      </I18nProvider>,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('da OS A');

    window.localStorage.setItem(
      SCRATCH_KEY_PREFIX + 'OS-B',
      JSON.stringify({ text: 'da OS B', savedAt: Date.now() }),
    );
    rerender(
      <I18nProvider initialLocale="en">
        <ScratchpadPanel osId="OS-B" />
      </I18nProvider>,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('da OS B');
  });
});

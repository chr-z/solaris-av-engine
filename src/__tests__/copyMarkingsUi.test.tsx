// Solaris v3 — QoL A1 — CopyMarkingsPopover (jsdom): lista gêmeas com motivo,
// prévia do plano, aplicação correta sobre a linha viva, texto livre opt-in,
// vazio honesto e aviso de planilha incompatível.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import { CopyMarkingsPopover } from '../components/Analysis/CopyMarkingsPopover';

const HEADERS = [
  'W.O.', 'INSTRUCTOR', 'DATE', 'STUDIO',
  'Tilted/Crooked Camera', 'Overexposed (Clipping)', 'OPERATOR COMMENTS',
];
const IDX_TILT = HEADERS.indexOf('Tilted/Crooked Camera');
const IDX_OVER = HEADERS.indexOf('Overexposed (Clipping)');
const IDX_COMMENT = HEADERS.indexOf('OPERATOR COMMENTS');

function mkRow(values: Record<number, string>) {
  return HEADERS.map((_, i) => ({ value: values[i] ?? '' }));
}

const CURRENT = mkRow({ 0: 'OS-CUR', 1: 'Prof X', 2: '2026-08-25', 3: 'Studio A' });
const TWIN = mkRow({ 0: 'OS-TWIN', 1: 'Prof X', 2: '2099-01-01', 3: 'Studio Z', 4: 'TRUE', 5: 'TRUE', 6: 'áudio baixo' });
const UNRELATED = mkRow({ 0: 'OS-OUTRO', 1: 'Prof Y', 2: '2099-01-01', 3: 'Studio Z' });
const ROWS = [
  { rowIndex: 10, row: CURRENT },
  { rowIndex: 11, row: TWIN },
  { rowIndex: 12, row: UNRELATED },
];

function openPopover(locale: 'en' | 'pt' = 'en', props: Record<string, unknown> = {}) {
  const onApply = vi.fn();
  const view = render(
    <I18nProvider initialLocale={locale}>
      <CopyMarkingsPopover
        headers={HEADERS}
        targetRow={CURRENT}
        rows={ROWS}
        currentRowIndex={10}
        onApply={onApply}
        {...props}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /copy markings|copiar marcações/i }));
  return { ...view, onApply };
}

describe('CopyMarkingsPopover — duplicar marcações de aula gêmea (A1)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('lista só gêmeas com motivo localizado; não-gêmea fica fora', () => {
    openPopover();
    expect(screen.getByText('OS-TWIN')).toBeInTheDocument();
    const list = screen.getByText('OS-TWIN').closest('ul');
    expect(list?.textContent).toMatch(/same instructor/i);
    expect(screen.queryByText('OS-OUTRO')).not.toBeInTheDocument();
  });

  it('prévia conta marcações e texto pulado; aplicar copia só os TRUE da origem', () => {
    const { onApply } = openPopover();
    fireEvent.click(screen.getByRole('button', { name: /OS-TWIN/ }));
    expect(screen.getByText(/2 marking\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/text skipped \(1\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [nextRow, summary] = onApply.mock.calls[0];
    expect(nextRow[IDX_TILT].value).toBe('TRUE');
    expect(nextRow[IDX_OVER].value).toBe('TRUE');
    expect(nextRow[IDX_COMMENT].value).toBe(''); // texto livre fora por padrão
    expect(summary.sourceLabel).toBe('OS-TWIN');
  });

  it('checkbox de texto livre entra no plano quando marcado', () => {
    const { onApply } = openPopover();
    fireEvent.click(screen.getByRole('button', { name: /OS-TWIN/ }));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText(/3 marking\(s\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    const [nextRow] = onApply.mock.calls[0];
    expect(nextRow[IDX_COMMENT].value).toBe('áudio baixo');
  });

  it('origem desmarcada não apaga destino: TRUE já presente vira "already equal"', () => {
    const markedTarget = mkRow({ 0: 'OS-CUR', 1: 'Prof X', 2: '2026-08-25', 3: 'Studio A', 4: 'TRUE' });
    openPopover('en', { targetRow: markedTarget });
    fireEvent.click(screen.getByRole('button', { name: /OS-TWIN/ }));
    expect(screen.getByText(/1 already equal/)).toBeInTheDocument();
  });

  it('sem gêmeas: mensagem honesta de vazio', () => {
    openPopover('en', { rows: [ROWS[0], { rowIndex: 12, row: UNRELATED }] });
    expect(screen.getByText(/no twin w\.o\. found/i)).toBeInTheDocument();
  });

  it('planilha sem colunas de marcação: aviso de incompatível e botão desabilitado', () => {
    const shortHeaders = ['W.O.', 'INSTRUCTOR', 'DATE', 'STUDIO'];
    const { onApply } = openPopover('en', { headers: shortHeaders });
    fireEvent.click(screen.getByRole('button', { name: /OS-TWIN/ }));
    expect(screen.getByText(/none of the marking columns/i)).toBeInTheDocument();
    const applyBtn = screen.getByRole('button', { name: /^copy$/i }) as HTMLButtonElement;
    expect(applyBtn).toBeDisabled();
    fireEvent.click(applyBtn);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('paridade PT: título e motivos traduzidos', () => {
    openPopover('pt');
    expect(screen.getByText(/copiar marcações de outra o\.s\./i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /OS-TWIN/ }));
    expect(screen.getByText(/mesmo professor/i)).toBeInTheDocument();
  });
});

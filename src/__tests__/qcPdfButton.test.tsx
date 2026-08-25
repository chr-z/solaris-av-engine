// Solaris v3 — F6 troca #2 (pdfmake): wiring do QCExportButton com fallback.
// O chunk do pdfmake é mockado: provamos a WIRING (PDF baixado com nome
// sugerido) e o CONTRATO de fallback (chunk falhou → relatório HTML rico
// do S4.1 é baixado, aviso visível, "Download again" continua funcionando).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QCExportButton } from '../components/Analysis/QCExportButton';
import { exportQCReportPdf } from '../utils/qcPdf';

vi.mock('../utils/qcPdf', () => ({
  exportQCReportPdf: vi.fn(),
  suggestedQCFileName: vi.fn(() => 'solar-qc-report-2026-08-25.pdf'),
}));

const mockedExport = exportQCReportPdf as unknown as ReturnType<typeof vi.fn>;

interface CapturedDownload {
  href: string;
  download: string;
  text: string | null;
}

describe('F6 QCExportButton — PDF lazy com fallback HTML permanente', () => {
  const downloads: CapturedDownload[] = [];
  let originalCreateObjectURL: unknown;
  let originalRevokeObjectURL: unknown;
  let originalAnchorClick: unknown;

  beforeEach(() => {
    cleanup();
    downloads.length = 0;
    mockedExport.mockReset();
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () =>
      'blob:mock-url';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clicked(this: HTMLAnchorElement) {
      downloads.push({
        href: this.href,
        download: this.download,
        text: null,
      });
    };
  });

  afterEach(() => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL =
      originalCreateObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
      originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick as typeof HTMLAnchorElement.prototype.click;
  });

  it('baixa o PDF com nome sugerido quando o chunk carrega', async () => {
    mockedExport.mockResolvedValue(
      new Blob(['%PDF-1.7 fake-for-test'], { type: 'application/pdf' })
    );
    render(<QCExportButton />);
    fireEvent.click(screen.getByRole('button', { name: /Export QC Report/i }));
    expect(await screen.findByText('Report exported')).toBeTruthy();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].download).toBe('solar-qc-report-2026-08-25.pdf');
    // sem aviso de fallback no caminho feliz
    expect(screen.queryByText(/PDF engine unavailable/i)).toBeNull();
  });

  it('fallback: chunk falhou → relatório HTML rico baixado + aviso visível', async () => {
    mockedExport.mockRejectedValue(new Error('pdfmake chunk failed to load'));
    render(<QCExportButton />);
    fireEvent.click(screen.getByRole('button', { name: /Export QC Report/i }));
    expect(await screen.findByText('Report exported')).toBeTruthy();
    expect(await screen.findByText(/PDF engine unavailable/i)).toBeTruthy();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].download.endsWith('.html')).toBe(true);
  });

  it('"Download again" re-baixa o último artefato (modo fallback)', async () => {
    mockedExport.mockRejectedValue(new Error('offline'));
    render(<QCExportButton />);
    fireEvent.click(screen.getByRole('button', { name: /Export QC Report/i }));
    await screen.findByText('Report exported');
    downloads.length = 0;
    fireEvent.click(screen.getByRole('button', { name: /Download again/i }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].download.endsWith('.html')).toBe(true);
  });

  it('botão fica desabilitado enquanto gera (evita duplo clique)', async () => {
    let resolvePdf!: (b: Blob) => void;
    mockedExport.mockReturnValue(
      new Promise<Blob>((resolve) => {
        resolvePdf = resolve;
      })
    );
    render(<QCExportButton />);
    const btn = screen.getByRole('button', { name: /Export QC Report/i });
    fireEvent.click(btn);
    // o clique dispara re-render: re-consulta o nó atual pelo label "Generating…"
    const generatingLabel = await screen.findByText('Generating…');
    const liveBtn = generatingLabel.closest('button') as HTMLButtonElement;
    expect(liveBtn.disabled).toBe(true);
    resolvePdf(new Blob(['%PDF-ok'], { type: 'application/pdf' }));
    expect(await screen.findByText('Report exported')).toBeTruthy();
  });
});

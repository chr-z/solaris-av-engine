/**
 * Testes do desktopBridge — ponte front ⇄ core Tauri.
 *
 * Estratégia: injetamos um `window.__TAURI_INTERNALS__` falso com `invoke`
 * stubado e verificamos roteamento de comando + serialização de argumentos.
 * Sem o stub, a ponte DEVE resolver indisponível (web/testes = null).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isDesktopBridgeAvailable,
  pickDesktopFolder,
  scanAlfredDesktop,
  saveLastReportDesktop,
  loadLastReportDesktop,
} from '../services/desktopBridge';

type InvokeImpl = (cmd: string, args?: unknown) => Promise<unknown>;

const W = window as unknown as { __TAURI_INTERNALS__?: unknown };

function installBridge(impl: InvokeImpl) {
  let lastCmd = '';
  let lastArgs: unknown;
  W.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args?: unknown) => {
      lastCmd = cmd;
      lastArgs = args;
      return impl(cmd, args);
    },
  };
  return {
    lastCall: () => ({ cmd: lastCmd, args: lastArgs }),
  };
}

describe('desktopBridge', () => {
  beforeEach(() => {
    delete W.__TAURI_INTERNALS__;
  });
  afterEach(() => {
    delete W.__TAURI_INTERNALS__;
  });

  it('sem runtime Tauri → indisponível e comandos devolvem null', async () => {
    expect(isDesktopBridgeAvailable()).toBe(false);
    await expect(pickDesktopFolder('t', 'd:\\x')).resolves.toBe(null);
    await expect(
      scanAlfredDesktop('d:\\alfred', { maxDepth: 4 }),
    ).resolves.toBe(null);
  });

  it('pickDesktopFolder roteia pick_folder_command e propaga cancelamento', async () => {
    const bridge = installBridge(() => Promise.resolve({ path: null }));
    await expect(pickDesktopFolder('Escolha a RAIZ_ALFRED')).resolves.toBe(null);
    expect(bridge.lastCall().cmd).toBe('pick_folder_command');
    expect(bridge.lastCall().args).toEqual({ title: 'Escolha a RAIZ_ALFRED', startPath: null });

    installBridge(() => Promise.resolve({ path: 'D:\\Alfred\\Producao' }));
    await expect(pickDesktopFolder()).resolves.toBe('D:\\Alfred\\Producao');
  });

  it('scanAlfredDesktop empacota ScanRequest em args.req (camelCase pro serde)', async () => {
    const bridge = installBridge(() =>
      Promise.resolve({
        report: { root: 'X', scanned_dirs: 3, skipped_permission_errors: 0, oss: [], orphan_groups: [], window_matches: [] },
      }),
    );
    const rep = await scanAlfredDesktop('X', {
      maxDepth: 5,
      declaredOsPaths: ['\\\\ALFRED\\c1'],
    });
    expect(rep?.scanned_dirs).toBe(3);
    expect(bridge.lastCall().cmd).toBe('scan_alfred_command');
    expect(bridge.lastCall().args).toEqual({
      req: { root: 'X', maxDepth: 5, declaredOsPaths: ['\\\\ALFRED\\c1'] },
    });
  });

  it('rejeição do IPC → null (nunca estoura no chamador)', async () => {
    installBridge(() => Promise.reject(new Error('boom')));
    await expect(scanAlfredDesktop('d:\\a')).resolves.toBe(null);
    await expect(pickDesktopFolder()).resolves.toBe(null);
    expect(isDesktopBridgeAvailable()).toBe(true);
  });

  it('saveLastReportDesktop empacota req.report e resolve false sem ponte', async () => {
    // Sem ponte: false, sem estourar.
    await expect(
      saveLastReportDesktop({
        root: 'X',
        scanned_dirs: 1,
        skipped_permission_errors: 0,
        oss: [],
        orphan_groups: [],
        window_matches: [],
      }),
    ).resolves.toBe(false);

    const report = {
      root: 'X',
      scanned_dirs: 7,
      skipped_permission_errors: 0,
      oss: [],
      orphan_groups: [],
      window_matches: [],
    };
    const bridge = installBridge(() => Promise.resolve({}));
    await expect(saveLastReportDesktop(report)).resolves.toBe(true);
    expect(bridge.lastCall().cmd).toBe('save_last_report_command');
    expect(bridge.lastCall().args).toEqual({ req: { report } });
  });

  it('loadLastReportDesktop devolve {report, scannedAt} e null em falha', async () => {
    // Sem ponte ⇒ null.
    await expect(loadLastReportDesktop()).resolves.toBe(null);

    const saved = {
      root: 'X',
      scanned_dirs: 3,
      skipped_permission_errors: 1,
      oss: [],
      orphan_groups: [],
      window_matches: [],
    };
    installBridge(() =>
      Promise.resolve({ report: saved, scannedAt: '2026-08-24 23:10:00' }),
    );
    await expect(loadLastReportDesktop()).resolves.toEqual({
      report: saved,
      scannedAt: '2026-08-24 23:10:00',
    });

    // IPC rejeita ⇒ null (nunca estoura).
    installBridge(() => Promise.reject(new Error('boom')));
    await expect(loadLastReportDesktop()).resolves.toBe(null);

    // Banco ainda vazio ⇒ relatório null.
    installBridge(() => Promise.resolve({ report: null, scannedAt: null }));
    await expect(loadLastReportDesktop()).resolves.toEqual({
      report: null,
      scannedAt: null,
    });
  });
});

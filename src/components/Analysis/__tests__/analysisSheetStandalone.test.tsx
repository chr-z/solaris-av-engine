/**
 * P3 standalone: a lista de W.O. não pode tocar nuvem quando o modo efetivo
 * é standalone (desktop Tauri / on-premise).
 *
 * Regressão do bug achado pelo probe E2E dentro do exe empacotado: em
 * standalone o boot caía no fluxo ADMIN (`/api/get-sheets-data` com
 * idToken inexistente) e a primeira tela exibia
 * "Sync Error: Session expired. Please sign in again." num app que não
 * possui sign-in nem nuvem.
 *
 * Cobre AnalysisSheetList + fetchFullRowData:
 *   1. cloud: fluxo real preservado (chama /api e reflete falha como Sync
 *      Error — comportamento pré-existente intocado);
 *   2. standalone: boot sem rede, lista pronta, ZERO "Sync Error";
 *   3. standalone: clique na linha dispara onRowSelected (seleção local
 *      vive, sem lock RTDB nem fetch);
 *   4. standalone: fetchFullRowData rejeita com StandaloneRowError antes
 *      de qualquer token/rede.
 *
 * Sem @testing-library no projeto: usa react-dom/client (createRoot) + act.
 * O módulo firebase é mockado SOMENTE aqui para tornar a perna cloud
 * determinística (auth.currentUser=null reproduz o cenário original sem rede).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AnalysisSheetList, {
    fetchFullRowData,
    StandaloneRowError,
} from '../AnalysisSheet';
import type { RowWithSheetIndex } from '../AnalysisSheet';
import { I18nProvider } from '../../../i18n/I18nContext';
import {
    getRuntimeMode,
    setRuntimeModeOverride,
} from '../../../config/runtimeMode';

const authState: { currentUser: { getIdToken: () => Promise<string> } | null } = {
    currentUser: null,
};

vi.mock('../../../config/firebase', () => ({
    database: {
        ref: () => ({ on: () => {}, off: () => {}, set: () => Promise.resolve() }),
        goOffline: () => {},
        goOnline: () => {},
    },
    auth: {
        get currentUser() {
            return authState.currentUser;
        },
    },
}));

const HEADERS = ['W.O.', 'INSTRUCTOR', 'DATE', 'STUDIO', 'FINAL SCORE'];

function rowWithIndex(rowIndex: number, wo: string): RowWithSheetIndex {
    return {
        rowIndex,
        row: [
            { value: wo },
            { value: 'Doe' },
            { value: '2026-08-25' },
            { value: 'Studio A' },
            { value: '' },
        ],
    };
}

const PENDING = [rowWithIndex(2, 'WO-002'), rowWithIndex(5, 'WO-005')];

let root: Root | null = null;
let lastSelection: unknown[] | null = null;

function mountSheet(): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const props = {
        onRowSelected: (...args: unknown[]) => {
            lastSelection = args;
        },
        onDataLoaded: () => {},
        selectedOsIndex: null,
        userProfile: {
            id: 'local-reviewer',
            name: 'Revisor Local',
            givenName: 'Revisor',
            picture: '',
            email: 'revisor@local.solaris',
        },
        headers: HEADERS,
        filteredPendingRows: PENDING,
        filteredCompletedRows: [],
        filteredSpecialRows: [],
        searchTerm: '',
        setSearchTerm: () => {},
        filters: { startDate: '', endDate: '', inconformities: [], studio: '' },
        setFilters: () => {},
    } as never;
    act(() => {
        root!.render(
            React.createElement(I18nProvider, null, React.createElement(AnalysisSheetList, props)),
        );
    });
}

function unmount(): void {
    if (root) {
        act(() => {
            root!.unmount();
        });
        root = null;
    }
    document.body.innerHTML = '';
    lastSelection = null;
}

describe('AnalysisSheetList — sync de nuvem por modo de runtime', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        setRuntimeModeOverride(null);
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        unmount();
        vi.unstubAllGlobals();
    });

    it('modo default (cloud): boot mantém o fluxo real de sync e reflete falha como Sync Error', async () => {
        expect(getRuntimeMode()).toBe('cloud');
        // Sessão Google ativa (fluxo real pós-login).
        authState.currentUser = { getIdToken: async () => 'tok-test' };
        fetchMock.mockResolvedValue({
            ok: false,
            statusText: 'Unauthorized',
            json: async () => ({ error: 'Request failed: Unauthorized' }),
        } as Response);

        await act(async () => {
            mountSheet();
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toContain('/api/get-sheets-data');
        expect(document.body.textContent).toContain('Sync Error');
    });

    it('standalone: boot sem rede — lista nasce pronta, zero fetch, zero Sync Error', async () => {
        setRuntimeModeOverride('standalone');

        await act(async () => {
            mountSheet();
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(getRuntimeMode()).toBe('standalone');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toContain('Sync Error');
        expect(document.body.textContent).not.toContain('Session expired');

        // As duas W.O. locais aparecem renderizadas.
        const text = document.body.textContent || '';
        expect(text).toContain('WO-002');
        expect(text).toContain('WO-005');
    });

    it('standalone: clique na linha dispara seleção local via onRowSelected', async () => {
        setRuntimeModeOverride('standalone');

        await act(async () => {
            mountSheet();
        });

        const firstRow = document.querySelector('li');
        expect(firstRow).not.toBeNull();
        await act(async () => {
            firstRow!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(lastSelection).not.toBeNull();
        const [rowIndex] = lastSelection as [number, unknown];
        expect(rowIndex).toBe(2);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('standalone: fetchFullRowData rejeita com StandaloneRowError antes de token/rede', async () => {
        setRuntimeModeOverride('standalone');

        await expect(fetchFullRowData(7)).rejects.toBeInstanceOf(StandaloneRowError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

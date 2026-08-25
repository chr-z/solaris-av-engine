/**
 * P3 standalone: a UI não pode oferecer fontes nem affordances de nuvem num
 * build sem nuvem.
 *
 * Cobre SourceSelector + OnlineUsers nos DOIS modos:
 *   1. standalone SourceSelector: só a aba Local existe (sem YouTube, sem
 *      Google Drive) — o Google Picker fica inalcançável;
 *   2. cloud SourceSelector: as três abas continuam lá (comportamento
 *      pré-existente travado por teste);
 *   3. standalone OnlineUsers: componente some da tela e NENHUM listener de
 *      presença RTDB é registrado (`database.ref` nunca chamado);
 *   4. cloud OnlineUsers: fluxo real preservado (listener registrado em
 *      `presence`).
 *
 * Sem @testing-library no projeto: usa react-dom/client (createRoot) + act,
 * mesmo harness de analysisSheetStandalone.test.tsx. O modo efetivo é
 * controlado pelo override de localStorage (runtimeMode).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import SourceSelector from '../SourceSelector';
import OnlineUsers from '../../Layout/OnlineUsers';
import { I18nProvider } from '../../../i18n/I18nContext';
import {
    setRuntimeModeOverride,
} from '../../../config/runtimeMode';

const refCalls: string[] = [];

vi.mock('../../../config/firebase', () => ({
    database: {
        ref: (path: string) => {
            refCalls.push(path);
            return {
                on: () => undefined,
                off: () => undefined,
                set: () => Promise.resolve(),
            };
        },
        goOffline: () => undefined,
        goOnline: () => undefined,
    },
}));

// OnlineUsers importa firebase/compat/app só para TIPOS (DataSnapshot), mas o
// import é de runtime — mock mínimo pra manter a suíte determinística e sem
// tocar no SDK real.
vi.mock('firebase/compat/app', () => ({ default: {} }));

function renderNode(node: React.ReactElement): {
    container: HTMLDivElement;
    root: Root;
} {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<I18nProvider>{node}</I18nProvider>);
    });
    return { container, root };
}

let mounted: { container: HTMLDivElement; root: Root } | null = null;

function mount(node: React.ReactElement): HTMLDivElement {
    mounted = renderNode(node);
    return mounted.container;
}

afterEach(() => {
    if (mounted) {
        act(() => {
            mounted!.root.unmount();
        });
        mounted.container.remove();
        mounted = null;
    }
});

beforeEach(() => {
    setRuntimeModeOverride(null);
    refCalls.length = 0;
});

describe('SourceSelector — P3 standalone UI gates', () => {
    it('standalone: mostra SOMENTE a aba Local (zero YouTube / zero Drive)', () => {
        setRuntimeModeOverride('standalone');
        const el = mount(<SourceSelector onSourceSelected={() => undefined} />);

        const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map(
            (b) => b.textContent ?? '',
        );
        expect(tabs).toEqual(['Local File']);

        // Affordance local presente; nada de Drive/YouTube em lugar nenhum.
        expect(el.textContent).toContain('Select Local File');
        expect(el.textContent).not.toContain('Google Drive');
        expect(el.textContent).not.toContain('YouTube');
    });

    it('cloud: mantém as três abas (Local, YouTube, Drive)', () => {
        setRuntimeModeOverride('cloud');
        const el = mount(<SourceSelector onSourceSelected={() => undefined} />);

        const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map(
            (b) => b.textContent ?? '',
        );
        expect(tabs).toEqual(['Local File', 'YouTube', 'Google Drive']);
    });
});

describe('OnlineUsers — P3 standalone UI gates', () => {
    it('standalone: não renderiza nada e não registra listener RTDB', async () => {
        setRuntimeModeOverride('standalone');
        const el = mount(<OnlineUsers />);

        // Deixa microtasks fluírem — se algum listener fosse registrado,
        // refCalls já teria sido populado aqui.
        await act(async () => {
            await Promise.resolve();
        });

        expect(el.textContent).toBe('');
        expect(refCalls).toEqual([]);
    });

    it('cloud: registra o listener de presença como sempre', async () => {
        setRuntimeModeOverride('cloud');
        mount(<OnlineUsers />);

        await act(async () => {
            await Promise.resolve();
        });

        expect(refCalls).toContain('presence');
    });
});

/**
 * P3 standalone: a UI não pode expor affordances de nuvem quando o modo
 * efetivo é standalone (desktop Tauri / on-premise).
 *
 * Cobre AnalysisForm — o ponto onde os links da planilha (Drive/YouTube)
 * viram <a> clicáveis e onde vive o botão "Open Drive Folder" do campo FOLDER:
 *   1. cloud: link renderiza como <a href>;
 *   2. standalone: mesma célula com link renderiza texto puro (sem <a>);
 *   3. FOLDER com link Drive em standalone cai no input de texto genérico,
 *      sem botão/ícone do Google Drive;
 *   4. override via localStorage (`solaris.runtimeMode`) é respeitado.
 *
 * Sem @testing-library no projeto: usa react-dom/client (createRoot) + act.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AnalysisForm from '../AnalysisForm';
import type { CellData } from '../../../types';
import {
    getRuntimeMode,
    setRuntimeModeOverride,
} from '../../../config/runtimeMode';

// O campo FOLDER (e seu botão do Drive) só renderiza se estiver listado em
// formSections; a planilha real não o inclui na aba default. Mockamos aqui
// APENAS para exercitar o gate standalone do botão — produção intocada.
vi.mock('../../../utils/constants', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../../../utils/constants')
    >();
    return {
        ...actual,
        formSections: {
            ...actual.formSections,
            'General Info': [...actual.formSections['General Info'], 'FOLDER'],
        },
    };
});

function cell(value: string, link?: string): CellData {
    return link ? { value, link } : { value };
}

const HEADERS = ['W.O.', 'INSTRUCTOR', 'FOLDER'];

/** Linha com link de planilha no W.O. e link de Drive no FOLDER. */
const ROW: CellData[] = [
    cell('WO-001', 'https://docs.google.com/spreadsheets/d/x/edit#gid=0'),
    cell('Doe'),
    cell('https://drive.google.com/drive/folders/ABC123'),
];

let root: Root | null = null;

function mount() {
    const props = {
        selectedRow: ROW,
        headers: HEADERS,
        onDataChange: () => {},
        onOpenPicker: () => {},
        isLocalVideo: true,
        localFilePath: '',
        onLocalFilePathChange: () => {},
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(React.createElement(AnalysisForm, props));
    });
}

function unmount() {
    if (root) {
        act(() => {
            root!.unmount();
        });
        root = null;
    }
    document.body.innerHTML = '';
}

describe('AnalysisForm — affordances de nuvem por modo de runtime', () => {
    beforeEach(() => {
        setRuntimeModeOverride(null);
        document.body.innerHTML = '';
    });
    afterEach(unmount);

    it('modo default (cloud): campo com link da planilha vira <a> clicável e Drive disponível', () => {
        expect(getRuntimeMode()).toBe('cloud');
        mount();
        const links = document.querySelectorAll('a[href]');
        expect(links.length).toBeGreaterThan(0);
        expect(links[0].getAttribute('href')).toContain('spreadsheets');
        expect(document.querySelector('button[aria-label="Open Google Drive Picker"]')).not.toBeNull();
    });

    it('standalone: mesma linha não tem <a> de planilha nem botão do Drive', () => {
        setRuntimeModeOverride('standalone');
        mount();
        expect(document.querySelectorAll('a[href]').length).toBe(0);
        expect(document.querySelector('button[aria-label="Open Google Drive Picker"]')).toBeNull();
    });

    it('standalone: campo FOLDER com link Drive cai no fallback de texto sem ícone do Drive', () => {
        setRuntimeModeOverride('standalone');
        mount();
        // O valor da pasta continua visível como campo somente-leitura…
        const folderInput = document.getElementById('FOLDER') as HTMLInputElement | null;
        expect(folderInput).not.toBeNull();
        expect(folderInput!.value).toBe('https://drive.google.com/drive/folders/ABC123');
        // …mas nenhum botão/ícone do Google Drive é renderizado.
        expect(document.querySelector('button[aria-label="Open Google Drive Picker"]')).toBeNull();
        // Ícones restantes são apenas os de tooltip (InfoIcon), sem link.
        expect(document.querySelectorAll('a[href]').length).toBe(0);
    });

    it('override localStorage muda o modo efetivo entre montagens', () => {
        setRuntimeModeOverride('cloud');
        mount();
        expect(getRuntimeMode()).toBe('cloud');
        expect(document.querySelector('a[href]')).not.toBeNull();
        unmount();

        setRuntimeModeOverride('standalone');
        mount();
        expect(getRuntimeMode()).toBe('standalone');
        expect(document.querySelector('a[href]')).toBeNull();
    });
});

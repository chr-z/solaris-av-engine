import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// O save tem que falhar de forma DETERMINÍSTICA (rede real do RTDB fica
// pendurada em demo/dummy). Mock do módulo na fronteira do componente.
vi.mock('../../../config/firebase', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../config/firebase')>();
    return {
        ...actual,
        getDb: vi.fn(() => Promise.reject(new Error('Missing or insufficient permissions'))),
        getFirebaseCompat: vi.fn(() => Promise.reject(new Error('Missing or insufficient permissions'))),
        isFirebaseConfigured: vi.fn(() => true),
    };
});

import { I18nProvider } from '../../../i18n/I18nContext';
import { TimestampModal } from '../AnalysisWorkspace';

const userProfile = {
    id: 'u1', name: 'Analista Um', givenName: 'Analista',
    picture: '', email: 'analista@solaris.demo',
};

const videoStub = {
    currentTime: 42,
    pause: () => {},
} as unknown as HTMLVideoElement;

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Seta valor via setter nativo + evento input (mesma técnica do E2E). */
function typeInto(el: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value',
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('TimestampModal — erro humano ao salvar marcador (spec v3)', () => {
    let container: HTMLDivElement;
    // O modal renderiza via createPortal(document.body): guardar o root pra
    // desmontar entre testes e consultar o DOCUMENT (não o container).
    let activeRoot: { unmount: () => void } | null = null;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(window.console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        if (activeRoot) {
            act(() => activeRoot!.unmount());
            activeRoot = null;
        }
        vi.restoreAllMocks();
        container.remove();
    });

    const q = <T extends Element = Element>(sel: string) =>
        document.querySelector(sel) as T | null;

    async function openAndType(comment: string) {
        const root = createRoot(container);
        await act(async () => {
            root.render(
                <I18nProvider>
                    <TimestampModal
                        isOpen
                        onClose={() => {}}
                        videoRef={{ current: videoStub }}
                        selectedOsIndex={1}
                        userProfile={userProfile}
                        currentVideoId="video-demo-1"
                        currentVideoName="Demo.mp4"
                    />
                </I18nProvider>,
            );
        });
        activeRoot = root;
        const ta = q<HTMLTextAreaElement>('textarea.input');
        expect(ta).toBeTruthy();
        await act(async () => {
            typeInto(ta!, comment);
        });
        return root;
    }

    it('mostra banner role=alert com mensagem humana quando o save falha', async () => {
        await openAndType('verificar ruído');
        const btn = [...document.querySelectorAll('button')]
            .find((b) => b.textContent?.includes('Add Marker')) as HTMLButtonElement;
        expect(btn.disabled).toBe(false);

        await act(async () => {
            btn.click();
            await flush();
            await flush();
        });

        const banner = q('[role="alert"]');
        expect(banner).toBeTruthy();
        const text = banner!.textContent || '';
        // mensagem humana, não crua
        expect(text).toMatch(/didn't save|still here/i);
        expect(text.toLowerCase()).not.toContain('missing or insufficient');
        expect(text.toLowerCase()).not.toContain('permission');
    });

    it('preserva o comentário digitado após a falha (promessa do hint)', async () => {
        await openAndType('comentário importante');
        const btn = [...document.querySelectorAll('button')]
            .find((b) => b.textContent?.includes('Add Marker')) as HTMLButtonElement;

        await act(async () => {
            btn.click();
            await flush();
            await flush();
        });

        const ta = q<HTMLTextAreaElement>('textarea.input');
        expect(ta!.value).toBe('comentário importante');
    });

    it('nunca dispara window.alert cru (fluxo inteiro)', async () => {
        await openAndType('qualquer coisa');
        const btn = [...document.querySelectorAll('button')]
            .find((b) => b.textContent?.includes('Add Marker')) as HTMLButtonElement;

        await act(async () => {
            btn.click();
            await flush();
            await flush();
        });

        expect(window.alert).not.toHaveBeenCalled();
    });
});

// Solaris v3 (R3) — erros humanos.
//
// Regra da spec: "Estados de erro humanos ... nunca raw error". Mensagens
// técnicas de rede/player viram frases curtas, na voz do produto, com uma
// ação sugerida. Nunca expõem stack, URL ou nome de exceção.

export interface HumanError {
    /** Frase principal (o que aconteceu). */
    title: string;
    /** O que fazer agora. */
    hint: string;
}

type ErrorInput = string | null | undefined;

/**
 * Mapeia mensagens cruas para versões humanas.
 * A correspondência é por palavra-chave (lowercase), tolerante a variações
 * das mensagens que o próprio app produz (App.tsx / VideoPlayer).
 */
export function humanizeError(raw: ErrorInput): HumanError {
    const msg = (raw || '').toLowerCase();

    if (!msg.trim()) {
        return {
            title: 'Something went wrong while loading the media.',
            hint: 'Try again — if it persists, pick another source.',
        };
    }

    if (msg.includes('private')) {
        return {
            title: 'That video is private.',
            hint: 'Try a public link instead.',
        };
    }

    if (
        msg.includes('authentication') ||
        msg.includes('sign in') ||
        msg.includes('session expired') ||
        msg.includes('not authenticated')
    ) {
        return {
            title: 'We need your Google sign-in for this one.',
            hint: 'Sign in and load it again — or test with a YouTube link.',
        };
    }

    if (msg.includes('drive') && !msg.includes('folder')) {
        return {
            title: 'This Drive video could not be opened.',
            hint: 'Check sharing permissions ("Anyone with the link") and try again.',
        };
    }

    if (
        msg.includes('network') ||
        msg.includes('fetch') ||
        msg.includes('failed to') ||
        msg.includes('timeout')
    ) {
        return {
            title: 'The connection dropped.',
            hint: 'Check your internet and hit retry.',
        };
    }

    if (msg.includes('format') || msg.includes('decode') || msg.includes('unsupported')) {
        return {
            title: 'This file format is not supported.',
            hint: 'Export it as MP4 (H.264) and try again.',
        };
    }

    // Fallback: nunca devolver a mensagem crua.
    return {
        title: 'Something went wrong while loading the media.',
        hint: 'Hit retry — if it keeps failing, try another source.',
    };
}

/**
 * Mensagem humana para falha de salvamento (Ctrl+S / botão Save).
 * Mantém a causa curta; nada de stack.
 */
export function humanizeSaveError(raw?: string): HumanError {
    const msg = (raw || '').toLowerCase();
    if (msg.includes('permission') || msg.includes('403') || msg.includes('lock')) {
        return {
            title: "The sheet didn't allow this edit.",
            hint: 'Ask an editor to review your access — your work stays on screen.',
        };
    }
    return {
        title: "The save didn't go through.",
        hint: 'Your changes are still here — check the connection and save again.',
    };
}

/**
 * Erro humano para a tela de login (popup fechado, rede, popup bloqueado…).
 * Nunca devolve a mensagem crua do provider; sempre oferece um caminho
 * (tentar de novo / entrar como visitante na demo).
 */
export function humanizeAuthError(raw?: string | null): HumanError {
    const msg = (raw || '').toLowerCase();
    if (
        msg.includes('popup') && msg.includes('clos') ||
        msg.includes('cancelled') ||
        msg.includes('canceled')
    ) {
        return {
            title: 'The sign-in window was closed before finishing.',
            hint: 'No problem — try signing in again when you are ready.',
        };
    }
    if (
        msg.includes('popup blocked') ||
        msg.includes('blocked')
    ) {
        return {
            title: 'Your browser blocked the sign-in window.',
            hint: 'Allow popups for this site and sign in again.',
        };
    }
    if (
        msg.includes('network') ||
        msg.includes('fetch') ||
        msg.includes('timeout') ||
        msg.includes('failed to')
    ) {
        return {
            title: 'We could not reach Google right now.',
            hint: 'Check your connection and try again in a few seconds.',
        };
    }
    if (
        msg.includes('unauthorized domain') ||
        msg.includes('domain') ||
        msg.includes('configuration') ||
        msg.includes('operation not allowed')
    ) {
        return {
            title: 'This sign-in method is not available here yet.',
            hint: 'Continue as guest to explore the demo while access is set up.',
        };
    }
    // Fallback: nunca a mensagem crua do provider.
    return {
        title: 'We could not sign you in.',
        hint: "Google didn't complete the sign-in. Wait a few seconds and try again — or continue as guest.",
    };
}

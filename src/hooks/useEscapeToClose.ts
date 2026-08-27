import { useEffect } from 'react';

/**
 * v3: fecha o modal ativo com Escape — mesmo contrato do ShortcutHelpModal
 * e do zoom dos monitores. Sem comportamento novo visível além do gesto.
 */
export function useEscapeToClose(active: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!active) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [active, onClose]);
}

// Solaris v3 — Feature Pack "Analista Feliz" — F2 QoL Core.
//
// Modal da busca universal (Ctrl+K). Casca fina sobre o CommandIndex puro:
// input com resultados ao vivo, navegação por setas, Enter abre, Esc fecha.
// Estilo consistente com o ShortcutHelpModal (backdrop blur + painel central).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CommandIndex,
  type IndexedDoc,
  type ScoredResult,
} from '../../features/qol/commandPalette';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Documentos indexáveis (OSs, analistas, estúdios, settings). */
  docs: readonly IndexedDoc[];
  /** Ação ao confirmar um resultado. */
  onPick: (result: ScoredResult) => void;
  /** Rótulos de seção por tipo (já traduzidos). */
  kindLabels: Record<string, string>;
}

const KIND_ORDER = ['os', 'analyst', 'studio', 'setting'] as const;

export default function CommandPaletteModal({
  isOpen,
  onClose,
  docs,
  onPick,
  kindLabels,
}: CommandPaletteModalProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => new CommandIndex(docs), [docs]);
  const results = useMemo(() => index.search(query, 12), [index, query]);

  // Reset a cada abertura + foco no campo.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIdx(0);
      // foco após a montagem do portal
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const move = (delta: number) => {
    setActiveIdx((cur) => {
      if (results.length === 0) return 0;
      return (cur + delta + results.length) % results.length;
    });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const r = results[activeIdx];
      if (r) {
        onClose();
        onPick(r);
      }
    }
  };

  // Agrupa mantendo a ordem global de score dentro de cada tipo.
  const grouped: Array<{ kind: string; items: Array<ScoredResult>; start: number }> = [];
  {
    let cursor = 0;
    for (const kind of KIND_ORDER) {
      const items = results.filter((r) => r.entry.kind === kind);
      if (items.length > 0) {
        grouped.push({ kind, items, start: cursor });
        cursor += items.length;
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={kindLabels.palette ?? 'Search'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[560px] max-w-[92vw] rounded-xl overflow-hidden border border-solar-light-border dark:border-solar-dark-border bg-solar-light-content dark:bg-solar-dark-content shadow-2xl">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={kindLabels.placeholder ?? '…'}
          className="w-full px-4 py-3 text-sm bg-transparent border-b border-solar-light-border dark:border-solar-dark-border text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
          aria-label={kindLabels.placeholder ?? 'Search'}
          autoComplete="off"
          spellCheck={false}
        />
        <ul className="max-h-[46vh] overflow-y-auto py-1" role="listbox">
          {query.trim() !== '' && results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-400">{kindLabels.empty ?? '—'}</li>
          )}
          {grouped.map((group) => (
            <li key={group.kind} className="px-1">
              <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {kindLabels[group.kind] ?? group.kind}
              </p>
              <ul>
                {group.items.map((r) => {
                  const flatIdx = group.start + group.items.indexOf(r);
                  const active = flatIdx === activeIdx;
                  return (
                    <li key={r.entry.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIdx(flatIdx)}
                        onClick={() => {
                          onClose();
                          onPick(r);
                        }}
                        className={`w-full flex items-baseline justify-between gap-3 px-3 py-1.5 rounded-md text-left text-sm transition-colors ${
                          active
                            ? 'bg-solar-accent/25 text-solar-accent'
                            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-500/10'
                        }`}
                      >
                        <span className="truncate font-medium">{r.entry.title}</span>
                        {r.entry.subtitle && (
                          <span className="flex-shrink-0 truncate text-xs text-gray-400">{r.entry.subtitle}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2 border-t border-solar-light-border dark:border-solar-dark-border text-[11px] text-gray-400 flex gap-3">
          <span>↑↓</span><span>Enter</span><span>Esc</span>
        </div>
      </div>
    </div>
  );
}

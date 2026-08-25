// Solaris v3 — F2 QoL Core — busca universal, modo foco e undo 24h.
import { describe, it, expect } from 'vitest';
import {
  CommandIndex,
  groupResultsByKind,
} from '../features/qol/commandPalette';
import {
  focusLayout,
  applyFocusPreferences,
  FOCUS_KEEP_REGIONS,
} from '../features/qol/focusMode';
import {
  UndoLog,
  parseLog,
  UNDO_WINDOW_MS,
} from '../features/qol/undo';

describe('F2 commandPalette — busca universal', () => {
  const idx = new CommandIndex([
    { id: 'os-1', kind: 'os', title: 'OS-1001 · Aula de Piano', subtitle: 'Studio A', keywords: ['1001'] },
    { id: 'os-2', kind: 'os', title: 'OS-1002 · Aula de Canto', subtitle: 'Studio B' },
    { id: 'ana-1', kind: 'analyst', title: 'Ana Souza', keywords: ['ana'] },
    { id: 'st-1', kind: 'studio', title: 'Studio A' },
    { id: 'set-1', kind: 'setting', title: 'Tema claro/escuro', keywords: ['theme', 'tema'] },
  ]);

  it('consulta vazia/branca retorna nada', () => {
    expect(idx.search('')).toEqual([]);
    expect(idx.search('   ')).toEqual([]);
  });

  it('prefixo vence e desempate é título mais curto', () => {
    const r = idx.search('OS-10');
    expect(r.map((x) => x.entry.id)).toEqual(['os-1', 'os-2']);
  });

  it('acha por keyword numérica ("1001" → OS-1001)', () => {
    const r = idx.search('1001');
    expect(r[0].entry.id).toBe('os-1');
  });

  it('match exato > prefixo > substring', () => {
    const exact = new CommandIndex([{ id: 'b', kind: 'analyst', title: 'Bruno Lima' }]);
    expect(exact.search('bruno lima')[0].score).toBe(100);
    // prefixo no início de palavra: 80 + 4 de bônus de word-boundary
    expect(exact.search('bruno')[0].score).toBe(84);
    expect(exact.search('runo')[0].score).toBe(59); // substring no meio
    expect(exact.search('zzz')).toEqual([]);
  });

  it('fuzzy subsequence: dígitos soltos acham a OS', () => {
    const r = idx.search('1002');
    // keyword não existe p/ os-2, mas o título contém como substring/fuzzy
    expect(r[0]?.entry.id ?? null).toBe('os-2');
  });

  it('limit corta o resultado (padrão 8)', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `k${i}`,
      kind: 'os' as const,
      title: `OS-${3000 + i}`,
    }));
    const i3 = new CommandIndex(many);
    expect(i3.search('OS-3').length).toBeLessThanOrEqual(8);
    expect(i3.search('OS-3', 5).length).toBeLessThanOrEqual(5);
  });

  it('setDocs substitui o índice e size reflete', () => {
    const i4 = new CommandIndex();
    expect(i4.size).toBe(0);
    i4.setDocs([{ id: 'x', kind: 'os', title: 'OS-1' }]);
    expect(i4.size).toBe(1);
    expect(i4.search('os-1')[0].entry.id).toBe('x');
  });

  it('groupResultsByKind agrupa preservando resultados', () => {
    const g = groupResultsByKind([
      { entry: { id: 'o', kind: 'os', title: 'O' }, score: 9 },
      { entry: { id: 's', kind: 'setting', title: 'S' }, score: 7 },
      { entry: { id: 'o2', kind: 'os', title: 'O2' }, score: 6 },
    ]);
    expect(g.get('os')?.map((r) => r.entry.id)).toEqual(['o', 'o2']);
    expect(g.get('setting')?.length).toBe(1);
    expect(g.has('analyst')).toBe(false);
  });
});

describe('F2 focusMode — regiões do modo foco', () => {
  it('modo foco preserva exatamente player+timeline', () => {
    const l = focusLayout(true);
    expect([...l.visible].sort()).toEqual([...FOCUS_KEEP_REGIONS].sort());
    expect(l.hidden).toEqual(['header', 'sheetList', 'monitors', 'form']);
  });

  it('modo normal mostra tudo', () => {
    const l = focusLayout(false);
    expect(l.hidden).toHaveLength(0);
    expect(l.visible).toHaveLength(6);
  });

  it('preferência keepMonitors devolve monitores à visível', () => {
    const l = applyFocusPreferences(focusLayout(true), { keepMonitors: true });
    expect(l.visible).toContain('monitors');
    expect(l.hidden).not.toContain('monitors');
  });

  it('sem preferência nada muda', () => {
    const base = focusLayout(true);
    expect(applyFocusPreferences(base, {})).toBe(base);
  });
});

describe('F2 undo — log global 24h', () => {
  const deps = (store: { v: string | null }, now: number) => ({
    read: () => store.v,
    write: (p: string) => {
      store.v = p;
    },
    now: () => now,
  });

  it('record persiste imediatamente e peek devolve o mais recente', () => {
    const store = { v: null as string | null };
    let t = 1_000_000;
    const log = new UndoLog(deps(store, t));
    log.record('assign-os', 'atribuiu OS-1', { osId: 'OS-1' });
    log.record('edit-cell', 'editou linha 3', { rowIndex: 3 });
    expect(log.undoable).toHaveLength(2);
    expect(log.peek()?.kind).toBe('edit-cell'); // topo = última ação
    expect(JSON.parse(store.v!)).toHaveLength(2);
  });

  it('eventos fora da janela de 24h somem do undoable', () => {
    const store = { v: null as string | null };
    const old = Date.now() - UNDO_WINDOW_MS - 60_000;
    const log = new UndoLog(deps(store, old));
    log.record('return-os', 'devolveu OS-9');
    // relógio avança 25h
    const later = new UndoLog(deps(store, old + 25 * 60 * 60 * 1000));
    expect(later.undoable).toHaveLength(0);
    expect(later.peek()).toBeNull();
  });

  it('consume remove o evento revertido e o próximo vira o topo', () => {
    const store = { v: null as string | null };
    let t = 5_000;
    const log = new UndoLog(deps(store, t));
    const e1 = log.record('prioritize-os', 'priorizou OS-2');
    const e2 = log.record('prioritize-os', 'priorizou OS-3');
    log.consume(e2.id);
    expect(log.peek()?.id).toBe(e1.id);
    log.consume(e1.id);
    expect(log.peek()).toBeNull();
  });

  it('appliedIds evita desfazer duas vezes o mesmo evento', () => {
    const store = { v: null as string | null };
    let t = 5_000;
    const log = new UndoLog(deps(store, t));
    const e1 = log.record('assign-os', 'x');
    log.record('assign-os', 'y');
    expect(log.peek(new Set([e1.id]))?.label).toBe('y');
    // tudo já aplicado → nada a fazer
    const all = new Set(log.undoable.map((e) => e.id));
    expect(log.peek(all)).toBeNull();
  });

  it('log corrompido no storage vira lista vazia, nunca lança', () => {
    expect(parseLog('{quebrado')).toEqual([]);
    expect(parseLog('42')).toEqual([]);
    const bad = new UndoLog({ read: () => '{{{', write: () => {} });
    expect(bad.undoable).toHaveLength(0);
  });

  it('eventos com shape inválido são filtrados na leitura', () => {
    const raw = JSON.stringify([
      { id: 'ok', ts: 1, kind: 'assign-os', label: 'x', payload: {} },
      { ts: 2, kind: 'nope' },
      null,
      'string',
    ]);
    const parsed = parseLog(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('ok');
  });

  it('clear esvazia memória e storage', () => {
    const store = { v: null as string | null };
    let t = 5_000;
    const log = new UndoLog(deps(store, t));
    log.record('edit-cell', 'a');
    log.clear();
    expect(log.undoable).toHaveLength(0);
    expect(JSON.parse(store.v!)).toEqual([]);
  });

  it('capacidade máxima mantém só os eventos mais recentes', () => {
    const store = { v: null as string | null };
    let t = 5_000;
    const log = new UndoLog({ ...deps(store, t), maxEvents: 3 });
    for (let i = 0; i < 6; i++) log.record('edit-cell', `e${i}`);
    expect(log.undoable.map((e) => e.label)).toEqual(['e3', 'e4', 'e5']);
  });
});

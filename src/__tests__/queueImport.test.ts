// Solaris v3 — Feature Pack "Analista Feliz" — QoL A3.
// Testes do núcleo de importação/exportação da fila (CSV + validação + undo).
import { describe, expect, it } from 'vitest';
import {
  applyImportInverse,
  buildQueueCsv,
  normalizeQueuePriority,
  normalizeQueueStatus,
  parseCsv,
  parseQueueImport,
  queueExportFilename,
  resolveQueueColumns,
} from '../features/qol/queueImport';
import type { QueueRowLike } from '../features/qol/queue';

const NOW = Date.UTC(2026, 7, 25, 18, 0, 0);

describe('parseCsv (RFC 4180 tolerante)', () => {
  it('quebra linhas simples e descarta linha final vazia', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('aceita campo com vírgula entre aspas e aspas dobradas', () => {
    const grid = parseCsv('"OS-1","Aula ""especial"", parte 2"');
    expect(grid[0]).toEqual(['OS-1', 'Aula "especial", parte 2']);
  });

  it('lida com CRLF e BOM de planilha Windows', () => {
    const grid = parseCsv('\uFEFFos_id,status\r\nOS-9,queued\r\n');
    expect(grid[0][0]).toBe('os_id');
    expect(grid[1]).toEqual(['OS-9', 'queued']);
  });

  it('aspas dentro de campo sem fechar não travam o parser', () => {
    const grid = parseCsv('x\n"a\nb"\n');
    expect(grid[1][0]).toBe('a\nb');
  });
});

describe('mapeamento de cabeçalhos', () => {
  it('resolve colunas EN e PT', () => {
    expect(resolveQueueColumns(['OS', 'Título', 'Prioridade', 'Prazo']).os_id).toBe(0);
    const pt = resolveQueueColumns(['ORDEM DE SERVIÇO', 'SITUAÇÃO', 'RESPONSÁVEL']);
    expect(pt.os_id).toBe(0);
    expect(pt.status).toBe(1);
    expect(pt.assignee).toBe(2);
  });

  it('coluna ausente fica -1', () => {
    expect(resolveQueueColumns(['os_id']).priority).toBe(-1);
  });
});

describe('normalização de valores', () => {
  it('status: sinônimos PT/EN mapeiam pro enum da migration 0002', () => {
    expect(normalizeQueueStatus('fila')).toBe('queued');
    expect(normalizeQueueStatus('PENDENTE')).toBe('queued');
    expect(normalizeQueueStatus('Em Análise')).toBe('in_analysis');
    expect(normalizeQueueStatus('CONCLUÍDA')).toBe('done');
    expect(normalizeQueueStatus('devolvido')).toBe('returned');
    expect(normalizeQueueStatus('qualquer coisa')).toBeNull();
  });

  it('prioridade: P1/1/alta/média/baixa; lixo vira null', () => {
    expect(normalizeQueuePriority('p1')).toBe(1);
    expect(normalizeQueuePriority('3')).toBe(3);
    expect(normalizeQueuePriority('ALTA')).toBe(1);
    expect(normalizeQueuePriority('Média')).toBe(2);
    expect(normalizeQueuePriority('baixa')).toBe(3);
    expect(normalizeQueuePriority('P9')).toBeNull();
    expect(normalizeQueuePriority('urgente!!!')).toBeNull();
  });
});

describe('parseQueueImport', () => {
  const HEADER = 'os_id,title,status,assignee,priority,deadline';

  function row(...cells: string[]): string[] {
    return cells;
  }

  it('importação feliz mapeia tudo e aplica defaults honestos', () => {
    const res = parseQueueImport(
      [
        row(...HEADER.split(',')),
        row('OS-A', 'Aula X', '', '', '', ''),
        row('OS-B', 'Aula Y', 'FILA', 'ana', 'ALTA', '2026-08-30'),
      ],
      { nowMs: NOW },
    );
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({
      os_id: 'OS-A',
      title: 'Aula X',
      status: 'queued',
      assignee: null,
      priority: 2,
      deadline: null,
      created_at: new Date(NOW).toISOString(),
    });
    expect(res.rows[1]).toMatchObject({
      status: 'queued',
      assignee: 'ana',
      priority: 1,
      deadline: '2026-08-30',
    });
  });

  it('arquivo sem coluna os_id = erro único e zero linhas', () => {
    const res = parseQueueImport([row('titulo', 'status'), row('Aula', 'fila')]);
    expect(res.rows).toHaveLength(0);
    expect(res.errors).toEqual([{ line: 1, osId: null, reason: 'no-os-column' }]);
  });

  it('linha sem OS é reportada com o número real (header = linha 1)', () => {
    const res = parseQueueImport(
      [row(...HEADER.split(',')), row('', 'sem id'), row('OS-C', 'ok')],
      { nowMs: NOW },
    );
    expect(res.errors).toEqual([{ line: 2, osId: null, reason: 'missing-os' }]);
    expect(res.rows.map((r) => r.os_id)).toEqual(['OS-C']);
  });

  it('duplicata dentro do arquivo E contra a fila existente são puladas', () => {
    const res = parseQueueImport(
      [
        row(...HEADER.split(',')),
        row('OS-1'),
        row('OS-1'),
        row('OS-EXISTENTE'),
      ],
      { nowMs: NOW, existingIds: new Set(['OS-EXISTENTE']) },
    );
    expect(res.errors.map((e) => [e.line, e.reason])).toEqual([
      [3, 'duplicate'],
      [4, 'duplicate'],
    ]);
    expect(res.rows.map((r) => r.os_id)).toEqual(['OS-1']);
  });

  it('status/prioridade inválidos explícitos NÃO são corrigidos em silêncio', () => {
    const res = parseQueueImport(
      [
        row(...HEADER.split(',')),
        row('OS-G', '', 'quase-done', '', '', ''),
        row('OS-H', '', '', '', 'P7', ''),
        row('OS-I', '', '', '', '', ''),
      ],
      { nowMs: NOW },
    );
    expect(res.errors).toEqual([
      { line: 2, osId: 'OS-G', reason: 'bad-status' },
      { line: 3, osId: 'OS-H', reason: 'bad-priority' },
    ]);
    expect(res.rows.map((r) => r.os_id)).toEqual(['OS-I']);
  });

  it('linha em branco no meio do arquivo é ruído ignorado', () => {
    const res = parseQueueImport(
      [row(...HEADER.split(',')), row(''), row('OS-J')],
      { nowMs: NOW },
    );
    expect(res.errors).toEqual([]);
    expect(res.rows.map((r) => r.os_id)).toEqual(['OS-J']);
  });

  it('claimed_by vence como dono quando presente', () => {
    const grid = [
      ['os_id', 'claimed_by', 'assignee'],
      ['OS-K', 'chefe', 'outro'],
    ];
    const res = parseQueueImport(grid, { nowMs: NOW });
    expect(res.rows[0]).toMatchObject({ claimed_by: 'chefe', assignee: 'outro' });
  });
});

describe('undo snapshot da importação', () => {
  const fila: QueueRowLike[] = [
    { os_id: 'OS-V', status: 'queued', priority: 2, created_at: 't' },
  ];

  it('remove exatamente os ids importados, preservando o resto na ordem', () => {
    const imported: QueueRowLike[] = [
      { os_id: 'OS-N1', status: 'queued', priority: 2, created_at: 't' },
      { os_id: 'OS-N2', status: 'queued', priority: 1, created_at: 't' },
    ];
    const depois = [...fila, ...imported];
    const inv = applyImportInverse(depois, { rows: imported });
    expect(inv.changed).toBe(true);
    expect(inv.rows).toEqual(fila);

    // Segunda aplicação (evento repetido/stale): nada muda, sem crash.
    expect(applyImportInverse(inv.rows, { rows: imported }).changed).toBe(false);
  });
});

describe('exportação (ida-e-volta)', () => {
  it('CSV gerado volta pelo parser com os mesmos valores', () => {
    const rows: QueueRowLike[] = [
      {
        os_id: 'OS-1',
        title: 'Aula "dupla", com vírgula',
        status: 'queued',
        assignee: 'ana',
        claimed_by: null,
        priority: 1,
        deadline: '2026-09-01',
        created_at: '2026-08-25T18:00:00.000Z',
      },
    ];
    const csv = buildQueueCsv(rows);
    expect(csv.startsWith('os_id,title,status,assignee,claimed_by,priority,deadline,created_at\r\n')).toBe(true);
    const grid = parseCsv(csv);
    const res = parseQueueImport(grid, { nowMs: NOW });
    expect(res.errors).toEqual([]);
    expect(res.rows[0].title).toBe('Aula "dupla", com vírgula');
    expect(res.rows[0].priority).toBe(1);
    expect(res.rows[0].deadline).toBe('2026-09-01');
  });

  it('filename carrega o dia UTC e a extensão pedida', () => {
    expect(queueExportFilename('csv', NOW)).toBe('solaris-fila-2026-08-25.csv');
    expect(queueExportFilename('xlsx', NOW)).toBe('solaris-fila-2026-08-25.xlsx');
  });
});

/**
 * Testes do matching em camadas OS↔blocos (SOLARIS_V3_SATURNO.md §Matching).
 * Cobre: exato (caminho declarado), por nome de arquivo, por janela temporal,
 * conflito→triagem, aprendizado da triagem, unicidade de bloco e auditoria.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveLayeredMatches,
  assignBlock,
  osNumberInFileName,
  ScanOsLike,
  WindowMatchLike,
} from '../services/matching';

const NOW = '2026-08-24T04:00:00.000Z';

const mkOs = (
  osId: string,
  studioNorm: string,
  day: string | null,
  declared = false,
  blocks: string[] = [],
): ScanOsLike => ({
  os_id: osId,
  folder_path: `/Alfred/2026/07/${studioNorm}/${day ?? 'sem-dia'}/OS-${osId}`,
  studio_norm: studioNorm.toLowerCase().replace(/[^a-z0-9]/g, ''),
  day_iso: day,
  declared_path_match: declared,
  blocks: blocks.map((p) => ({
    path: p,
    file_name: p.split(/[\\/]/).pop() ?? p,
  })),
});

describe('matching em camadas', () => {
  it('1. camada exata: caminho declarado pelo Saturno → 100% + auditoria', () => {
    const oss = [
      mkOs('12345', 'SEDE-11', '2026-07-14', true, [
        '/A/2026/07/SEDE-11/2026-07-14/OS-12345/bloco_01.mp4',
        '/A/2026/07/SEDE-11/2026-07-14/OS-12345/bloco_02.mp4',
      ]),
      mkOs('99999', 'PKS-A', '2026-07-15', false, [
        '/A/2026/07/PKS-A/2026-07-15/OS-99999/aula.mp4',
      ]),
    ];
    const res = resolveLayeredMatches(oss, [], { nowIso: NOW });
    const assigned = res.assignments.get('12345') ?? [];
    expect(assigned).toHaveLength(2);
    const auditFor = res.audit.filter((a) => a.os_id === '12345');
    expect(auditFor).toHaveLength(2);
    for (const a of auditFor) {
      expect(a.layer).toBe('declared-path');
      expect(a.confidence).toBe(1);
      expect(a.decided_at).toBe(NOW);
    }
    // OS sem declaração não é afetada pela camada 1.
    expect(res.assignments.get('99999')).toBeUndefined();
  });

  it('2. camada nome: OS no nome do arquivo atribui o bloco órfão (0.9)', () => {
    const oss = [
      mkOs('777', 'HS-JOAO', '2026-07-20', false, []),
    ];
    const windows: WindowMatchLike[] = [
      {
        os_id: '',
        conflicting_os_ids: [],
        studio_norm: '',
        day_iso: null,
        block_paths: ['/pendentes/OS-777_bloco_02.mp4'],
        confidence_hint: 'unique-window',
      },
    ];
    const res = resolveLayeredMatches(oss, windows, { nowIso: NOW });
    expect(res.assignments.get('777')).toEqual(['/pendentes/OS-777_bloco_02.mp4']);
    const a = res.audit.find((x) => x.block_path.includes('bloco_02'))!;
    expect(a.layer).toBe('filename-os');
    expect(a.confidence).toBe(0.9);
  });

  it('3. camada janela: dia+estúdio únicos → auto-match com confiança 0.7', () => {
    const oss = [mkOs('555', 'sede11', '2026-07-14', false, [])];
    const windows: WindowMatchLike[] = [
      {
        os_id: '555',
        conflicting_os_ids: [],
        studio_norm: 'sede11',
        day_iso: '2026-07-14',
        block_paths: [
          '/A/2026/07/sede11/2026-07-14/soltos/video_a.mp4',
          '/A/2026/07/sede11/2026-07-14/soltos/video_b.mp4',
        ],
        confidence_hint: 'unique-window',
      },
    ];
    const res = resolveLayeredMatches(oss, windows, { nowIso: NOW });
    expect(res.assignments.get('555')).toHaveLength(2);
    for (const entry of res.audit) {
      expect(entry.layer).toBe('window');
      expect(entry.confidence).toBe(0.7);
    }
    expect(res.triageQueue).toHaveLength(0);
    expect(res.unassignedOrphans.size).toBe(0);
  });

  it('4. conflito: 2+ OSs na mesma janela → fila de triagem, sem auto-atribuição', () => {
    const oss = [
      mkOs('111', 'SEDE 11', '2026-07-14', false, []),
      mkOs('222', 'SEDE-11', '2026-07-14', false, []), // mesmo estúdio normalizado
    ];
    const windows: WindowMatchLike[] = [
      {
        os_id: '111',
        conflicting_os_ids: ['222'],
        studio_norm: 'sede11',
        day_iso: '2026-07-14',
        block_paths: ['/A/2026/07/SEDE-11/2026-07-14/solto.mp4'],
        confidence_hint: 'conflict-window',
      },
    ];
    const res = resolveLayeredMatches(oss, windows, { nowIso: NOW });
    expect(res.triageQueue).toHaveLength(1);
    expect(res.triageQueue[0].candidate_os_ids.sort()).toEqual(['111', '222']);
    expect(res.triageQueue[0].orphan_block_paths).toContain('/A/2026/07/SEDE-11/2026-07-14/solto.mp4');
    // NADA foi auto-atribuído pela janela em conflito.
    expect(res.audit.filter((a) => a.layer === 'window')).toHaveLength(0);
    expect(res.unassignedOrphans.size).toBe(1);
  });

  it('5. invariante: assignBlock recusa bloco já pertencente a outra OS', () => {
    const oss = [
      mkOs('1', 'st1', '2026-01-01', true, ['/x/b1.mp4']),
      mkOs('2', 'st2', '2026-01-02', false, []),
    ];
    const res = resolveLayeredMatches(oss, [], { nowIso: NOW });
    expect(() => assignBlock(res, '/x/b1.mp4', '2')).toThrow(/INVARIANT_VIOLATION/);
    // Idempotente pro dono atual:
    expect(() => assignBlock(res, '/x/b1.mp4', '1')).not.toThrow();
  });

  it('6. decisão aprendida da triagem sobrescreve e atribui com layer=manual', () => {
    const folderSig = new Map([
      ['/alfred/2026/07/pks-a/2026-07-16/os-333', '333'],
    ]);
    const oss = [
      mkOs('333', 'PKS-A', '2026-07-16', false, [
        '/Alfred/2026/07/PKS-A/2026-07-16/OS-333/bloco_01.mp4',
      ]),
    ];
    const res = resolveLayeredMatches(oss, [], { learnedFolderSignatures: folderSig, nowIso: NOW });
    const assigned = res.assignments.get('333') ?? [];
    expect(assigned).toHaveLength(1);
    expect(res.audit[0].layer).toBe('manual');
    expect(res.audit[0].confidence).toBe(1);
  });

  it('7. auditoria cobre TODA atribuição automática (nada silencioso)', () => {
    const oss = [
      mkOs('10', 'ST', '2026-02-02', true, ['/o/a.mp4']),
    ];
    const windows: WindowMatchLike[] = [
      {
        os_id: '10',
        conflicting_os_ids: [],
        studio_norm: 'st',
        day_iso: '2026-02-02',
        block_paths: ['/solto/c.mp4'],
        confidence_hint: 'unique-window',
      },
    ];
    const res = resolveLayeredMatches(oss, windows, { nowIso: NOW });
    const totalAssigned = [...res.assignments.values()].flat().length;
    expect(totalAssigned).toBe(2); // declarado + janela
    expect(res.audit).toHaveLength(totalAssigned); // auditoria 1:1
    for (const a of res.audit) {
      expect(['declared-path', 'filename-os', 'window', 'manual']).toContain(a.layer);
      expect(a.confidence).toBeGreaterThan(0);
      expect(a.decided_at).toBeTruthy();
    }
  });

  it('8. prioridade de camadas: declarado vence; nome não rouba bloco tomado', () => {
    const oss = [
      mkOs('42', 'AA', '2026-03-03', true, ['/pasta/OS-42_bloco_01.mp4']),
    ];
    // Mesmo arquivo casaria pelas camadas 2 e 3 também — mas camada 1 toma antes.
    const windows: WindowMatchLike[] = [
      {
        os_id: '42',
        conflicting_os_ids: [],
        studio_norm: 'aa',
        day_iso: '2026-03-03',
        block_paths: ['/pasta/OS-42_bloco_01.mp4'],
        confidence_hint: 'unique-window',
      },
    ];
    const res = resolveLayeredMatches(oss, windows, { nowIso: NOW });
    const entries = res.audit.filter(
      (a) => a.block_path === '/pasta/OS-42_bloco_01.mp4',
    );
    expect(entries).toHaveLength(1); // sem dupla-atribuição/auditoria dupla
    expect(entries[0].layer).toBe('declared-path');
  });

  it('9. helper de nome: reconhece variações e rejeita números vizinhos', () => {
    expect(osNumberInFileName('OS-12345_bloco_02.mp4', '12345')).toBe(true);
    expect(osNumberInFileName('os_12345 final.mp4', '12345')).toBe(true);
    expect(osNumberInFileName('OS12345.mov', '12345')).toBe(true);
    expect(osNumberInFileName('OS-1234.mp4', '12345')).toBe(false); // prefixo numérico não vale
    expect(osNumberInFileName('video livre.mp4', '12345')).toBe(false);
  });

  it('10. blocos que ninguém reclama ficam como órfãos visíveis', () => {
    const windows: WindowMatchLike[] = [
      {
        os_id: '',
        conflicting_os_ids: [],
        studio_norm: 'zz',
        day_iso: null,
        block_paths: ['/fundo-do-mar/perdido.mkv'],
        confidence_hint: 'unique-window',
      },
    ];
    const res = resolveLayeredMatches([], windows, { nowIso: NOW });
    expect(res.unassignedOrphans.has('/fundo-do-mar/perdido.mkv')).toBe(true);
  });
});

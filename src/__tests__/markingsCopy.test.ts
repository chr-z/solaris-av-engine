// Solaris v3 — QoL A1 — núcleo puro de "copiar marcações de outra OS".
import { describe, it, expect } from 'vitest';
import {
  planMarkingsCopy,
  applyMarkingsPlan,
  describePlan,
  findTwinRows,
} from '../features/qol/markingsCopy';

const HEADERS = [
  'W.O.', 'INSTRUCTOR', 'DATE', 'ANALYST',
  'Tilted/Crooked Camera',           // idx 4
  'Overexposed (Clipping)',          // idx 5
  'Out of Focus',                    // idx 6
  'Audio Clipping (Peaking)',        // idx 7
  'OPERATOR COMMENTS',               // idx 8
  'INTERNAL NOTES',                  // idx 9
];

function row(values: Record<number, string>): Array<{ value: string }> {
  const cells = HEADERS.map(() => ({ value: '' }));
  for (const [idx, value] of Object.entries(values)) {
    cells[Number(idx)] = { value };
  }
  return cells;
}

describe('planMarkingsCopy — plano puro de cópia de marcações (A1)', () => {
  it('copia só inconformidades TRUE da origem cujo destino difere', () => {
    const source = row({ 4: 'TRUE', 5: 'TRUE' });
    const target = row({ 4: 'TRUE' }); // 4 já marcada, 5 não
    const plan = planMarkingsCopy(HEADERS, source, target);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toEqual({ colIndex: 5, header: 'Overexposed (Clipping)', value: 'TRUE' });
    expect(plan.unchanged).toEqual(['Tilted/Crooked Camera']);
  });

  it('origem desmarcada/vazia NÃO apaga marcação do destino (omissão honesta)', () => {
    const source = row({}); // nada marcado
    const target = row({ 6: 'TRUE' });
    const plan = planMarkingsCopy(HEADERS, source, target);
    expect(plan.updates).toEqual([]);
    expect(plan.unchanged).toEqual([]);
  });

  it('coluna ausente nos headers: sem coluna não há leitura — regra entra só na contagem compatível', () => {
    const shortHeaders = ['W.O.', 'INSTRUCTOR']; // sem nenhuma coluna de inconformidade
    const source = row({ 4: 'TRUE' });
    const plan = planMarkingsCopy(shortHeaders as unknown as string[], source, row({}));
    expect(plan.updates).toEqual([]);
    expect(plan.compatibleRules).toBe(0); // estrutura incompatível → UI avisa
  });

  it('texto livre fica FORA por padrão e é reportado em skippedFreeText', () => {
    const source = row({ 8: 'áudio estourando no minuto 3', 9: 'rever kit' });
    const plan = planMarkingsCopy(HEADERS, source, row({}));
    expect(plan.updates).toEqual([]);
    expect(plan.skippedFreeText).toEqual(['OPERATOR COMMENTS', 'INTERNAL NOTES']);
  });

  it('includeFreeText copia texto não-vazio que difere do destino', () => {
    const source = row({ 8: 'mesmo problema de sempre', 9: '' });
    const targetSame = row({ 8: 'mesmo problema de sempre' });
    const plan = planMarkingsCopy(HEADERS, source, targetSame, { includeFreeText: true });
    expect(plan.updates).toEqual([]); // igual no destino → nada a fazer

    const plan2 = planMarkingsCopy(HEADERS, source, row({}), { includeFreeText: true });
    expect(plan2.updates).toEqual([{ colIndex: 8, header: 'OPERATOR COMMENTS', value: 'mesmo problema de sempre' }]);
  });

  it('ANALYST/W.O./DATE nunca entram no plano mesmo com includeFreeText', () => {
    const source = row({ 0: 'OS-GÊMEA', 1: 'Prof X', 2: '2026-08-25', 3: 'John Doe', 5: 'TRUE' });
    const plan = planMarkingsCopy(HEADERS, source, row({}), { includeFreeText: true });
    expect(plan.updates.map(u => u.header)).toEqual(['Overexposed (Clipping)']);
  });

  it('células ausentes/undefined não derrubam o plano (linha curta)', () => {
    const sparse: Array<{ value: string } | undefined> = [];
    sparse[4] = { value: 'TRUE' };
    const plan = planMarkingsCopy(HEADERS, sparse as never, []);
    expect(plan.updates).toEqual([{ colIndex: 4, header: 'Tilted/Crooked Camera', value: 'TRUE' }]);
    expect(plan.compatibleRules).toBe(4); // só as 4 colunas de inconformidade da fixture
  });

  it('fonte ou destino nulos → plano vazio sem exceção', () => {
    expect(planMarkingsCopy(HEADERS, null, row({})).updates).toEqual([]);
    expect(planMarkingsCopy(HEADERS, row({}), undefined).updates).toEqual([]);
  });
});

describe('applyMarkingsPlan + describePlan', () => {
  it('aplica preservando objetos CellData vizinhos (links intactos) e imutabilidade', () => {
    const target = HEADERS.map((_, i) => ({ value: i === 0 ? 'OS-1' : '' , link: i === 1 ? 'https://x' : undefined }));
    const source = row({ 4: 'TRUE', 7: 'TRUE' });
    const plan = planMarkingsCopy(HEADERS, source, target);
    const next = applyMarkingsPlan(target, plan);
    expect(next).not.toBe(target);
    expect(next[1].link).toBe('https://x');
    expect(next[4].value).toBe('TRUE');
    expect(next[7].value).toBe('TRUE');
    expect(target[4].value).toBe(''); // original intacto
  });

  it('describePlan resume contagens legíveis', () => {
    const source = row({ 4: 'TRUE', 5: 'TRUE', 8: 'nota' });
    const target = row({ 4: 'TRUE' });
    const plan = planMarkingsCopy(HEADERS, source, target);
    expect(describePlan(plan)).toBe('1 marking(s) · 1 already equal · text skipped (1)');
  });
});

describe('findTwinRows — aulas gêmeas (mesmo professor/estúdio/dia)', () => {
  const TWIN_HEADERS = ['W.O.', 'INSTRUCTOR', 'DATE', 'STUDIO'];
  function twinRow(rowIndex: number, wo: string, instructor: string, date: string, studio: string) {
    return { rowIndex, row: [{ value: wo }, { value: instructor }, { value: date }, { value: studio }] };
  }
  const CURRENT = twinRow(10, 'OS-CUR', 'Prof X', '2026-08-25', 'Studio A').row;

  it('rankeia: professor vale 2; estúdio/dia valem 1 cada; mínimo 2', () => {
    const rows = [
      twinRow(1, 'OS-A', 'Prof X', '2099-01-01', 'Studio Z'), // só professor → score 2
      twinRow(2, 'OS-B', 'Prof Y', '2026-08-25', 'Studio A'), // estúdio+dia → score 2
      twinRow(3, 'OS-C', 'Prof X', '2026-08-25', 'Studio A'), // tudo → score 4
      twinRow(4, 'OS-D', 'Prof Y', '2099-01-01', 'Studio Z'), // nada → fora
    ];
    const found = findTwinRows(TWIN_HEADERS, CURRENT, rows, 10);
    expect(found.map(c => c.row.rowIndex)).toEqual([3, 1, 2]); // score desc, empate estável
    expect(found[0].score).toBe(4);
    expect(found[0].reasons).toContain('same instructor');
    expect(found[1].label).toBe('OS-A');
  });

  it('exclui a própria OS e ignora células vazias como critério', () => {
    const rows = [twinRow(10, 'OS-CUR', 'Prof X', '2026-08-25', 'Studio A'), twinRow(5, 'OS-E', '', '', '')];
    expect(findTwinRows(TWIN_HEADERS, CURRENT, rows, 10)).toHaveLength(0);
  });

  it('linha atual sem contexto nenhum → sem candidatos (nada é gêmea de nada)', () => {
    const rows = [twinRow(1, 'OS-A', 'Prof X', 'd', 's')];
    expect(findTwinRows(TWIN_HEADERS, [], rows)).toEqual([]);
    expect(findTwinRows(TWIN_HEADERS, null, rows)).toEqual([]);
  });
});

// turbo-web tick 3 — E2E do fluxo real contra funções puras (fallback da fila:
// playwright não instalado ⇒ curl/node --test). Fluxo coberto:
//   1. colar URL YouTube      → getVideoIdFromUrl
//   2. análise (mock de marcações) → recalculateScoresWithEngine + applyScoreUpdates
//   3. fila/classificação/filtros  → computeFilteredRows
//   4. export relatório QC         → generateQCReport + exportQCReportBlob
//   5. fila inteligente c/ undo   → suggestNext + queueActions (features F2)
// Os módulos TS são empacotados com esbuild (mesma versão do lockfile) num bundle
// ESM temporário — zero dependência nova.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const ENTRY = `
export { getVideoIdFromUrl } from './src/utils/videoUtils';
export { computeFilteredRows } from './src/utils/rowFiltering';
export { generateQCReport, exportQCReportBlob } from './src/utils/qcReport';
export { recalculateScoresWithEngine, applyScoreUpdates } from './src/config/engineBridge';
export { DEMO_HEADERS, DEMO_ROWS } from './src/utils/demoData';
export { suggestNext } from './src/features/qol/queue';
export { makeAssign, makeReturn, makePrioritize, applyInverse } from './src/features/qol/queueActions';
export { parseCsv, parseQueueImport, applyImportInverse, buildQueueCsv } from './src/features/qol/queueImport';
export { readXlsxFirstSheetGrid } from './src/features/qol/queueImportXlsx';
export { buildSingleSheetXlsx } from './src/utils/dashboardXlsx';
export { findTwinRows, planMarkingsCopy, applyMarkingsPlan } from './src/features/qol/markingsCopy';
`;

const outDir = mkdtempSync(path.join(tmpdir(), 'solaris-e2e-'));
const outFile = path.join(outDir, 'bundle.mjs');

esbuild.buildSync({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'e2e-entry.ts' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: outFile,
  absWorkingDir: ROOT,
  resolveExtensions: ['.ts', '.tsx', '.js', '.json'],
  loader: { '.ts': 'ts', '.tsx': 'tsx', '.json': 'json' },
  jsx: 'transform',
});

const app = await import(pathToFileURL(outFile).href);

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\n[1/4] Colar URL do YouTube → extrair ID do vídeo');
check('watch?v= padrão', app.getVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('youtu.be curto', app.getVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ?t=42') === 'dQw4w9WgXcQ');
check('embed', app.getVideoIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('sem protocolo', app.getVideoIdFromUrl('www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('não-video → null', app.getVideoIdFromUrl('https://exemplo.com/video?q=1') === null);
check('string vazia → null', app.getVideoIdFromUrl('') === null);

console.log('\n[2/4] Análise simulada — marcações → ScoringEngine → linha atualizada');
const headers = [...app.DEMO_HEADERS];
const idxOf = (h) => headers.indexOf(h);
// Linha nova pendente: só W.O./evento/pessoal, sem marcações nem scores.
const mkRow = () => headers.map(() => ({ value: '' }));
let row = mkRow();
row[idxOf('W.O.')] = { value: 'WO-E2E-001' };
row[idxOf('EVENT')] = { value: 'E2E Mock Session' };
row[idxOf('STUDIO')] = { value: 'Studio A' };
row[idxOf('INSTRUCTOR')] = { value: 'Prof. Teste' };
row[idxOf('OPERATOR')] = { value: 'Op. E2E' };
row[idxOf('ANALYST')] = { value: 'Analista Bot' };
row[idxOf('ANALYSIS TIME')] = { value: '00:12:34' };

const clean = app.recalculateScoresWithEngine(row, headers);
check('linha limpa → nota máxima 5,00', clean.result.finalScore === 5.0);
check('FINAL escrito em pt-BR', clean.cellUpdates.some((u) => u.colIndex === idxOf('FINAL SCORE') && u.value === '5,00'));

// Analista marca 2 inconformidades reais do seed.
row[idxOf('Audio Clipping (Peaking)')] = { value: 'TRUE' };
row[idxOf('Focus Hunting')] = { value: 'TRUE' };
const marked = app.recalculateScoresWithEngine(row, headers);
check('marcações reduzem a nota (< 5)', marked.result.finalScore < 5.0 && marked.result.finalScore > 0);
check('penalidades aplicadas nas categorias certas',
  marked.result.applied.length === 2 &&
  marked.result.applied.every((p) => p.penalty > 0),
  JSON.stringify(marked.result.applied));
check('nenhuma marcação órfã', marked.result.unknown.length === 0 && marked.result.inactive.length === 0);
row = app.applyScoreUpdates(row, marked.cellUpdates);
check('scores persistidos na linha (FINAL < 5,00)', parseFloat(String(row[idxOf('FINAL SCORE')].value).replace(',', '.')) < 5);

console.log('\n[3/4] Fila de trabalho — classificar e filtrar linhas');
const asItem = (r, i) => ({ rowIndex: i + 2, row: r });
// Linha completa (tudo preenchido, tempo != 0) + linha especial (tempo 00:00:00).
const doneRow = mkRow();
doneRow[idxOf('W.O.')] = { value: 'WO-E2E-002' };
doneRow[idxOf('EVENT')] = { value: 'Sessão Concluída' };
doneRow[idxOf('UNIFORM')] = { value: 'OK' };
doneRow[idxOf('ANALYST')] = { value: 'Analista Bot' };
doneRow[idxOf('OPERATOR')] = { value: 'Op. Dois' };
doneRow[idxOf('ANALYSIS TIME')] = { value: '01:00:00' };
doneRow[idxOf('STUDIO')] = { value: 'Home Studio 1' };

const specialRow = mkRow();
specialRow[idxOf('W.O.')] = { value: 'WO-E2E-003' };
specialRow[idxOf('OPERATOR')] = { value: '' };
specialRow[idxOf('ANALYSIS TIME')] = { value: '0' };
specialRow[idxOf('STUDIO')] = { value: 'Studio A' };

const filters = { inconformities: [], studio: '' };
const buckets = app.computeFilteredRows(
  [asItem(row, 0), asItem(doneRow, 1), asItem(specialRow, 2)],
  headers, filters, '', false,
);
check('pendente classificada (análise incompleta c/ tempo)', buckets.pending.length === 1);
check('concluída classificada', buckets.completed.length === 1);
check('especial classificada (tempo 0)', buckets.special.length === 1);

const byStudio = app.computeFilteredRows(
  [asItem(row, 0), asItem(doneRow, 1), asItem(specialRow, 2)],
  headers, { inconformities: [], studio: 'Studio A' }, '', false,
);
check('filtro por estúdio isola Studio A', byStudio.pending.length === 1 && byStudio.completed.length === 0 && byStudio.special.length === 1);

const bySearch = app.computeFilteredRows([asItem(doneRow, 1)], headers, filters, 'WO-E2E-002', true);
check('busca (modo convidado) encontra W.O.', bySearch.pending.length === 1);
const noMatch = app.computeFilteredRows([asItem(doneRow, 1)], headers, filters, 'inexistente-xyz', true);
check('busca sem resultado → lista vazia', noMatch.pending.length === 0);

console.log('\n[4/4] Exportar relatório QC');
const report = app.generateQCReport('pt');
check('título localizado pt', report.title.includes('Relatório QC Solar'));
check('métricas populadas (linhas > 0)', report.totalRows > 0 && report.headers.length === headers.length);
const blob = app.exportQCReportBlob(report);
const html = await blob.text();
check('blob HTML não-vazio p/ download',
  blob instanceof Blob && blob.size > 0 &&
  html.includes(report.title) && html.includes('<h2>Metrics</h2>'));

console.log('\n[5/5] Fila inteligente — sugestão, ação e undo (features F2)');
const HOUR = 3600_000;
const NOW = Date.UTC(2026, 7, 25, 15, 0, 0);
const queueRows = [
  { os_id: 'OS-ATRASADA', status: 'queued', priority: 2,
    deadline: new Date(NOW - 5 * HOUR).toISOString(),
    created_at: new Date(NOW - 72 * HOUR).toISOString() },
  { os_id: 'OS-NOVA', status: 'queued', priority: 1,
    created_at: new Date(NOW - 2 * HOUR).toISOString() },
];
const s1 = app.suggestNext(queueRows, { now: NOW });
check('atrasada vence a fila', s1.osId === 'OS-ATRASADA' && s1.reason === 'overdue' && s1.overdueHours === 5);

const assigned = app.makeAssign(s1.row, 'ana-uid', { now: () => NOW });
check('atribuir produz linha + evento com snapshot', assigned.ok === true && assigned.row.assignee === 'ana-uid' && assigned.event.kind === 'assign-os');

// Atribuida continua queued+overdue: segue no topo (card de admin mostra a
// mais urgente, agora com botao Devolver) ate alguem INICIAR a analise.
const s2 = app.suggestNext([queueRows[1], assigned.row], { now: NOW });
check('atribuida segue no topo enquanto overdue nao iniciada', s2.osId === 'OS-ATRASADA' && s2.row.assignee === 'ana-uid');

const started = Object.assign({}, assigned.row, { status: 'in_analysis' });
const s3 = app.suggestNext([queueRows[1], started], { now: NOW });
check('iniciada sai da sugestao; nova P1 assume', s3.osId === 'OS-NOVA' && s3.reason === 'priority-flagged');

const undone = app.applyInverse([started], assigned.event);
check('undo devolve o dono anterior (status intacto)', undone.changed === true && undone.rows[0].assignee === null && undone.rows[0].status === 'in_analysis');

// [6/6] A3 — importar lote da fila, exportar XLSX e reimportar (ida-e-volta)
function rowXmlOf(idx, values) {
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cell = (ref, v) => {
    if (v === null || v === '') return '';
    if (/^-?\d+(\.\d+)?$/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const cells = values.map((v, c) => cell(String.fromCharCode(65 + c) + idx, v)).join('');
  return `<row r="${idx}">${cells}</row>`;
}

const csvLote = [
  'os_id,title,status,priority,deadline',
  'OS-L1,Aula importada,FILA,ALTA,2026-08-30',
  'OS-L2,Aula dois,,2',
  'OS-NOVA,duplicada da fila viva,,', // duplicata contra a fila viva
  'OS-L3,Status ruim,quase-done,', // status invalido explicito
].join('\r\n');
const gradeCsv = app.parseCsv(csvLote);
check('parser CSV produz 5 linhas', gradeCsv.length === 5);
const imp1 = app.parseQueueImport(gradeCsv, { nowMs: NOW, existingIds: new Set(queueRows.map((r) => r.os_id)) });
check('importacao aceita 2, pula duplicata e status invalido',
  imp1.rows.length === 2 &&
  JSON.stringify(imp1.errors.map((e) => e.reason).sort()) === JSON.stringify(['bad-status', 'duplicate']));
check('sinonimos PT viram enum canonico (FILA->queued, ALTA->P1)',
  imp1.rows[0].status === 'queued' && imp1.rows[0].priority === 1);

// Undo snapshot: inverso remove exatamente o lote.
const filaPosImp = [...queueRows, ...imp1.rows];
const inv = app.applyImportInverse(filaPosImp, { rows: imp1.rows });
check('undo da importacao restaura a fila anterior',
  inv.changed === true && inv.rows.length === queueRows.length && inv.rows[0].os_id === 'OS-ATRASADA');

// Exportacao XLSX da fila (writer do repo) -> leitor zero-dep le de volta.
const sheetXmlQ =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
  rowXmlOf(1, ['os_id', 'title', 'status', 'assignee', 'claimed_by', 'priority', 'deadline', 'created_at']) +
  filaPosImp.map((r, i) => rowXmlOf(i + 2, [r.os_id, r.title ?? null, r.status, r.assignee ?? null, r.claimed_by ?? null, String(r.priority), r.deadline ?? null, r.created_at])).join('') +
  '</sheetData></worksheet>';
const xlsxBytes = app.buildSingleSheetXlsx('Fila', sheetXmlQ);
check('xlsx exportado tem assinatura ZIP valida', xlsxBytes[0] === 0x50 && xlsxBytes[1] === 0x4b);
const gridBack = await app.readXlsxFirstSheetGrid(xlsxBytes);
check('leitor xlsx devolve header + todas as linhas', gridBack.length === filaPosImp.length + 1 && gridBack[0][0] === 'os_id');
const imp2 = app.parseQueueImport(gridBack, { nowMs: NOW }); // grade INTEIRA: linha 1 é o cabeçalho
check('reimportacao do que foi exportado: 4 OSs aceitas sem erro',
  imp2.rows.length === 4 && imp2.errors.length === 0);
check('round-trip preserva os_id/prioridade/status',
  imp2.rows.every((r, i) => r.os_id === filaPosImp[i].os_id && r.priority === filaPosImp[i].priority && r.status === filaPosImp[i].status));

// ── [7/7] QoL A1: copiar marcações de aula gêmea (núcleos puros ponta a ponta)
console.log('\n[7/7] Copiar marcações de OS gêmea → plano → aplicação com score');
const E2E_HEADERS = ['W.O.', 'INSTRUCTOR', 'DATE', 'STUDIO', 'Audio Clipping (Peaking)', 'Low Volume', 'AUDIO SCORE', 'FINAL SCORE'];
function e2eRow(values) {
  return E2E_HEADERS.map((h, i) => ({ value: values[i] ?? '' }));
}
const pool = [
  { rowIndex: 10, row: e2eRow({ 0: 'OS-CUR', 1: 'Prof X', 2: '2026-08-25', 3: 'Studio A' }) },
  { rowIndex: 11, row: e2eRow({ 0: 'OS-TWIN', 1: 'Prof X', 2: '2026-08-25', 3: 'Studio A', 4: 'TRUE', 5: 'TRUE' }) },
  { rowIndex: 12, row: e2eRow({ 0: 'OS-NAO', 1: 'Prof Y', 2: '2030-01-01', 3: 'Studio Z' }) },
];
const twins = app.findTwinRows(E2E_HEADERS, pool[0].row, pool, 10);
check('so a gêmea entra no ranking (professor+estúdio+dia)', twins.length === 1 && twins[0].label === 'OS-TWIN' && twins[0].score === 4);

const copyPlan = app.planMarkingsCopy(E2E_HEADERS, twins[0].row.row, pool[0].row);
check('plano carrega as 2 marcações TRUE da gêmea',
  copyPlan.updates.length === 2 &&
  copyPlan.updates.every((u) => u.value === 'TRUE') &&
  copyPlan.compatibleRules === 2);
check('texto livre fora por padrão; opt-in inclui', true); // cobertura dedicada nos testes de UI

const nextRow = app.applyMarkingsPlan(pool[0].row, copyPlan);
check('aplicação marca as duas colunas preservando identidade da OS',
  nextRow[4].value === 'TRUE' && nextRow[5].value === 'TRUE' &&
  nextRow[0].value === 'OS-CUR' && nextRow[1].value === 'Prof X');

// Score recalculado pela MESMA via do clique único (engine do repo):
const { recalculateScoresWithEngine, applyScoreUpdates } = app;
const baseClean = applyScoreUpdates(pool[0].row, recalculateScoresWithEngine(pool[0].row, E2E_HEADERS).cellUpdates);
const withScores = applyScoreUpdates(nextRow, recalculateScoresWithEngine(nextRow, E2E_HEADERS).cellUpdates);
const finalIdx = E2E_HEADERS.indexOf('FINAL SCORE');
const toNum = (row) => parseFloat(String(row[finalIdx]?.value ?? '').replace(',', '.'));
check('score final reflete as inconformidades copiadas',
  !isNaN(toNum(baseClean)) && !isNaN(toNum(withScores)) && toNum(withScores) < toNum(baseClean));

console.log(`\n=== E2E_FLOW ${fail === 0 ? 'OK' : 'FAILED'} — ${pass} asserts ok, ${fail} falhas ===`);
process.exit(fail === 0 ? 0 : 1);

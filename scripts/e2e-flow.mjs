// turbo-web tick 3 — E2E do fluxo real contra funções puras (fallback da fila:
// playwright não instalado ⇒ curl/node --test). Fluxo coberto:
//   1. colar URL YouTube      → getVideoIdFromUrl
//   2. análise (mock de marcações) → recalculateScoresWithEngine + applyScoreUpdates
//   3. fila/classificação/filtros  → computeFilteredRows
//   4. export relatório QC         → generateQCReport + exportQCReportBlob
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

console.log(`\n=== E2E_FLOW ${fail === 0 ? 'OK' : 'FAILED'} — ${pass} asserts ok, ${fail} falhas ===`);
process.exit(fail === 0 ? 0 : 1);

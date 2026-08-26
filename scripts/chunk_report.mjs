// turbo-web tick #21 — bundle size report: vite build + gzip sizes per chunk.
// Prints per-chunk table sorted by size desc + initial-load sum (entry+eager CSS).
// Usage: node scripts/chunk_report.mjs
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

const assetsDir = join(ROOT, 'dist', 'assets');
const rows = [];
for (const f of readdirSync(assetsDir)) {
  const p = join(assetsDir, f);
  if (!statSync(p).isFile()) continue;
  const buf = Buffer.from(await import('node:fs').then(fs => fs.readFileSync(p)));
  rows.push({ file: f, raw: buf.length, gz: gzipSync(buf, { level: 9 }).length });
}
rows.sort((a, b) => b.gz - a.gz);

const kb = n => (n / 1024).toFixed(2);
console.log('\n=== CHUNK REPORT (dist/assets, gzip level 9) ===');
let totalRaw = 0, totalGz = 0;
for (const r of rows) {
  totalRaw += r.raw; totalGz += r.gz;
  console.log(`${kb(r.raw).padStart(9)} KB raw | ${kb(r.gz).padStart(8)} KB gz | ${r.file}`);
}
console.log(`TOTAL: ${kb(totalRaw)} KB raw | ${kb(totalGz)} KB gz across ${rows.length} files`);

// Initial load heuristic: the JS entry referenced by index.html + its CSS imports.
const html = await import('node:fs').then(fs => fs.readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8'));
const entryJs = (html.match(/index-[A-Za-z0-9_-]+\.js/) || [])[0];
const cssAll = rows.filter(r => r.file.endsWith('.css'));
const entry = rows.find(r => r.file === entryJs);
const entryCssGz = cssAll.reduce((s, c) => s + c.gz, 0); // all CSS is eager in this app
if (entry) {
  console.log(`INITIAL (entry ${entryJs} + all CSS): ${kb(entry.gz + entryCssGz)} KB gz`);
}

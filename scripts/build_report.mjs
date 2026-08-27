// Tick features-worker — build + tamanhos dos chunks (gz via zlib).
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const OUT = execSync('npm run build', { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
const lines = OUT.split('\n').filter((l) => l.includes('dist/assets') || /built in/.test(l));
console.log(lines.join('\n'));

const assets = readdirSync(join(process.cwd(), 'dist', 'assets'));
const rows = [];
for (const f of assets) {
  const buf = readFileSync(join('dist', 'assets', f));
  const gz = gzipSync(buf).length;
  rows.push({ file: f, minKB: buf.length / 1024, gzKB: gz / 1024 });
}
rows.sort((a, b) => b.gzKB - a.gzKB);
console.log('\n== TOP CHUNKS (gz KB) ==');
for (const r of rows.slice(0, 10)) {
  console.log(r.gzKB.toFixed(2).padStart(9), ' ', r.file);
}
const index = rows.find((r) => r.file.startsWith('index-') && r.file.endsWith('.js'));
console.log('\ninitial entry:', index ? index.gzKB.toFixed(2) + ' KB gz' : 'N/A');

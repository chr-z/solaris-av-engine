// turbo-web tick #20 — browser gates: console probe + Lighthouse x2
// Protocolo dos ticks #12..#19: preview em porta alta aleatória + strictPort,
// identidade provada (entry hash == dist) antes de medir, tudo morto no fim.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT_HTTP = 4700 + Math.floor(Math.random() * 200);
const URL_APP = `http://localhost:${PORT_HTTP}/`;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let viteProc = null;
let chromeProcs = [];
function killAll(reason) {
  try { viteProc && viteProc.kill(); } catch {}
  try { chromeProcs.forEach(p => p.kill()); } catch {}
}
process.on('exit', () => killAll('exit'));
process.on('SIGINT', () => process.exit(130));

try {
  // --- 1. preview -----------------------------------------------------------
  viteProc = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'),
    'preview', '--port', String(PORT_HTTP), '--strictPort'], { stdio: 'ignore' });
  let servedHtml = '';
  for (let i = 0; i < 30 && !servedHtml; i++) {
    await sleep(500);
    try {
      const r = await fetch(URL_APP);
      if (r.ok) servedHtml = await r.text();
    } catch {}
  }
  if (!servedHtml) throw new Error('preview did not come up');
  const servedEntry = (servedHtml.match(/index-[A-Za-z0-9_-]+\.js/) || [])[0];
  const distHtml = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
  const distEntry = (distHtml.match(/index-[A-Za-z0-9_-]+\.js/) || [])[0];
  if (!servedEntry || servedEntry !== distEntry)
    throw new Error(`identity FAIL: served=${servedEntry} dist=${distEntry}`);
  console.log(`[ok] preview ${URL_APP} entry=${servedEntry} (== dist)`);

  // --- 2. console probe ------------------------------------------------------
  const probe = spawn(process.execPath, [join(ROOT, 'scripts/console-probe.mjs'), String(PORT_HTTP)],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let probeOut = '';
  probe.stdout.on('data', d => { probeOut += d; });
  probe.stderr.on('data', d => { probeOut += d; });
  await new Promise(res => probe.on('close', res));
  console.log('--- console probe tail ---');
  console.log(probeOut.trim().split('\n').slice(-8).join('\n'));

  // --- 3. Lighthouse x2 ------------------------------------------------------
  const lhArgsBase = [
    join(process.env.LOCALAPPDATA || '', 'npm-cache/_npx/0f94ee7615faf582/node_modules/lighthouse/cli/index.js'),
    URL_APP, '--output=json', '--output-path=stdout',
    '--chrome-flags=--headless=new --disable-gpu --no-first-run --user-data-dir=' +
      join(process.env.TEMP || '.', 'lh-t20-profile').replace(/\\/g, '/'),
    '--only-categories=performance,accessibility,best-practices',
  ];
  for (const round of [1, 2]) {
    const t0 = Date.now();
    const res = spawn(process.execPath, [...lhArgsBase], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    res.stdout.on('data', d => { out += d; });
    res.stderr.on('data', d => { err += d; });
    const code = await new Promise(r2 => res.on('close', r2));
    if (code !== 0 || !out.trim().startsWith('{')) {
      throw new Error(`LH R${round} failed code=${code}: ${err.slice(-400)}`);
    }
    const rep = JSON.parse(out);
    const c = rep.categories;
    const scores = {
      perf: Math.round(c.performance.score * 100),
      a11y: Math.round(c.accessibility.score * 100),
      bp: Math.round(c['best-practices'].score * 100),
    };
    const a = rep.audits;
    console.log(`LH R${round}: P${scores.perf}/A${scores.a11y}/BP${scores.bp}` +
      ` (FCP ${(a['first-contentful-paint'].numericValue / 1000).toFixed(1)}s` +
      ` LCP ${(a['largest-contentful-paint'].numericValue / 1000).toFixed(1)}s` +
      ` CLS ${a['cumulative-layout-shift'].numericValue.toFixed(3)}` +
      ` TBT ${a['total-blocking-time'].numericValue.toFixed(0)}ms) [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
    writeFileSync(join(ROOT, `scripts/lh-report-r${round}.json`), out);
  }
  console.log('[ok] all browser gates done');
  process.exit(0);
} catch (err) {
  console.error(`[FAIL] ${err?.message ?? err}`);
  process.exit(1);
}

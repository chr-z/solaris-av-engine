#!/usr/bin/env node
/**
 * SOLARIS accessibility scan (turbo-web item 5).
 *
 * Zero new runtime deps: drives the SYSTEM Chrome over CDP (native WebSocket,
 * Node >=22), injects the local axe-core devDependency into the page and runs
 * WCAG A/AA scans against the production build served by `vite preview`.
 *
 * Phases:
 *   A) login screen (as rendered before any interaction)
 *   B) main app (guest/demo mode, local demo data)
 *
 * Usage: node scripts/axe-scan.mjs
 * Exit code: number of violations found (0 = clean), capped at 125.
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Random high ports: stray preview servers from earlier sessions are a real
// hazard on this machine — never assume a fixed port is free or ours.
const PORT_HTTP = 4200 + Math.floor(Math.random() * 500);
const PORT_CDP = 19300 + Math.floor(Math.random() * 500);
// `localhost` (not 127.0.0.1): vite preview may bind IPv6-only here.
const URL_APP = `http://localhost:${PORT_HTTP}/`;
const AXE_SOURCE = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { tries = 40, delayMs = 500, label = 'condition' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { lastErr = e; }
    await sleep(delayMs);
  }
  throw new Error(`timeout waiting for ${label}${lastErr ? `: ${lastErr}` : ''}`);
}

// ------------------------------------------------------------------ startup
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) throw new Error('system Chrome not found');
const userDataDir = mkdtempSync(join(tmpdir(), 'solaris-axe-'));

const viteProc = spawn(
  process.execPath,
  [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT_HTTP), '--strictPort'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
);
const chromeProc = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--mute-audio',
  '--window-size=1440,900',
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${PORT_CDP}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErrTail = '';
chromeProc.stderr.on('data', (d) => { chromeErrTail = (chromeErrTail + d).slice(-4000); });

function cleanup(code, note) {
  try { chromeProc.kill(); } catch {}
  try { viteProc.kill(); } catch {}
  if (note) console.error(note);
  process.exit(code);
}
process.on('exit', () => { try { chromeProc.kill(); viteProc.kill(); } catch {} });

try {
  await waitFor(async () => {
    const r = await fetch(URL_APP);
    if (!r.ok) throw new Error(`preview http ${r.status}`);
    return true;
  }, { label: 'vite preview server' });
  // Prove the served build IS this worktree's dist: the entry asset name in
  // the served HTML must match the one on disk. Stray servers on random high
  // ports are unlikely, but cheap to rule out.
  {
    const servedHtml = await (await fetch(URL_APP)).text();
    const servedEntry = servedHtml.match(/assets\/(index-[^"]+\.js)/)?.[1];
    const localEntry = readFileSync(join(ROOT, 'dist/index.html'), 'utf8')
      .match(/assets\/(index-[^"]+\.js)/)?.[1];
    if (!servedEntry || servedEntry !== localEntry) {
      throw new Error(`served dist mismatch! served=${servedEntry} local=${localEntry}`);
    }
    console.log(`[ok] serving verified as our dist (entry ${servedEntry})`);
  }
  console.log(`[ok] vite preview serving ${URL_APP}`);

  // ------------------------------------------------------------------- CDP
  const targets = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`);
    if (!r.ok) throw new Error(`cdp http ${r.status}`);
    const list = await r.json();
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target yet');
    return page;
  }, { tries: 24, label: 'chrome page target' });
  console.log(`[ok] chrome up (${targets.url}), connecting to tab socket`);
  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('websocket connect failed'));
    setTimeout(() => rej(new Error('websocket connect timeout')), 15000);
  });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`page eval failed: ${d.text}${d.exception?.description ? ` :: ${d.exception.description}` : ''}`);
    }
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const navigate = async (url) => {
    await send('Page.navigate', { url });
    await waitFor(async () => (await evaluate('document.readyState')) === 'complete', { label: `load ${url}` });
    await sleep(1200); // let late effects (fonts, gapi) settle before scanning
  };
  const injectAxe = () => evaluate(AXE_SOURCE);

  const scan = async (phase) => {
    const raw = await evaluate(`(async () => {
      const res = await window.axe.run(document, { resultTypes: ['violations'] });
      return JSON.stringify(res.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.length,
        sampleTargets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
        detail: v.nodes.slice(0, 30).map((n) => ({
          target: n.target.join(' '),
          html: (n.html || '').slice(0, 160),
          failureSummary: n.failureSummary || '',
        })),
      })));
    })()`);
    const violations = JSON.parse(raw);
    console.log(`\n=== PHASE ${phase}: ${violations.length} violation rule(s) ===`);
    for (const v of violations.sort((a, b) => (a.impact ?? '').localeCompare(b.impact ?? ''))) {
      console.log(`[${v.impact ?? 'minor'}] ${v.id} — ${v.help} — ${v.nodes} node(s)\n    e.g. ${v.sampleTargets.join(' | ')}`);
    }
    return violations;
  };

  // ------------------------------------------------------------- phase A
  await navigate(URL_APP);
  // The app boots in 'initializing' (gapi/firebase bootstrap); the real
  // login screen only exists once that settles (or errors out). Wait for it.
  const findGuestBtnExpr = `(() => {
    const els = [...document.querySelectorAll('button, a, [role="button"]')];
    const b = els.find((x) => /guest|convidado|demo/i.test((x.textContent || '').trim()));
    return b ? (b.textContent || '').trim() : null;
  })()`;
  const guestLabel = await waitFor(() => evaluate(findGuestBtnExpr), {
    tries: 60, label: 'login screen render (guest button visible)',
  });
  console.log(`[ok] login screen ready, guest button: "${guestLabel}"`);
  await injectAxe();
  const loginViolations = await scan('A: LOGIN SCREEN');

  // ------------------------------------------------------------- phase B
  await evaluate(`(() => {
    const els = [...document.querySelectorAll('button, a, [role="button"]')];
    const b = els.find((x) => /guest|convidado|demo/i.test((x.textContent || '').trim()));
    b.click();
  })()`);
  console.log(`\n[ok] clicked guest button: "${guestLabel}"`);

  await waitFor(async () => {
    const state = await evaluate(`(() => ({
      tables: document.querySelectorAll('table').length,
      grids: document.querySelectorAll('[role="grid"]').length,
      headers: document.querySelectorAll('header').length,
      guestBtnGone: ![...document.querySelectorAll('button')]
        .some((x) => /guest|convidado|demo/i.test((x.textContent || '').trim())),
    }))()`);
    return (state.tables || state.grids || state.headers) > 0 && state.guestBtnGone;
  }, { tries: 30, label: 'main app render after guest login' });
  await sleep(1500); // let lazy chunks mount

  const appViolations = await scan('B: MAIN APP (GUEST/DEMO)');

  // --------------------------------------------------------------- report
  const summary = {
    generatedAt: new Date().toISOString(),
    build: `${URL_APP} (vite preview, production dist)`,
    engine: 'axe-core@' + (await evaluate('window.axe.version')),
    phases: {
      login: loginViolations,
      mainApp: appViolations,
    },
    totals: {
      loginRules: loginViolations.length,
      mainAppRules: appViolations.length,
      criticalOrSeriousMainApp: appViolations.filter((v) => v.impact === 'critical' || v.impact === 'serious').length,
    },
  };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(ROOT, 'scripts/axe-report.json'), JSON.stringify(summary, null, 2));
  console.log('\n[ok] report saved to scripts/axe-report.json');
  console.log(JSON.stringify(summary.totals));

  const exitCode = Math.min(summary.totals.loginRules + summary.totals.mainAppRules, 125);
  cleanup(exitCode);
} catch (err) {
  cleanup(126, `[axe-scan] FAILED: ${err?.message ?? err}\n[chromium stderr tail]\n${chromeErrTail}`);
}

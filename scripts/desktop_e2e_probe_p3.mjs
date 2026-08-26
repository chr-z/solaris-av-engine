#!/usr/bin/env node
/**
 * desktop_e2e_probe_p3.mjs — prova P3 (UI standalone sem nuvem) DENTRO do exe.
 *
 * Estende desktop_e2e_probe.mjs com as asserções deste tick:
 *   6. após entrar e abrir uma W.O., NÃO existe aba YouTube nem Google Drive
 *      (SourceSelector standalone só oferece fonte local);
 *   7. NÃO existe botão de upsell Pro ("Upgrade to Pro"/"Assinar o Pro");
 *   8. o texto "Google Drive" não aparece em lugar nenhum do DOM vivo.
 *
 * Critérios 1-5 do probe original continuam valendo (render, clique, zero
 * recurso remoto, zero endpoint proibido, console limpo).
 *
 * Usage: node scripts/desktop_e2e_probe_p3.mjs <path-to-exe>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXE = process.argv[2];
if (!EXE) { console.error('usage: node desktop_e2e_probe_p3.mjs <exe>'); process.exit(2); }

const PORT = 47400 + Math.floor(Math.random() * 1500);
const UDD = mkdtempSync(join(tmpdir(), 'solaris_e2e_p3_'));
// http://ipc.localhost = forma WINDOWS da origem de IPC do Tauri v2
// (equivalente ao ipc:// acima; ja allowlistada na CSP desde 2fafb29).
const TAURI_ORIGINS = ['tauri://', 'http://tauri.localhost', 'https://tauri.localhost', 'data:', 'blob:', 'about:', 'ipc://', 'http://ipc.localhost'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { bootMs: null, clicked: null, woClicked: null, tabs: [], upgradeBtn: false,
  driveTextInDom: false, remoteResources: [], forbiddenHits: [], consoleErrors: [],
  exceptions: [], afterWoTextSample: '' };

let child; let ws; let msgId = 0; const pending = new Map(); const listeners = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`cdp timeout ${method}`)); } }, 15000);
  });
}
function onEvent(method, fn) { listeners.push({ method, fn }); }

async function waitForTargets(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const pages = list.filter((t) => t.type === 'page');
      if (pages.length > 0) return pages;
    } catch { /* not up yet */ }
    await sleep(400);
  }
  throw new Error(`no CDP targets on :${PORT} after ${timeoutMs}ms`);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url);
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('ws error'));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else if (m.method) {
        for (const l of listeners) if (l.method === m.method) l.fn(m.params);
      }
    };
  });
}

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

const READINESS = `(() => { const b = document.body; return b ? b.innerText.replace(/\\s+/g,' ').trim().length : -1; })()`;
const BODY_TEXT = `document.body.innerText.replace(/\\s+/g," ").trim()`;

try {
  child = spawn(EXE, [], {
    cwd: UDD,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
      WEBVIEW2_USER_DATA_FOLDER: UDD,
    },
    stdio: 'ignore',
  });
  const t0 = Date.now();

  const pages = await waitForTargets();
  const page = pages.find((p) => /tauri/i.test(p.url)) || pages[0];
  await connect(page.webSocketDebuggerUrl);
  await send('Runtime.enable');

  onEvent('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') results.consoleErrors.push((p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  });
  onEvent('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    results.exceptions.push(String(d.text || '') + ' ' + String(d.exception?.description || '').slice(0, 160));
  });

  // 1) boot render
  const deadline = Date.now() + 30000;
  let textLen = -1;
  while (Date.now() < deadline) {
    try { textLen = await evalJs(READINESS); } catch { /* navigating */ }
    if (textLen > 40) break;
    await sleep(300);
  }
  if (textLen <= 40) throw new Error(`UI never rendered (bodyText=${textLen})`);
  results.bootMs = Date.now() - t0;

  // 2) standalone boots straight into the app (local session, no login wall)
  const CLICK_WO = `(() => {
    const rx = /WO-2024/i;
    const els = [...document.querySelectorAll('button,[role=button],tr,div,span')]
      .filter(e => e.offsetParent !== null && rx.test(e.innerText || ''));
    if (!els.length) return null;
    const el = els[els.length - 1]; // deepest match
    el.click();
    return (el.innerText || '').replace(/\\s+/g,' ').slice(0, 60);
  })()`;

  let woClicked = null;
  const woDeadline = Date.now() + 15000;
  while (Date.now() < woDeadline) {
    try { woClicked = await evalJs(CLICK_WO); } catch { woClicked = null; }
    if (woClicked) break;
    await sleep(500);
  }
  results.woClicked = woClicked;
  if (!woClicked) throw new Error('no W.O. row found/clickable in standalone boot');

  // 3) wait for the video/source panel to mount (SourceSelector appears)
  const srcDeadline = Date.now() + 15000;
  let tabs = [];
  while (Date.now() < srcDeadline) {
    try {
      tabs = JSON.parse(await evalJs(`(() => JSON.stringify([...document.querySelectorAll('[role=tab]')].map(t => (t.innerText||'').replace(/\\s+/g,' ').trim())))()`));
    } catch { tabs = []; }
    if (tabs.length > 0) break;
    await sleep(400);
  }
  results.tabs = tabs;

  // 4) cloud-affordance absence proofs
  results.upgradeBtn = await evalJs(`(() => !![...document.querySelectorAll('button,[role=button]')].find(b => !b.disabled && b.offsetParent !== null && /(upgrade to pro|assinar o pro)/i.test(b.innerText || '')))()`);
  const htmlNow = await evalJs('document.documentElement.outerHTML');
  results.driveTextInDom = htmlNow.includes('Google Drive');
  results.syncBtnInDom = htmlNow.includes('Sincronizar com planilha');
  const FORBIDDEN = ['accounts.google.com', 'firebaseio.com', 'identitytoolkit', 'securetoken.net', 'ui-avatars.com'];
  for (const f of FORBIDDEN) if (htmlNow.includes(f)) results.forbiddenHits.push(f);

  results.afterWoTextSample = (await evalJs(BODY_TEXT)).slice(0, 500);

  // 5) behavioral zero-cloud proof
  const urls = JSON.parse(await evalJs(`(() => JSON.stringify(performance.getEntriesByType('resource').map(r => r.name)))()`));
  results.remoteResources = urls.filter((u) => !TAURI_ORIGINS.some((o) => u.startsWith(o)));

  const fails = [];
  if (!results.bootMs) fails.push('no render');
  if (!(tabs.length === 1 && /local/i.test(tabs[0]))) fails.push('source tabs not [Local]-only: ' + JSON.stringify(tabs));
  if (results.upgradeBtn) fails.push('Pro upsell button visible in standalone');
  if (results.driveTextInDom) fails.push('"Google Drive" text present in live DOM');
  if (results.syncBtnInDom) fails.push('"Sincronizar com planilha" button visible in standalone');
  if (results.forbiddenHits.length) fails.push('forbidden endpoints in DOM: ' + results.forbiddenHits.join(','));
  if (results.remoteResources.length) fails.push('remote fetches: ' + results.remoteResources.join(','));
  if (results.consoleErrors.length) fails.push('console errors: ' + JSON.stringify(results.consoleErrors));
  if (results.exceptions.length) fails.push('exceptions: ' + JSON.stringify(results.exceptions));

  console.log(JSON.stringify({
    verdict: fails.length === 0 ? 'DESKTOP_E2E_P3_PASS' : 'DESKTOP_E2E_P3_FAIL',
    fails, ...results,
  }, null, 2));
  process.exitCode = fails.length === 0 ? 0 : 1;
} catch (err) {
  console.log(JSON.stringify({ verdict: 'DESKTOP_E2E_P3_FAIL', fatal: String(err).slice(0, 400), partial: results }, null, 2));
  process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === 1) ws.close(); } catch {}
  try { if (child && !child.killed) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  await sleep(800);
  try { rmSync(UDD, { recursive: true, force: true }); } catch {}
}

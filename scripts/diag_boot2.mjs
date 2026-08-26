#!/usr/bin/env node
/** diag_boot2.mjs — diagnostico profundo: erros de boot + mount real do React. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXE = process.argv[2];
const PORT = 47500 + Math.floor(Math.random() * 800);
const UDD = mkdtempSync(join(tmpdir(), 'solaris_diag2_'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws; let msgId = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`cdp timeout ${method}`)); } }, 15000);
  });
}
async function waitForTargets(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const pages = list.filter((t) => t.type === 'page');
      if (pages.length > 0) return pages;
    } catch {}
    await sleep(400);
  }
  throw new Error('no cdp targets');
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
      }
    };
  });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __evalError: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200) };
  return r.result.value;
}

const child = spawn(EXE, [], {
  cwd: UDD,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: UDD,
  },
  stdio: 'ignore',
});
try {
  const pages = await waitForTargets();
  const page = pages.find((p) => /tauri/i.test(p.url)) || pages[0];
  await connect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  // Coletor de erros instalado ANTES de qualquer script da página.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__diagErrs=[];window.addEventListener('error',function(e){window.__diagErrs.push('ERR: '+e.message+' @'+(e.filename||'')+':'+e.lineno)});window.addEventListener('unhandledrejection',function(e){window.__diagErrs.push('REJ: '+String(e.reason&&e.reason.message||e.reason).slice(0,150))});`,
  });
  await send('Page.reload', { ignoreCache: true });
  await sleep(6000);
  const out = {};
  out.href = await evalJs('location.href');
  out.rootChildren = await evalJs(`document.getElementById('root') ? document.getElementById('root').childElementCount : 'no-root'`);
  out.diagErrs = await evalJs('JSON.stringify(window.__diagErrs||[])');
  out.bodySample = await evalJs(`document.body ? document.body.innerText.replace(/\\s+/g,' ').trim().slice(0,300) : 'no-body'`);
  const modErr = await evalJs(`(() => { try { JSON.stringify(Object.fromEntries(Object.entries(window.localStorage))) } catch(e) { return 'LS_ERR: '+e.message } })()`);
  out.localStorage = modErr;
  console.log(JSON.stringify(out, null, 2));
} finally {
  try { child.kill(); } catch {}
  setTimeout(() => { try { rmSync(UDD, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
}

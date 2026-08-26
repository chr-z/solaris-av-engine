#!/usr/bin/env node
/** diag_targets.mjs — lista TODOS os targets CDP e testa navegacao tauri.localhost. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXE = process.argv[2];
const PORT = 47500 + Math.floor(Math.random() * 800);
const UDD = mkdtempSync(join(tmpdir(), 'solaris_diag3_'));
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
async function listTargets() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      return await res.json();
    } catch {}
    await sleep(400);
  }
  throw new Error('no cdp');
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
  if (r.exceptionDetails) return { __evalError: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160) };
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
  await sleep(1500);
  const targets = await listTargets();
  console.log('TARGETS:', JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url })), null, 1));
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  await connect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  // tenta navegar pro protocolo do Tauri explicitamente
  await send('Page.navigate', { url: 'http://tauri.localhost/' });
  await sleep(5000);
  console.log('AFTER_NAV:', JSON.stringify({
    href: await evalJs('location.href'),
    rootChildren: await evalJs(`document.getElementById('root') ? document.getElementById('root').childElementCount : 'no-root'`),
    bodySample: await evalJs(`document.body ? document.body.innerText.replace(/\\s+/g,' ').trim().slice(0,200) : 'no-body'`),
  }, null, 1));
} finally {
  try { child.kill(); } catch {}
  setTimeout(() => { try { rmSync(UDD, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
}

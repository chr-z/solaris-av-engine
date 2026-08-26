#!/usr/bin/env node
/** diag_boot.mjs — diagnostico do boot dentro do exe (DOM/storage/URL). */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXE = process.argv[2];
const PORT = 47500 + Math.floor(Math.random() * 800);
const UDD = mkdtempSync(join(tmpdir(), 'solaris_diag_'));
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
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
  await send('Runtime.enable');
  const deadline = Date.now() + 30000;
  let textLen = -1;
  while (Date.now() < deadline) {
    try { textLen = await evalJs('document.body ? document.body.innerText.replace(/\\s+/g," ").trim().length : -1'); } catch {}
    if (textLen > 40) break;
    await sleep(300);
  }
  await sleep(2000);
  const href = await evalJs('location.href');
  const lsKeys = await evalJs('JSON.stringify(Object.fromEntries(Object.entries(window.localStorage)))');
  const bodyText = await evalJs('document.body.innerText.replace(/\\s+/g," ").trim().slice(0, 600)');
  const counts = await evalJs('JSON.stringify({buttons: document.querySelectorAll("button").length, tabs: document.querySelectorAll("[role=tab]").length, rows: document.querySelectorAll("tr").length, woText: (/WO-\\d{4}/i.test(document.body.innerText))})');
  console.log(JSON.stringify({ href, lsKeys: JSON.parse(lsKeys), counts: JSON.parse(counts), bodyText }, null, 2));
} finally {
  try { child.kill(); } catch {}
  try { rmSync(UDD, { recursive: true, force: true }); } catch {}
}

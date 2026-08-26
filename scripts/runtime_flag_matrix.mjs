#!/usr/bin/env node
/**
 * runtime_flag_matrix.mjs — matriz de provas do flag STANDALONE_MODE (P3).
 *
 * Dentro do exe real, via CDP, para cada caso:
 *   A1: env STANDALONE_MODE=1  ⇒ opinião aplicada, modo standalone.
 *   A2: env ausente            ⇒ nenhuma opinião aplicada; modo = sinal local
 *       (exe é nato-standalone pelo runtime Tauri).
 *   A3: env STANDALONE_MODE=0  ⇒ GUARDA anti-rebaixamento: opinião cloud não
 *       se aplica em artefato que já nasceu sem nuvem; modo segue standalone.
 *
 * Uso: node scripts/runtime_flag_matrix.mjs <exe>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXE = process.argv[2];
if (!EXE) { console.error('usage: node runtime_flag_matrix.mjs <exe>'); process.exit(2); }
const PORT = 47900 + Math.floor(Math.random() * 600);
const UDD = mkdtempSync(join(tmpdir(), 'solaris_flag_'));
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
  if (r.exceptionDetails) throw new Error('eval failed: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200));
  return r.result.value;
}

async function bootOnce(extraEnv) {
  // janela + user-data-dir novos por caso (storage isolado)
  const udd = mkdtempSync(join(tmpdir(), 'solaris_case_'));
  const child = spawn(EXE, [], {
    cwd: udd,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
      WEBVIEW2_USER_DATA_FOLDER: udd,
      ...extraEnv,
    },
    stdio: 'ignore',
  });
  try {
    const pages = await waitForTargets();
    const page = pages.find((p) => /tauri/i.test(p.url)) || pages[0];
    await connect(page.webSocketDebuggerUrl);
    await send('Runtime.enable');
    // espera o app hidratar (body com texto > 40)
    const deadline = Date.now() + 30000;
    let textLen = -1;
    while (Date.now() < deadline) {
      try { textLen = await evalJs('document.body ? document.body.innerText.replace(/\\s+/g," ").trim().length : -1'); } catch {}
      if (textLen > 40) break;
      await sleep(300);
    }
    if (textLen <= 40) throw new Error('ui never rendered');
    await sleep(800);
    return await evalJs(`(() => {
      const ls = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k.indexOf('solaris.') === 0) ls[k] = window.localStorage.getItem(k);
      }
      return JSON.stringify({
        applied: ls['solaris.runtimeModeRemoteApplied'] ?? null,
        override: ls['solaris.runtimeMode'] ?? null,
        woVisible: /WO-2024/i.test(document.body.innerText),
      });
    })()`);
  } finally {
    try { child.kill(); } catch {}
    setTimeout(() => { try { rmSync(udd, { recursive: true, force: true }); } catch {} }, 400);
  }
}

const cases = [
  ['A1_env=1', { STANDALONE_MODE: '1' }],
  ['A2_sem_env', {}],
  ['A3_env=0_guarda', { STANDALONE_MODE: '0' }],
];

const results = {};
for (const [name, env] of cases) {
  results[name] = JSON.parse(await bootOnce(env));
  await sleep(1200);
}
console.log(JSON.stringify({ port: PORT, results }, null, 2));
setTimeout(() => { try { rmSync(UDD, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);

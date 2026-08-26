#!/usr/bin/env node
/**
 * web_flag_serve.mjs — Experimento B do P3 runtime flag (deploy WEB).
 *
 * Serve o build CLOUD (dist/ com SDK Firebase real embarcado) em localhost e
 * prova que o arquivo de config do deploy liga/desliga o modo sem rebuild:
 *
 *   B1: dist + solaris.config.json {"standaloneMode":true}
 *       ⇒ app entra DIRETO (login wall do Google contornada), W.O.s visíveis,
 *         opinião 'standalone' persistida.
 *   B2: mesmo servidor SEM o arquivo (perfil limpo)
 *       ⇒ login wall volta (modo cloud nativo), nada aplicado.
 *
 * Uso: node scripts/web_flag_serve.mjs [distDir]
 */
import { createServer } from 'node:http';
import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { spawn, execSync } from 'node:child_process';

const DIST = process.argv[2] || join(process.cwd(), 'dist');
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist inválido: ' + DIST);
  process.exit(2);
}
const PORT = 42100 + Math.floor(Math.random() * 300); // fora das faixas reservadas (netsh excludedportrange)
const CDPPORT = 43100 + Math.floor(Math.random() * 190); // idem
const BASE = `http://localhost:${PORT}/`;
const CONFIG = join(DIST, 'solaris.config.json');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE);
    let rel = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (rel === '') rel = 'index.html';
    const file = join(DIST, rel);
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'cache-control': 'no-store' });
    res.end('not found');
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeOnce(label) {
  const udd = await mkdtemp(join(tmpdir(), 'solaris_webexp_'));
  // stub do service worker ANTES dos scripts da página: o experimento não pode
  // ter cache interferindo na fase de reversão.
  await writeFile(join(udd, 'swstub.js'), `
    navigator.serviceWorker.register = () => Promise.reject(new Error('sw-disabled-exp'));
    window.__swStubbed = true;
  `, 'utf8');
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--user-data-dir=${udd}`,
    `--remote-debugging-port=${CDPPORT}`,
    'about:blank',
  ];
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const bin = existsSync(chrome) ? chrome : EDGE;
  const child = spawn(bin, args, { stdio: 'ignore' });

  let ws; let msgId = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout')); } }, 15000);
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200));
    return r.result.value;
  };
  const out = { phase: label, browser: bin.includes('chrome') ? 'chrome' : 'edge' };
  try {
    // espera CDP
    let pages = null;
    const deadline0 = Date.now() + 25000;
    while (Date.now() < deadline0) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDPPORT}/json/list`);
        const list = await res.json();
        pages = list.filter((t) => t.type === 'page');
        if (pages.length) break;
      } catch {}
      await sleep(400);
    }
    if (!pages || !pages.length) throw new Error('no cdp targets');
    const wsConn = new Promise((resolve, reject) => {
      ws = new WebSocket(pages[0].webSocketDebuggerUrl);
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
    await wsConn;
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `navigator.serviceWorker.register=()=>Promise.reject(new Error('sw-disabled-exp'));`,
    });
    await send('Page.navigate', { url: BASE });
    const deadline = Date.now() + 40000;
    let len = -1;
    while (Date.now() < deadline) {
      try { len = await evalJs('document.body ? document.body.innerText.replace(/\\s+/g," ").trim().length : -1'); } catch {}
      if (len > 30) break;
      await sleep(300);
    }
    await sleep(2500);
    out.bodySample = await evalJs(`document.body.innerText.replace(/\\s+/g,' ').trim().slice(0,220)`);
    out.state = JSON.parse(await evalJs(`(() => {
      const ls = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        ls[k] = window.localStorage.getItem(k);
      }
      return JSON.stringify({
        applied: ls['solaris.runtimeModeRemoteApplied'] ?? null,
        woVisible: /WO-2024/i.test(document.body.innerText),
        loginWall: /sign in|entrar com google|continue with google/i.test(document.body.innerText),
      });
    })()`));
  } catch (e) {
    out.error = String(e.message || e).slice(0, 200);
  } finally {
    try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
    setTimeout(() => { try { rm(udd, { recursive: true, force: true }); } catch {} }, 800);
  }
  return out;
}

server.listen(PORT, async () => {
  const report = { base: BASE };
  // Fase B1: config standalone presente
  await writeFile(CONFIG, JSON.stringify({ standaloneMode: true }), 'utf8');
  report.b1_configOn = await probeOnce('B1');
  await sleep(1500);
  // Fase B2: arquivo removido — deploy "voltou atrás"
  await rm(CONFIG, { force: true });
  report.b2_configOff = await probeOnce('B2');
  console.log(JSON.stringify(report, null, 2));
  server.close();
  process.exit(0);
});

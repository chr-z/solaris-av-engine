#!/usr/bin/env node
/** web_diag.mjs — diagnostico do boot web no chrome headless (console+erros). */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn, execSync } from 'node:child_process';

const DIST = join(process.cwd(), 'dist');
const PORT = 42500 + Math.floor(Math.random() * 200); // fora das faixas reservadas
const CDP = 43300 + Math.floor(Math.random() * 200); // fora das faixas reservadas
const BASE = `http://localhost:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE);
    let rel = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (rel === '') rel = 'index.html';
    const body = await readFile(join(DIST, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] || 'application/octet-stream' });
    res.end(body);
    console.log('[srv] 200', req.url);
  } catch {
    res.writeHead(404); res.end('nf');
    console.log('[srv] 404', req.url);
  }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
server.listen(PORT);

const udd = mkdtempSync(join(tmpdir(), 'solaris_webdiag_'));
const bin = existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe') ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${udd}`, `--remote-debugging-port=${CDP}`, 'about:blank'], { stdio: 'ignore' });

let ws; let msgId = 0; const pending = new Map(); const logs = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('to')); } }, 15000);
  });
}
try {
  let pages = null;
  const dl = Date.now() + 25000;
  while (Date.now() < dl) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      pages = list.filter((t) => t.type === 'page');
      if (pages.length) break;
    } catch {}
    await sleep(400);
  }
  await new Promise((resolve, reject) => {
    ws = new WebSocket(pages[0].webSocketDebuggerUrl);
    ws.onopen = resolve; ws.onerror = () => reject(new Error('ws'));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        logs.push('console.' + m.params.type + ': ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 180));
      } else if (m.method === 'Runtime.exceptionThrown') {
        logs.push('EXC: ' + String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 220));
      } else if (m.method === 'Log.entryAdded') {
        logs.push('log.' + m.params.entry.level + ': ' + String(m.params.entry.text).slice(0, 180));
      }
    };
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(12000);
  const r1 = await send('Runtime.evaluate', { expression: `JSON.stringify({href:location.href, rs:document.readyState, bl:document.body.innerText.trim().length, scripts:[...document.scripts].map(s=>s.src||'inline').slice(0,8)})`, returnByValue: true });
  console.log('PAGE:', r1.result.value);
  console.log('LOGS:', JSON.stringify(logs.slice(0, 20), null, 1));
} catch (e) {
  console.log('ERR:', e.message);
} finally {
  try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  try { rmSync(udd, { recursive: true, force: true }); } catch {}
  server.close();
  process.exit(0);
}

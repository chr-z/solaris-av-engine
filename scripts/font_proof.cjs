#!/usr/bin/env node
// redesign tick 24 — prova de fonte: confirma que a Inter/JetBrains Mono
// (font-display:optional) realmente aplicam no build servido, e captura o
// computed style do h1. Uso: SHOT_URL=http://localhost:PORT/ node scripts/font_proof.cjs
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9231;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-fontproof-' + Date.now());
const URL_APP = process.env.SHOT_URL || 'http://localhost:4321/';

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--no-first-run', `--user-data-dir=${PROFILE}`,
    'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { chrome.kill(); process.exit(2); }, 60000);
  try {
    let targets = null;
    for (let i = 0; i < 30 && !targets; i++) {
      await sleep(500);
      try { targets = await httpGetJson(`http://127.0.0.1:${PORT}/json/list`); } catch (e) {}
    }
    if (!targets) throw new Error('devtools nao subiu');
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let mid = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
    const send = (method, params) => new Promise((resolve, reject) => {
      pending.set(++mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};
               window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};`,
    });
    await send('Page.navigate', { url: URL_APP });
    await sleep(6000);

    const expr = `(() => {
      const el = document.querySelector('h1') || document.body;
      const cs = getComputedStyle(el);
      return {
        fontFamilyComputed: cs.fontFamily,
        inter400Loaded: document.fonts.check('16px Inter'),
        mono400Loaded: document.fonts.check('12px "JetBrains Mono"'),
        loadedFaces: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight),
      };
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    console.log(JSON.stringify(r.result.value, null, 1));
    clearTimeout(hardExit);
    ws.close();
  } finally { chrome.kill(); }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

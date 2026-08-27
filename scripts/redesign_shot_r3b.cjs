// Captura v3 (R3 restante): fila premium + empty state filtrado + diálogo QC
// + erro humano no login. Protocolo anti-órfão: sobe o PRÓPRIO vite preview
// em porta aleatória alta, prova qual build está sendo servido (hash do entry),
// usa profile/temp únicos e mata chrome+preview no finally.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
const REPO = 'C:/Yui/data/saas/solaris-redesign';
const PREVIEW_PORT = 4300 + Math.floor(Math.random() * 400);
const CDP_PORT = 9400 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PREVIEW_PORT}`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-shot-r3b-' + Date.now());

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { spawn } = require('child_process');

  // [A] prova de build: hash do entry no dist local
  const distIndex = fs.readFileSync(path.join(REPO, 'dist', 'index.html'), 'utf8');
  const localEntry = (distIndex.match(/assets\/index-[^"]+\.js/) || [])[0];
  if (!localEntry) throw new Error('dist/index.html sem entry');

  // [B] sobe preview próprio
  console.log('[0] vite preview porta', PREVIEW_PORT);
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT),
    '--strictPort', '--host', '127.0.0.1'], { cwd: REPO, stdio: 'ignore', shell: true });
  let served = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { served = await httpGet(`${BASE}/`); break; } catch (e) {}
  }
  if (!served) throw new Error('preview nao subiu');
  const servedEntry = (served.match(/assets\/index-[^"]+\.js/) || [])[0];
  console.log('[0.5] build servida == dist local?', servedEntry === localEntry,
    `(servida=${servedEntry}, local=${localEntry})`);
  if (servedEntry !== localEntry) throw new Error('preview servindo OUTRO build!');

  // [C] chrome headless + CDP
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { console.log('[!] timeout global'); chrome.kill(); preview.kill(); process.exit(2); }, 170000);

  try {
    let targets = null;
    for (let i = 0; i < 30 && !targets; i++) {
      await sleep(500);
      try { targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`)); } catch (e) {}
    }
    if (!targets) throw new Error('devtools nao subiu');
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); setTimeout(() => j(new Error('ws')), 15000); });
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
    const send = (method, params) => new Promise((resolve, reject) => { pending.set(++mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
    const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};`,
    });

    // ---- PASSO 1: navega, espera login, entra como guest
    await send('Page.navigate', { url: `${BASE}/` });
    let logged = false;
    for (let i = 0; i < 45 && !logged; i++) {
      await sleep(1000);
      try {
        await evalJs(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`);
        logged = (await evalJs(`document.querySelectorAll('ul li').length > 0`)) === true;
      } catch (e) {}
    }
    if (!logged) throw new Error('guest/fila falhou');
    await sleep(2000);

    // ---- SHOT A: fila com dados (anatomia MVP, acabamento v3)
    let s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'r3b_fila.png'), Buffer.from(s.data, 'base64'));
    console.log('[1] r3b_fila.png ok');

    // ---- SHOT B: empty state contextual — busca sem resultado
    await evalJs(`(() => {
      const input = document.querySelector('input[type="text"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'zzzz-sem-resultado');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(1500);
    const empties = await evalJs(`document.querySelectorAll('[data-testid="queue-empty"]').length`);
    s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'r3b_fila_vazia.png'), Buffer.from(s.data, 'base64'));
    console.log('[2] r3b_fila_vazia.png ok — empty-states na DOM:', empties);

    // limpa a busca
    await evalJs(`(() => {
      const input = document.querySelector('input[type="text"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(800);

    // ---- SHOT C: diálogo do relatório QC
    await evalJs(`[...document.querySelectorAll('button')].find(b => /export qc report/i.test(b.getAttribute('aria-label') || '') || /qc report/i.test(b.textContent))?.click()`);
    let qc = false;
    for (let i = 0; i < 10 && !qc; i++) {
      await sleep(700);
      qc = (await evalJs(`!!document.querySelector('.qc-export-popup [role="dialog"], .qc-export-popup .card-raised') || !!document.querySelector('.qc-export-popup')`)) === true;
    }
    await sleep(600);
    s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'r3b_qc_dialog.png'), Buffer.from(s.data, 'base64'));
    console.log('[3] r3b_qc_dialog.png ok — dialog:', qc);

    // ---- SHOT D: erro humano no login (popup bloqueado pela rede cortada)
    await send('Page.navigate', { url: `${BASE}/` });
    let loginVisible = false;
    for (let i = 0; i < 40 && !loginVisible; i++) {
      await sleep(1000);
      loginVisible = (await evalJs(`!![...document.querySelectorAll('button')].find(b => /google/i.test(b.textContent))`).catch(() => false)) === true;
    }
    if (!loginVisible) throw new Error('login não apareceu');
    // clica no botão Google → popup falha (rede bloqueada) → erro humanizado
    await evalJs(`[...document.querySelectorAll('button')].find(b => /google/i.test(b.textContent))?.click()`);
    let errBox = false;
    for (let i = 0; i < 12 && !errBox; i++) {
      await sleep(1000);
      errBox = (await evalJs(`!!document.querySelector('[role="alert"]')`)) === true;
    }
    await sleep(500);
    s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'r3b_login_erro.png'), Buffer.from(s.data, 'base64'));
    console.log('[4] r3b_login_erro.png ok — alert visivel:', errBox);

    clearTimeout(hardExit);
    ws.close();
  } finally {
    chrome.kill();
    preview.kill();
    setTimeout(() => process.exit(0), 500);
  }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

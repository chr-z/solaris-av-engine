// Captura v3 (R3): entra como guest, abre a PRIMEIRA linha da fila (tela de
// análise: player + timeline + painel) e fotografa. Reusa o protocolo
// anti-órfão: porta via SHOT_URL, stubs gapi/google, bloqueio de rede Google.
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
const PORT = 9229;
const PREFIX = process.env.SHOT_PREFIX || 'r3';
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-shot-' + Date.now());

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
  const { spawn } = require('child_process');
  console.log('[0] subindo chrome headless');
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const hardExit = setTimeout(() => { console.log('[!] timeout global'); chrome.kill(); process.exit(2); }, 150000);

  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try { targets = await httpGetJson(`http://127.0.0.1:${PORT}/json/list`); break; } catch (e) {}
    }
    if (!targets) throw new Error('devtools nao subiu');

    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.addEventListener('open', r);
      ws.addEventListener('error', j);
      setTimeout(() => j(new Error('ws timeout')), 15000);
    });
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
    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.gapi = { load: (n, o) => o && o.callback && o.callback(), client: { init: async () => ({}), setToken: () => {} } };
        window.google = { accounts: { oauth2: { initTokenClient: (c) => ({ requestAccessToken: () => c && c.error_callback && c.error_callback({ type: 'stub' }) }) } } };
      `,
    });

    await send('Page.navigate', { url: process.env.SHOT_URL || 'http://localhost:4321/' });

    // espera botão guest e clica
    let clicked = false;
    for (let i = 0; i < 40 && !clicked; i++) {
      await sleep(1000);
      try {
        await send('Runtime.evaluate', {
          expression: `[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`,
          returnByValue: true,
        });
        // a fila é uma <ul> com <li> clicáveis (ListItem), não table
        const r = await send('Runtime.evaluate', {
          expression: `document.querySelectorAll('main li, ul li').length > 0`,
          returnByValue: true,
        });
        clicked = r.result.value === true;
      } catch (e) {}
    }
    if (!clicked) throw new Error('guest/login falhou');
    console.log('[1] guest ok, tabela visivel');

    // espera linhas da fila carregarem (demo) — <li> clicáveis
    let rows = 0;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const r = await send('Runtime.evaluate', {
        expression: `document.querySelectorAll('ul li').length`,
        returnByValue: true,
      }).catch(() => ({ result: { value: 0 } }));
      rows = r.result.value || 0;
      if (rows > 0) break;
    }
    if (!rows) throw new Error('fila demo nao carregou');
    console.log('[2] itens na fila:', rows);

    // clica no primeiro item clicável da fila → abre o workspace de análise
    await send('Runtime.evaluate', {
      expression: `(() => { const li = [...document.querySelectorAll('ul li')].find(el => el.onclick || el.getAttribute('tabindex') !== null || el.className.includes('cursor')) || document.querySelector('ul li'); li?.click(); return !!li; })()`,
      returnByValue: true,
    });
    console.log('[3] clique na primeira OS');

    // workspace aberto? (procura painel Analysis Sheet / player)
    let open = false;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const r = await send('Runtime.evaluate', {
        expression: `document.body.innerText.includes('Analysis Sheet') || document.body.innerText.includes('RGB Parade')`,
        returnByValue: true,
      }).catch(() => ({ result: { value: false } }));
      open = r.result.value === true;
      if (open) break;
    }
    console.log('[4] workspace de analise:', open);

    // dá tempo do layout/monitores estabilizarem
    await sleep(4000);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, PREFIX + '_analysis.png'), Buffer.from(s.data, 'base64'));
    console.log('[5] analysis shot ok');
    clearTimeout(hardExit);
    ws.close();
  } finally { chrome.kill(); }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

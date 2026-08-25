// Capturas v3 (robusto): bloqueia URLs do Google via Network.setBlockedURLs,
// espera LoginScreen (timeout controlado do app), fotografa, entra como guest
// e fotografa o workspace com dados demo. Logs por fase.
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
const PORT = 9227;
const PREFIX = process.env.SHOT_PREFIX || 'r2'; // prefixo do arquivo de saída por pacote
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

  const hardExit = setTimeout(() => { console.log('[!] timeout global'); chrome.kill(); process.exit(2); }, 110000);

  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try { targets = await httpGetJson(`http://127.0.0.1:${PORT}/json/list`); break; } catch (e) {}
    }
    if (!targets) throw new Error('devtools nao subiu');
    console.log('[1] devtools ok');

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
    // Stubs do gapi/google ANTES dos scripts da página: leva o app direto ao
    // estado signedOut (LoginScreen) sem depender de rede do Google.
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.gapi = { load: (n, o) => o && o.callback && o.callback(), client: { init: async () => ({}), setToken: () => {} } };
        window.google = { accounts: { oauth2: { initTokenClient: (c) => ({ requestAccessToken: () => c && c.error_callback && c.error_callback({ type: 'stub' }) }) } } };
      `,
    });
    console.log('[2] stubs injetados');
    console.log('[2] network pronto');

    // IMPORTANTE: 127.0.0.1 explícito — localhost resolve p/ ::1 no Chrome e
    // ::1:4173 é o preview do worker turbo (outro build!)
    await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
    console.log('[3] navegou, esperando login screen');

    // espera botão guest (aparece após timeout do gapi ~10s)
    let clicked = 'timeout';
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      try {
        const r = await send('Runtime.evaluate', {
          expression: `[...document.querySelectorAll('button')].some(b => /guest|convidado/i.test(b.textContent))`,
          returnByValue: true,
        });
        if (r.result.value === true) {
          const s1 = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(OUT, PREFIX + '_login.png'), Buffer.from(s1.data, 'base64'));
          console.log('[4] login shot ok');
          await sleep(500);
          await send('Runtime.evaluate', {
            expression: `[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent)).click()`,
            returnByValue: true,
          });
          clicked = 'clicked';
          break;
        }
      } catch (e) { /* página recarregando */ }
    }
    console.log('[5] guest:', clicked);
    if (clicked !== 'clicked') throw new Error('botao guest nunca apareceu');

    let rows = 0;
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      try {
        const r = await send('Runtime.evaluate', {
          expression: `(document.body.innerText.includes('WO-2024') ? 1 : 0) + document.querySelectorAll('main li').length`,
          returnByValue: true,
        });
        rows = r.result.value || 0;
        if (rows > 1) break;
      } catch (e) {}
    }
    await sleep(3000);
    const s2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, PREFIX + '_workspace.png'), Buffer.from(s2.data, 'base64'));
    console.log('[6] workspace shot ok, tbody rows =', rows);
    clearTimeout(hardExit);
    ws.close();
  } finally { chrome.kill(); }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

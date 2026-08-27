// Debug: inspeciona os checkboxes do painel de regras no workspace (demo).
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const REPO = 'C:/Yui/data/saas/solaris-redesign';
const PREVIEW_PORT = 4700 + Math.floor(Math.random() * 200);
const CDP_PORT = 9700 + Math.floor(Math.random() * 200);
const BASE = `http://localhost:${PREVIEW_PORT}`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-dbg-' + Date.now());

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { spawn } = require('child_process');
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: REPO, stdio: 'ignore', shell: true });
  let served = null;
  for (let i = 0; i < 40 && !served; i++) { await sleep(500); try { served = await httpGet(`${BASE}/`); } catch (e) {} }
  if (!served) throw new Error('preview nao subiu');

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { chrome.kill(); preview.kill(); process.exit(2); }, 240000);

  try {
    let targets = null;
    for (let i = 0; i < 30 && !targets; i++) { await sleep(500); try { targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`)); } catch (e) {} }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); setTimeout(() => j(new Error('ws')), 15000); });
    let mid = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
    });
    const send = (method, params) => new Promise((resolve, reject) => { pending.set(++mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r && r.exceptionDetails) throw new Error('page eval: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 500));
      return r && r.result ? r.result.value : undefined;
    };

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};`,
    });

    await send('Page.navigate', { url: `${BASE}/` });
    let loginVisible = false;
    for (let i = 0; i < 40 && !loginVisible; i++) {
      await sleep(1000);
      loginVisible = (await evalJs(`!![...document.querySelectorAll('button')].find(b => /google/i.test(b.textContent))`).catch(() => false)) === true;
    }
    await evalJs(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`);
    let guestGone = false;
    for (let i = 0; i < 25 && !guestGone; i++) { await sleep(1000); guestGone = (await evalJs(`![...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))`).catch(() => false)) === true; }
    console.log('[1] guest dentro:', guestGone);

    // abre WO-2024-101
    for (let i = 0; i < 20; i++) { await sleep(1000); const ok = await evalJs(`(()=>{const li=[...document.querySelectorAll('ul li')].find(el=>el.textContent.includes('WO-2024-101'));if(li){li.click();return true}return false})()`); if (ok) break; }
    let open = false;
    for (let i = 0; i < 20 && !open; i++) { await sleep(1000); open = (await evalJs(`document.body.innerText.includes('Analysis Sheet') || document.body.innerText.includes('RGB Parade')`)) === true; }
    console.log('[2] workspace:', open);
    await sleep(3000);

    // inventário de abas
    const tabs = await evalJs(`[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>['Framing','Lighting','Video Quality','Scenery & Assets','Audio'].includes(t))`);
    console.log('[3] abas visíveis:', JSON.stringify(tabs));

    for (const tab of ['Lighting', 'Audio']) {
      await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '${tab}')?.click()`);
      await sleep(800);
      const inv = await evalJs(`(() => ({
        checksAll: document.querySelectorAll('input[type=checkbox]').length,
        uncheck: [...document.querySelectorAll('input[type=checkbox]')].filter(c=>!c.checked).length,
        labels: [...document.querySelectorAll('label')].map(l=>l.innerText.trim().slice(0,40)).filter(Boolean).slice(0,14),
      }))()`);
      console.log(`[${tab}]`, JSON.stringify(inv));
    }

    clearTimeout(hardExit);
    ws.close();
  } finally {
    chrome.kill();
    preview.kill();
  }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

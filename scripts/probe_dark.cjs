// Probe pontual: por que o dark: não aplica nos Docks? Estado real do DOM/CSS.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const REPO = 'C:/Yui/data/saas/solaris-redesign';
const PREVIEW_PORT = 4700 + Math.floor(Math.random() * 200);
const CDP_PORT = 9700 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PREVIEW_PORT}`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-probe-' + Date.now());

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: REPO, stdio: 'ignore', shell: true });
  for (let i = 0; i < 40; i++) { await sleep(500); try { await httpGet(`${BASE}/`); break; } catch (e) {} }
  const chrome = spawn(CHROME, [`--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--disable-gpu', '--window-size=1600,900', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 30 && !targets; i++) { await sleep(500); try { targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`)); } catch (e) {} }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); setTimeout(() => j(new Error('ws')), 15000); });
    let mid = 0; const pending = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
    const send = (method, params) => new Promise((res, rej) => { pending.set(++mid, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
    const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

    await send('Page.enable'); await send('Runtime.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};` });

    await send('Page.navigate', { url: `${BASE}/` });
    for (let i = 0; i < 30; i++) { await sleep(1000); if ((await evalJs(`document.querySelectorAll('button').length>0`)) === true) break; }
    console.log('[login] htmlClass =', JSON.stringify(await evalJs(`document.documentElement.className`)));

    // entra guest
    for (let i = 0; i < 25; i++) {
      await evalJs(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`).catch(() => {});
      await sleep(1000);
      if ((await evalJs(`document.querySelectorAll('ul li').length>0`).catch(() => false)) === true) break;
    }
    // abre análise
    await evalJs(`(() => { const li=[...document.querySelectorAll('ul li')].find(el=>el.getAttribute('tabindex')!==null||el.className.includes('cursor'))||document.querySelector('ul li'); li?.click(); })()`);
    for (let i = 0; i < 15; i++) { await sleep(1000); if ((await evalJs(`document.body.innerText.includes('Analysis Sheet')||document.body.innerText.includes('RGB Parade')`).catch(() => false)) === true) break; }
    await sleep(3000);

    console.log('[ws] htmlClass =', JSON.stringify(await evalJs(`document.documentElement.className`)));
    const probe = await evalJs(`(() => {
      const el = document.querySelector('.backdrop-blur-md');
      if (!el) return 'sem .backdrop-blur-md';
      const cs = getComputedStyle(el);
      const h3 = el.querySelector('h3');
      return JSON.stringify({
        cls: el.className.slice(0, 120),
        bg: cs.backgroundColor,
        h3Color: h3 ? getComputedStyle(h3).color : null,
        darkRule: [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.selectorText && r.selectorText.includes('dark\\\\:bg-solar-dark-content')); } catch(e){ return false; } }),
        lightRule: [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.selectorText && r.selectorText.includes('bg-solar-light-content')); } catch(e){ return false; } }),
      });
    })()`);
    console.log('[dock]', probe);
    const varProbe = await evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--color-surface') || '(vazia)'`);
    console.log('[var] --color-surface =', JSON.stringify(varProbe));
    ws.close();
  } finally {
    chrome.kill(); preview.kill();
    setTimeout(() => process.exit(0), 400);
  }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

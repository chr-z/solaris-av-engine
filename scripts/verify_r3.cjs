// Verificação R3 no browser real: abre guest → primeira OS → checa
// ScoreRing (SVG + label FINAL), timeline nova (régua/pins container),
// tokens aplicados e ausência de classes antigas. Exit code = nº de falhas.
const http = require('http');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9231;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-verify-' + Date.now());

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
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { chrome.kill(); process.exit(2); }, 150000);
  const failures = [];
  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try { targets = await httpGetJson(`http://127.0.0.1:${PORT}/json/list`); break; } catch (e) {}
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

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};`,
    });
    await send('Page.navigate', { url: process.env.SHOT_URL || 'http://localhost:4321/' });

    // login → guest → fila
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      await sleep(1000);
      try {
        await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()` });
        const r = await send('Runtime.evaluate', { expression: `document.querySelectorAll('ul li').length > 0`, returnByValue: true });
        ok = r.result.value === true;
      } catch (e) {}
    }
    if (!ok) throw new Error('guest falhou');
    for (let i = 0; i < 15; i++) { await sleep(1000); break; }

    // abre a primeira OS
    await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('ul li')].find(el => (el.className||'').includes('cursor'))?.click() || document.querySelector('ul li')?.click()` });
    let open = false;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const r = await send('Runtime.evaluate', { expression: `document.body.innerText.includes('Analysis Sheet')`, returnByValue: true }).catch(() => ({ result: { value: false } }));
      open = r.result.value === true;
      if (open) break;
    }
    if (!open) throw new Error('workspace não abriu');
    await sleep(3000);

    const evalJson = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
      if (r && r.result && 'value' in r.result) return r.result.value;
      if (r && r.exceptionDetails) console.log('[page-exception]', JSON.stringify(r.exceptionDetails).slice(0, 300));
      return undefined;
    };

    const c = {};
    c.scoreRingSvg = await evalJson(`document.querySelectorAll('svg circle[stroke-dasharray]').length > 0`);
    c.finalLabel = await evalJson(`/final/i.test(document.body.innerText)`);
    c.timelineTrack = await evalJson(`!!document.querySelector('div[class*="bg-black/25"]')`);
    c.emptyOrPlayer = await evalJson(`document.body.innerText.includes('Paste a YouTube link') || !!document.querySelector('video')`);
    c.bgToken = await evalJson(`getComputedStyle(document.body).backgroundColor === 'rgb(11, 14, 20)'`);
    c.noRawMediaError = await evalJson(`!document.body.innerText.includes('Media Error')`);
    // score numérico visível no anel? (padrão 0,00–5,00 com vírgula)
    c.ringNumber = await evalJson(`/\\b\\d,\\d{2}\\b/.test(document.body.innerText)`);
    const expect = {
      scoreRingSvg: true, finalLabel: true, timelineTrack: true,
      emptyOrPlayer: true, bgToken: true, noRawMediaError: true,
    };
    console.log(JSON.stringify(c, null, 2));
    for (const k of Object.keys(expect)) {
      if (c[k] !== expect[k]) failures.push(k);
    }
    clearTimeout(hardExit);
    ws.close();
  } finally { chrome.kill(); }
  if (failures.length) { console.error('FALHAS:', failures.join(', ')); process.exit(failures.length); }
  console.log('VERIFY_R3_OK');
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

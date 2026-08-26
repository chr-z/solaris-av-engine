// Probe DOM focado da tela de análise (t19b): usa seletores REAIS dos
// componentes v3 em vez de regex genérica. Reusa protocolo anti-órfão.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
const REPO = 'C:/Yui/data/saas/solaris-redesign';
const PORT_HTTP = 4300 + Math.floor(Math.random() * 400);
const PORT_CDP = 9700 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PORT_HTTP}`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-shot-t19b-' + Date.now());

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
  const distIndex = fs.readFileSync(path.join(REPO, 'dist', 'index.html'), 'utf8');
  const localEntry = (distIndex.match(/assets\/index-[^"]+\.js/) || [])[0];
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT_HTTP),
    '--strictPort', '--host', '127.0.0.1'], { cwd: REPO, stdio: 'ignore', shell: true });
  let served = null;
  for (let i = 0; i < 40 && !served; i++) {
    await sleep(500);
    try { served = await httpGet(`${BASE}/`); } catch (e) {}
  }
  if (!served) throw new Error('preview nao subiu');
  const servedEntry = (served.match(/assets\/index-[^"]+\.js/) || [])[0];
  if (servedEntry !== localEntry) throw new Error('preview servindo OUTRO build!');
  console.log('[0] preview ok,', servedEntry);

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT_CDP}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => {
    try { chrome.kill(); execSync(`taskkill /pid ${preview.pid} /T /F`); } catch (e) {}
    process.exit(2);
  }, 170000);

  try {
    let targets = null;
    for (let i = 0; i < 30 && !targets; i++) {
      await sleep(500);
      try { targets = JSON.parse(await httpGet(`http://127.0.0.1:${PORT_CDP}/json/list`)); } catch (e) {}
    }
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
        if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
      }
    });
    const send = (method, params) => new Promise((resolve, reject) => { pending.set(++mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
    const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};`,
    });

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

    // abre a primeira linha
    await evalJs(`(() => {
      const li = [...document.querySelectorAll('ul li')].find(el => el.onclick || el.getAttribute('tabindex') !== null || String(el.className).includes('cursor')) || document.querySelector('ul li');
      li?.click();
      return !!li;
    })()`);
    await sleep(3500);

    // probes com seletores reais
    const state = await evalJs(`(() => {
      const q = (s) => document.querySelector(s);
      const qa = (s) => document.querySelectorAll(s).length;
      return {
        video: !!q('video'),
        // track da WaveformTimeline: w-full h-9 relative + bg-black/25
        tlTrack: qa('div[class*="bg-black\\/25"]').length,
        // skeleton de waveform carregando (estado offline/demo)
        tlSkeleton: qa('.skeleton-line').length,
        // ScoreRing: svg com stroke dasharray no cabeçalho do sheet
        ringSvg: qa('svg[viewBox="0 0 36 36"], svg circle[stroke-dasharray]').length,
        tabs: [...document.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim()).slice(0, 6),
        textSample: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 500),
      };
    })()`);
    console.log(JSON.stringify(state, null, 1));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't19_analysis.png'), Buffer.from(s.data, 'base64'));
    console.log('[shot] t19_analysis.png atualizado');

    console.log('T19B_PROBE_PASS', state.video && (state.tlTrack > 0 || state.tlSkeleton > 0) ? 'OK' : 'CHECAR');
  } finally {
    clearTimeout(hardExit);
    try { chrome.kill(); } catch (e) {}
    await sleep(500);
    try { execSync(`taskkill /pid ${preview.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    console.log('[cleanup] ok');
  }
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

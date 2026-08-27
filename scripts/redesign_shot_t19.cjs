// t19 — validação do sweep alias→token final: provas de CSS no browser real +
// screenshots das telas (login/fila/análise). Protocolo anti-órfão completo:
// preview próprio em porta alta aleatória (strictPort), prova do build servido
// (hash do entry == dist local), chrome headless --disable-gpu com debug port
// aleatória e temp próprio, cleanup por taskkill /T (wrapper npx não mata o
// filho node sozinho).
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
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-shot-t19-' + Date.now());

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
  fs.mkdirSync(OUT, { recursive: true });

  // [A] prova de build: hash do entry no dist local
  const distIndex = fs.readFileSync(path.join(REPO, 'dist', 'index.html'), 'utf8');
  const localEntry = (distIndex.match(/assets\/index-[^"]+\.js/) || [])[0];
  if (!localEntry) throw new Error('dist/index.html sem entry');

  // [B] preview próprio
  console.log('[0] vite preview porta', PORT_HTTP);
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT_HTTP),
    '--strictPort', '--host', '127.0.0.1'], { cwd: REPO, stdio: 'ignore', shell: true });
  let served = null;
  for (let i = 0; i < 40 && !served; i++) {
    await sleep(500);
    try { served = await httpGet(`${BASE}/`); } catch (e) {}
  }
  if (!served) throw new Error('preview nao subiu');
  const servedEntry = (served.match(/assets\/index-[^"]+\.js/) || [])[0];
  if (servedEntry !== localEntry) throw new Error(`preview servindo OUTRO build! (${servedEntry} != ${localEntry})`);
  console.log('[0.5] build servida == dist local:', servedEntry);

  // [C] chrome headless + CDP
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT_CDP}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => {
    console.log('[!] timeout global');
    try { chrome.kill(); } catch (e) {}
    try { execSync(`taskkill /pid ${preview.pid} /T /F`); } catch (e) {}
    process.exit(2);
  }, 170000);

  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
    console.log('[shot]', name);
  };

  try {
    let targets = null;
    for (let i = 0; i < 30 && !targets; i++) {
      await sleep(500);
      try { targets = JSON.parse(await httpGet(`http://127.0.0.1:${PORT_CDP}/json/list`)); } catch (e) {}
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
        if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
      }
    });
    var send = (method, params) => new Promise((resolve, reject) => { pending.set(++mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
    const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};`,
    });

    // ---- PASSO 1: login screen
    await send('Page.navigate', { url: `${BASE}/` });
    let ready = false;
    for (let i = 0; i < 45 && !ready; i++) {
      await sleep(1000);
      try { ready = (await evalJs(`[...document.querySelectorAll('button')].some(b => /guest|convidado/i.test(b.textContent))`)) === true; } catch (e) {}
    }
    if (!ready) throw new Error('login nao apareceu');
    await sleep(800);
    await shot('t19_login.png');

    // ---- PASSO 2: guest -> fila
    let logged = false;
    for (let i = 0; i < 30 && !logged; i++) {
      await sleep(1000);
      try {
        await evalJs(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`);
        logged = (await evalJs(`document.querySelectorAll('ul li').length > 0`)) === true;
      } catch (e) {}
    }
    if (!logged) throw new Error('guest/fila falhou');
    await sleep(2000);
    await shot('t19_fila.png');

    // ---- PASSO 3: provas de CSS no DOM vivo
    // (1) divisor h-px bg-hairline resolve pro token (não transparente)
    const bgProbe = await evalJs(`(() => {
      const el = document.createElement('div');
      el.className = 'bg-hairline';
      el.style.cssText = 'position:absolute;width:8px;height:8px;';
      document.body.appendChild(el);
      const c = getComputedStyle(el).backgroundColor;
      el.remove();
      return c;
    })()`);
    // (2) borda hairline de card real da tela resolve pro token
    const borderProbe = await evalJs(`(() => {
      const el = [...document.querySelectorAll('*')].find(n => n.className && String(n.className).includes('border-b'));
      return el ? getComputedStyle(el).borderBottomColor : 'sem-elemento';
    })()`);
    console.log('[css] bg-hairline =', bgProbe);
    console.log('[css] border-b exemplo =', borderProbe);
    const cssOk = bgProbe === 'rgba(255, 255, 255, 0.06)';
    console.log('[css] PROVA TOKEN HAIRLINE:', cssOk ? 'OK' : 'FALHOU (' + bgProbe + ')');

    // (3) nenhuma classe morta restante: variantes /N sobre tokens var()
    const deadProbe = await evalJs(`[...document.querySelectorAll('[class]')]
      .map(n => String(n.className)).join(' ')
      .match(/(?:bg|text|border|ring)-(?:hairline|surface-raised|ink|ink-secondary)\\/\\d+/g)?.length ?? 0`);
    console.log('[css] classes /N mortas no DOM:', deadProbe);

    // ---- PASSO 4: abrir análise (primeira linha da fila)
    await evalJs(`(() => {
      const li = [...document.querySelectorAll('ul li')].find(el => el.onclick || el.getAttribute('tabindex') !== null || String(el.className).includes('cursor')) || document.querySelector('ul li');
      li?.click();
      return !!li;
    })()`);
    await sleep(3000);
    const analysisState = await evalJs(`(() => ({
      video: !!document.querySelector('video'),
      timeline: !!document.querySelector('[class*=timeline i], [class*=waveform i]'),
      sheet: document.body.innerText.includes('FINAL SCORE'),
    }))()`);
    console.log('[4] estado análise:', JSON.stringify(analysisState));
    await shot('t19_analysis.png');

    console.log('T19_SHOTS_PASS', JSON.stringify({ cssOk, deadProbe, analysisState }));
  } finally {
    clearTimeout(hardExit);
    try { chrome.kill(); } catch (e) {}
    await sleep(500);
    try { execSync(`taskkill /pid ${preview.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    console.log('[cleanup] chrome + preview (tree) encerrados');
  }
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

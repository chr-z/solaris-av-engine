// Tick 9 redesign — prova da micro-sparkline do badge de score:
// guest -> fila -> abre 1a OS -> cabeçalho do workspace deve ter a polyline
// com gradiente accent (ScoreSpark); hover abre o tooltip rico com as 5
// categorias nota/máximo; screenshot pra comparação MVP vs v3.
// Protocolo anti-órfão herdado do redesign_shot_t8_countup.cjs.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
const REPO = 'C:/Yui/data/saas/solaris-redesign';
const PREVIEW_PORT = 4300 + Math.floor(Math.random() * 400);
const CDP_PORT = 9400 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PREVIEW_PORT}`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-shot-t9-' + Date.now());

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
  const distIndex = fs.readFileSync(path.join(REPO, 'dist', 'index.html'), 'utf8');
  const localEntry = (distIndex.match(/assets\/index-[^"]+\.js/) || [])[0];
  if (!localEntry) throw new Error('dist/index.html sem entry');

  console.log('[0] vite preview porta', PREVIEW_PORT);
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT),
    '--strictPort', '--host', '127.0.0.1'], { cwd: REPO, stdio: 'ignore', shell: true });
  let served = null;
  for (let i = 0; i < 40 && !served; i++) {
    await sleep(500);
    try { served = await httpGet(`${BASE}/`); } catch (e) {}
  }
  if (!served) throw new Error('preview nao subiu');
  const servedEntry = (served.match(/assets\/index-[^"]+\.js/) || [])[0];
  if (servedEntry !== localEntry) throw new Error('preview servindo OUTRO build!');
  console.log('[0.5] build servida == dist local? true');

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { chrome.kill(); preview.kill(); process.exit(2); }, 170000);

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

    // login guest -> fila
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
    console.log('[1] guest ok, fila visivel');
    await sleep(1500);

    // clica no primeiro item da fila -> workspace de análise
    await evalJs(`(() => { const li = [...document.querySelectorAll('ul li')].find(el => el.onclick || el.getAttribute('tabindex') !== null || String(el.className).includes('cursor')) || document.querySelector('ul li'); li?.click(); return !!li; })()`);
    let open = false;
    for (let i = 0; i < 20 && !open; i++) {
      await sleep(1000);
      open = (await evalJs(`document.body.innerText.includes('Analysis Sheet') || document.body.innerText.includes('RGB Parade')`)) === true;
    }
    if (!open) throw new Error('workspace nao abriu');
    console.log('[2] workspace aberto');

    // sparkline presente? (polyline com gradiente accent dentro do svg decorativo)
    let spark = false;
    for (let i = 0; i < 15 && !spark; i++) {
      await sleep(1000);
      spark = (await evalJs(`!!document.querySelector('svg polyline[stroke="url(#scoreSparkGrad)"]')`)) === true;
    }
    console.log('[3] sparkline renderizada?', spark);
    if (!spark) throw new Error('ScoreSpark nao encontrada no cabecalho');

    // pontos reais da polyline + ponto da categoria mais fraca
    const pts = await evalJs(`document.querySelector('svg polyline[stroke="url(#scoreSparkGrad)"]')?.getAttribute('points')`);
    const dot = await evalJs(`(() => { const c=[...document.querySelectorAll('svg circle')].find(c=>c.getAttribute('fill')==='var(--color-accent-to)'); return c ? c.getAttribute('cx')+','+c.getAttribute('cy') : null; })()`);
    console.log('[4] points =', JSON.stringify(pts), '| dot(categoria mais fraca) =', dot);

    // hover na spark -> tooltip rico
    await evalJs(`(() => { const el = document.querySelector('svg polyline[stroke="url(#scoreSparkGrad)"]').closest('span'); ['mouseenter','mouseover'].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true }))); return true; })()`);
    let tip = null;
    for (let i = 0; i < 30 && !tip; i++) {
      await sleep(200);
      tip = await evalJs(`document.querySelector('.tooltip-rich')?.innerText || null`);
    }
    if (!tip) throw new Error('tooltip nao abriu no hover');
    const catOk = ['ENQUADRAMENTO', 'ILUMINAÇÃO', 'OUTROS', 'CENÁRIO', 'ÁUDIO'].every(c => tip.includes(c));
    console.log('[5] tooltip aberto; 5 categorias presentes?', catOk);
    console.log('[5.1] tooltip:', JSON.stringify(tip));

    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't9_workspace_spark.png'), Buffer.from(s.data, 'base64'));
    console.log('[6] shot salvo: t9_workspace_spark.png');

    clearTimeout(hardExit);
    ws.close();
  } finally {
    chrome.kill();
    preview.kill();
    setTimeout(() => process.exit(0), 500);
  }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

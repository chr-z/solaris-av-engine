// Tick 9 — axe-core scan do workspace COM a sparkline nova (estado marcado),
// protocolo anti-órfão. axe.min.js é baixado pelo node e injetado (a página
// roda com redes bloqueadas). Critério da fila: zero violações critical/serious.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const REPO = 'C:/Yui/data/saas/solaris-redesign';
const PREVIEW_PORT = 4300 + Math.floor(Math.random() * 400);
const CDP_PORT = 9400 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PREVIEW_PORT}`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-axe-t9-' + Date.now());
const AXE_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js',
  'https://unpkg.com/axe-core@4.10.2/axe.min.js',
];

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchAxe() {
  for (const u of AXE_URLS) {
    try {
      const res = await fetch(u);
      if (!res.ok) continue;
      return await res.text();
    } catch (e) {}
  }
  throw new Error('axe.min.js indisponivel (CDN)');
}

async function main() {
  const axeSrc = await fetchAxe();
  console.log('[0] axe.min.js carregado:', axeSrc.length, 'bytes');

  const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: REPO, stdio: 'ignore', shell: true });
  for (let i = 0; i < 40; i++) { await sleep(500); try { await httpGet(`${BASE}/`); break; } catch (e) {} }
  const chrome = spawn(CHROME, [`--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--disable-gpu', '--window-size=1600,900', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { chrome.kill(); preview.kill(); process.exit(2); }, 150000);
  try {
    let targets = null;
    for (let i = 0; i < 30 && !targets; i++) { await sleep(500); try { targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`)); } catch (e) {} }
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); setTimeout(() => j(new Error('ws')), 15000); });
    let mid = 0; const pending = new Map();
    ws.addEventListener('message', ev => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } });
    const send = (method, params) => new Promise((resolve, reject) => { pending.set(++mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
    const evalJs = async (e, awaitP) => {
      const r = (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: !!awaitP })).result;
      if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.value;
    };

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};` });

    await send('Page.navigate', { url: `${BASE}/` });
    let logged = false;
    for (let i = 0; i < 90 && !logged; i++) {
      await sleep(1000);
      try {
        await evalJs(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`);
        // login completo = botão guest sumiu da tela (a fila demo pode
        // pré-renderizar atrás do overlay de login, então ul li não serve)
        logged = (await evalJs(`![...document.querySelectorAll('button')].some(b => /guest|convidado/i.test(b.textContent))`)) === true;
      } catch (e) {}
    }
    await sleep(1500);
    // clique REAL via CDP (coordenadas do li) — mais fiel que el.click()
    const rect = await evalJs(`(() => {
      const lis = [...document.querySelectorAll('ul li')];
      const li = lis.find(el => /WO-\\d+/.test(el.innerText));
      if (!li) return null;
      const r = li.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`);
    console.log('[0.9] rect do item:', rect);
    if (!rect) throw new Error('item da fila nao encontrado');
    const { x, y } = JSON.parse(rect);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    let open = false;
    for (let i = 0; i < 20 && !open; i++) {
      await sleep(1000);
      open = (await evalJs(`document.body.innerText.includes('Analysis Sheet') || document.body.innerText.includes('RGB Parade')`)) === true;
    }
    if (!open) {
      const snippet = await evalJs(`document.body.innerText.slice(0, 300)`);
      console.log('[diag] corpo da pagina:', JSON.stringify(snippet));
      throw new Error('workspace nao abriu');
    }
    console.log('[1] workspace aberto');

    // marca uma regra (mesmo fluxo da prova 2) pra escanear o estado pós-marcação
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Lighting')?.click()`);
    await sleep(800);
    const clicked = await evalJs(`(() => { const el=[...document.querySelectorAll('input[type=checkbox]')].find(c=>!c.checked); el?.click(); return el ? (el.id||'?') : null; })()`);
    console.log('[2] regra marcada pro scan:', clicked);

    // injeta e roda o axe — via init-script da página (evaluate gigante por WS
    // mostrou-se frágil); recarrega a página pro script inicial valer
    await send('Page.addScriptToEvaluateOnNewDocument', { source: axeSrc });
    await send('Page.reload');
    let axeReady = false;
    for (let i = 0; i < 30 && !axeReady; i++) { await sleep(1000); axeReady = (await evalJs(`typeof window.axe === 'object' && typeof window.axe.run === 'function' && !!document.body`)) === true; }
    if (!axeReady) throw new Error('axe nao disponivel apos reload');
    // refaz login pós-reload se necessário e volta ao workspace marcado
    const guestGone = await evalJs(`![...document.querySelectorAll('button')].some(b => /guest|convidado/i.test(b.textContent))`);
    console.log('[2.5] pos-reload guest sumiu?', guestGone);
    if (!guestGone) {
      for (let i = 0; i < 60 && !guestGone; i++) {
        await sleep(1000);
        await evalJs(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`);
      }
      await sleep(1500);
      const rect2 = await evalJs(`(() => { const li=[...document.querySelectorAll('ul li')].find(el => /WO-\\d+/.test(el.innerText)); if (!li) return null; const r=li.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`);
      if (!rect2) throw new Error('fila sumiu pos-reload');
      const p2 = JSON.parse(rect2);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p2.x, y: p2.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p2.y ? p2.x : p2.x, y: p2.y, button: 'left', clickCount: 1 });
      await sleep(2500);
    }
    const stillOpen = await evalJs(`document.body.innerText.includes('Analysis Sheet') || document.body.innerText.includes('RGB Parade')`);
    if (!stillOpen) throw new Error('workspace nao voltou apos reload');
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Lighting')?.click()`);
    await sleep(800);
    await evalJs(`(() => { const el=[...document.querySelectorAll('input[type=checkbox]')].find(c=>!c.checked); el?.click(); return true; })()`);
    await sleep(500);
    const r = await evalJs(`axe.run(document, { resultTypes: ['violations'] }).then(res => JSON.stringify((res.violations || []).map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))))`, true);
    const violations = JSON.parse(r);
    const serious = violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    console.log('[3] violacoes axe:', JSON.stringify(violations));
    console.log('[4] critical+serious:', serious.length);

    // sparkline não pode poluir a árvore de acessibilidade
    const sparkA11y = await evalJs(`(() => { const svg=document.querySelector('svg polyline[stroke="url(#scoreSparkGrad)"]')?.closest('svg'); return svg ? { ariaHidden: svg.getAttribute('aria-hidden'), focusable: svg.getAttribute('focusable') } : null; })()`);
    console.log('[5] spark svg:', JSON.stringify(sparkA11y));
    clearTimeout(hardExit); ws.close();
    process.exitCode = serious.length === 0 ? 0 : 1;
  } finally { chrome.kill(); preview.kill(); setTimeout(() => process.exit(process.exitCode || 0), 400); }
}
main().catch(e => { console.error('[erro]', e.message); process.exit(1); });

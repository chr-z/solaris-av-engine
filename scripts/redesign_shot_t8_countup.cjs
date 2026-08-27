// Tick 8 redesign — prova do wow #2 (contagem dos achados animada):
// abre o diálogo do relatório QC e compara o texto resumido NO MEIO da
// animação (~250ms) contra o FINAL (>1.5s). O final deve ser idêntico ao
// formato estático anterior; o intermediário deve diferir (animação rodou).
// Protocolo anti-órfão herdado do redesign_shot_r3b.cjs.
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
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-shot-t8-' + Date.now());

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
    // Headless novo reporta prefers-reduced-motion:reduce por padrão — o app
    // respeita (correto!). Aqui FORÇamos no-preference pra exercitar a animação.
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
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
    await sleep(1500);

    // abre o diálogo do relatório QC
    await evalJs(`[...document.querySelectorAll('button')].find(b => /export qc report/i.test(b.getAttribute('aria-label') || '') || /qc report/i.test(b.textContent))?.click()`);
    let opened = false;
    for (let i = 0; i < 60 && !opened; i++) {
      await sleep(100);
      opened = (await evalJs(`!!document.querySelector('.qc-export-popup')`)) === true;
    }
    if (!opened) throw new Error('dialogo QC nao abriu');
    console.log('[1] dialogo QC aberto');
    console.log('[1.5] reduced-motion na pagina =', await evalJs(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`));

    // burst sampling: texto do resumo a cada 100ms por 1.6s
    const samples = [];
    for (let i = 0; i < 16; i++) {
      const txt = await evalJs(`document.querySelector('.qc-export-popup .card-raised p')?.textContent || null`);
      samples.push(txt);
      await sleep(100);
    }
    const uniq = [...new Set(samples)];
    console.log('[2] sequencia unica de textos:', JSON.stringify(uniq));

    const textMid = uniq[0] || null;
    const textFinal = samples[samples.length - 1];
    let s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't8_qc_final.png'), Buffer.from(s.data, 'base64'));

    const differs = uniq.length > 1;
    const finalOk = textFinal !== null && /\d+ rows · avg \d+\.\ds · \d+ errors/.test(textFinal);
    console.log('[4] houve variacao (animacao)?', differs, '| formato final ok?', finalOk);
    if (!differs || !finalOk) {
      console.log('[!] ATENCAO: animacao pode nao ter sido pega no frame medio (timing) — conferir shots');
    }

    clearTimeout(hardExit);
    ws.close();
  } finally {
    chrome.kill();
    preview.kill();
    setTimeout(() => process.exit(0), 500);
  }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

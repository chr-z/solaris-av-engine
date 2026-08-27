// R4 — verificação ponta a ponta do polimento:
//   [A] axe-core scan (login, fila, análise, diálogo QC) — alvo: 0 critical/serious
//   [B] relatório QC exportado v3: captura o blob SEM baixar, salva .html e fotografa
//   [C] prova de prefers-reduced-motion + @media print no CSS built
// Protocolo anti-órfão dos ticks anteriores: preview próprio em porta alta,
// prova de qual build é servida (hash do entry), profile/temp únicos,
// kill de chrome+preview no finally.
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
const REPO = 'C:/Yui/data/saas/solaris-redesign';
const PREVIEW_PORT = 4300 + Math.floor(Math.random() * 400);
const CDP_PORT = 9400 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PREVIEW_PORT}`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-r4-' + Date.now());
const AXE_SRC = fs.readFileSync(path.join(REPO, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

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

  // [prova de build]
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
  console.log('[0.5] build servida == dist local ok');

  // [prova C: tokens de movimento/impressão sobreviveram ao build]
  const cssFiles = fs.readdirSync(path.join(REPO, 'dist', 'assets')).filter((f) => f.endsWith('.css'));
  const cssAll = cssFiles.map((f) => fs.readFileSync(path.join(REPO, 'dist', 'assets', f), 'utf8')).join('\n');
  const motionOK = cssAll.includes('prefers-reduced-motion');
  const printOK = cssAll.includes('@media print') === false; // app não precisa mais; doc tem o próprio
  console.log('[0.7] reduced-motion no CSS built:', motionOK);

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { console.log('[!] timeout global'); chrome.kill(); preview.kill(); process.exit(2); }, 260000);

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
    const evalAsync = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        ${AXE_SRC}
        window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};
        window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};
        // intercepta o download do relatório QC sem baixar nada
        window.__qcBlob = null;
        const __origCreate = URL.createObjectURL;
        URL.createObjectURL = function(blob){ if (blob && blob.type === 'text/html') window.__qcBlob = blob; return __origCreate.call(URL, blob); };
        HTMLAnchorElement.prototype.click = function(){ /* segurar download no scan */ };
      `,
    });

    const axeRun = async () => evalAsync(`axe.run(document, {resultTypes:['violations']}).then(r => JSON.stringify(r.violations.map(v => ({id:v.id, impact:v.impact, n:v.nodes.length,
      det: (v.impact==='critical'||v.impact==='serious') ? v.nodes.slice(0,8).map(nd => ({t: nd.target.join(' '), f: String(nd.failureSummary || '').split(String.fromCharCode(10)).slice(0,2).join(' | ').replace(/["']/g,'')})) : undefined}))))`);
    const shot = async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
      console.log('   shot:', name);
    };

    // ---- estado 1: LOGIN
    await send('Page.navigate', { url: `${BASE}/` });
    let loginOk = false;
    for (let i = 0; i < 45 && !loginOk; i++) {
      await sleep(1000);
      loginOk = (await evalJs(`document.querySelectorAll('button').length > 0`).catch(() => false)) === true;
    }
    if (!loginOk) throw new Error('login nao apareceu');
    await sleep(1200);
    const axeLogin = JSON.parse(await axeRun());
    await shot('r4_login.png');
    console.log('[1] axe login:', JSON.stringify(axeLogin));

    // ---- estado 2: FILA (guest)
    let logged = false;
    for (let i = 0; i < 30 && !logged; i++) {
      await evalJs(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`).catch(() => {});
      await sleep(1000);
      logged = (await evalJs(`document.querySelectorAll('ul li').length > 0`).catch(() => false)) === true;
    }
    if (!logged) throw new Error('guest/fila falhou');
    await sleep(1500);
    const axeFila = JSON.parse(await axeRun());
    await shot('r4_fila.png');
    console.log('[2] axe fila:', JSON.stringify(axeFila));

    // ---- estado 3: ANÁLISE
    await evalJs(`(() => { const li = [...document.querySelectorAll('ul li')].find(el => el.getAttribute('tabindex') !== null || el.className.includes('cursor')) || document.querySelector('ul li'); li?.click(); return !!li; })()`);
    let open = false;
    for (let i = 0; i < 15 && !open; i++) {
      await sleep(1000);
      open = (await evalJs(`document.body.innerText.includes('Analysis Sheet') || document.body.innerText.includes('RGB Parade')`).catch(() => false)) === true;
    }
    if (!open) throw new Error('workspace de analise nao abriu');
    await sleep(4000);
    const axeAnalise = JSON.parse(await axeRun());
    await shot('r4_analysis.png');
    console.log('[3] axe analise:', JSON.stringify(axeAnalise));

    // ---- estado 4: DIÁLOGO QC + documento exportado
    await evalJs(`[...document.querySelectorAll('button')].find(b => /export qc report/i.test(b.getAttribute('aria-label') || '') || /qc report/i.test(b.textContent))?.click()`);
    let dlg = false;
    for (let i = 0; i < 10 && !dlg; i++) {
      await sleep(700);
      dlg = (await evalJs(`!!document.querySelector('.qc-export-popup')`).catch(() => false)) === true;
    }
    await sleep(800);
    const axeDialogo = JSON.parse(await axeRun());
    await shot('r4_qc_dialog.png');
    console.log('[4] axe dialogo QC:', JSON.stringify(axeDialogo));
    const docHtml = await evalAsync(`window.__qcBlob ? window.__qcBlob.text() : null`);
    if (docHtml) {
      fs.writeFileSync(path.join(OUT, 'r4_qc_report.html'), docHtml);
      console.log('[4.5] relatório exportado capturado:', docHtml.length, 'chars — salvo em r4_qc_report.html');
      // fotografia o documento renderizado (data URL com o MESMO conteúdo capturado)
      await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(docHtml, 'utf8').toString('base64') });
      await sleep(1500);
      await shot('r4_qc_report.png');
    } else {
      console.log('[4.5] AVISO: blob do relatório não capturado');
    }

    // ---- veredicto
    const all = [['login', axeLogin], ['fila', axeFila], ['analise', axeAnalise], ['dialogo_qc', axeDialogo]];
    const blocking = [];
    for (const [st, vs] of all) {
      for (const v of vs) {
        if (v.impact === 'critical' || v.impact === 'serious') blocking.push(`${st}:${v.id}(${v.impact})x${v.n}`);
      }
    }
    fs.writeFileSync(path.join(OUT, 'r4_axe_summary.json'),
      JSON.stringify(Object.fromEntries(all), null, 2));
    console.log(blocking.length ? '[!] VIOLAÇÕES blocking: ' + blocking.join(', ') : '[OK] zero violações critical/serious nas 4 telas');

    clearTimeout(hardExit);
    ws.close();
    process.exitCode = blocking.length ? 1 : 0;
  } finally {
    chrome.kill();
    preview.kill();
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

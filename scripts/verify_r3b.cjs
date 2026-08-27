// Verificação R3b no browser real (protocolo anti-órfão: preview próprio em
// porta alta + prova de hash do build + cleanup no finally). Exit code = nº
// de falhas.
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const REPO = 'C:/Yui/data/saas/solaris-redesign';
const PREVIEW_PORT = 4700 + Math.floor(Math.random() * 200);
const CDP_PORT = 9700 + Math.floor(Math.random() * 200);
const BASE = `http://localhost:${PREVIEW_PORT}`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-verify-r3b-' + Date.now());

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { spawn } = require('child_process');
  const failures = [];
  const distIndex = fs.readFileSync(path.join(REPO, 'dist', 'index.html'), 'utf8');
  const localEntry = (distIndex.match(/assets\/index-[^"]+\.js/) || [])[0];

  const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: REPO, stdio: 'ignore', shell: true });
  let served = null;
  for (let i = 0; i < 40 && !served; i++) { await sleep(500); try { served = await httpGet(`${BASE}/`); } catch (e) {} }
  if (!served) throw new Error('preview nao subiu');
  const servedEntry = (served.match(/assets\/index-[^"]+\.js/) || [])[0];
  console.log('[build] servida == local?', servedEntry === localEntry);
  if (servedEntry !== localEntry) failures.push('preview servindo outro build');

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { chrome.kill(); preview.kill(); process.exit(2); }, 170000);

  try {
    let targets = null;
    for (let i = 0; i < 30 && !targets; i++) { await sleep(500); try { targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`)); } catch (e) {} }
    if (!targets) throw new Error('devtools nao subiu');
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
    const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};`,
    });

    // ---- login screen: erro humano
    await send('Page.navigate', { url: `${BASE}/` });
    let loginVisible = false;
    for (let i = 0; i < 40 && !loginVisible; i++) {
      await sleep(1000);
      loginVisible = (await evalJs(`!![...document.querySelectorAll('button')].find(b => /google/i.test(b.textContent))`).catch(() => false)) === true;
    }
    if (!loginVisible) throw new Error('login não apareceu');
    // guest button estilizado com btn-ghost?
    const ghostOk = await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/guest|convidado/i.test(b.textContent)); return !!b && b.className.includes('btn-ghost'); })()`);
    if (!ghostOk) failures.push('botao guest sem .btn-ghost');

    await evalJs(`[...document.querySelectorAll('button')].find(b => /google/i.test(b.textContent))?.click()`);
    let errBox = null;
    for (let i = 0; i < 12 && !errBox; i++) {
      await sleep(1000);
      errBox = await evalJs(`(() => { const a=document.querySelector('[role="alert"]'); return a ? a.innerText : null; })()`);
    }
    console.log('[login] alert =', JSON.stringify(errBox));
    if (!errBox || !/sign|connect|Google/i.test(errBox)) failures.push('alert de erro humano ausente no login');
    if (errBox && /auth\/|TypeError|net::/i.test(errBox)) failures.push('RAW ERROR visivel no login!');

    // ---- entra como guest → fila
    let logged = false;
    for (let i = 0; i < 45 && !logged; i++) {
      await sleep(1000);
      try {
        await evalJs(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`);
        logged = (await evalJs(`document.querySelectorAll('ul li').length > 0`)) === true;
      } catch (e) {}
    }
    if (!logged) throw new Error('guest falhou');
    await sleep(1500);

    // busca sem resultado → empty states contextual
    await evalJs(`(() => { const input=document.querySelector('input[type="text"]'); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(input,'zzzz'); input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await sleep(1500);
    const emptyText = await evalJs(`(() => { const e=document.querySelector('[data-testid="queue-empty"]'); return e ? e.innerText : null; })()`);
    console.log('[fila] empty-state =', JSON.stringify(emptyText));
    if (!emptyText || !/matches this search|corresponde/i.test(emptyText)) failures.push('empty state filtrado sem dica contextual');
    if (!emptyText || !/[Cc]lear|[Ll]impe/.test(emptyText)) failures.push('dica de limpar filtro ausente');
    // role=status presente (a11y)
    const statusRole = await evalJs(`!!document.querySelector('[data-testid="queue-empty"][role="status"]')`);
    if (!statusRole) failures.push('empty state sem role=status');

    // limpa busca → fila volta
    await evalJs(`(() => { const input=document.querySelector('input[type="text"]'); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(input,''); input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await sleep(1200);

    // ---- diálogo QC
    await evalJs(`[...document.querySelectorAll('button')].find(b => /export qc report/i.test(b.getAttribute('aria-label')||'') || /qc report/i.test(b.textContent))?.click()`);
    let dlg = null;
    for (let i = 0; i < 10 && !dlg; i++) { await sleep(700); dlg = await evalJs(`(() => { const p=document.querySelector('.qc-export-popup'); return p ? p.innerText : null; })()`); }
    console.log('[qc] dialog =', JSON.stringify(dlg && dlg.slice(0, 140)));
    if (!dlg || !/exported|exportado/i.test(dlg)) failures.push('dialogo QC nao abriu');
    const qcBtnPrimary = await evalJs(`(() => { const b=[...document.querySelectorAll('.qc-export-popup button')].find(x=>/download again/i.test(x.textContent)); return !!b && b.className.includes('btn-primary'); })()`);
    if (!qcBtnPrimary) failures.push('botao Download again sem .btn-primary');

    clearTimeout(hardExit);
    ws.close();
  } finally {
    chrome.kill(); preview.kill();
    setTimeout(() => process.exit(failures.length ? 1 : 0), 400);
  }
  if (failures.length) { console.log('\nFALHAS:', failures.length); failures.forEach((f) => console.log(' -', f)); process.exitCode = 1; }
  else console.log('\nVERIFICACAO R3B: tudo ok');
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

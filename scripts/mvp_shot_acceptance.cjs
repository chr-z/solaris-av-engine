// Captura MVP (main) p/ aceite visual: login, análise, diálogo QC.
// [t30] OBSOLETO p/ builds demo pos-t24: espera TELA DE LOGIN que não existe mais
// (build sobe direto na fila; guest click falha). Use scripts/redesign_shot_t25.cjs
// para shots de merge/regate — evidência: scripts/dom_probe_t30.cjs + log t30.
// Protocolo anti-órfão (skill saas-factory-ops): porta alta aleatória, navega
// em localhost (não 127.0.0.1), stubs gapi/google + bloqueio de rede Google,
// screenshot só após conferir hash do entry contra o dist local.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
// DIST pode ser sobrescrito p/ capturar outro checkout (ex.: probe isolado da main)
const DIST = process.env.SHOT_DIST ? path.resolve(process.env.SHOT_DIST) : path.join(__dirname, '..', 'dist');
const PREFIX = process.env.SHOT_PREFIX || 'mvp';
const PORT = 4200 + Math.floor(Math.random() * 500);
// porta de debug tambem aleatoria: runs consecutivos colidem na 9231 fixa
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 400);

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
  // ---- servidor estático do dist local, porta alta exclusiva ----
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
    let rel = urlPath === '/' ? '/index.html' : urlPath;
    let fp = path.join(DIST, rel);
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(DIST, 'index.html');
    const ext = path.extname(fp).toLowerCase();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, () => r()));
  console.log('[srv] porta', PORT);

  // ---- prova de build: hash do entry no dist local ----
  const idxHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const entryM = idxHtml.match(/assets\/[A-Za-z0-9_.-]+\.js/g) || [];
  console.log('[dist] entries:', entryM.join(' '));
  if (!entryM.length) throw new Error('dist sem entry js');

  const { spawn } = require('child_process');
  console.log('[0] subindo chrome headless');
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${DEBUG_PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'solaris-mvp-shot-' + Date.now())}`,
    'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { try { chrome.kill(); } catch {} process.exit(2); }, 240000);

  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try { targets = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`); break; } catch (e) {}
    }
    if (!targets) throw new Error('devtools nao subiu');
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.addEventListener('open', r); ws.addEventListener('error', j);
      setTimeout(() => j(new Error('ws timeout')), 15000);
    });
    let mid = 0; const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
    const send = (method, params) => new Promise((resolve, reject) => {
      pending.set(++mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result.value;
    };

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.gapi = { load: (n, o) => o && o.callback && o.callback(), client: { init: async () => ({}), setToken: () => {} } };
        window.google = { accounts: { oauth2: { initTokenClient: (c) => ({ requestAccessToken: () => c && c.error_callback && c.error_callback({ type: 'stub' }) }) } } };
      `,
    });

    // helper: espera predicado via evalJs
    const waitFor = async (expr, tries, label) => {
      for (let i = 0; i < tries; i++) {
        try { if ((await evalJs(expr)) === true) return true; } catch (e) {}
        await sleep(1000);
      }
      return false;
    };
    const shotTo = async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
      console.log('[shot]', name);
    };

    // ================= LOGIN =================
    await send('Page.navigate', { url: `http://localhost:${PORT}/#/login` });
    await sleep(4000);
    // prova de que servimos NOSSO build: algum asset do dist carregou com o hash esperado
    const servedOk = await waitFor(`performance.getEntriesByType('resource').some(e => ${JSON.stringify(entryM)}.some(a => e.name.includes(a)))`, 15, 'entry');
    console.log('[hash] nosso entry servido:', servedOk);
    if (!servedOk) throw new Error('build servido nao confere com dist local');

    // espera a TELA DE LOGIN (botao google/guest presente, fila ausente) ou fila direta
    let sawLogin = false;
    for (let i = 0; i < 25; i++) {
      const st = await evalJs(`(() => {
        const b = [...document.querySelectorAll('button')].find(b => /google|guest|convidado/i.test((b.textContent||'') + ' ' + (b.getAttribute('aria-label')||'')));
        return { login: !!b && !document.body.innerText.includes('Pending'), fila: document.querySelectorAll('ul li').length >= 5 };
      })()`).catch(() => ({ login: false, fila: false }));
      if (st.login) { await sleep(800); await shotTo(`${PREFIX}_login.png`); sawLogin = true; break; }
      if (st.fila) break;
      await sleep(1000);
    }
    console.log('[login] tela capturada:', sawLogin);

    // login guest — tolerante: botão guest OU qualquer formulário de email+senha demo
    const guestClicked = await waitFor(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/guest|convidado/i.test(b.textContent||b.getAttribute('aria-label')||'')); if(b){b.click();return true}return false})()`, 20, 'guest');
    if (!guestClicked) throw new Error('login guest falhou');
    await sleep(2500);

    // fila logo após o guest (antes de abrir qualquer OS)
    const filaRows = await waitFor(`document.querySelectorAll('ul li').length >= 5`, 12);
    console.log('[fila] linhas:', filaRows);
    await sleep(1000);
    await shotTo(`${PREFIX}_fila.png`);

    // ================= ANÁLISE =================
    // abre a primeira OS da fila; se a fila estiver vazia, tenta seed via localStorage
    let rowOpened = await waitFor(`(() => { const li=document.querySelector('ul li, table tbody tr'); if(li){li.click();return true}return false})()`, 12, 'linha fila');
    if (!rowOpened) {
      console.log('[fila] vazia — tentando seed demo via localStorage');
      await evalJs(`(() => {
        try {
          const KEY='solaris_demo_seed_v1';
          const raw=localStorage.getItem(KEY);
          if(raw && JSON.parse(raw).length>0) return 'already';
          const demo=[{id:'demo-1',workOrder:'WO-2601',title:'Spot Brand X 30s',client:'Brand X',status:'pending',createdAt:new Date().toISOString(),durationSec:30,video:{url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'},checks:[],notes:''}];
          localStorage.setItem(KEY, JSON.stringify(demo));
          return 'seeded';
        } catch(e) { return 'err:'+e.message; }
      })()`);
      locationHack: ;
      await evalJs(`location.reload()`);
      await sleep(5000);
      rowOpened = await waitFor(`(() => { const li=document.querySelector('ul li, table tbody tr'); if(li){li.click();return true}return false})()`, 12, 'linha fila pos-seed');
    }
    if (!rowOpened) throw new Error('nenhuma linha da fila pra abrir no MVP');
    await sleep(6000); // player/timeline estabilizam

    await shotTo(`${PREFIX}_analysis.png`);

    // ================= DIÁLOGO QC =================
    const qcBtn = `[...document.querySelectorAll('button')].find(b => /export qc report|qc report|gerar parecer|relat[oó]rio/i.test((b.getAttribute('aria-label')||'')+' '+(b.textContent||'')))`;
    let qcOpened = false;
    try {
      qcOpened = (await evalJs(`(() => { const b=${qcBtn}; if(b){b.click();return true}return false})()`)) === true;
    } catch (e) {}
    if (qcOpened) {
      qcOpened = await waitFor(`!!document.querySelector('[role="dialog"], .modal, .overlay, .popup') || document.body.innerText.length > 2000`, 10, 'qc dialog');
      await sleep(1500);
    }
    await shotTo(`${PREFIX}_qc_dialog.png`);
    console.log('[qc] dialog aberto:', qcOpened);

    clearTimeout(hardExit);
    ws.close();
  } finally {
    try { chrome.kill(); } catch {}
    server.close();
    setTimeout(() => process.exit(0), 200);
  }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

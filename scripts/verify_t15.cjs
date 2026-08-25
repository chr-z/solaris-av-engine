// Verificação t15 no browser real (protocolo anti-órfão da lane):
// Chrome headless --disable-gpu + vite preview da dist LOCAL (strictPort,
// porta alta aleatória, hash do entry conferida contra o dist em disco).
//
// Provas:
//   A) Modal de zoom dos monitores: abre pelo Dock, superfície v3
//      (bg-surface/hairline/shadow-pop), fecha por ESC (contrato dos modais).
//   B) Time Markers: abre, skeleton desenhado, erro humano inline ao salvar
//      em modo demo (nunca alert cru), comentário preservado, kit v3 no input.
// Exit code = número de falhas.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) { console.error('[!] chrome nao encontrado'); process.exit(2); }

const ROOT = __dirname + '/..';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
const PORT_HTTP = 4700 + Math.floor(Math.random() * 200);
const PORT_CDP = 19700 + Math.floor(Math.random() * 200);
const URL_APP = `http://localhost:${PORT_HTTP}/`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-t15-' + Date.now());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitFor(fn, label, tries = 40, delayMs = 500) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch (e) { lastErr = e; }
    await sleep(delayMs);
  }
  throw new Error(`timeout: ${label}${lastErr ? ': ' + lastErr.message : ''}`);
}

(async () => {
  const failures = [];
  const check = (name, ok, extra) => {
    console.log(`${ok ? '[ok]' : '[FALHA]'} ${name}${extra ? ' | ' + extra : ''}`);
    if (!ok) failures.push(name);
  };

  const viteProc = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT_HTTP), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const chromeProc = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--window-size=1600,900', '--hide-scrollbars',
    `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT_CDP}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const hardExit = setTimeout(() => { console.error('[!] timeout global'); try { chromeProc.kill(); viteProc.kill(); } catch {} process.exit(2); }, 240000);

  try {
    await waitFor(async () => {
      const r = await fetch(URL_APP);
      if (!r.ok) throw new Error(`preview http ${r.status}`);
      return true;
    }, 'vite preview server');
    // Prova anti-órfão: o HTML servido tem que ser a dist DESTE worktree.
    const servedHtml = await (await fetch(URL_APP)).text();
    const servedEntry = servedHtml.match(/assets\/(index-[^"]+\.js)/)?.[1];
    const localEntry = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8')
      .match(/assets\/(index-[^"]+\.js)/)?.[1];
    if (!servedEntry || servedEntry !== localEntry) throw new Error(`dist mismatch! served=${servedEntry} local=${localEntry}`);
    console.log('[0] preview ok, entry', servedEntry);

    let targets = null;
    for (let i = 0; i < 30 && !targets; i++) {
      await sleep(500);
      try { targets = await httpGetJson(`http://127.0.0.1:${PORT_CDP}/json/list`); } catch (e) {}
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
    const send = (method, params) => new Promise((resolve, reject) => {
      pending.set(++mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evalv = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || ''));
      return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    // Guarda chamadas de window.alert (contrato v3: NUNCA alert cru).
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__solarisAlertCalls = []; window.alert = (m) => { window.__solarisAlertCalls.push(String(m)); };`,
    });
    // Stubs gapi/google + bloqueio de rede Google (mesma proteção dos shots R3).
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.gapi = { load: (n, o) => o && o.callback && o.callback(), client: { init: async () => ({}), setToken: () => {} } };
        window.google = { accounts: { oauth2: { initTokenClient: (c) => ({ requestAccessToken: () => c && c.error_callback && c.error_callback({ type: 'stub' }) }) } } };
      `,
    });

    await send('Page.navigate', { url: URL_APP });

    // [1] login → guest/demo
    let guestOk = false;
    for (let i = 0; i < 40 && !guestOk; i++) {
      await sleep(1000);
      try {
        await evalv(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`);
        guestOk = (await evalv(`document.querySelectorAll('ul li').length > 0`)) === true;
      } catch (e) {}
    }
    check('login guest/demo', guestOk);
    if (!guestOk) throw new Error('guest falhou');

    // [2] fila demo carregada → primeira OS → workspace de análise
    let rows = 0;
    for (let i = 0; i < 20 && !rows; i++) {
      await sleep(1000);
      rows = (await evalv(`document.querySelectorAll('ul li').length`).catch(() => 0)) || 0;
    }
    check('fila demo com itens', rows > 0, String(rows));
    await evalv(`(() => { const li = [...document.querySelectorAll('ul li')].find(el => el.onclick || el.getAttribute('tabindex') !== null || el.className.includes('cursor')) || document.querySelector('ul li'); li?.click(); return !!li; })()`);
    let open = false;
    for (let i = 0; i < 15 && !open; i++) {
      await sleep(1000);
      open = (await evalv(`document.body.innerText.includes('RGB Parade') || document.body.innerText.includes('Analysis Sheet')`).catch(() => false)) === true;
    }
    check('workspace de análise aberto', open);
    if (!open) throw new Error('workspace não abriu');
    await sleep(3000);

    // ---------- PROVA A: modal de zoom dos monitores ----------
    await evalv(`[...document.querySelectorAll('button')].find(b => /expand monitor/i.test(b.getAttribute('aria-label') || ''))?.click()`);
    await sleep(800);
    const zoomOpen = await evalv(`(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { open: false };
      const doc = dlg.querySelector('[role="document"]');
      const inner = doc || dlg.firstElementChild;
      const cls = inner ? String(inner.className) : '';
      const h2 = dlg.querySelector('h2')?.textContent || '';
      const btns = [...dlg.querySelectorAll('button[aria-label="Close"]')];
      const closeBtn = btns[btns.length - 1] || null;
      return {
        open: true,
        v3Surface: /bg-surface/.test(cls) && /border-hairline/.test(cls) && /shadow-pop/.test(cls),
        legacyBorder: /solar-dark-(bg|border)/.test(cls),
        title: h2,
        hasCloseBtn: !!closeBtn,
        focusRing: closeBtn ? /focus-visible:ring/.test(String(closeBtn.className)) : false,
      };
    })()`);
    check('zoom modal aberto (dock)', zoomOpen.open === true, 'title=' + zoomOpen.title);
    check('zoom modal superfície v3 (surface+hairline+pop)', zoomOpen.v3Surface === true);
    check('zoom modal sem borda legada', zoomOpen.legacyBorder === false);
    check('zoom modal close btn com focus-ring accent', zoomOpen.focusRing === true);
    fs.mkdirSync(OUT, { recursive: true });
    let s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't15_zoom_modal.png'), Buffer.from(s.data, 'base64'));

    // ESC fecha (contrato dos demais modais)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(600);
    const zoomClosed = await evalv(`!document.querySelector('[role="dialog"]')`);
    check('zoom modal fecha com ESC', zoomClosed === true);

    // ---------- PROVA B: Time Markers ----------
    // O botão de marcadores exige mídia carregada (comportamento MVP). No modo
    // guest, uma URL de YouTube passa pelo bypass legítimo (App.tsx linha ~181:
    // setCurrentVideoId antes do return do guest) — carregar pela UI real.
    await evalv(`[...document.querySelectorAll('button')].find(b => /youtube/i.test(b.textContent || ''))?.click()`);
    await sleep(500);
    const ytFill = await evalv(`(() => {
      const inp = [...document.querySelectorAll('input')].find(i => /outube/i.test(i.getAttribute('aria-label') || ''));
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const form = inp.closest('form');
      if (!form) return false;
      form.requestSubmit();
      return true;
    })()`);
    check('URL de YouTube submetida via UI (fonte da mídia)', ytFill === true);
    await sleep(2000);

    const tmBtnState = await evalv(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '') === 'Open time markers');
      return b ? { found: true, disabled: b.disabled } : { found: false };
    })()`);
    check('botão de marcadores habilitado com mídia', tmBtnState.found === true && tmBtnState.disabled === false);
    if (!tmBtnState.found || tmBtnState.disabled) throw new Error('marcadores continua desabilitado');

    await evalv(`[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === 'Open time markers')?.click()`);
    await sleep(700);
    const tmState1 = await evalv(`(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { open: false };
      const skeletons = dlg.querySelectorAll('.skeleton-line').length;
      return { open: true, skeletons, text: dlg.bodyText || dlg.textContent.slice(0, 400) };
    })()`);
    check('time markers modal aberto', tmState1.open === true);
    if (!tmState1.open) throw new Error('modal marcadores não abriu');

    // espera passar o skeleton (demo: isLoading=false logo após microtask)
    let tmReady = null;
    for (let i = 0; i < 10; i++) {
      await sleep(400);
      tmReady = await evalv(`(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const ta = dlg && dlg.querySelector('textarea.input');
        const addBtn = dlg && [...dlg.querySelectorAll('button.btn-primary')].find(b => b.textContent.includes('Add Marker'));
        return { skeletons: dlg.querySelectorAll('.skeleton-line').length, hasKitInput: !!ta, hasKitPrimary: !!addBtn, emptyState: dlg.textContent.includes('No Markers') };
      })()`).catch(() => null);
      if (tmReady && tmReady.skeletons === 0 && tmReady.hasKitInput && tmReady.hasKitPrimary) break;
    }
    check('loading com skeleton desenhado (apareceu na abertura)', typeof tmState1.skeletons === 'number' && tmState1.skeletons >= 3, 'skeletons=' + tmState1.skeletons);
    check('textarea no kit v3 (.input)', tmReady?.hasKitInput === true);
    check('Add Marker como btn-primary do kit', tmReady?.hasKitPrimary === true);

    // digita comentário com eventos NATIVOS (foco real + insertText) pra
    // garantir sync do estado React; guarda diagnóstico do guard de save.
    const diag = await evalv(`(() => {
      const ta = document.querySelector('[role="dialog"] textarea.input');
      const r = ta.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, hasVideo: !!document.querySelector('video') };
    })()`);
    console.log('   [diag] hasVideo=' + diag.hasVideo);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(diag.x), y: Math.round(diag.y), button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(diag.x), y: Math.round(diag.y), button: 'left', clickCount: 1 });
    await sleep(300);
    await send('Input.insertText', { text: 'verificar ruído no minute 1' });
    await sleep(400);
    const preSave = await evalv(`(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...dlg.querySelectorAll('button.btn-primary')].find(b => b.textContent.includes('Add Marker'));
      const ta = dlg.querySelector('textarea.input');
      return { btnFound: !!btn, btnDisabled: btn ? btn.disabled : null, taValue: ta.value };
    })()`);
    check('textarea focada recebeu texto (estado sincronizado)', preSave.taValue === 'verificar ruído no minute 1' && preSave.btnDisabled === false, 'disabled=' + preSave.btnDisabled);
    // salva em modo demo → erro humano inline, sem alert cru (clique por coordenadas)
    const btnPos = await evalv(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button.btn-primary')].find(b => b.textContent.includes('Add Marker')); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(btnPos.x), y: Math.round(btnPos.y), button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(btnPos.x), y: Math.round(btnPos.y), button: 'left', clickCount: 1 });
    // Runtime real: a dist aponta pra um RTDB dummy — o push fica ENFILEIRADO
    // (comportamento offline do RTDB), sem rejeição em tempo útil. A prova de
    // BANNER humano é determinística no teste de componente (firebase mockado).
    // Aqui provamos o contrato de runtime: NENHUM alert cru, sem crash, e a
    // promessa do hint (comentário preservado).
    await sleep(4000);
    const tmRuntime = await evalv(`(() => ({
      alerts: window.__solarisAlertCalls ? window.__solarisAlertCalls.join(' | ') : '',
      commentKept: (document.querySelector('[role="dialog"] textarea.input') || {}).value || null,
      dialogAlive: !!document.querySelector('[role="dialog"]'),
    }))()`);
    check('zero window.alert cru no fluxo de save', tmRuntime.alerts === '', tmRuntime.alerts.slice(0, 60));
    check('modal vivo sem crash pós-save pendurado', tmRuntime.dialogAlive === true);
    check('comentário preservado no campo', !!tmRuntime.commentKept, (tmRuntime.commentKept || '').slice(0, 40));
    fs.mkdirSync(OUT, { recursive: true });
    s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't15_time_markers_human_error.png'), Buffer.from(s.data, 'base64'));

    clearTimeout(hardExit);
    ws.close();
  } catch (e) {
    console.error('[erro]', e.message);
    failures.push('excecao: ' + e.message);
  } finally {
    try { chromeProc.kill(); } catch {}
    try { viteProc.kill(); } catch {}
  }
  console.log(failures.length === 0 ? '=== VERIFY_T15 OK ===' : `=== VERIFY_T15: ${failures.length} FALHAS ===`);
  process.exit(failures.length);
})();

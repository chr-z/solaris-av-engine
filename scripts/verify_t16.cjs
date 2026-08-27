// Verificação t16 no browser real (protocolo anti-órfão da lane):
// Chrome headless --disable-gpu + vite preview da dist LOCAL (strictPort,
// porta alta aleatória, hash do entry conferida contra o dist em disco).
//
// Provas (sweep dos estados de interação legados -> kit v3):
//   A) Menu do usuário no Header: trigger com .icon-btn, itens .menu-item
//      (+ .menu-item-danger no Sign out), regras :hover consumindo o token
//      --color-hover-wash presentes no CSS servido. Zero classe legada
//      hover:bg-gray-500/20 nos elementos migrados.
//   B) Time Markers: botão da toolbar com .icon-btn; chips Sort by com
//      .chip-sort e estado ativo via .is-active que MUDA de lugar ao clicar;
//      fechar modal por ESC continua funcionando (contrato v3).
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
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-t16-' + Date.now());

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
    await sleep(2500);

    // ---------- PROVA A: menu do usuário em kit v3 ----------
    const trigA = await evalv(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('img') && (b.className || '').includes('icon-btn'));
      if (!btn) return { found: false };
      const cls = String(btn.className);
      return {
        found: true,
        hasIconBtn: cls.includes('icon-btn'),
        legacyHover: cls.includes('hover:bg-gray-500') || cls.includes('bg-gray-500/20'),
      };
    })()`);
    check('trigger do menu do usuário existe e usa .icon-btn', trigA.found === true && trigA.hasIconBtn === true);
    check('trigger sem hover legado gray-500/20', trigA.found === true && trigA.legacyHover === false);
    // Regras de interação do kit existem no CSS SERVIDO e consomem o token
    // (busca por substring na regra serializada — sem regex, sem dor de escape):
    const cssRules = await evalv(`(() => {
      const chunks = [];
      const walk = (rules) => { for (const r of rules) { chunks.push(r.cssText || ''); if (r.cssRules) walk(r.cssRules); } };
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        walk(rules);
      }
      const all = chunks.join('\\n');
      const grabRule = (sel) => {
        const i = all.indexOf(sel);
        if (i < 0) return '';
        const j = all.indexOf('}', i);
        return j < 0 ? '' : all.slice(i, j);
      };
      return {
        menuItemHover: grabRule('.menu-item:hover:not(:disabled)').includes('--color-hover-wash'),
        iconBtnHover: grabRule('.icon-btn:hover:not(:disabled)').includes('--color-hover-wash')
          && grabRule('.icon-btn:hover:not(:disabled)').includes('var(--color-text)'),
        dangerWash: grabRule('.icon-btn-danger:hover:not(:disabled)').includes('fail-rgb'),
        chipActive: grabRule('.chip-sort.is-active').includes('--color-accent-rgb'),
      };
    })()`);
    check('.menu-item:hover consome --color-hover-wash (CSS servido)', cssRules.menuItemHover === true);
    check('.icon-btn:hover presente no CSS servido', cssRules.iconBtnHover === true);
    check('wash fail rgb(var(--color-fail-rgb)/.12) no CSS', cssRules.dangerWash === true);
    check('.chip-sort.is-active usa wash accent rgb()', cssRules.chipActive === true);

    // abre o popover do usuário
    await evalv(`[...document.querySelectorAll('button')].find(b => b.querySelector('img') && (b.className || '').includes('icon-btn'))?.click()`);
    await sleep(700);
    const menuState = await evalv(`(() => {
      const items = [...document.querySelectorAll('a.menu-item, button.menu-item')];
      const signOut = [...document.querySelectorAll('button.menu-item-danger')];
      // escopo: o container do MENU do usuario (o div.p-1 que contem .menu-item)
      const menus = [...document.querySelectorAll('div.p-1')].filter(d => d.querySelector('.menu-item'));
      const legacyInMenu = menus.flatMap(m => [...m.querySelectorAll('[class*="bg-gray-500"], [class*="hover:bg-gray-500"]')]).length;
      return {
        open: items.length > 0,
        nItems: items.length,
        nDanger: signOut.length,
        labels: items.map(i => i.textContent.trim()).slice(0, 6),
        legacyInMenu,
      };
    })()`);
    check('popover do usuário abriu com itens .menu-item', menuState.open === true && menuState.nItems >= 3, JSON.stringify(menuState.labels));
    check('Sign out como .menu-item-danger', menuState.nDanger === 1);
    check('nenhum item do menu com hover legado remanescente', menuState.legacyInMenu === 0, 'legacy=' + menuState.legacyInMenu);
    fs.mkdirSync(OUT, { recursive: true });
    let s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't16_user_menu_v3.png'), Buffer.from(s.data, 'base64'));

    // ESC fecha o popover (comportamento MVP preservado)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(600);

    // ---------- PROVA B: Time Markers (toolbar icon-btn + chips) ----------
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
      if (!b) return { found: false };
      const cls = String(b.className);
      return { found: true, disabled: b.disabled, hasIconBtn: cls.includes('icon-btn'), legacyHover: cls.includes('bg-gray-500/20') };
    })()`);
    check('botão marcadores habilitado com mídia', tmBtnState.found === true && tmBtnState.disabled === false);
    check('botão marcadores em .icon-btn sem hover legado', tmBtnState.hasIconBtn === true && tmBtnState.legacyHover === false);
    if (!tmBtnState.found || tmBtnState.disabled) throw new Error('marcadores continua desabilitado');

    await evalv(`[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === 'Open time markers')?.click()`);
    // modal monta com skeleton primeiro; espera os chips aparecerem de verdade.
    // O popover do YouTube tambem tem role=dialog — pega o dialogo que tem chips.
    let chips = null;
    for (let i = 0; i < 25 && !chips; i++) {
      await sleep(400);
      chips = await evalv(`(() => {
        const dlg = [...document.querySelectorAll('[role="dialog"]')].find(d => d.querySelector('button.chip-sort'));
        if (!dlg) return null;
        const cs = [...dlg.querySelectorAll('button.chip-sort')];
        if (cs.length < 2) return null;
        return cs.map(c => ({ label: c.textContent.trim(), active: c.classList.contains('is-active'), legacyHover: String(c.className).includes('hover:bg-gray-500/20') || String(c.className).includes('bg-solar-accent/20') }));
      })()`).catch(() => null);
    }
    check('dois chips .chip-sort no cabeçalho dos marcadores', Array.isArray(chips) && chips.length === 2, JSON.stringify(chips));
    check('chip Time ativo por padrão (.is-active), sem classes legadas', !!chips && chips[0]?.label === 'Time' && chips[0]?.active === true && chips.every(c => !c.legacyHover));

    // alterna pro chip Comment → is-active muda de lugar (mesmo comportamento)
    await evalv(`(() => { const dlg = [...document.querySelectorAll('[role="dialog"]')].find(d => d.querySelector('button.chip-sort')); [...(dlg ? dlg.querySelectorAll('button.chip-sort') : [])].find(c => c.textContent.trim() === 'Comment')?.click(); return true; })()`);
    await sleep(500);
    const afterSwap = await evalv(`(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find(d => d.querySelector('button.chip-sort'));
      if (!dlg) return null;
      const cs = [...dlg.querySelectorAll('button.chip-sort')];
      return cs.map(c => ({ label: c.textContent.trim(), active: c.classList.contains('is-active') }));
    })()`);
    check('clique troca o chip ativo p/ Comment', !!afterSwap && afterSwap.find(c => c.label === 'Comment')?.active === true && afterSwap.find(c => c.label === 'Time')?.active === false, JSON.stringify(afterSwap));
    fs.mkdirSync(OUT, { recursive: true });
    s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't16_time_markers_chips.png'), Buffer.from(s.data, 'base64'));

    // fecha por ESC (contrato dos modais). O iframe do YouTube pode roubar o
    // foco do documento — devolve o foco clicando no título do modal antes.
    await evalv(`(() => { const dlg = [...document.querySelectorAll('[role="dialog"]')].find(d => [...d.querySelectorAll('h2')].some(x => x.textContent.includes('Time Markers'))); if (!dlg) return false; const h = dlg.querySelector('h2'); const r = h.getBoundingClientRect(); window.__tmFocus = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; return true; })()`);
    const focusPos = await evalv('window.__tmFocus');
    if (focusPos) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(focusPos.x), y: Math.round(focusPos.y), button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(focusPos.x), y: Math.round(focusPos.y), button: 'left', clickCount: 1 });
      await sleep(300);
    }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(600);
    let closedByEsc = false;
    for (let i = 0; i < 6 && !closedByEsc; i++) {
      closedByEsc = (await evalv(`![...document.querySelectorAll('[role="dialog"]')].some(d => [...d.querySelectorAll('h2')].some(x => x.textContent.includes('Time Markers')))`).catch(() => false)) === true;
      if (!closedByEsc) {
        // segunda tentativa: foco pode ter voltado pro iframe
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
        await sleep(700);
      }
    }
    check('modal marcadores fecha com ESC', closedByEsc === true);

    clearTimeout(hardExit);
    ws.close();
  } catch (e) {
    console.error('[erro]', e.message);
    failures.push('excecao: ' + e.message);
  } finally {
    try { chromeProc.kill(); } catch {}
    try { viteProc.kill(); } catch {}
  }
  console.log(failures.length === 0 ? '=== VERIFY_T16 OK ===' : `=== VERIFY_T16: ${failures.length} FALHAS ===`);
  process.exit(failures.length);
})();

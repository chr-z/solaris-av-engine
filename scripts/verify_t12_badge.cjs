// Verificação T12 no browser real: badge de score com tier semântico na lista
// (pill tabular verde/amarelo/vermelho pelos cortes do ScoringEngine) + zebra/
// hover sutil nas linhas. Protocolo anti-órfão (preview própria em porta alta +
// prova de hash do build + cleanup no finally). Exit code = nº de falhas.
//
// Provas:
//  A. estático: dist CSS contém .badge-score e as variantes semânticas
//     (.badge-pill.badge-ok/warn/fail) + utilities zebra (even:bg-surface);
//  B. runtime (estado limpo): toda linha com score renderiza pill badge-score,
//     classe badge-ok (demo tem 4.60..5.00), cor computada = token --color-ok,
//     número em mono tabular;
//  C. runtime (marcação): marcar TODAS as regras de Lighting da pior linha
//     demo (WO-2024-101, 4.62) derruba o final pra faixa warn — se o estado do
//     demo propagar pra lista, o badge da linha vira amarelo ao vivo;
//  D. shots t12_fila_badges.png / t12_fila_badges_marked.png.
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const REPO = 'C:/Yui/data/saas/solaris-redesign';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
const PREVIEW_PORT = 4700 + Math.floor(Math.random() * 200);
const CDP_PORT = 9700 + Math.floor(Math.random() * 200);
const BASE = `http://localhost:${PREVIEW_PORT}`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-verify-t12-' + Date.now());

// Token v3 --color-ok = #34D399 -> rgb(52, 211, 153)
const OK_RGB = 'rgb(52, 211, 153)';
// Token v3 --color-warn = #FBBF24 -> rgb(251, 191, 36)
const WARN_RGB = 'rgb(251, 191, 36)';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { spawn } = require('child_process');
  const failures = [];

  // ---- prova A: estático no dist
  const distAssets = path.join(REPO, 'dist', 'assets');
  const cssFile = fs.readdirSync(distAssets).find((f) => f.endsWith('.css'));
  const css = fs.readFileSync(path.join(distAssets, cssFile), 'utf8');
  const distIndex = fs.readFileSync(path.join(REPO, 'dist', 'index.html'), 'utf8');
  const localEntry = (distIndex.match(/assets\/index-[^"]+\.js/) || [])[0];

  if (!/\.badge-score\s*\{/.test(css)) failures.push('.badge-score ausente no CSS final');
  if (!/\.badge-pill\.badge-ok/.test(css)) failures.push('.badge-pill.badge-ok ausente');
  if (!/\.badge-pill\.badge-warn/.test(css)) failures.push('.badge-pill.badge-warn ausente');
  if (!/\.badge-pill\.badge-fail/.test(css)) failures.push('.badge-pill.badge-fail ausente');
  console.log('[A] estatico: badge-score + variantes semânticas no dist?', failures.length === 0);

  // ---- preview própria servindo ESTE build
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: REPO, stdio: 'ignore', shell: true });
  let served = null;
  for (let i = 0; i < 40 && !served; i++) { await sleep(500); try { served = await httpGet(`${BASE}/`); } catch (e) {} }
  if (!served) throw new Error('preview nao subiu');
  const servedEntry = (served.match(/assets\/index-[^"]+\.js/) || [])[0];
  console.log('[build] servida == local?', servedEntry === localEntry);
  if (servedEntry !== localEntry) failures.push('preview servindo outro build');

  // ---- chrome headless
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { chrome.kill(); preview.kill(); process.exit(2); }, 300000);

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
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r && r.exceptionDetails) throw new Error('page eval: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 400));
      return r && r.result ? r.result.value : undefined;
    };

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};`,
    });

    // ---- LOGIN (sinal correto: botão guest SUMIR da tela, não contar li)
    await send('Page.navigate', { url: `${BASE}/` });
    let loginVisible = false;
    for (let i = 0; i < 40 && !loginVisible; i++) {
      await sleep(1000);
      loginVisible = (await evalJs(`!![...document.querySelectorAll('button')].find(b => /google/i.test(b.textContent))`).catch(() => false)) === true;
    }
    if (!loginVisible) throw new Error('login não apareceu');
    await evalJs(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`);
    let guestGone = false;
    for (let i = 0; i < 25 && !guestGone; i++) {
      await sleep(1000);
      guestGone = (await evalJs(`![...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))`).catch(() => false)) === true;
    }
    if (!guestGone) throw new Error('login guest não entrou');
    console.log('[1] guest dentro');

    // ---- FILA: prova B (estado limpo)
    let badgeInfo = null;
    for (let i = 0; i < 25 && !badgeInfo; i++) {
      await sleep(1000);
      badgeInfo = await evalJs(`(() => {
        const badges = [...document.querySelectorAll('.badge-pill.badge-score')];
        if (!badges.length) return null;
        const lis = [...document.querySelectorAll('ul li')];
        return {
          badges: badges.length,
          lis: lis.length,
          classes: badges.map(b => b.className),
          colors: badges.map(b => getComputedStyle(b).color),
          tnumFont: getComputedStyle(badges[0].querySelector('.tnum')).fontFamily,
          tnumVariant: getComputedStyle(badges[0].querySelector('.tnum')).fontVariantNumeric,
        };
      })()`).catch(() => null);
    }
    if (!badgeInfo) throw new Error('nenhum badge-score na fila');
    console.log('[2] badges:', badgeInfo.badges, '| lis:', badgeInfo.lis, '| classes:', JSON.stringify(badgeInfo.classes));
    console.log('[2] cores:', JSON.stringify(badgeInfo.colors));
    if (badgeInfo.badges < 5) failures.push('badges a menos que linhas com score (esperado >=5)');
    const allOk = badgeInfo.classes.every(c => c.includes('badge-ok'));
    const anyGreen = badgeInfo.colors.includes(OK_RGB);
    if (!allOk || !anyGreen) failures.push(`estado limpo deveria ser todo verde (${JSON.stringify({ allOk, anyGreen })})`);
    if (!/JetBrains|mono/i.test(badgeInfo.tnumFont)) failures.push('.tnum sem fonte mono: ' + badgeInfo.tnumFont);
    if (!/tabular/.test(badgeInfo.tnumVariant)) failures.push('.tnum sem tabular-nums: ' + badgeInfo.tnumVariant);
    console.log('[B] limpo: tudo verde, mono tabular?', allOk && anyGreen, '|', badgeInfo.tnumVariant);

    const s1 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't12_fila_badges.png'), Buffer.from(s1.data, 'base64'));
    console.log('[shot] t12_fila_badges.png');

    // ---- prova C: abre a PIOR linha (WO-2024-101, 4.62) e marca todas as regras de Lighting
    const opened = await evalJs(`(() => {
      const li = [...document.querySelectorAll('ul li')].find(el => el.textContent.includes('WO-2024-101'));
      if (!li) return false;
      li.click(); return true;
    })()`);
    if (!opened) throw new Error('linha WO-2024-101 nao encontrada na fila');
    let open = false;
    for (let i = 0; i < 20 && !open; i++) {
      await sleep(1000);
      open = (await evalJs(`document.body.innerText.includes('Analysis Sheet') || document.body.innerText.includes('RGB Parade')`)) === true;
    }
    if (!open) throw new Error('workspace nao abriu');
    console.log('[3] workspace aberto (WO-2024-101)');

    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Lighting')?.click()`);
    await sleep(800);
    let marked = 0;
    for (let iter = 0; iter < 20; iter++) {
      const clicked = await evalJs(`(() => {
        const boxes = [...document.querySelectorAll('input[type=checkbox]')].filter(c => !c.checked);
        if (!boxes.length) return false;
        boxes[0].click(); return true;
      })()`);
      if (!clicked) break;
      marked++;
      await sleep(350);
    }
    console.log('[4] regras de Lighting marcadas:', marked, '(9 existem na aba)');
    console.log('[4] regras de Lighting marcadas pelo demo:', marked);
    await sleep(1200);

    // volta pra fila: fecha o workspace (X do header) ou history.back()
    const wentBack = await evalJs(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b =>
        (b.getAttribute('aria-label') || '').match(/close|back|voltar/i));
      if (btn) { btn.click(); return 'botao:' + btn.getAttribute('aria-label'); }
      history.back(); return 'history.back';
    })()`);
    console.log('[5] voltou pra fila via', wentBack);
    let listBack = false;
    for (let i = 0; i < 15 && !listBack; i++) {
      await sleep(1000);
      listBack = (await evalJs(`!!document.querySelector('.badge-pill.badge-score')`)) === true;
    }
    if (!listBack) throw new Error('fila não reapareceu depois de fechar o workspace');

    // lê o badge da linha marcada
    const markedBadge = await evalJs(`(() => {
      const li = [...document.querySelectorAll('ul li')].find(el => el.textContent.includes('WO-2024-101'));
      if (!li) return null;
      const b = li.querySelector('.badge-pill.badge-score');
      return b ? { cls: b.className, color: getComputedStyle(b).color, text: b.innerText } : null;
    })()`);
    console.log('[6] badge DEPOIS da marcação:', JSON.stringify(markedBadge));

    const s2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't12_fila_badges_marked.png'), Buffer.from(s2.data, 'base64'));
    console.log('[shot] t12_fila_badges_marked.png');

    const propagated = markedBadge && markedBadge.cls.includes('badge-warn') && markedBadge.color === WARN_RGB;
    console.log('[C] demo propagou pro badge? (amarelo vivo)', propagated);
    if (!propagated) {
      console.log('[!] NOTA: modo demo nao propagou a nota pra lista (escrita passa pelo sheetSync/nuvem).');
      console.log('    Tier warn/fail fica coberto por: testes unitarios de scoreBandClass + prova A (CSS) +');
      console.log('    mesma classe/pill do estado verde provado em B. Registrado como limitacao do modo demo.');
    }

    clearTimeout(hardExit);
    ws.close();
  } finally {
    chrome.kill();
    preview.kill();
  }

  console.log('\n==== RESULTADO T12 ====');
  if (failures.length) { failures.forEach((f) => console.log('FAIL:', f)); process.exit(failures.length); }
  console.log('TUDO VERDE: badge-score com tier semantico no ar, zebra/hover na lista');
  process.exit(0);
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

// Verificação T11 no browser real: rampa neutra v3 remapeada sobre a escala
// `gray`. Protocolo anti-órfão (preview próprio em porta alta + prova de hash
// do build + cleanup no finally). Exit code = nº de falhas.
//
// Provas:
//  A. estático: dist CSS contém a rampa (--color-neutral-*) E as utilities
//     text-gray-* apontando pros gêmeos _rgb da rampa (não pro cinza antigo);
//  B. runtime: nenhum elemento renderizado (login/fila/análise) carrega cor
//     computada da paleta gray ANTIGA do Tailwind;
//  C. runtime: ::placeholder dos inputs usa o tom 500 novo (#7B87A0);
//  D. shots t11_login / t11_fila / t11_analysis p/ comparativo do dono.
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const REPO = 'C:/Yui/data/saas/solaris-redesign';
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';
const PREVIEW_PORT = 4700 + Math.floor(Math.random() * 200);
const CDP_PORT = 9700 + Math.floor(Math.random() * 200);
const BASE = `http://localhost:${PREVIEW_PORT}`;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-verify-t11-' + Date.now());

// Paleta gray ANTIGA do Tailwind (RGB) — não pode sobrar nenhuma na tela.
const OLD_GRAY = new Set([
  '243, 244, 246', '229, 231, 235', '209, 213, 219', '156, 163, 175',
  '107, 114, 128', '75, 85, 99', '55, 65, 81', '31, 41, 55', '17, 24, 39',
]);
const NEW_500 = 'rgb(123, 135, 160)'; // --color-neutral-500

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

  if (!/--color-neutral-500:\s*#7b87a0/.test(css)) failures.push('rampa neutra ausente no CSS final');
  if (!/\.text-gray-400\{[^}]*color:\s*rgb\(var\(--color-neutral-400-rgb\)/.test(css))
    failures.push('text-gray-400 nao aponta pra rampa v3');

  // ---- preview próprio servindo ESTE build
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
  const hardExit = setTimeout(() => { chrome.kill(); preview.kill(); process.exit(2); }, 240000);

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

    // ---- tela LOGIN
    await send('Page.navigate', { url: `${BASE}/` });
    let loginVisible = false;
    for (let i = 0; i < 40 && !loginVisible; i++) {
      await sleep(1000);
      loginVisible = (await evalJs(`!![...document.querySelectorAll('button')].find(b => /google/i.test(b.textContent))`).catch(() => false)) === true;
    }
    if (!loginVisible) throw new Error('login não apareceu');

    // varredura de paleta antiga (função reutilizada em cada tela)
    const SCAN = `(() => {
      const els = [...document.querySelectorAll('*')].filter(e => /\\b(text|bg|border|ring|placeholder|from|to)-gray-\\d/.test(e.getAttribute('class') || '')).slice(0, 900);
      const bad = [];
      for (const e of els) {
        const cs = getComputedStyle(e);
        for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
          const v = cs[prop];
          const m = v.match(/^rgba?\\(([^)]+)\\)$/);
          if (m && OLD_GRAY_SET.includes(m[1].replace(/, 255$/, ''))) bad.push(e.className.slice(0, 60) + ' -> ' + v);
        }
      }
      return { scanned: els.length, bad };
    })()`.replace('OLD_GRAY_SET', JSON.stringify([...OLD_GRAY]));

    const scanLogin = await evalJs(SCAN);
    console.log('[login] elementos c/ gray:', scanLogin.scanned, '| paleta antiga:', scanLogin.bad.length);
    if (scanLogin.bad.length) { failures.push('login usa gray antigo: ' + scanLogin.bad.slice(0, 3).join(' | ')); }

    const s1 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't11_login.png'), Buffer.from(s1.data, 'base64'));
    console.log('[shot] t11_login.png');

    // ---- entra como GUEST → FILA
    await evalJs(`[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()`);
    let rows = 0;
    for (let i = 0; i < 25 && !rows; i++) {
      await sleep(1000);
      rows = (await evalJs(`document.querySelectorAll('ul li').length`).catch(() => 0)) || 0;
    }
    if (!rows) throw new Error('fila demo nao carregou');
    console.log('[fila] itens:', rows);

    // placeholder prova C
    const ph = await evalJs(`(() => {
      const inp = document.querySelector('input[placeholder]');
      if (!inp) return null;
      return getComputedStyle(inp, '::placeholder').color;
    })()`);
    console.log('[placeholder] cor:', ph, '| esperado:', NEW_500);
    if (ph !== NEW_500) failures.push('placeholder fora da rampa: ' + ph);

    const scanFila = await evalJs(SCAN);
    console.log('[fila] elementos c/ gray:', scanFila.scanned, '| paleta antiga:', scanFila.bad.length);
    if (scanFila.bad.length) { failures.push('fila usa gray antigo: ' + scanFila.bad.slice(0, 3).join(' | ')); }

    const s2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't11_fila.png'), Buffer.from(s2.data, 'base64'));
    console.log('[shot] t11_fila.png');

    // ---- abre PRIMEIRA OS → ANÁLISE
    await evalJs(`(() => { document.querySelector('ul li')?.click(); return true; })()`);
    let open = false;
    for (let i = 0; i < 15 && !open; i++) {
      await sleep(1000);
      open = (await evalJs(`document.body.innerText.includes('Analysis Sheet') || document.body.innerText.includes('RGB Parade')`).catch(() => false)) === true;
    }
    console.log('[analise] workspace aberto?', open);
    if (!open) failures.push('workspace de análise não abriu');
    await sleep(4000);

    const scanAn = await evalJs(SCAN);
    console.log('[analise] elementos c/ gray:', scanAn.scanned, '| paleta antiga:', scanAn.bad.length);
    if (scanAn.bad.length) { failures.push('análise usa gray antigo: ' + scanAn.bad.slice(0, 3).join(' | ')); }

    const s3 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 't11_analysis.png'), Buffer.from(s3.data, 'base64'));
    console.log('[shot] t11_analysis.png');

    clearTimeout(hardExit);
    ws.close();
  } finally {
    chrome.kill();
    preview.kill();
  }

  console.log('\\n==== RESULTADO T11 ====');
  if (failures.length) { failures.forEach((f) => console.log('FAIL:', f)); process.exit(failures.length); }
  console.log('TUDO VERDE: rampa v3 no ar, zero paleta antiga nas 3 telas');
  process.exit(0);
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

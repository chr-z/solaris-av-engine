// Probe t10: checklist de inconformidades usa o kit .checkbox-custom animado.
// Prova no browser real (headless --disable-gpu): appearance:none, gradiente
// accent ao marcar, comportamento preservado (onChange dispara). Screenshots
// antes/depois em redesign_shots/t10_*.png pra comparação MVP vs v3.
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9233;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-verify-' + Date.now());
const OUT = 'C:/Yui/data/saas_factory/redesign_shots';

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
  const { spawn } = require('child_process');
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { chrome.kill(); process.exit(2); }, 150000);
  const failures = [];
  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try { targets = await httpGetJson(`http://127.0.0.1:${PORT}/json/list`); break; } catch (e) {}
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

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.gapi={load:(n,o)=>o&&o.callback&&o.callback(),client:{init:async()=>({}),setToken:()=>{}}};window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'})})}}};`,
    });
    await send('Page.navigate', { url: process.env.SHOT_URL || 'http://localhost:4321/' });

    // login → guest → fila
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      await sleep(1000);
      try {
        await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b => /guest|convidado/i.test(b.textContent))?.click()` });
        const r = await send('Runtime.evaluate', { expression: `document.querySelectorAll('ul li').length > 0`, returnByValue: true });
        ok = r.result.value === true;
      } catch (e) {}
    }
    if (!ok) throw new Error('guest falhou');

    // abre a primeira OS
    await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('ul li')].find(el => (el.className||'').includes('cursor'))?.click() || document.querySelector('ul li')?.click()` });
    let open = false;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const r = await send('Runtime.evaluate', { expression: `document.body.innerText.includes('Analysis Sheet')`, returnByValue: true }).catch(() => ({ result: { value: false } }));
      open = r.result.value === true;
      if (open) break;
    }
    if (!open) throw new Error('workspace não abriu');
    await sleep(3000);

    const evalJson = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
      if (r && r.result && 'value' in r.result) return r.result.value;
      if (r && r.exceptionDetails) console.log('[page-exception]', JSON.stringify(r.exceptionDetails).slice(0, 300));
      return undefined;
    };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
      console.log('shot:', name);
    };

    // Prova anti-stale: entry servido == dist local
    const servedEntry = await evalJson(`document.querySelector('script[type=module]')?.src || ''`);
    const distEntry = fs.readdirSync('dist/assets').find(f => /^index-.*\.js$/.test(f));
    const antiStale = !!servedEntry && servedEntry.includes(distEntry);
    console.log('entry:', path.basename(servedEntry || '?'), '| dist:', distEntry, '| match:', antiStale);

    // Acha aba com checkboxes do checklist se a ativa não tiver
    let count = await evalJson(`document.querySelectorAll('form input.checkbox-custom, label > input.checkbox-custom').length`) || 0;
    if (!count) {
      const tabs = await evalJson(`[...document.querySelectorAll('nav[aria-label="Tabs"] button')].map(b => b.textContent)`);
      for (const t of (tabs || [])) {
        await evalJson(`[...document.querySelectorAll('nav[aria-label="Tabs"] button')].find(b => b.textContent === ${JSON.stringify(t)})?.click()`);
        await sleep(400);
        count = await evalJson(`document.querySelectorAll('label > input.checkbox-custom').length`) || 0;
        if (count) break;
      }
    }

    // Estado computado ANTES de marcar
    const cs = await evalJson(`(() => {
      const el = document.querySelector('label > input.checkbox-custom');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { appearance: s.appearance, w: s.width, h: s.height, radius: s.borderRadius,
               oldRingClass: el.className.includes('ring-solar-accent'),
               border: s.borderColor };
    })()`);

    await shot('t10_checklist.png');

    // Marca um e prova o gradiente accent + comportamento
    const after = await evalJson(`(() => {
      const el = document.querySelector('label > input.checkbox-custom');
      if (!el) return null;
      const beforeChecked = el.checked;
      el.click();
      const s = getComputedStyle(el);
      return { beforeChecked, nowChecked: el.checked,
               bgImage: s.backgroundImage.slice(0, 120),
               changed: el.checked !== beforeChecked };
    })()`);
    await sleep(300);
    await shot('t10_checklist_marcado.png');
    // devolve ao estado original (demo local, mas higiene)
    await evalJson(`document.querySelector('label > input.checkbox-custom')?.click()`);

    const c = {
      antiStale,
      kitCount: (count || 0) > 0,
      appearanceNone: cs ? cs.appearance === 'none' : false,
      size16: cs ? cs.w === '16px' && cs.h === '16px' : false,
      noOldRingClass: cs ? !cs.oldRingClass : false,
      toggles: after ? after.changed === true : false,
      gradientWhenChecked: after ? /gradient/i.test(after.bgImage) : false,
    };
    console.log(JSON.stringify({ c, cs, after }, null, 2));
    for (const k of Object.keys(c)) if (!c[k]) failures.push(k);
    clearTimeout(hardExit);
    ws.close();
  } finally { chrome.kill(); }
  if (failures.length) { console.error('FALHAS:', failures.join(', ')); process.exit(failures.length); }
  console.log('VERIFY_T10_OK');
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

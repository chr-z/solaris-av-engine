// Probe DOM do build atual: o que renderiza em / e em /#/login apos 8s?
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = 4200 + Math.floor(Math.random() * 500);
const DEBUG_PORT = 9700 + Math.floor(Math.random() * 200);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',(c)=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}

async function main() {
  // serve dist
  const serve = spawn(process.execPath, [
    path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js'),
    'preview', '--port', String(PORT), '--strictPort',
  ], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  for (let i = 0; i < 20; i++) { await sleep(500); try { await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`); } catch (e) { continue; } }

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${DEBUG_PORT}`, '--headless=new', '--disable-gpu',
    '--window-size=1600,900', '--no-first-run',
    `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'solaris-domprobe-' + Date.now())}`,
    'about:blank',
  ], { stdio: 'ignore' });
  const hardExit = setTimeout(() => { try { chrome.kill(); serve.kill(); } catch {} process.exit(2); }, 90000);
  try {
    let targets = null;
    for (let i = 0; i < 24; i++) { await sleep(500); try { targets = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`); if (targets.length) break; } catch (e) {} }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); setTimeout(()=>j(new Error('ws timeout')),15000); });
    let mid = 0; const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
    });
    const send = (method, params) => new Promise((resolve, reject) => { pending.set(++mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result.value;
    };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*','*apis.google.com*','*googleapis.com*','*.gstatic.com*','*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.gapi = { load: (n,o)=>o&&o.callback&&o.callback(), client:{init:async()=>({}),setToken:()=>{}} };
      window.google = { accounts:{ oauth2:{ initTokenClient:(c)=>({ requestAccessToken:()=>c&&c.error_callback&&c.error_callback({type:'stub'}) }) } } };
    `});
    for (const url of [`http://localhost:${PORT}/#/login`, `http://localhost:${PORT}/`]) {
      await send('Page.navigate', { url });
      await sleep(8000);
      const snap = await evalJs(`(() => {
        const txt = (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,600);
        return {
          url: location.href,
          buttons: [...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim().slice(0,40)).filter(Boolean).slice(0,12),
          ulLi: document.querySelectorAll('ul li').length,
          trRows: document.querySelectorAll('table tbody tr').length,
          roleRow: document.querySelectorAll('[role="row"]').length,
          inputs: document.querySelectorAll('input').length,
          bodySnippet: txt,
        };
      })()`);
      console.log(JSON.stringify(snap, null, 1));
    }
    clearTimeout(hardExit);
    ws.close(); try { chrome.kill(); } catch {}
    try { serve.kill(); } catch {}
    process.exit(0);
  } catch (e) {
    console.error('[probe-erro]', e.message);
    clearTimeout(hardExit);
    try { chrome.kill(); } catch {}
    try { serve.kill(); } catch {}
    process.exit(1);
  }
}
main();

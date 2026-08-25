// turbo-web console probe: loads the served build, clicks Guest, captures
// every console error/warning + uncaught exception with stacks via CDP.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = process.argv[2];
if (!PORT) { console.error('usage: node scripts/console-probe.mjs <port>'); process.exit(2); }

// launch headless chrome
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [`--remote-debugging-port=9333`, '--headless=new', '--disable-gpu', '--no-first-run',
   '--user-data-dir=' + process.env.TEMP + '\\lh-probe-profile', 'about:blank'],
  { stdio: 'ignore' });
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
      target = list.find(t => t.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('no tab target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const { type, args, stackTrace } = msg.params;
      if (type === 'error' || type === 'warning') {
        events.push({ kind: 'console.' + type,
          text: args.map(a => a.value ?? a.description ?? JSON.stringify(a.preview?.properties?.map(p => p.value))).join(' ').slice(0, 500),
          stack: stackTrace ? stackTrace.callFrames.slice(0, 4).map(f => f.functionName + '@' + (f.url || '').split('/').pop() + ':' + f.lineNumber).join(' <- ') : '' });
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      events.push({ kind: 'EXCEPTION',
        text: (d.exception?.description || d.text).slice(0, 500),
        stack: d.stackTrace ? d.stackTrace.callFrames.slice(0, 5).map(f => f.functionName + '@' + (f.url || '').split('/').pop() + ':' + f.lineNumber).join(' <- ') : '' });
    }
  };
  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await sleep(4000);
  // click guest button if present
  const clicked = await send('Runtime.evaluate', {
    expression: `(() => { const b=[...document.querySelectorAll('button')].find(x=>/guest|visitante/i.test(x.textContent)); if(b){b.click();return true;} return false; })()`,
    returnByValue: true });
  await sleep(6000);
  chrome.kill();
  console.log('guestClicked:', clicked?.result?.value);
  console.log('events:', events.length);
  events.forEach(e => console.log('\n[' + e.kind + ']', e.text, '\n  stack:', e.stack));
} finally {
  try { chrome.kill(); } catch {}
}

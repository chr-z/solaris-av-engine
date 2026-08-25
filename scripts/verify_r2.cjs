// Verificação R2 v2: busca recursiva em @layer + inspeção direta de elementos.
const http = require('http');
const path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9229;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'solaris-verify2-' + Date.now());

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
  const hardExit = setTimeout(() => { chrome.kill(); process.exit(2); }, 90000);
  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try { targets = await httpGetJson(`http://127.0.0.1:${PORT}/json/list`); break; } catch (e) {}
    }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
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

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*', '*apis.google.com*', '*googleapis.com*', '*.gstatic.com*', '*www.google.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.gapi = { load: (n, o) => o && o.callback && o.callback(), client: { init: async () => ({}) } };
        window.google = { accounts: { oauth2: { initTokenClient: (c) => ({ requestAccessToken: () => c && c.error_callback && c.error_callback({ type: 'stub' }) }) } } };
      `,
    });
    await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });

    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      const r = await send('Runtime.evaluate', {
        expression: `[...document.querySelectorAll('button')].some(b => /guest|convidado/i.test(b.textContent))`,
        returnByValue: true,
      }).catch(() => null);
      if (r && r.result.value === true) break;
    }

    const checks = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const out = { sheets: document.styleSheets.length };
        // busca recursiva incluindo CSSLayerBlockRule
        const found = new Set();
        const walk = (rules) => {
          for (const r of rules) {
            if (r.selectorText) found.add(r.selectorText);
            if (r.cssRules) walk(r.cssRules);
          }
        };
        for (const ss of document.styleSheets) {
          try { walk(ss.cssRules); } catch (e) {}
        }
        const all = [...found].join(' | ');
        out.badgePill = all.includes('.badge-pill');
        out.badgeFail = all.includes('.badge-fail');
        out.checkboxCustom = all.includes('.checkbox-custom');
        out.tooltipRich = all.includes('.tooltip-rich');
        out.skeletonLine = all.includes('.skeleton-line');
        out.logoDisc = all.includes('.solaris-logo-disc');
        // elemento raiz do login
        const root = document.querySelector('.h-screen.w-screen');
        if (root) {
          const cs = getComputedStyle(root);
          out.loginBg = cs.backgroundColor;
          out.loginFont = cs.fontFamily.slice(0, 50);
        } else { out.loginBg = 'root AUSENTE'; }
        // disco do logo
        const disc = document.querySelector('.solaris-logo-disc');
        if (disc) {
          const cs = getComputedStyle(disc);
          out.discImage = cs.backgroundImage.slice(0, 90);
          out.discRadius = cs.borderRadius;
          out.discShadow = cs.boxShadow.slice(0, 60);
        } else { out.discImage = 'disc AUSENTE'; }
        // var token resolvendo
        out.tokenAccentFrom = getComputedStyle(document.documentElement).getPropertyValue('--color-accent-from').trim();
        out.tokenGradient = getComputedStyle(document.documentElement).getPropertyValue('--gradient-accent').trim().slice(0, 60);
        return out;
      })()`,
    });
    console.log(JSON.stringify(checks.result.value, null, 1));
    clearTimeout(hardExit);
    ws.close();
  } finally { chrome.kill(); }
}
main().catch((e) => { console.error('[erro]', e.message); process.exit(1); });

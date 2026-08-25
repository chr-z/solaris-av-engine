#!/usr/bin/env node
/**
 * SOLARIS redesign t18 — screenshots do painel ADMIN migrado (dono compara).
 * Esqueleto idêntico ao axe-scan.mjs validado (preview strictPort + prova de
 * hash do entry + chrome headless --disable-gpu + CDP nativo). Sem deps novas.
 *
 * Fases:
 *   A) login screen → shot
 *   B) guest demo → main app → shot (workspace)
 *   C) #/admin/dashboards (allowlist demo = admin local) → shot painel KPI
 *   D) #/admin (regras) → shot console de regras
 *   E) modal BugReport aberto a partir do header → shot modal v3
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = 'C:/Yui/data/saas_factory/redesign_shots';
const PORT_HTTP = 4200 + Math.floor(Math.random() * 500);
const PORT_CDP = 19300 + Math.floor(Math.random() * 500);
const URL_APP = `http://localhost:${PORT_HTTP}/`;
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { tries = 40, delayMs = 500, label = 'condition' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch (e) { lastErr = e; }
    await sleep(delayMs);
  }
  throw new Error(`timeout waiting for ${label}${lastErr ? `: ${lastErr}` : ''}`);
}

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) throw new Error('system Chrome not found');
const userDataDir = mkdtempSync(join(tmpdir(), 'solaris-t18-'));

const viteProc = spawn(
  process.execPath,
  [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT_HTTP), '--strictPort'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
);
const chromeProc = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--window-size=1440,900',
  `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${PORT_CDP}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErrTail = '';
chromeProc.stderr.on('data', (d) => { chromeErrTail = (chromeErrTail + d).slice(-4000); });
function cleanup(code, note) {
  try { chromeProc.kill(); } catch {}
  try { viteProc.kill(); } catch {}
  if (note) console.error(note);
  process.exit(code);
}
process.on('exit', () => { try { chromeProc.kill(); viteProc.kill(); } catch {} });

try {
  await waitFor(async () => {
    const r = await fetch(URL_APP);
    if (!r.ok) throw new Error(`preview http ${r.status}`);
    return true;
  }, { label: 'vite preview server' });
  const servedHtml = await (await fetch(URL_APP)).text();
  const servedEntry = servedHtml.match(/assets\/(index-[^"]+\.js)/)?.[1];
  const localEntry = readFileSync(join(ROOT, 'dist/index.html'), 'utf8')
    .match(/assets\/(index-[^"]+\.js)/)?.[1];
  if (!servedEntry || servedEntry !== localEntry) {
    throw new Error(`served dist mismatch! served=${servedEntry} local=${localEntry}`);
  }
  console.log(`[ok] serving verified as our dist (entry ${servedEntry})`);

  const targets = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`);
    if (!r.ok) throw new Error(`cdp http ${r.status}`);
    return r.json().then((l) => l.find((t) => t.type === 'page'));
  }, { tries: 24, label: 'chrome page target' });
  console.log('[ok] chrome up');
  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('websocket connect failed'));
    setTimeout(() => rej(new Error('websocket connect timeout')), 15000);
  });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`page eval failed: ${d.text}${d.exception?.description ? ` :: ${d.exception.description}` : ''}`);
    }
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');

  mkdirSync(SHOTS_DIR, { recursive: true });
  let shotN = 0;
  const shot = async (name) => {
    const data = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(SHOTS_DIR, name);
    writeFileSync(file, Buffer.from(data.data, 'base64'));
    shotN++;
    console.log(`[shot ${shotN}] ${name}`);
  };
  const navigate = async (url) => {
    await send('Page.navigate', { url });
    await waitFor(async () => (await evaluate('document.readyState')) === 'complete', { label: `load ${url}` });
    await sleep(1200);
  };

  // ------------------------------------------------------------- fase A/B
  await navigate(URL_APP);
  const findGuestBtnExpr = `(() => {
    const els = [...document.querySelectorAll('button, a, [role="button"]')];
    const b = els.find((x) => /guest|convidado|demo/i.test((x.textContent || '').trim()));
    return b ? true : false;
  })()`;
  let hasLogin = true;
  try {
    await waitFor(() => evaluate(findGuestBtnExpr), { tries: 20, label: 'login screen render' });
  } catch {
    hasLogin = false;
    console.log('[warn] sem tela de login — build demo direta');
  }
  if (hasLogin) {
    await shot('t18_admin_login.png');
    await evaluate(`(() => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const b = els.find((x) => /guest|convidado|demo/i.test((x.textContent || '').trim()));
      b.click();
    })()`);
    await waitFor(async () => !(await evaluate(findGuestBtnExpr)), { tries: 30, label: 'guest login' });
    await sleep(1500);
    await shot('t18_workspace.png');
  }

  // ------------------------------------------- fase C: dashboard (#/admin/dashboards)
  await navigate(`${URL_APP}#/admin/dashboards`);
  await waitFor(async () => evaluate(`!!document.querySelector('[data-testid="dash-summary-cards"]')`),
    { tries: 30, label: 'dashboards panel render' });
  await sleep(800);
  await shot('t18_dashboards_v3.png');

  // ------------------------------------------- fase D: regras (#/admin)
  await navigate(`${URL_APP}#/admin`);
  await waitFor(async () => evaluate(`!!document.querySelector('[data-testid="admin-rules-panel"]')`),
    { tries: 30, label: 'admin rules panel render' });
  await sleep(600);
  await shot('t18_admin_rules_v3.png');

  // ------------------------------------------- fase E: modal BugReport (via header)
  // Caminho real: popover do usuário → "Report an Issue". De #/admin para a raiz
  // só o fragmento muda (sem reload) — garantir documento NOVO com hop about:blank
  // e query única.
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await navigate(`${URL_APP}?t18=${Date.now()}`);
  try {
    await waitFor(async () => evaluate(
      `document.querySelectorAll('table,[role="grid"]').length > 0 || !!document.querySelector('header') || [...document.querySelectorAll('button')].some((x) => /guest|demo/i.test(x.textContent || ''))`,
    ), { tries: 30, label: 'app shell after reload' });
  } catch {
    const diag = await evaluate(`(() => ({
      href: location.href,
      ready: document.readyState,
      buttons: document.querySelectorAll('button').length,
      text: (document.body?.innerText || '').slice(0, 160),
    }))()`);
    throw new Error(`app não carregou após reload: ${JSON.stringify(diag)}`);
  }
  // reload pode cair na tela de login de novo — refazer o fluxo guest se preciso
  const needsLogin = await evaluate(findGuestBtnExpr);
  if (needsLogin) {
    await evaluate(`(() => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      els.find((x) => /guest|convidado|demo/i.test((x.textContent || '').trim())).click();
    })()`);
    await waitFor(async () => !(await evaluate(findGuestBtnExpr)), { tries: 30, label: 'guest re-login' });
  }
  await sleep(1200);
  // abrir o popover do usuário (botão-ícone do avatar no header)
  const opened = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('header button.icon-btn')]
      .find((b) => b.querySelector('img, svg') && !b.getAttribute('aria-label'));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!opened) throw new Error('popover do usuário não encontrado no header');
  await waitFor(async () => evaluate(`(() => {
    const items = [...document.querySelectorAll('.menu-item')];
    return items.some((x) => /report|issue|problema|relato/i.test(x.textContent || ''));
  })()`), { tries: 15, label: 'menu com Report an Issue' });
  await evaluate(`(() => {
    const items = [...document.querySelectorAll('.menu-item')];
    items.find((x) => /report|issue|problema|relato/i.test(x.textContent || '')).click();
  })()`);
  await waitFor(async () => evaluate(`(() => {
    const ov = document.querySelector('.fixed.inset-0.z-\\\\[60\\\\], .fixed.inset-0');
    return !!ov && /report|issue|problema|relato/i.test(ov.textContent || '');
  })()`), { tries: 20, label: 'bug report modal aberto' });
  await sleep(400);
  await shot('t18_bug_report_modal_v3.png');

  console.log('\\nT18_SHOTS_OK');
  cleanup(0);
} catch (err) {
  cleanup(126, `[t18-shot] FAILED: ${err?.message ?? err}\\n[chromium stderr tail]\\n${chromeErrTail}`);
}

#!/usr/bin/env node
/**
 * desktop_e2e_probe_p3b.mjs — prova E2E do toggle de modo + badge de origem
 * DENTRO do exe empacotado (sem mudar código):
 *
 *   FASE 1 — boot SEM env e SEM config.local.json: badge "Modo local" visível
 *            com origem "Tauri runtime" (detecção nativa do exe);
 *   FASE 2 — invoke('set_standalone_mode_command') escreve o arquivo REAL em
 *            %APPDATA%/dev.chr-z.solaris/config.local.json (conteúdo validado
 *            pelo node na sequência); reload ⇒ boot reaplica a opinião e o
 *            tooltip do badge passa a mostrar "file (core)";
 *   FASE 3 — estado anterior do arquivo restaurado (delete se não existia),
 *            reload ⇒ origem volta a "Tauri runtime";
 *   sempre — zero recurso remoto, zero endpoint proibido no DOM, console limpo.
 *
 * PASS = todas as fases provadas + guardas verdes.
 * Usage: node scripts/desktop_e2e_probe_p3b.mjs <path-to-exe>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const EXE = process.argv[2];
if (!EXE) { console.error('usage: node desktop_e2e_probe_p3b.mjs <exe>'); process.exit(2); }

const PORT = 42100 + Math.floor(Math.random() * 800); // fora das faixas reservadas do Windows
const UDD = mkdtempSync(join(tmpdir(), 'solaris_e2e_p3b_'));
const TAURI_ORIGINS = ['tauri://', 'http://tauri.localhost', 'https://tauri.localhost', 'data:', 'blob:', 'about:', 'ipc://', 'http://ipc.localhost'];
const CONFIG_PATH = join(homedir(), 'AppData', 'Roaming', 'dev.chr-z.solaris', 'config.local.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {
  bootMs: null, phase1: {}, phase2: {}, phase3: {},
  remoteResources: [], forbiddenHits: [], consoleErrors: [], exceptions: [],
};

let child; let ws; let msgId = 0; const pending = new Map(); const listeners = [];

function send(method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`cdp timeout ${method}`)); } }, timeoutMs);
  });
}
function onEvent(method, fn) { listeners.push({ method, fn }); }

async function waitForTargets(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const pages = list.filter((t) => t.type === 'page');
      if (pages.length > 0) return pages;
    } catch { /* not up yet */ }
    await sleep(400);
  }
  throw new Error(`no CDP targets on :${PORT} after ${timeoutMs}ms`);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url);
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('ws error'));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else if (m.method) {
        for (const l of listeners) if (l.method === m.method) l.fn(m.params);
      }
    };
  });
}

async function evalJs(expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

const READINESS = `(() => { const b = document.body; return b ? b.innerText.replace(/\\s+/g,' ').trim().length : -1; })()`;
async function waitUiRender(label, t0) {
  const deadline = Date.now() + 30000;
  let len = -1;
  while (Date.now() < deadline) {
    try { len = await evalJs(READINESS); } catch { /* navigating */ }
    if (len > 40) break;
    await sleep(300);
  }
  if (len <= 40) throw new Error(`[${label}] UI never rendered`);
  return Date.now() - t0;
}

/** Estado do badge no DOM atual: {present, text, title}. */
const BADGE_PROBE = `(() => {
  const els = [...document.querySelectorAll('div[role=status]')]
    .filter(e => /modo local|local mode/i.test(e.innerText || ''));
  if (!els.length) return { present: false };
  const el = els[0];
  return { present: true, text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
           title: el.getAttribute('title') || '' };
})()`;

async function reloadAndWait(t0) {
  await evalJs('location.reload()', false).catch(() => {});
  // O alvo navega — aguarda o body voltar a ter conteúdo.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await evalJs(READINESS)) > 40) return Date.now() - t0; } catch { /* reloading */ }
    await sleep(400);
  }
  throw new Error('UI never re-rendered after reload');
}

try {
  child = spawn(EXE, [], {
    cwd: UDD,
    env: {
      ...process.env,
      // FASE 1 é sem flag: NÃO setar STANDALONE_MODE aqui.
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
      WEBVIEW2_USER_DATA_FOLDER: UDD,
    },
    stdio: 'ignore',
  });
  const t0 = Date.now();

  const pages = await waitForTargets();
  const page = pages.find((p) => /tauri/i.test(p.url)) || pages[0];
  await connect(page.webSocketDebuggerUrl);
  await send('Runtime.enable');

  onEvent('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') results.consoleErrors.push((p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  });
  onEvent('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    results.exceptions.push(String(d.text || '') + ' ' + String(d.exception?.description || '').slice(0, 160));
  });

  results.bootMs = await waitUiRender('boot', t0);

  // ---------- FASE 1: badge visível, origem = runtime Tauri ----------
  const beforeFileExisted = existsSync(CONFIG_PATH);
  const beforeContent = beforeFileExisted ? readFileSync(CONFIG_PATH, 'utf8') : null;
  results.phase1.filePreExisted = beforeFileExisted;
  results.phase1.badge = await evalJs(BADGE_PROBE);
  results.phase1.modeOrigin = await evalJs(
    `window.__TAURI_INTERNALS__ ? 'has-internals' : 'no-internals'`,
  );

  // ---------- FASE 2: escrita via IPC + persistência + origem "file" ----------
  const writeRes = await evalJs(
    `window.__TAURI_INTERNALS__.invoke('set_standalone_mode_command', { req: { standalone: true } })`,
    true,
  );
  results.phase2.writeResult = writeRes;
  results.phase2.fileOnDisk = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); // prova NODE-side
  const readBack = await evalJs(
    `window.__TAURI_INTERNALS__.invoke('get_runtime_config_command')`,
    true,
  );
  results.phase2.readBack = readBack;
  results.phase2.reloadMs = await reloadAndWait(Date.now());
  results.phase2.badgeAfterReload = await evalJs(BADGE_PROBE);

  // ---------- FASE 3: restauração do estado anterior ----------
  if (beforeFileExisted && beforeContent !== null) writeFileSync(CONFIG_PATH, beforeContent);
  else { try { rmSync(CONFIG_PATH, { force: true }); } catch {} }
  await reloadAndWait(Date.now());
  results.phase3.badgeAfterRestore = await evalJs(BADGE_PROBE);

  // ---------- Guardas anti-regressão ----------
  const htmlNow = await evalJs('document.documentElement.outerHTML');
  const FORBIDDEN = ['accounts.google.com', 'firebaseio.com', 'identitytoolkit', 'securetoken.net', 'ui-avatars.com'];
  for (const f of FORBIDDEN) if (htmlNow.includes(f)) results.forbiddenHits.push(f);
  const urls = JSON.parse(await evalJs(`(() => JSON.stringify(performance.getEntriesByType('resource').map(r => r.name)))()`));
  results.remoteResources = urls.filter((u) => !TAURI_ORIGINS.some((o) => u.startsWith(o)));

  const fails = [];
  if (!results.bootMs) fails.push('no render');
  // FASE 1 — no sabor standalone o BUILD FLAG vence (degrau acima do runtime
  // Tauri na detecção); origem nativa esperada = "build flag (standalone)".
  if (!results.phase1.badge?.present) fails.push('F1: badge ausente no boot standalone');
  else if (!/build flag/i.test(results.phase1.badge.title || '')) fails.push('F1: origem esperada "build flag (standalone)", veio: ' + results.phase1.badge.title);
  // FASE 2
  if (!writeRes?.configPath || !String(writeRes.configPath).toLowerCase().includes('config.local.json')) fails.push('F2: writeResult sem configPath: ' + JSON.stringify(writeRes));
  if (results.phase2.fileOnDisk?.standaloneMode !== true) fails.push('F2: arquivo em disco sem standaloneMode=true: ' + JSON.stringify(results.phase2.fileOnDisk));
  if (readBack?.standalone !== true || readBack?.source !== 'file') fails.push('F2: leitura pós-escrita não reflete arquivo: ' + JSON.stringify(readBack));
  if (!results.phase2.badgeAfterReload?.present) fails.push('F2: badge sumiu após reload');
  else if (!/file \(core\)/i.test(results.phase2.badgeAfterReload.title || '')) fails.push('F2: origem pós-reload esperada "file (core)", veio: ' + results.phase2.badgeAfterReload.title);
  // FASE 3
  if (beforeFileExisted === false && existsSync(CONFIG_PATH)) fails.push('F3: config.local.json não foi restaurado (removido)');
  // Origem pós-restauração volta ao sinal nativo do artefato (build flag).
  if (!results.phase3.badgeAfterRestore?.present) fails.push('F3: badge ausente após restauração');
  else if (!/build flag/i.test(results.phase3.badgeAfterRestore.title || '')) fails.push('F3: origem pós-restauração esperada "build flag", veio: ' + results.phase3.badgeAfterRestore.title);
  // Guardas globais
  if (results.forbiddenHits.length) fails.push('forbidden endpoints in DOM: ' + results.forbiddenHits.join(','));
  if (results.remoteResources.length) fails.push('remote fetches: ' + results.remoteResources.join(','));
  if (results.consoleErrors.length) fails.push('console errors: ' + JSON.stringify(results.consoleErrors));
  if (results.exceptions.length) fails.push('exceptions: ' + JSON.stringify(results.exceptions));

  console.log(JSON.stringify({
    verdict: fails.length === 0 ? 'DESKTOP_E2E_P3B_PASS' : 'DESKTOP_E2E_P3B_FAIL',
    fails, ...results,
  }, null, 2));
  process.exitCode = fails.length === 0 ? 0 : 1;
} catch (err) {
  console.log(JSON.stringify({ verdict: 'DESKTOP_E2E_P3B_FAIL', fatal: String(err).slice(0, 400), partial: results }, null, 2));
  process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === 1) ws.close(); } catch {}
  try { if (child && !child.killed) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  await sleep(800);
  try { rmSync(UDD, { recursive: true, force: true }); } catch {}
}

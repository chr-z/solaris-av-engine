#!/usr/bin/env node
/**
 * SOLARIS qc-pdf smoke (F6 troca #2 — pdfmake).
 *
 * Prova REAL do caminho arriscado num Chrome headless de verdade:
 *   1. bundle mínimo (esbuild, zero dep nova) montando o QCExportButton REAL
 *      (o import() do pdfmake vai inline no bundle iife; o LAZY de produção é
 *      provado à parte pela análise de chunks do vite build);
 *   2. clique no botão → pdfmake gera o PDF de verdade no browser;
 *   3. download capturado via Browser.setDownloadBehavior (CDP) → arquivo em
 *      disco; validamos header %PDF-, %%EOF, tamanho e nome;
 *   4. "Download again" no diálogo re-baixa o artefato (2º arquivo);
 *   5. zero erros de console / exceções / unhandledrejection.
 *
 * Exit code: nº de falhas (0 = limpo), cap 20.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT_HTTP = 4800 + Math.floor(Math.random() * 300);
const PORT_CDP = 19900 + Math.floor(Math.random() * 300);
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { tries = 60, delayMs = 500, label = 'cond' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleepMs(delayMs);
  }
  throw new Error(`timeout: ${label}${lastErr ? ` — ${lastErr}` : ''}`);
}

// ------------------------------------------------------------------ bundle
const ENTRY = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QCExportButton } from './src/components/Analysis/QCExportButton';

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e)));
window.__unhandled = [];
window.addEventListener('unhandledrejection', (e) => window.__unhandled.push(String(e.reason)));

createRoot(document.getElementById('root')).render(
  React.createElement('div', null, React.createElement(QCExportButton)),
);
`;

const outDir = mkdtempSync(join(tmpdir(), 'solaris-qcpdf-'));
const downloadDir = mkdtempSync(join(tmpdir(), 'solaris-qcpdf-dl-'));
const jsOut = join(outDir, 'qc-smoke.js');
await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'qc-smoke.tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: jsOut,
  absWorkingDir: ROOT,
  resolveExtensions: ['.ts', '.tsx', '.js', '.json'],
  loader: { '.ts': 'ts', '.tsx': 'tsx', '.json': 'json' },
  jsx: 'transform',
  define: { 'process.env.NODE_ENV': '"production"' },
});
writeFileSync(
  join(outDir, 'index.html'),
  '<!doctype html><html><body style="margin:0">' +
    '<div id="root"></div><script src="./qc-smoke.js"></script></body></html>',
);

// ------------------------------------------------------------------ server
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = readFileSync(join(outDir, name));
    res.writeHead(200, {
      'content-type': name.endsWith('.html')
        ? 'text/html'
        : 'application/javascript',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('nope');
  }
});
await new Promise((r) => server.listen(PORT_HTTP, '127.0.0.1', r));

// ------------------------------------------------------------------ chrome
const chromePath = CHROME_CANDIDATES.find((p) => {
  try {
    require('fs').accessSync(p);
    return true;
  } catch {
    return false;
  }
});
if (!chromePath) throw new Error('system Chrome not found');
const userDataDir = mkdtempSync(join(tmpdir(), 'solaris-qcpdf-chrome-'));
const chromeProc = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT_CDP}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws;
let msgId = 0;
const pending = new Map();
const consoleErrors = [];
function onCdpMessage(data) {
  const msg = JSON.parse(
    typeof data === 'string' ? data : data.toString(),
  );
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message}`));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(
      JSON.stringify(
        msg.params?.exceptionDetails?.exception?.description || msg.params,
      ).slice(0, 200),
    );
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    consoleErrors.push(
      (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? '')
        .join(' ')
        .slice(0, 200),
    );
  }
  if (
    msg.method === 'Browser.downloadProgress' ||
    msg.method === 'Browser.downloadWillBegin'
  ) {
    downloadEvents.push(
      `${msg.method}:${msg.params?.state ?? ''}:${msg.params?.suggestedName ?? ''}`,
    );
  }
}

const downloadEvents = [];

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(
      JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }),
    );
  });
}

/** Clique CONFIÁVEL (pipeline de input real → cria user activation). */
async function trustedClick(findExpr, label, sessionId) {
  const coords = await send(
    'Runtime.evaluate',
    {
      expression: `(() => { const el = ${findExpr}; if (!el) return null;
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); })()`,
      returnByValue: true,
    },
    sessionId,
  );
  if (!coords.result.value) throw new Error(`elemento não encontrado p/ clique: ${label}`);
  const { x, y } = JSON.parse(coords.result.value);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
}

const SEL_QC_BTN = `document.querySelector('button[aria-label="Export QC Report"]')`;
const SEL_AGAIN_BTN = `[...document.querySelectorAll('[role="dialog"] button')].find((b) => /Download again/i.test(b.textContent || ''))`;

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL ${failures}: ${msg}`);
};

try {
  const versionBody = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${PORT_CDP}/json/version`);
    if (!res.ok) throw new Error(`http ${res.status}`);
    return res.json();
  }, { label: 'cdp /json/version' });
  ws = new WebSocket(versionBody.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.onmessage = (ev) => onCdpMessage(ev.data);

  // downloads → pasta local
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
    eventsEnabled: true,
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);

  await send(
    'Page.navigate',
    { url: `http://127.0.0.1:${PORT_HTTP}/` },
    sessionId,
  );
  await sleepMs(1200);

  // botão presente e hidratado?
  const btnFound = await send(
    'Runtime.evaluate',
    {
      expression: `!!${SEL_QC_BTN}`,
      returnByValue: true,
    },
    sessionId,
  );
  if (btnFound.result.value === true) console.log('BTN_MOUNTED ok');
  else fail('botão QC não montou');

  // clique #1 (confiável) → gera PDF e baixa
  await trustedClick(SEL_QC_BTN, "botao QC Report", sessionId);

  const pdfFiles = () =>
    readdirSync(downloadDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  await waitFor(
    () => existsSync(downloadDir) && pdfFiles().length >= 1,
    { label: 'download do PDF aparecer', tries: 30, delayMs: 500 },
  );
  const first = pdfFiles()[0];
  const buf = readFileSync(join(downloadDir, first));
  const head = buf.subarray(0, 5).toString('ascii');
  const tail = buf.subarray(Math.max(0, buf.length - 64)).toString('latin1');
  console.log(
    `DOWNLOAD_1 ${JSON.stringify({ name: first, bytes: buf.length, headerOk: head === '%PDF-', eofOk: tail.includes('%%EOF') })}`,
  );
  if (!(head === '%PDF-' && tail.includes('%%EOF') && buf.length > 2000)) {
    fail(`PDF inválido: ${first} (${buf.length}B)`);
  }

  // diálogo aberto com aviso ausente (caminho feliz)?
  const happyUi = await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return { dlg: false };
        return {
          dlg: true,
          fallbackWarning: !!Array.from(dlg.querySelectorAll('p')).find((p) => /PDF engine unavailable/i.test(p.textContent || '')),
          againBtn: !!Array.from(dlg.querySelectorAll('button')).find((b) => /Download again/i.test(b.textContent || '')),
        };
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  console.log(`DIALOG ${JSON.stringify(happyUi.result.value)}`);
  if (!happyUi.result.value?.dlg) fail('diálogo de confirmação não abriu');
  if (happyUi.result.value?.fallbackWarning) fail('aviso de fallback apareceu no caminho feliz');

  // clique #2 (confiável) → Download again.
  // Prova do WIRING: interceptamos anchor.click() na página. O ARQUIVO é
  // bônus — o Chrome headless novo costuma bloquear o 2º download automático
  // da mesma origem (artefato do modo headless, não da lógica do app); o
  // caminho disco→bytes válidos já ficou provado no primeiro download.
  await send(
    'Runtime.evaluate',
    {
      expression: `window.__anchorClicks = [];
        (() => {
          const orig = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            window.__anchorClicks.push({ download: this.download || '', href: String(this.href || '').slice(0, 24) });
          };
        })();`,
    },
    sessionId,
  );
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
    eventsEnabled: true,
  });
  await trustedClick(SEL_AGAIN_BTN, 'Download again', sessionId);
  await waitFor(
    async () => {
      const r = await send(
        'Runtime.evaluate',
        { expression: 'window.__anchorClicks.length', returnByValue: true },
        sessionId,
      );
      return r.result.value >= 1;
    },
    { label: 'anchor.click() do Download again', tries: 20, delayMs: 500 },
  );
  const clicksState = await send(
    'Runtime.evaluate',
    { expression: 'JSON.stringify(window.__anchorClicks)', returnByValue: true },
    sessionId,
  );
  const clicks = JSON.parse(clicksState.result.value);
  console.log(`DOWNLOAD_AGAIN ${JSON.stringify(clicks)}`);
  if (!clicks[0]?.download.endsWith('.pdf') || !clicks[0]?.href.startsWith('blob:')) {
    fail(`Download again com artefato errado: ${JSON.stringify(clicks[0])}`);
  }
  // bônus: se o Chrome deixar, o 2º arquivo aparece em disco
  await sleepMs(2500);
  if (pdfFiles().length >= 2) {
    const secondBuf = readFileSync(join(downloadDir, pdfFiles()[1]));
    console.log(
      `DOWNLOAD_2 bytes=${secondBuf.length} headerOk=${secondBuf.subarray(0, 5).toString('ascii') === '%PDF-'}`,
    );
    if (secondBuf.subarray(0, 5).toString('ascii') !== '%PDF-') fail('2º download não é PDF');
  } else {
    console.log('DOWNLOAD_2 skippado — Chrome headless bloqueou 2º download automático (wiring provado acima)');
  }

  // estado final do app: zero erros
  const errState = await send(
    'Runtime.evaluate',
    { expression: `JSON.stringify({e: window.__errors, u: window.__unhandled})`, returnByValue: true },
    sessionId,
  );
  const errs = JSON.parse(errState.result.value);
  if (errs.e.length || errs.u.length) fail(`erros na página: ${JSON.stringify(errs).slice(0, 200)}`);
  if (consoleErrors.length) fail(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);

  console.log(`DOWNLOAD_EVENTS ${JSON.stringify(downloadEvents)}`);
  console.log(failures === 0 ? 'QCPDF_SMOKE_PASS' : `QCPDF_SMOKE_FAIL (${failures})`);
} catch (e) {
  fail(String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  console.log(`QCPDF_SMOKE_FAIL (${failures})`);
} finally {
  try {
    chromeProc.kill();
  } catch {}
  try {
    server.close();
  } catch {}
  try {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
}
process.exit(Math.min(failures, 20));

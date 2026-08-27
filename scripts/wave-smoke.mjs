#!/usr/bin/env node
/**
 * SOLARIS wave smoke (F6 troca #1 — wavesurfer.js v7).
 *
 * Prova REAL do caminho arriscado num Chrome headless de verdade:
 *   1. bundle mínimo (esbuild, zero dep nova) montando <WaveSurferCanvas>
 *      com peaks sintéticos (inclui clips p/ tier vermelho);
 *   2. chunk lazy do wavesurfer carrega e dispara "ready";
 *   3. renderFunction custom PINTA pixels não vazios no canvas
 *      (shadow DOM do v7, aberto);
 *   4. loop de setTime (playhead) roda 2s sem um único erro/console.
 *
 * Exit code: nº de falhas (0 = limpo), cap 20.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT_HTTP = 4700 + Math.floor(Math.random() * 300);
const PORT_CDP = 19700 + Math.floor(Math.random() * 300);
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { tries = 40, delayMs = 500, label = 'cond' } = {}) {
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
import WaveSurferCanvas from './src/features/wavesurfer/WaveSurferCanvas';

const peaks = Array.from({ length: 150 }, (_, i) =>
  i % 37 === 0 ? 1 : Math.abs(Math.sin(i / 9)) * 0.55,
);

function App() {
  const [t, setT] = React.useState(0);
  React.useEffect(() => {
    const iv = setInterval(() => setT((v) => (v + 1) % 100), 250);
    return () => clearInterval(iv);
  }, []);
  return React.createElement(
    'div',
    { id: 'stage', style: { width: '640px', height: '48px', position: 'relative', background: '#111827' } },
    React.createElement(WaveSurferCanvas, { peaks, duration: 100, currentTime: t }),
  );
}

window.__fallbacks = 0;
window.addEventListener('solaris:waveform-fallback', () => window.__fallbacks++);
window.__dbg = [];
const origWarn = console.warn.bind(console);
console.warn = (...a) => { window.__dbg.push(a.map(String).join(' ').slice(0, 200)); origWarn(...a); };

createRoot(document.getElementById('root')).render(React.createElement(App));
`;

const outDir = mkdtempSync(join(tmpdir(), 'solaris-wave-'));
const jsOut = join(outDir, 'wave-smoke.js');
await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'wave-smoke.tsx' },
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
    '<div id="root"></div><script src="./wave-smoke.js"></script></body></html>',
);

// ------------------------------------------------------------------ server
const http = await import('node:http');
const url = await import('node:url');
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = join(outDir, name);
  try {
    const body = ['index.html'].includes(name.slice(1))
      ? readUtf(file)
      : require('fs').readFileSync(file);
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
function readUtf(p) {
  return require('fs').readFileSync(p, 'utf8');
}
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
const userDataDir = mkdtempSync(join(tmpdir(), 'solaris-wave-chrome-'));
const chromeProc = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--window-size=900,300',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${PORT_CDP}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

try {
  const list = await waitFor(
    async () => {
      const r = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`);
      const tabs = await r.json();
      return tabs.find((t) => t.type === 'page');
    },
    { label: 'chrome CDP tab' },
  );

  const ws = new WebSocket(list.webSocketDebuggerUrl);
  let mid = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++mid;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const consoleEvents = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const { type, args } = msg.params;
      consoleEvents.push({
        type,
        text: args
          .map((a) => a.value ?? a.description ?? '')
          .join(' ')
          .slice(0, 200),
      });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleEvents.push({
        type: 'exception',
        text: String(d.exception?.description ?? d.text).slice(0, 200),
      });
    }
  };
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send(
    'Page.navigate',
    { url: `http://127.0.0.1:${PORT_HTTP}/` },
  );
  await sleepMs(2500); // mount + lazy chunk + decode

  const evalJs = async (expr) =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true }))
      .result.value;

  // 1) container montou e recebeu a árvore do wavesurfer
  const probe1 = await evalJs(`(() => {
    const stage = document.getElementById('stage');
    const host = stage && stage.firstElementChild;
    // v7 anexa o shadowRoot num FILHO do container passado, não nele.
    const wsRoot = host && host.firstElementChild;
    return {
      hasStage: !!stage,
      childTag: host ? host.tagName : null,
      hasShadow: !!(wsRoot && wsRoot.shadowRoot),
      hostHtml: host ? host.outerHTML.slice(0, 400) : null,
      dbg: window.__dbg || [],
    };
  })()`);
  check('container do canvas montado dentro do stage', probe1.hasStage && probe1.childTag === 'DIV');
  check('shadow DOM do wavesurfer presente (v7)', probe1.hasShadow);
  if (!probe1.hasShadow) {
    const dbg = await evalJs(`({ fb: window.__fallbacks })`);
    console.error('DEBUG fallbacks:', JSON.stringify(dbg));
    console.error('DEBUG probe1:', JSON.stringify(probe1));
    console.error(
      'DEBUG console:',
      JSON.stringify(consoleEvents.slice(0, 8), null, 1),
    );
  }

  // 2) canvas com pixels REAIS pintados pelo renderFunction
  const probe2 = await evalJs(`(() => {
    const stage = document.getElementById('stage');
    const host = stage.firstElementChild;
    const wsRoot = host && host.firstElementChild;
    const sr = wsRoot && wsRoot.shadowRoot;
    const canvases = sr ? sr.querySelectorAll('canvas') : [];
    let painted = 0, total = 0, samples = [];
    for (const c of canvases) {
      total++;
      try {
        const ctx = c.getContext('2d');
        if (!ctx || c.width === 0 || c.height === 0) continue;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let nonBlank = 0;
        for (let i = 3; i < d.length; i += 40) if (d[i] > 0) nonBlank++;
        samples.push(nonBlank);
        if (nonBlank > 10) painted++;
      } catch {}
    }
    return { canvasCount: total, painted, samples };
  })()`);
  check(
    'canvases criados dentro do shadow DOM',
    probe2.canvasCount >= 2,
    JSON.stringify(probe2),
  );
  check(
    'renderFunction pintou pixels (barras visíveis)',
    probe2.painted >= 1,
    JSON.stringify(probe2),
  );

  // 3) cores dB por barra: procurar pixel vermelho (clip) e azul (progresso)
  const probe3 = await evalJs(`(() => {
    const stage = document.getElementById('stage');
    const host = stage.firstElementChild;
    const wsRoot = host && host.firstElementChild;
    const sr = wsRoot && wsRoot.shadowRoot;
    const out = { red: 0, blue: 0 };
    if (!sr) return out;
    for (const c of sr.querySelectorAll('canvas')) {
      const ctx = c.getContext('2d');
      if (!ctx || !c.width) continue;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 16) {
        const [r, g, b] = [d[i], d[i+1], d[i+2]];
        if (r > 180 && g < 110 && b < 110) out.red++;      // #ef4444 clip
        if (b > 150 && r < 130 && g > 90 && g < 190) out.blue++; // progresso
      }
    }
    return out;
  })()`);
  check('pixel vermelho de clipping presente (tier dB ok)', probe3.red > 0, JSON.stringify(probe3));
  check('overlay de progresso azul presente', probe3.blue > 0, JSON.stringify(probe3));

  // 4) playhead: 2s de tick sem erros e sem fallback
  await sleepMs(2000);
  const probe4 = await evalJs(`({ fallbacks: window.__fallbacks })`);
  const hardErrors = consoleEvents.filter(
    (e) => e.type === 'exception' || e.type === 'error',
  );
  check('nenhum fallback disparado', probe4.fallbacks === 0);
  check(
    'console limpo durante ciclo de playhead',
    hardErrors.length === 0,
    JSON.stringify(hardErrors.slice(0, 3)),
  );

  console.log(
    `\nWAVE_SMOKE: ${pass} ok, ${fail} FAIL (console events: ${consoleEvents.length})`,
  );
} finally {
  chromeProc.kill();
  server.close();
  try {
    rmSync(outDir, { recursive: true, force: true });
  } catch {}
}
process.exit(Math.min(fail, 20));

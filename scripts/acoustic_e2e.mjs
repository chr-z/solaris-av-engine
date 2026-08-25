/**
 * Solaris acoustics E2E probe (no playwright/puppeteer — CDP over native WebSocket).
 *
 * Phase A (preview build, port A): boot app → guest login → workspace renders,
 *   count console errors, assert acoustic panel absent without media.
 * Phase B (vite dev server, port B): import the REAL TS engine module in-page
 *   and run known-answer analysis on synthetic PCM inside Chromium.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PREVIEW_PORT = Number(process.argv[2] ?? 4471);
const DEV_PORT = Number(process.argv[3] ?? 4577);
const CDP_PORT = 9333;
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  `--remote-debugging-port=${CDP_PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP.replace(/\\/g, '/') + '/solaris-acoustics-e2e-profile',
  '--window-size=1440,900',
  'about:blank',
], { stdio: 'ignore' });

async function getTabTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const tabs = await res.json();
      const tab = tabs.find((t) => t.type === 'page');
      if (tab) return tab;
    } catch { /* chrome not ready */ }
    await sleep(250);
  }
  throw new Error('CDP tab not found');
}

let msgId = 0;
const pending = new Map();
function send(ws, method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function connect(tabUrlObj) {
  const ws = new WebSocket(tabUrlObj.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.text ?? 'exception');
    }
    return ev;
  };
  return { ws, consoleErrors };
}

async function evalJs(cdp, expression, awaitPromise = false) {
  const r = await send(cdp.ws, 'Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error('page eval: ' + (r.exceptionDetails.text ?? 'unknown'));
  return r.result.value;
}

const results = { phaseA: {}, phaseB: {}, phaseC: {} };
try {
  // ---------- PHASE A: preview build ----------
  const tab = await getTabTarget();
  const cdp = await connect(tab);
  await send(cdp.ws, 'Runtime.enable');
  await send(cdp.ws, 'Page.enable');
  // Keep the deterministic offline flow: block cloud endpoints (skill pattern).
  await send(cdp.ws, 'Network.enable');
  await send(cdp.ws, 'Network.setBlockedURLs', {
    urls: ['*googleapis.com*', '*gstatic.com*', '*accounts.google.com*', '*firebaseio*', '*identitytoolkit*'],
  });
  // Deterministic offline login: stub gapi/google BEFORE any page script runs
  // (skill pattern) so auth reaches 'signedOut' without Google endpoints.
  await send(cdp.ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.gapi = {
        load: (name, opts) => setTimeout(() => (opts && opts.callback ? opts.callback() : undefined), 0),
        client: { init: async () => {}, setToken: () => {}, request: async () => ({}) },
      };
      window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    `,
  });
  await send(cdp.ws, 'Page.navigate', { url: `http://localhost:${PREVIEW_PORT}/` });
  await sleep(3500);

  // Poll for the guest button (app boots in initializing state).
  let clicked = false;
  for (let i = 0; i < 30 && !clicked; i++) {
    clicked = await evalJs(cdp, `(() => {
      const btns = [...document.querySelectorAll('button')];
      const guest = btns.find(b => /guest|convidado/i.test(b.textContent || ''));
      if (guest) { guest.click(); return true; }
      return false;
    })()`);
    if (!clicked) await sleep(500);
  }
  results.phaseA.guestClicked = clicked;
  await sleep(4000);

  const stateA = await evalJs(cdp, `(() => ({
    title: document.title,
    hasWorkspace: !!document.querySelector('.w-1\\\\/3') || document.body.innerText.length > 200,
    bodySnippet: document.body.innerText.slice(0, 120).replace(/\\n/g, ' | '),
    acousticPanelVisible: document.body.innerText.includes('Análise Acústica'),
    buttons: document.querySelectorAll('button').length,
  }))()`);
  results.phaseA.state = stateA;
  results.phaseA.consoleErrors = cdp.consoleErrors.slice(0, 5);
  results.phaseA.ok =
    clicked &&
    stateA.hasWorkspace &&
    !stateA.acousticPanelVisible && // sem mídia → painel não renderiza (status idle)
    cdp.consoleErrors.filter((e) => !/net::ERR_FAILED|Failed to load resource/.test(e)).length === 0;

  // ---------- PHASE B: real engine inside Chromium via vite dev ----------
  await send(cdp.ws, 'Page.navigate', { url: `http://localhost:${DEV_PORT}/` });
  await sleep(1500);
  const phaseBExpr = `
    (async () => {
      const mod = await import('/src/audio-acoustics/index.ts');
      const SR = 16000;
      const rng = (() => { let a = 99; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
      function makeSpeechLike(pattern) {
        let z1 = 0, z2 = 0; const out = [];
        for (const { word, pause } of pattern) {
          const wN = Math.round(word * SR);
          for (let i = 0; i < wN; i++) {
            const tEdge = Math.min(i / (SR * 0.01), (wN - i) / (SR * 0.03), 1);
            const white = rng() * 2 - 1;
            z1 = 0.6 * z1 + 0.4 * white; z2 = 0.85 * z2 + 0.15 * z1;
            out.push(0.5 * tEdge * z2 * 3.5);
          }
          for (let i = 0; i < Math.round(pause * SR); i++) out.push(0);
        }
        return Float64Array.from(out);
      }
      const dry = makeSpeechLike([
        { word: 1.2, pause: 0.9 }, { word: 1.4, pause: 0.9 }, { word: 1.2, pause: 0.9 },
        { word: 1.6, pause: 0.9 }, { word: 1.3, pause: 0 },
      ]);
      const reverberant = mod.addReverb(dry, 1.2, SR);
      const cleanReport = mod.analyzeAudioPcm(dry, SR);
      const revReport = mod.analyzeAudioPcm(reverberant, SR);
      const clipped = mod.hardClip(makeSpeechLike([{ word: 2, pause: 0.5 }, { word: 2, pause: 0.5 }, { word: 2, pause: 0 }]), -3);
      const clipReport = mod.analyzeAudioPcm(clipped, SR);
      const cols = mod.acousticSheetColumns(revReport);
      return {
        engineVersion: 'P3',
        cleanOverall: cleanReport.overallScore,
        reverbClean: cleanReport.axes.reverb.score,
        reverbHigh: revReport.axes.reverb.score,
        rt60Measured: revReport.reverb.rt60,
        rt60Method: revReport.reverb.rt60Method,
        clipScoreClipped: clipReport.axes.clipping.score,
        sheetColumns: cols,
        marksRev: revReport.timelineMarks.length,
      };
    })()
  `;
  results.phaseB.engine = await evalJs(cdp, phaseBExpr, true);
  results.phaseB.ok =
    results.phaseB.engine.cleanOverall >= 70 &&
    results.phaseB.engine.reverbHigh < results.phaseB.engine.reverbClean &&
    results.phaseB.engine.clipScoreClipped <= 80;

  // ---------- PHASE C: REAL Web Worker + progress/cancel/cache in Chromium ----------
  const phaseCExpr = `
    (async () => {
      const mod = await import('/src/audio-acoustics/worker/analysisRunner.ts');
      const engine = await import('/src/audio-acoustics/index.ts');
      const SR = 16000;
      const rng = (() => { let a = 99; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
      function makeSpeechLike(pattern) {
        let z1 = 0, z2 = 0; const out = [];
        for (const { word, pause } of pattern) {
          const wN = Math.round(word * SR);
          for (let i = 0; i < wN; i++) {
            const tEdge = Math.min(i / (SR * 0.01), (wN - i) / (SR * 0.03), 1);
            const white = rng() * 2 - 1;
            z1 = 0.6 * z1 + 0.4 * white; z2 = 0.85 * z2 + 0.15 * z1;
            out.push(0.5 * tEdge * z2 * 3.5);
          }
          for (let i = 0; i < Math.round(pause * SR); i++) out.push(0);
        }
        return Float64Array.from(out);
      }
      const pcm = new Float32Array(makeSpeechLike([
        { word: 1.2, pause: 0.9 }, { word: 1.4, pause: 0.9 }, { word: 1.2, pause: 0.9 },
        { word: 1.6, pause: 0.9 }, { word: 1.3, pause: 0 },
      ]));

      // 1) Worker real: done + progresso.
      const pcts = [];
      const run = mod.runAnalysis({ samples: pcm.slice(), sampleRate: SR, onProgress: (p) => pcts.push(p.pct) });
      const out = await run;

      // 2) Cancelamento: novo run cancelado na largada.
      const run2 = mod.runAnalysis({ samples: pcm.slice(), sampleRate: SR });
      run2.cancel();
      const out2 = await run2;

      // 3) Cache com localStorage REAL do browser.
      const rep = out.status === 'done' ? out.report : null;
      const cache = engine.createAnalysisCache ? engine.createAnalysisCache({ storage: window.localStorage }) : null;
      let cacheRoundtrip = false;
      if (cache && rep) {
        cache.clear();
        cache.set('e2e-media', rep);
        const again = cache.get('e2e-media');
        cacheRoundtrip = !!again && again.overallScore === rep.overallScore
          && !!window.localStorage.getItem(Object.keys(window.localStorage).find(k => k.includes('e2e-media') || k.includes('solaris.acoustics.cache') && window.localStorage.getItem(k)?.includes('"overallScore"')) ?? '');
        cache.clear();
      }

      return {
        workerStatus: out.status,
        overallScore: rep ? rep.overallScore : -1,
        progressEvents: pcts.length,
        lastPct: pcts.length ? pcts[pcts.length - 1] : -1,
        cancelStatus: out2.status,
        cacheRoundtrip,
        hadLocalStorage: typeof window.localStorage !== 'undefined',
      };
    })()
  `;
  try {
    results.phaseC.worker = await evalJs(cdp, phaseCExpr, true);
    results.phaseC.ok =
      results.phaseC.worker.workerStatus === 'done' &&
      results.phaseC.worker.progressEvents > 3 &&
      results.phaseC.worker.lastPct === 94 &&
      results.phaseC.worker.cancelStatus === 'cancelled' &&
      results.phaseC.worker.cacheRoundtrip === true &&
      results.phaseC.worker.overallScore >= 70;
  } catch (e) {
    results.phaseC.worker = { error: String(e) };
    results.phaseC.ok = false;
  }

  cdp.ws.close();
} finally {
  chrome.kill();
}

console.log(JSON.stringify(results, null, 2));
process.exit(results.phaseA.ok && results.phaseB.ok && results.phaseC.ok ? 0 : 1);

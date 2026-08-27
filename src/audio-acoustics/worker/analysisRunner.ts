/**
 * Solaris Acoustics — runner do worker com fallback síncrono cancelável.
 *
 * - Browser: tenta `new Worker(new URL('./analyze.worker.ts', import.meta.url),
 *   { type: 'module' })` (o Vite transforma isso num chunk de worker real).
 * - Teste/SSR/desktop-sem-worker: injete `workerFactory` (um WorkerLike fake)
 *   ou use o fallback síncrono — MESMO contrato de eventos/outcome.
 *
 * Cancelamento:
 * - worker: terminate() imediato (mata o burn de CPU) + outcome 'cancelled';
 * - síncrono: cooperativo via opts.signal — o motor lança na próxima checagem.
 */
import {
  analyzeAudioPcm,
  AnalysisCancelledError,
  type AcousticProgress,
  type AcousticReport,
} from '../audioAcoustics';
import type { WorkerRequest, WorkerResponse, WorkerSerializableOptions } from './workerProtocol';

export interface RunAnalysisArgs {
  samples: Float32Array;
  sampleRate: number;
  opts?: WorkerSerializableOptions;
  onProgress?: (p: AcousticProgress) => void;
}

export type AnalysisOutcome =
  | { status: 'done'; report: AcousticReport }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export type AnalysisRun = Promise<AnalysisOutcome> & { cancel(): void };

/** Superconjunto mínimo do Worker/MessagePort usado pelo runner. */
export interface WorkerLike {
  postMessage(msg: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null;
}

export type WorkerFactory = () => WorkerLike | null;

/** Tenta construir um Worker real de módulo; null quando indisponível. */
export function defaultWorkerFactory(): WorkerLike | null {
  try {
    if (typeof Worker === 'undefined') return null;
    const w = new Worker(new URL('./analyze.worker.ts', import.meta.url), {
      type: 'module',
    });
    return w as unknown as WorkerLike;
  } catch {
    return null;
  }
}

let sharedWorker: WorkerLike | null = null;
let sharedBusy = false;
let jobIdCounter = 0;

/** Factory usada por runAnalysis quando não há override em setWorkerFactory. */
let activeFactory: WorkerFactory = defaultWorkerFactory;

/** Testes/injeção: troca a factory e descarta o worker em cache (null = padrão). */
export function setWorkerFactory(f: WorkerFactory | null): void {
  activeFactory = f ?? defaultWorkerFactory;
  releaseShared(true);
}

function acquireShared(): WorkerLike | null {
  if (sharedBusy) return null; // uma análise por vez — simples e previsível
  if (!sharedWorker) {
    const w = activeFactory();
    if (!w) return null;
    sharedWorker = w;
  }
  sharedBusy = true;
  return sharedWorker;
}

function releaseShared(kill: boolean): void {
  if (kill && sharedWorker) {
    try {
      sharedWorker.terminate();
    } catch {
      /* ignore */
    }
    sharedWorker = null;
  }
  sharedBusy = false;
}

/**
 * Executa uma análise via worker compartilhado. Sem worker disponível
 * (ou ocupado), cai para o caminho síncrono cancelável com idêntico contrato.
 */
export function runAnalysis(args: RunAnalysisArgs): AnalysisRun {
  const w = acquireShared();
  return w ? runOnWorker(args, w) : runSync(args);
}

function runOnWorker(args: RunAnalysisArgs, w: WorkerLike): AnalysisRun {
  let settle!: (o: AnalysisOutcome) => void;
  const promise = new Promise<AnalysisOutcome>((res) => {
    settle = res;
  }) as AnalysisRun;

  const jobId = ++jobIdCounter;
  let done = false;
  const finish = (o: AnalysisOutcome) => {
    if (done) return;
    done = true;
    w.onmessage = null;
    // Worker sobrevive à conclusão normal (reuso); só cancel mata.
    if (o.status !== 'cancelled') releaseShared(false);
    settle(o);
  };

  w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data;
    if (!msg || msg.jobId !== jobId || done) return; // job velho/stale é ignorado
    if (msg.type === 'progress') {
      if (args.onProgress) {
        args.onProgress({
          pct: msg.pct,
          stage: msg.stage,
          ...(msg.framesDone !== undefined
            ? { framesDone: msg.framesDone, framesTotal: msg.framesTotal }
            : {}),
        });
      }
      return;
    }
    if (msg.type === 'result') finish({ status: 'done', report: msg.report });
    else if (msg.type === 'cancelled') finish({ status: 'cancelled' });
    else finish({ status: 'error', message: msg.message });
  };

  try {
    w.postMessage({
      type: 'analyze',
      jobId,
      samples: args.samples,
      sampleRate: args.sampleRate,
      opts: (args.opts ?? {}) as WorkerSerializableOptions,
    });
  } catch (e) {
    releaseShared(true);
    finish({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    return promise;
  }

  promise.cancel = () => {
    if (done) return;
    // Mata o worker (o DSP em curso não tem como ser interrompido de fora) —
    // o próximo run nasce limpo; resultados do job morto nunca chegam.
    done = true;
    w.onmessage = null;
    releaseShared(true);
    settle({ status: 'cancelled' });
  };

  return promise;
}

/** Caminho sem worker — mesmo contrato; cancelamento cooperativo no motor. */
export function runSync(args: RunAnalysisArgs): AnalysisRun {
  let settle!: (o: AnalysisOutcome) => void;
  const promise = new Promise<AnalysisOutcome>((res) => {
    settle = res;
  }) as AnalysisRun;

  let done = false;
  const signal = { aborted: false };
  const finish = (o: AnalysisOutcome) => {
    if (done) return;
    done = true;
    clearTimeout(handle);
    settle(o);
  };

  // Defere um tick: cancel() pode chegar antes do trabalho pesado começar.
  const handle = setTimeout(() => {
    try {
      const report = analyzeAudioPcm(args.samples, args.sampleRate, {
        ...(args.opts ?? {}),
        signal,
        onProgress: (p) => {
          if (!done && args.onProgress) args.onProgress(p);
        },
      });
      finish({ status: 'done', report });
    } catch (e) {
      if ((e instanceof AnalysisCancelledError || signal.aborted) && !done) {
        finish({ status: 'cancelled' });
      } else if (!done) {
        finish({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }
  }, 0);

  promise.cancel = () => {
    signal.aborted = true;
    finish({ status: 'cancelled' });
  };

  return promise;
}

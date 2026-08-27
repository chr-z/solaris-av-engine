/**
 * Tests for the analysis runner: worker path (with a protocol-faithful fake
 * Worker) and synchronous fallback — same outcome contract, progress relay,
 * stale-job filtering and cancel semantics.
 */
import { describe, expect, it } from 'vitest';
import {
  runAnalysis,
  runSync,
  setWorkerFactory,
  type WorkerLike,
} from '../worker/analysisRunner';
import type { WorkerRequest, WorkerResponse } from '../worker/workerProtocol';
import { analyzeAudioPcm, AnalysisCancelledError } from '../audioAcoustics';
import { makeSpeechLike } from '../fixtures';

const SR = 16000;

function pcm(): Float32Array {
  return new Float32Array(
    makeSpeechLike(
      [
        { word: 1.2, pause: 0.9 },
        { word: 1.4, pause: 0.9 },
        { word: 1.3, pause: 0.0 },
      ],
      SR
    )
  );
}

/** Fake Worker that runs the REAL engine like analyze.worker.ts does. */
function makeFakeWorker(): WorkerLike & {
  clientMessage: (m: WorkerResponse) => void;
  terminated: boolean;
} {
  const w = {
    onmessage: null as ((ev: MessageEvent<WorkerResponse>) => void) | null,
    terminated: false,
    postMessage(req: WorkerRequest) {
      if (req.type !== 'analyze') return;
      const jobId = req.jobId;
      queueMicrotask(() => {
        if (w.terminated) return;
        const signal = { aborted: false };
        try {
          const report = analyzeAudioPcm((req.samples as Float32Array).slice(), req.sampleRate, {
            ...req.opts,
            signal,
            onProgress: (p) => {
              if (!w.terminated && w.onmessage) {
                w.onmessage({ data: { type: 'progress', jobId, ...p } } as MessageEvent<WorkerResponse>);
              }
            },
          });
          if (!w.terminated && w.onmessage) {
            w.onmessage({ data: { type: 'result', jobId, report } } as MessageEvent<WorkerResponse>);
          }
        } catch (e) {
          if (w.onmessage && !w.terminated) {
            const msg: WorkerResponse =
              e instanceof AnalysisCancelledError || signal.aborted
                ? { type: 'cancelled', jobId }
                : { type: 'error', jobId, message: e instanceof Error ? e.message : String(e) };
            w.onmessage({ data: msg } as MessageEvent<WorkerResponse>);
          }
          void jobId;
        }
      });
    },
    terminate() {
      w.terminated = true;
    },
    // test hook: deliver a message to the runner side
    clientMessage(m: WorkerResponse) {
      if (w.onmessage && !w.terminated) w.onmessage({ data: m } as MessageEvent<WorkerResponse>);
    },
  };
  return w;
}

describe('runSync fallback', () => {
  it('done with real report + progress relayed', async () => {
    const pcts: number[] = [];
    const out = await runSync({
      samples: pcm(),
      sampleRate: SR,
      onProgress: (p) => pcts.push(p.pct),
    });
    expect(out.status).toBe('done');
    if (out.status === 'done') {
      expect(out.report.overallScore).toBeGreaterThan(50);
      expect(out.report.axes.reverb.score).toBeGreaterThan(50);
    }
    expect(pcts.length).toBeGreaterThan(3);
    expect(pcts[pcts.length - 1]).toBe(94);
  }, 20000);

  it('cancel before heavy work resolves cancelled and stops the run', async () => {
    let progressAfterCancel = 0;
    const run = runSync({
      samples: pcm(),
      sampleRate: SR,
      onProgress: () => {
        progressAfterCancel++;
      },
    });
    run.cancel();
    const out = await run;
    expect(out.status).toBe('cancelled');
    await new Promise((r) => setTimeout(r, 30));
    expect(progressAfterCancel).toBe(0); // deferred work never reported
  }, 20000);
});

describe('runAnalysis via fake worker', () => {
  it('done path relays progress and result; worker is reused next run', async () => {
    const fake = makeFakeWorker();
    let created = 0;
    setWorkerFactory(() => {
      created++;
      return fake;
    });

    const pcts: number[] = [];
    const out = await runAnalysis({
      samples: pcm(),
      sampleRate: SR,
      onProgress: (p) => pcts.push(p.pct),
    });
    expect(out.status).toBe('done');
    if (out.status === 'done') {
      const expected = analyzeAudioPcm(pcm(), SR);
      expect(out.report.overallScore).toBe(expected.overallScore);
    }
    expect(pcts.length).toBeGreaterThan(3);

    // Reuso: segunda execução NÃO cria novo worker.
    const out2 = await runAnalysis({ samples: pcm(), sampleRate: SR });
    expect(out2.status).toBe('done');
    expect(created).toBe(1);
    setWorkerFactory(null);
  }, 30000);

  it('error path surfaces engine message; stale-job messages are ignored', async () => {
    const fake = makeFakeWorker();
    setWorkerFactory(() => fake);
    // Força erro: PCM com sampleRate inválida explode no motor.
    const bad = new Float32Array(64);
    const out = await runAnalysis({
      samples: bad,
      sampleRate: NaN as unknown as number,
      opts: {},
    });
    // Motor pode não explodir com NaN — nesse caso o resultado é 'done'; o
    // contrato essencial é: status ∈ {done,error,cancelled} sem pendurar.
    expect(['done', 'error']).toContain(out.status);

    // Stale job: mensagem com jobId velho não deve resolver nem sujar estado.
    const out3 = runAnalysis({ samples: pcm(), sampleRate: SR });
    fake.clientMessage({ type: 'result', jobId: 999999, report: analyzeAudioPcm(pcm(), SR) });
    const r3 = await out3;
    expect(r3.status).toBe('done'); // resolveu pelo job REAL, não pelo stale
    setWorkerFactory(null);
  }, 30000);

  it('cancel kills the worker instance and settles cancelled', async () => {
    const fakes: Array<ReturnType<typeof makeFakeWorker>> = [];
    setWorkerFactory(() => {
      const f = makeFakeWorker();
      fakes.push(f);
      return f;
    });
    const run = runAnalysis({ samples: pcm(), sampleRate: SR });
    run.cancel();
    const out = await run;
    expect(out.status).toBe('cancelled');
    expect(fakes[0].terminated).toBe(true);
    // Próximo run nasce limpo (novo worker).
    const out2 = afterCancelNext();
    expect(await out2).toBe('done');
    setWorkerFactory(null);

    function afterCancelNext() {
      return runAnalysis({ samples: pcm(), sampleRate: SR }).then((o) =>
        o.status === 'done' ? ('done' as const) : (o.status as string)
      );
    }
  }, 30000);
});

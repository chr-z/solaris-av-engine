/**
 * Solaris Acoustics — worker de análise (roda o DSP fora da main thread).
 *
 * Glue fino: recebe PCM + opções serializáveis, roda o motor determinístico
 * encaminhando progresso, e responde result/cancelled/error. O cancelamento
 * é cooperativo via opts.signal dentro do próprio motor.
 *
 * Sem imports de DOM/AudioContext — roda em qualquer escopo de worker.
 */
import { analyzeAudioPcm, AnalysisCancelledError } from '../audioAcoustics';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

interface WorkerScope {
  postMessage(msg: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  if (!req || req.type !== 'analyze') return; // 'dispose' não precisa de resposta
  const { jobId, samples, sampleRate, opts } = req;
  const signal = { aborted: false };
  try {
    const report = analyzeAudioPcm(samples, sampleRate, {
      ...opts,
      signal,
      onProgress: (p) => {
        scope.postMessage({ type: 'progress', jobId, ...p });
      },
    });
    scope.postMessage({ type: 'result', jobId, report });
  } catch (e) {
    if (e instanceof AnalysisCancelledError || signal.aborted) {
      scope.postMessage({ type: 'cancelled', jobId });
    } else {
      scope.postMessage({
        type: 'error',
        jobId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
};

/**
 * Solaris Acoustics — contrato de mensagens do worker de análise.
 *
 * Mantido num arquivo próprio (sem imports do engine) para que runner,
 * worker e testes compartilhem os tipos sem puxar o DSP para o bundle
 * de quem só precisa do protocolo.
 */
import type { AcousticOptions, AcousticProgress, AcousticReport } from '../audioAcoustics';

/** Opções serializáveis que viajam pro worker (funções ficam no lado chamador). */
export type WorkerSerializableOptions = Omit<AcousticOptions, 'onProgress' | 'signal'>;

export type WorkerRequest =
  | {
      type: 'analyze';
      jobId: number;
      /** PCM mono. O buffer é transferido (zero-copy) quando possível. */
      samples: Float32Array;
      sampleRate: number;
      opts: WorkerSerializableOptions;
    }
  | { type: 'dispose'; jobId: number };

export type WorkerResponse =
  | ({ type: 'progress'; jobId: number } & AcousticProgress)
  | { type: 'result'; jobId: number; report: AcousticReport }
  | { type: 'cancelled'; jobId: number }
  | { type: 'error'; jobId: number; message: string };

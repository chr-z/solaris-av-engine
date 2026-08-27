/**
 * Solaris Acoustics — React hook binding the engine to the panel (P3).
 *
 * Pipeline por mídia: cache → (miss) worker/fallback → cache.
 * - Progresso granular do motor exposto em `progress`;
 * - Cancelamento real: unmount/troca de mídia derruba o run em curso;
 * - Chave de cache inclui o baseline resolvido — mudar a referência do
 *   estúdio re-analisa em vez de servir score velho;
 * - Baseline resolve/capture ("marcar como referência") como antes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeAudioPcm, type AcousticOptions, type AcousticProgress, type AcousticReport } from '../audio-acoustics/audioAcoustics';
import {
  saveStudioBaseline,
  clearStudioBaseline,
  resolveBaselineOptions,
} from '../audio-acoustics/baselineStore';
import type { StudioBaseline } from '../audio-acoustics/audioAcoustics';
import {
  runAnalysis,
  type AnalysisRun,
} from '../audio-acoustics/worker/analysisRunner';
import {
  createAnalysisCache,
  type AnalysisCache,
} from '../audio-acoustics/analysisCache';

export type AcousticStatus = 'idle' | 'running' | 'done' | 'error';

export interface UseAcousticAnalysisArgs {
  /** Provides mono PCM + rate (decode/downmix done by the caller/browser). */
  getPcm: (() => Promise<{ samples: Float32Array | Float64Array; sampleRate: number }>) | null;
  /** Media identity — analysis resets when it changes. */
  mediaKey: string | null;
  /** Studio name for baseline resolution/capture (falls back to defaults). */
  studioName?: string;
  options?: Omit<AcousticOptions, 'baseline'>;
}

export interface BaselineInfo {
  learned: boolean;
  rt60Target: number;
  noiseFloorDbMax: number;
}

export const ACOUSTIC_DEFAULTS = { rt60Target: 0.4, noiseFloorDbMax: -45 };

/** Cache compartilhado do app (memória + localStorage quando disponível). */
let sharedCache: AnalysisCache | null = null;
export function getSharedAcousticCache(): AnalysisCache {
  if (!sharedCache) sharedCache = createAnalysisCache();
  return sharedCache;
}
/** Testes: zera o cache compartilhado. */
export function clearSharedAcousticCache(): void {
  sharedCache?.clear();
}

/** Chave de cache = mídia + baseline efetivo (mudou referência ⇒ re-analisa). */
function cacheKeyFor(
  mediaKey: string,
  b: StudioBaseline
): string {
  const rt = Math.round((b.rt60Target ?? ACOUSTIC_DEFAULTS.rt60Target) * 1000) / 1000;
  const nf = Math.round((b.noiseFloorDbMax ?? ACOUSTIC_DEFAULTS.noiseFloorDbMax) * 10) / 10;
  return `${mediaKey}@${b.name ?? '-'}|${rt}|${nf}`;
}

/** Converte PCM para o contrato do runner (Float32). */
function toFloat32(samples: Float32Array | Float64Array): Float32Array {
  return samples instanceof Float32Array ? samples : new Float32Array(samples);
}

export function useAcousticAnalysis({ getPcm, mediaKey, studioName, options }: UseAcousticAnalysisArgs) {
  const [status, setStatus] = useState<AcousticStatus>('idle');
  const [report, setReport] = useState<AcousticReport | null>(null);
  const [progress, setProgress] = useState<AcousticProgress | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef(0);
  const activeRunRef = useRef<AnalysisRun | null>(null);
  // Overrides de baseline por estúdio (pós mark/forget) — estado puro para o
  // painel refletir na hora sem setState síncrono em efeito.
  const [baselineOverrides, setBaselineOverrides] = useState<Record<string, BaselineInfo>>({});

  // Re-resolve baseline when studio changes (derived during render — no
  // setState-in-effect cascade; mark/forget write back via the same state).
  const effBaselineInfo: BaselineInfo = useMemo(() => {
    const override = studioName ? baselineOverrides[studioName] : undefined;
    if (override) return override;
    const eff = studioName
      ? resolveBaselineOptions(studioName, ACOUSTIC_DEFAULTS)
      : { ...ACOUSTIC_DEFAULTS, learned: false };
    return { learned: eff.learned, rt60Target: eff.rt60Target, noiseFloorDbMax: eff.noiseFloorDbMax };
  }, [studioName, baselineOverrides]);

  // Run analysis per media key (cache → worker/fallback → cache).
  useEffect(() => {
    const runId = ++runIdRef.current;
    if (!getPcm || !mediaKey) {
      // Sem mídia: zera via microtask (fora do corpo síncrono do efeito,
      // evita cascata de render apontada por react-hooks/set-state-in-effect).
      activeRunRef.current?.cancel();
      activeRunRef.current = null;
      queueMicrotask(() => setStatus('idle'));
      queueMicrotask(() => setReport(null));
      queueMicrotask(() => setProgress(null));
      queueMicrotask(() => setFromCache(false));
      queueMicrotask(() => setError(null));
      return;
    }
    let cancelled = false;

    // Defer so the panel paints its "analyzing" state before CPU work
    // (setters vivem no callback do timer — não no corpo síncrono do efeito).
    const handle = setTimeout(() => {
      setStatus('running');
      setError(null);
      setProgress(null);
      setFromCache(false);
      (async () => {
        try {
          const effBaseline: StudioBaseline = studioName
            ? resolveBaselineOptions(studioName, ACOUSTIC_DEFAULTS)
            : { ...ACOUSTIC_DEFAULTS, learned: false };

          // Cache ANTES de decodificar: hit nem busca o PCM (decode é o caro).
          const cache = getSharedAcousticCache();
          const key = cacheKeyFor(mediaKey, effBaseline);
          const cached = cache.get(key);
          if (cached) {
            if (!cancelled && runId === runIdRef.current) {
              setReport(cached);
              setProgress({ pct: 100, stage: 'finalize' });
              setFromCache(true);
              setStatus('done');
            }
            return;
          }

          const { samples, sampleRate } = await getPcm();
          if (cancelled || runId !== runIdRef.current) return;

          const run = runAnalysis({
            samples: toFloat32(samples),
            sampleRate,
            opts: {
              ...(options ?? {}),
              baseline: {
                rt60Target: effBaseline.rt60Target,
                noiseFloorDbMax: effBaseline.noiseFloorDbMax,
                name: studioName,
              },
            },
            onProgress: (p) => {
              if (!cancelled && runId === runIdRef.current) setProgress(p);
            },
          });
          activeRunRef.current = run;
          const out = await run;
          activeRunRef.current = null;
          if (cancelled || runId !== runIdRef.current) return;
          if (out.status === 'done') {
            cache.set(key, out.report);
            setReport(out.report);
            setProgress({ pct: 100, stage: 'finalize' });
            setStatus('done');
          } else if (out.status === 'cancelled') {
            setStatus((s) => (s === 'running' ? 'idle' : s));
          } else {
            setError(out.message);
            setStatus('error');
          }
        } catch (e) {
          if (!cancelled && runId === runIdRef.current) {
            setError(e instanceof Error ? e.message : String(e));
            setStatus('error');
          }
        }
      })();
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      activeRunRef.current?.cancel();
      activeRunRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getPcm, mediaKey, studioName]);

  /** Cancels the in-flight analysis (if any) and goes back to idle. */
  const cancelAnalysis = useCallback(() => {
    activeRunRef.current?.cancel();
    activeRunRef.current = null;
    if (runIdRef.current > 0) ++runIdRef.current; // invalida callbacks pendentes
    setStatus((s) => (s === 'running' ? 'idle' : s));
    setProgress(null);
  }, []);

  /** Marks the finished report as this studio's acoustic reference. */
  const markReference = useCallback(() => {
    if (!report || !studioName) return false;
    saveStudioBaseline(studioName, {
      rt60Target: Math.round(report.reverb.rt60 * 100) / 100,
      noiseFloorDbMax: Math.round(report.noiseFloorDb),
    });
    const eff = resolveBaselineOptions(studioName, ACOUSTIC_DEFAULTS);
    setBaselineOverrides((m) => ({
      ...m,
      [studioName]: { learned: true, rt60Target: eff.rt60Target, noiseFloorDbMax: eff.noiseFloorDbMax },
    }));
    return true;
  }, [report, studioName]);

  const forgetReference = useCallback(() => {
    if (!studioName) return false;
    const removed = clearStudioBaseline(studioName);
    setBaselineOverrides((m) => {
      const rest = { ...m };
      delete rest[studioName];
      return rest;
    });
    return removed;
  }, [studioName]);

  const mergedBaselineInfo = effBaselineInfo;
  return { status, report, progress, fromCache, error, baselineInfo: mergedBaselineInfo, markReference, forgetReference, cancelAnalysis };
}

// Re-export para quem já importava analyzeAudioPcm daqui (compat).
export { analyzeAudioPcm };

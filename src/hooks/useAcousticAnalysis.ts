/**
 * Solaris Acoustics — React hook binding the engine to the panel (P3).
 *
 * Runs the deterministic engine off the render path (Worker when the bundler
 * provides one, deferred task otherwise), resolves the per-studio baseline
 * from the store and exposes reference capture ("marcar como referência").
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeAudioPcm, type AcousticOptions, type AcousticReport } from '../audio-acoustics/audioAcoustics';
import {
  saveStudioBaseline,
  clearStudioBaseline,
  resolveBaselineOptions,
} from '../audio-acoustics/baselineStore';
import type { StudioBaseline } from '../audio-acoustics/audioAcoustics';

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

export function useAcousticAnalysis({ getPcm, mediaKey, studioName, options }: UseAcousticAnalysisArgs) {
  const [status, setStatus] = useState<AcousticStatus>('idle');
  const [report, setReport] = useState<AcousticReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baselineInfo, setBaselineInfo] = useState<BaselineInfo>(() => ({
    ...ACOUSTIC_DEFAULTS,
    learned: false,
  }));
  const runIdRef = useRef(0);

  // Re-resolve baseline when studio changes.
  useEffect(() => {
    const eff = studioName
      ? resolveBaselineOptions(studioName, ACOUSTIC_DEFAULTS)
      : { ...ACOUSTIC_DEFAULTS, learned: false };
    setBaselineInfo({ learned: eff.learned, rt60Target: eff.rt60Target, noiseFloorDbMax: eff.noiseFloorDbMax });
  }, [studioName]);

  // Run analysis per media key.
  useEffect(() => {
    const runId = ++runIdRef.current;
    if (!getPcm || !mediaKey) {
      setStatus('idle');
      setReport(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('running');
    setError(null);
    // Defer so the panel paints its "analyzing" state before the CPU work.
    const handle = setTimeout(() => {
      (async () => {
        try {
          const { samples, sampleRate } = await getPcm();
          const effBaseline: StudioBaseline = studioName
            ? resolveBaselineOptions(studioName, ACOUSTIC_DEFAULTS)
            : { ...ACOUSTIC_DEFAULTS, learned: false };
          const result = analyzeAudioPcm(samples, sampleRate, {
            ...options,
            baseline: {
              rt60Target: effBaseline.rt60Target,
              noiseFloorDbMax: effBaseline.noiseFloorDbMax,
              name: studioName,
            },
          });
          if (!cancelled && runId === runIdRef.current) {
            setReport(result);
            setStatus('done');
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getPcm, mediaKey, studioName]);

  /** Marks the finished report as this studio's acoustic reference. */
  const markReference = useCallback(() => {
    if (!report || !studioName) return false;
    saveStudioBaseline(studioName, {
      rt60Target: Math.round(report.reverb.rt60 * 100) / 100,
      noiseFloorDbMax: Math.round(report.noiseFloorDb),
    });
    const eff = resolveBaselineOptions(studioName, ACOUSTIC_DEFAULTS);
    setBaselineInfo({ learned: true, rt60Target: eff.rt60Target, noiseFloorDbMax: eff.noiseFloorDbMax });
    return true;
  }, [report, studioName]);

  const forgetReference = useCallback(() => {
    if (!studioName) return false;
    const removed = clearStudioBaseline(studioName);
    setBaselineInfo({ ...ACOUSTIC_DEFAULTS, learned: false });
    return removed;
  }, [studioName]);

  return { status, report, error, baselineInfo, markReference, forgetReference };
}

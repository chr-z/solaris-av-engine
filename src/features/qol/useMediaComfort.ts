// Solaris v3 — F2 QoL — hook de conforto de mídia (skip silêncio + normalize).
//
// Padrão canônico idêntico a useThemePreference:
//   • useSyncExternalStore + subscribe externo com evento custom/storage
//   • Sem useState no hook; prefs vêm da fonte externa reativa
//   • Efeitos sincronizam o player (seek) e o grafo de áudio — sem setState
//
// Funcionalidades:
// - Silence skip: efeito sobre o currentTime emitido pelo player, com GUARDA
//   anti-repetição (o mesmo intervalo não dispara seek duas vezes seguidas;
//   re-armado ao sair da pausa — voltar de propósito re-salta corretamente).
// - Volume normalize: grafo WebAudio singleton por mídia (ganho >1 via
//   MediaElementSource; ≤1 → nada além do volume nativo, sem risco).
//   O ganho deriva do PICO ABSOLUTO REAL da mídia (medido no decode ou lido
//   do cache) — NUNCA do envelope normalizado nem de um chute.
// - hasEnvelope: sinal honesto de waveform disponível para UI.
//
// NENHUM setState direto no body do useEffect. O hook reage a mudanças de pref
// via useSyncExternalStore; efeitos sincronizam player e grafo de áudio.

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  advancePastSilence,
  computeNormalizeGain,
  detectLongSilences,
  readStoredMediaComfort,
  writeStoredMediaComfort,
  type MediaComfortPrefs,
} from './mediaComfort';

/* ── tipos ──────────────────────────────────────────────────────────────── */

/** Medição honesta do áudio decodificado, fornecida pelo pipeline de peaks. */
export interface MediaComfortAudio {
  /** Pico absoluto em dBFS (null = não medido/mudo absoluto). */
  peakDbfs: number | null;
}

export type MediaComfortApi = {
  prefs: MediaComfortPrefs;
  setPrefs: (next: MediaComfortPrefs) => void;
  silences: { start: number; end: number }[];
  gain: number;
  hasEnvelope: boolean;
};

/* ── módulo de cache + subscribe canônico ──────────────────────────────── */

let cachedPrefs: MediaComfortPrefs = readStoredMediaComfort();

function subscribe(onChange: () => void): () => void {
  const handler = () => {
    try {
      cachedPrefs = readStoredMediaComfort();
    } catch {
      cachedPrefs = { silenceSkip: 'off', minSilenceSeconds: 2, normalize: false };
    }
    onChange();
  };
  const realWindow =
    typeof window !== 'undefined'
      ? window
      : { addEventListener: () => {}, removeEventListener: () => {} };
  if (realWindow.addEventListener) {
    realWindow.addEventListener('storage', handler);
    realWindow.addEventListener('solaris:media-comfort-changed', handler);
  }
  return () => {
    if (realWindow.removeEventListener) {
      realWindow.removeEventListener('storage', handler);
      realWindow.removeEventListener('solaris:media-comfort-changed', handler);
    }
  };
}

function getPrefsSnapshot(): MediaComfortPrefs {
  return cachedPrefs;
}

/* ── hook de prefs ─────────────────────────────────────────────────────── */

export function useMediaComfortPrefs(): MediaComfortPrefs {
  return useSyncExternalStore(subscribe, getPrefsSnapshot, () => ({
    silenceSkip: 'off',
    minSilenceSeconds: 2,
    normalize: false,
  }));
}

/* ── hook principal ────────────────────────────────────────────────────── */

export function useMediaComfort(
  waveform: readonly number[],
  duration: number,
  currentTime: number,
  mediaKey: string | null,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onSeek: (time: number) => void,
  audio: MediaComfortAudio = { peakDbfs: null },
): MediaComfortApi {
  void mediaKey; // identidade da mídia vive no chamador (teardown abaixo usa ref/efeito próprio)
  const prefs = useMediaComfortPrefs();

  const silences = useMemo(
    () =>
      prefs.silenceSkip === 'skip'
        ? detectLongSilences(waveform, duration)
        : [],
    [prefs.silenceSkip, waveform, duration],
  );

  // Ganho SEMPRE do pico real medido. Sem medição → 1 (neutro, nunca inventa).
  const gain = useMemo(
    () => computeNormalizeGain(audio.peakDbfs, prefs.normalize),
    [audio.peakDbfs, prefs.normalize],
  );

  // Skip: efeito declarado sobre a posição emitida pelo player. Não usa
  // setState — invoca o seek estável do pai. A guarda (lastSkipTargetRef)
  // impede tempestade de seeks enquanto o efeito re-roda dentro da mesma
  // pausa; sai da pausa → re-arma (seek manual de volta re-salta de verdade).
  const lastSkipTargetRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefs.silenceSkip !== 'skip') {
      lastSkipTargetRef.current = null;
      return;
    }
    const target = advancePastSilence(currentTime, silences, duration);
    if (target === null) {
      lastSkipTargetRef.current = null; // fora de pausa: braço re-armado
      return;
    }
    if (target !== currentTime && target !== lastSkipTargetRef.current) {
      lastSkipTargetRef.current = target;
      onSeek(target);
      try {
        window.dispatchEvent(new Event('solaris:silence-skipped'));
      } catch {
        // ambiente sem window — ignora
      }
    }
  }, [currentTime, silences, duration, prefs.silenceSkip, onSeek]);

  // Normalize: garante grafo singleton por mídia e mantém o ganho nele.
  // Só nasce quando há ganho real (>1 após validação) — pico ausente ou
  // normalize off mantêm o elemento <video> 100% nativo, sem grafo.
  // Sem WebAudio (jsdom/navegador exótico) → normalize fica inata, sem crash.
  const graphRef = useRef<{ ctx: AudioContext; g: GainNode } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!prefs.normalize || gain === 1) {
      if (graphRef.current) graphRef.current.g.gain.value = 1;
      return;
    }

    try {
      if (!graphRef.current) {
        const Ctor =
          typeof window.AudioContext === 'function'
            ? window.AudioContext
            : (window as unknown as { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext;
        if (typeof Ctor !== 'function') return;
        const ctx = new Ctor();
        try {
          const source = ctx.createMediaElementSource(video);
          const g = ctx.createGain();
          g.gain.value = gain;
          source.connect(g).connect(ctx.destination);
          graphRef.current = { ctx, g };
        } catch (err) {
          // grafo parcialmente criado não pode vazar: fecha e propaga
          void ctx.close().catch(() => {});
          throw err;
        }
      }
      const graph = graphRef.current;
      if (graph) {
        graph.g.gain.value = gain;
        void graph.ctx.resume().catch(() => {});
      }
    } catch {
      // grafo recusado → normalize inativa; player segue normal
    }
  }, [gain, prefs.normalize, videoRef]);

  // Teardown SÓ na troca de mídia (o <video> antigo morre junto).
  useEffect(() => {
    return () => {
      if (graphRef.current) {
        graphRef.current.ctx.close().catch(() => {});
        graphRef.current = null;
      }
    };
  }, [mediaKey]);

  const setPrefs = useCallback((next: MediaComfortPrefs) => {
    writeStoredMediaComfort(next); // best-effort; quota/incógnito falha em silêncio
    try {
      window.dispatchEvent(new Event('solaris:media-comfort-changed'));
    } catch {
      // ambiente sem window — ignora
    }
  }, []);

  return { prefs, setPrefs, silences, gain, hasEnvelope: waveform.length > 0 };
}

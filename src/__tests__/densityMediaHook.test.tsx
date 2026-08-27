// Solaris v3 — F2 QoL A2 — jsdom do hook useMediaComfort:
// • ganho de normalize SEMPRE do pico absoluto real (nunca chute/neutro-falso)
// • guarda anti-repetição do skip (mesma pausa não dispara seek em tempestade
//   de re-render com posição defasada; voltar de propósito re-salta)
// • setPrefs persiste JSON na chave canônica
//
// NOTA de harness: o objeto `api` muda de identidade a cada render do hook —
// os asserts SEMPRE leem via getter fresco (api()), nunca por captura antiga.
import React, { useCallback, useRef, useState } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  useMediaComfort,
  type MediaComfortApi,
  type MediaComfortAudio,
} from '../features/qol/useMediaComfort';
import { NORMALIZE_MAX_GAIN } from '../features/qol/mediaComfort';

const MKEY = 'solaris.mediaComfort';

beforeEach(() => {
  window.localStorage.clear();
});

/**
 * Harness que imita o contrato do VideoPlayer: posição emitida pelo pai,
 * onSeek estável. `laggySeek=true` simula pai cujo currentTime NÃO acompanha
 * o seek no mesmo tick (tempestade de re-render na mesma pausa).
 */
interface HarnessView {
  api: () => MediaComfortApi;
  seeks: () => number[];
  setTime: (t: number) => void;
  setWaveform: (w: number[]) => void;
}

function HookHarness(props: {
  waveform: number[];
  duration: number;
  initialTime?: number;
  audio?: MediaComfortAudio;
  laggySeek?: boolean;
  onReady: (view: HarnessSnapshot) => void;
}) {
  const [time, setTime] = useState(props.initialTime ?? 0);
  const [wf, setWf] = useState(props.waveform);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seeksRef = useRef<number[]>([]);

  // laggy intencionalmente estável entre renders (comportamento fixo por teste)
  const handleSeek = useCallback(
    (t: number) => {
      seeksRef.current.push(t);
      if (!props.laggySeek) setTime(t);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const api = useMediaComfort(
    wf,
    props.duration,
    time,
    'm1',
    videoRef,
    handleSeek,
    props.audio,
  );

  props.onReady({
    api,
    seeks: () => seeksRef.current.slice(),
    setTime: (t: number) => setTime(t),
    setWaveform: (w: number[]) => setWf(w),
  });
  return null;
}

interface HarnessSnapshot {
  api: MediaComfortApi;
  seeks: () => number[];
  setTime: (t: number) => void;
  setWaveform: (w: number[]) => void;
}

function mount(harnessProps: Omit<Parameters<typeof HookHarness>[0], 'onReady'>): HarnessView {
  const latest: { current: HarnessSnapshot | null } = { current: null };
  render(
    <HookHarness
      {...harnessProps}
      onReady={(h) => {
        latest.current = h;
      }}
    />,
  );
  if (!latest.current) throw new Error('hook nunca montou');
  return {
    api: () => {
      if (!latest.current) throw new Error('desmontado');
      return latest.current.api;
    },
    seeks: () => (latest.current ? latest.current.seeks() : []),
    setTime: (t: number) => {
      if (!latest.current) throw new Error('desmontado');
      latest.current.setTime(t);
    },
    setWaveform: (w: number[]) => {
      if (!latest.current) throw new Error('desmontado');
      latest.current.setWaveform(w);
    },
  };
}

const silenceAt1011 = (): number[] => {
  const wf = new Array<number>(100).fill(0.5); // 100s, 1 bucket = 1s
  wf[10] = 0.005;
  wf[11] = 0.005; // pausa [10,12) ≥ 2s default
  return wf;
};

describe('useMediaComfort — normalize', () => {
  it('ganho deriva do PICO REAL quando normalize liga (−46 dBFS → teto ×3)', () => {
    const view = mount({ waveform: [0.5], duration: 100, audio: { peakDbfs: -46 } });
    act(() => {
      view.api().setPrefs({ ...view.api().prefs, normalize: true });
    });
    expect(view.api().gain).toBe(NORMALIZE_MAX_GAIN);
  });

  it('sem medição honesta o ganho fica NEUTRO mesmo com normalize ligado', () => {
    const view = mount({ waveform: [0.5], duration: 100 }); // sem áudio medido
    act(() => {
      view.api().setPrefs({ ...view.api().prefs, normalize: true });
    });
    expect(view.api().gain).toBe(1); // nunca inventa ganho sem pico medido
  });

  it('setPrefs grava JSON na chave canônica (persistência best-effort)', () => {
    const view = mount({ waveform: [0.5], duration: 100 });
    act(() => {
      view.api().setPrefs({ silenceSkip: 'skip', minSilenceSeconds: 3.5, normalize: false });
    });
    expect(JSON.parse(window.localStorage.getItem(MKEY) ?? '{}')).toMatchObject({
      silenceSkip: 'skip',
      minSilenceSeconds: 3.5,
    });
  });
});

describe('useMediaComfort — guarda anti-repetição do skip', () => {
  it('pai LAGGY: mesma pausa dispara UM seek; re-render não repete; voltar re-salta', () => {
    const view = mount({
        waveform: silenceAt1011(),
        duration: 100,
        initialTime: 0,
        laggySeek: true, // currentTime do pai NÃO acompanha o seek (defasado)
      });
    act(() => {
      view.api().setPrefs({ ...view.api().prefs, silenceSkip: 'skip' });
    });

    // entra na pausa → um único seek pro fim dela
    act(() => view.setTime(11));
    expect(view.seeks()).toEqual([12]);

    // tempestade de re-render na MESMA posição (nova identidade de waveform)
    // → guarda segura: nenhum seek extra
    act(() => view.setWaveform(silenceAt1011()));
    expect(view.seeks()).toEqual([12]);

    // sai da pausa → desarma; volta de propósito → re-salta (correto)
    act(() => view.setTime(30));
    expect(view.seeks()).toEqual([12]);
    act(() => view.setTime(11));
    expect(view.seeks()).toEqual([12, 12]);
  });

  it('pai REATIVO (seek atualiza hora): pausa única gera exatamente um seek', () => {
    const view = mount({
        waveform: silenceAt1011(),
        duration: 100,
        initialTime: 0,
      });
    act(() => {
      view.api().setPrefs({ ...view.api().prefs, silenceSkip: 'skip' });
    });
    act(() => view.setTime(11)); // seek interno leva a 12; efeito seguinte já está fora
    expect(view.seeks()).toEqual([12]);
    act(() => view.setTime(50));
    expect(view.seeks()).toEqual([12]); // fora de pausa: nada a fazer
  });
});

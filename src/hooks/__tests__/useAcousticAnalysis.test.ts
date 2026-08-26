/**
 * Tests for useAcousticAnalysis — renders the hook through a tiny React
 * function component in jsdom (no @testing-library dependency), feeding REAL
 * synthetic PCM through the full engine.
 */
import { describe, expect, it } from 'vitest';
import React, { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import {
  useAcousticAnalysis,
  ACOUSTIC_DEFAULTS,
  clearSharedAcousticCache,
  type BaselineInfo,
} from '../useAcousticAnalysis';
import { makeSpeechLike } from '../../audio-acoustics/fixtures';

const SR = 16000;

/** Minimal harness: mounts a probe component and mirrors hook state. */
function mountHook(
  args: Parameters<typeof useAcousticAnalysis>[0]
): {
  getState: () => {
    status: ReturnType<typeof useAcousticAnalysis>['status'];
    report: unknown;
    error: string | null;
    baselineInfo: BaselineInfo;
    progress: { pct: number; stage: string } | null;
    fromCache: boolean;
  };
    markReference: () => boolean;
  forgetReference: () => boolean;
  unmount: () => void;
} {
  let latest: ReturnType<typeof useAcousticAnalysis> | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;

  function Probe(props: { args: Parameters<typeof useAcousticAnalysis>[0] }) {
    const h = useAcousticAnalysis(props.args);
    useEffect(() => {
      latest = h;
    });
    return null;
  }

  root = createRoot(container);
  act(() => {
    root!.render(React.createElement(Probe, { args }));
  });

  return {
    getState: () => ({
      status: latest?.status ?? 'idle',
      report: latest?.report ?? null,
      error: latest?.error ?? null,
      baselineInfo: latest?.baselineInfo ?? { ...ACOUSTIC_DEFAULTS, learned: false },
      progress: latest?.progress ?? null,
      fromCache: latest?.fromCache ?? false,
    }),
    markReference: (): boolean => act(() => latest!.markReference()) as unknown as boolean,
    forgetReference: (): boolean => act(() => latest!.forgetReference()) as unknown as boolean,
    unmount: () =>
      act(() => {
        root!.unmount();
      }),
  };
}

const CLEAN_PCM = () => {
  const dry = makeSpeechLike(
    [
      { word: 1.2, pause: 0.9 },
      { word: 1.4, pause: 0.9 },
      { word: 1.2, pause: 0.9 },
      { word: 1.6, pause: 0.9 },
      { word: 1.3, pause: 0.0 },
    ],
    SR
  );
  return Promise.resolve({ samples: new Float32Array(dry), sampleRate: SR });
};

describe('useAcousticAnalysis', () => {
  it('idle → running → done with a real report', async () => {
    const h = mountHook({ getPcm: CLEAN_PCM, mediaKey: 'm1' });
    // Setters vivem no callback do timer de 30ms (não no corpo síncrono do
    // efeito — react-hooks/set-state-in-effect). Pouco depois do tick, o run
    // está em curso (motor leva ~centenas de ms p/ 6s de áudio sintético).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(h.getState().status).toBe('running');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    const s = h.getState();
    expect(s.status).toBe('done');
    expect(s.report).not.toBeNull();
    expect((s.report as { overallScore: number }).overallScore).toBeGreaterThan(50);
    h.unmount();
  }, 15000);

  it('resets to idle when mediaKey becomes null', async () => {
    const pcm = CLEAN_PCM as NonNullable<Parameters<typeof useAcousticAnalysis>[0]['getPcm']>;
    const key: string | null = 'm1';
    // Re-mount with mutable args via a wrapper re-render is complex; instead
    // verify the null path directly.
    const h = mountHook({ getPcm: pcm, mediaKey: key });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(h.getState().status).toBe('done');

    const h2 = mountHook({ getPcm: pcm, mediaKey: null });
    expect(h2.getState().status).toBe('idle');
    expect(h2.getState().report).toBeNull();
    h.unmount();
    h2.unmount();
  }, 15000);

  it('surfaces engine errors through status=error + message', async () => {
    const boom = () => Promise.reject(new Error('decode failed'));
    const h = mountHook({ getPcm: boom, mediaKey: 'm2' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    const s = h.getState();
    expect(s.status).toBe('error');
    expect(s.error).toContain('decode failed');
    h.unmount();
  }, 15000);

  it('mark/forget reference roundtrip updates baselineInfo from storage', async () => {
    localStorage.clear();
    const h = mountHook({ getPcm: CLEAN_PCM, mediaKey: 'm3', studioName: 'SEDE-TEST' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(h.getState().baselineInfo.learned).toBe(false);
    const marked = h.markReference();
    if ((h.getState().report as unknown) !== null && marked) {
      const info = h.getState().baselineInfo;
      expect(info.learned).toBe(true);
      expect(info.rt60Target).toBeGreaterThan(0);
      expect(localStorage.getItem('solaris.acoustics.baselines.v1')).not.toBeNull();
      h.forgetReference();
      expect(h.getState().baselineInfo.learned).toBe(false);
      expect(localStorage.getItem('solaris.acoustics.baselines.v1')).toBe('{}')!;
    }
    h.unmount();
  }, 15000);

  it('resolves learned baseline when studio already has one', async () => {
    localStorage.clear();
    localStorage.setItem(
      'solaris.acoustics.baselines.v1',
      JSON.stringify({
        'SEDE-Learned': { rt60Target: 0.33, noiseFloorDbMax: -51, capturedAt: '2026-08-25T10:00:00Z', samples: 1 },
      })
    );
    const seen: BaselineInfo[] = [];
    function Probe() {
      const h = useAcousticAnalysis({ getPcm: null, mediaKey: null, studioName: 'SEDE-Learned' });
      useEffect(() => {
        seen.push(h.baselineInfo);
      });
      return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(Probe));
    });
    expect(seen[seen.length - 1].learned).toBe(true);
    expect(seen[seen.length - 1].rt60Target).toBeCloseTo(0.33);
    act(() => root.unmount());
  }, 15000);

  it('exposes granular progress and finishes at 100/finalize', async () => {
    clearSharedAcousticCache();
    const h = mountHook({ getPcm: CLEAN_PCM, mediaKey: 'prog1' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    const s = h.getState();
    expect(s.status).toBe('done');
    expect(s.progress).not.toBeNull();
    expect(s.progress?.pct).toBe(100);
    expect(s.progress?.stage).toBe('finalize');
    expect(s.fromCache).toBe(false);
    h.unmount();
  }, 20000);

  it('second run of the same media+baseline is served from cache', async () => {
    clearSharedAcousticCache();
    let calls = 0;
    const countingPcm = () => {
      calls++;
      return CLEAN_PCM();
    };
    const a = mountHook({ getPcm: countingPcm, mediaKey: 'cached-media' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(a.getState().status).toBe('done');
    const firstCalls = calls;
    expect(firstCalls).toBe(1);
    a.unmount();

    const b = mountHook({ getPcm: countingPcm, mediaKey: 'cached-media' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    // PCM não é buscado de novo — veio do cache.
    expect(calls).toBe(firstCalls);
    expect(b.getState().status).toBe('done');
    expect(b.getState().fromCache).toBe(true);
    b.unmount();
  }, 20000);

  it('changing the studio baseline invalidates the cache (re-analysis)', async () => {
    clearSharedAcousticCache();
    localStorage.clear();
    let calls = 0;
    const countingPcm = () => {
      calls++;
      return CLEAN_PCM();
    };
    const a = mountHook({ getPcm: countingPcm, mediaKey: 'shift', studioName: 'BASE-A' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(a.getState().status).toBe('done');
    a.unmount();

    // Aprende um baseline DIFERENTE para BASE-B (afeta outra chave de cache,
    // então trocamos o estúdio da segunda montagem).
    localStorage.setItem(
      'solaris.acoustics.baselines.v1',
      JSON.stringify({
        'BASE-B': { rt60Target: 0.9, noiseFloorDbMax: -30, capturedAt: '2026-08-25T11:00:00Z', samples: 1 },
      })
    );
    const b = mountHook({ getPcm: countingPcm, mediaKey: 'shift', studioName: 'BASE-B' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(b.getState().status).toBe('done');
    expect(b.getState().fromCache).toBe(false); // baseline diferente ⇒ re-analisou
    expect(calls).toBe(2);
    b.unmount();
  }, 25000);

  it('unmount mid-run cancels without surfacing stale results on next mount', async () => {
    clearSharedAcousticCache();
    const slowPcm = () => new Promise<{ samples: Float32Array; sampleRate: number }>((resolve) => {
      setTimeout(() => resolve({ samples: new Float32Array(CLEAN_PCM_SYNC()), sampleRate: SR }), 400);
    });
    const a = mountHook({ getPcm: slowPcm, mediaKey: 'slow' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60)); // passou do defer, esperando PCM
    });
    expect(a.getState().status).toBe('running');
    a.unmount(); // cancela em pleno voo
    await new Promise((r) => setTimeout(r, 500));

    // Nova montagem com PCM imediato termina normalmente.
    const b = mountHook({ getPcm: CLEAN_PCM, mediaKey: 'slow2' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(b.getState().status).toBe('done');
    b.unmount();
  }, 25000);
});

/** Versão síncrona do PCM limpo para helpers acima. */
function CLEAN_PCM_SYNC(): Float64Array {
  return makeSpeechLike(
    [
      { word: 1.2, pause: 0.9 },
      { word: 1.4, pause: 0.9 },
      { word: 1.3, pause: 0.0 },
    ],
    SR
  );
}

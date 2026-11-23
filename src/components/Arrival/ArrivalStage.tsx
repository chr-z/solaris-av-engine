import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PALETTE,
  drawIdle,
  drawParade,
  drawSpectrum,
  drawVector,
  drawWaveform,
  fitCanvas,
  makeSampler,
  meterFromAnalyser,
  timecode,
} from './scopes';
import type { TourCopy, TourStep } from './copy';

/** Defect marks burned into the tape ruler, in seconds. */
const TAPE_MARKS = [
  { t: 16, label: 'DEAD AIR' },
  { t: 20, label: 'BLACK' },
  { t: 24, label: 'CLIP' },
  { t: 29, label: 'SKIN' },
  { t: 34, label: 'HUM' },
];

interface ArrivalStageProps {
  copy: TourCopy;
  step: TourStep;
  index: number;
}

const ArrivalStage: React.FC<ArrivalStageProps> = ({ copy, step, index }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const paradeRef = useRef<HTMLCanvasElement>(null);
  const vectorRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const tcRef = useRef<HTMLSpanElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const rmsRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLSpanElement>(null);

  const samplerRef = useRef<ReturnType<typeof makeSampler> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioGraphRef = useRef<{ src: MediaElementAudioSourceNode; gain: GainNode } | null>(null);
  const spectrumState = useRef<{ scratch: Uint8Array | null; shift: number }>({ scratch: null, shift: 0 });
  const meterScratch = useRef<Uint8Array | null>(null);
  const segmentRef = useRef<[number, number]>(step.seek);
  const [armed, setArmed] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);

  segmentRef.current = step.seek;

  /* ---------- audio: arm on first user gesture (autoplay-safe) ---------- */
  const armAudio = useCallback(() => {
    if (audioGraphRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const src = ctx.createMediaElementSource(video);
      const gain = ctx.createGain();
      gain.gain.value = 0; // the tape never makes noise; the analyser still sees it
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.62;
      src.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      audioGraphRef.current = { src, gain };
      analyserRef.current = analyser;
      video.muted = false;
      void ctx.resume();
      setArmed(true);
    } catch {
      // WebAudio unavailable: the video scopes still work, spectrum stays idle.
    }
  }, []);

  useEffect(() => {
    const onGesture = () => armAudio();
    window.addEventListener('pointerdown', onGesture, { once: true, passive: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [armAudio]);

  useEffect(() => {
    return () => {
      audioGraphRef.current?.src.disconnect();
      audioGraphRef.current?.gain.disconnect();
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
      audioGraphRef.current = null;
    };
  }, []);

  /* ---------- playback: keep the tape inside the active chapter ---------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const [start] = step.seek;
    const seekAndPlay = () => {
      try {
        video.currentTime = start;
      } catch {
        /* metadata not ready yet; the loadedmetadata handler retries */
      }
      video.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true));
    };
    if (video.readyState >= 1) seekAndPlay();
    else video.addEventListener('loadedmetadata', seekAndPlay, { once: true });
  }, [step.seek]);

  const startTape = () => {
    const video = videoRef.current;
    if (!video) return;
    armAudio();
    video.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true));
  };

  /* ---------- render loop ---------- */
  useEffect(() => {
    let raf = 0;
    let last = 0;
    if (!samplerRef.current) samplerRef.current = makeSampler();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const video = videoRef.current;
      if (!video) return;

      const [segStart, segEnd] = segmentRef.current;
      if (video.currentTime > segEnd) {
        try {
          video.currentTime = segStart;
        } catch {
          /* ignore */
        }
      }

      if (tcRef.current) tcRef.current.textContent = timecode(video.currentTime);
      if (headRef.current && video.duration) {
        headRef.current.style.left = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
      }

      if (now - last < 33) return; // ~30 fps is plenty for a 90p sample
      last = now;

      const img = samplerRef.current?.sample(video);
      const wave = waveRef.current;
      const parade = paradeRef.current;
      const vector = vectorRef.current;
      const spec = specRef.current;

      const prep = (canvas: HTMLCanvasElement | null) => {
        if (!canvas) return null;
        const { w, h, dpr } = fitCanvas(canvas);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, w, h };
      };

      const waveC = prep(wave);
      if (waveC) {
        if (img) drawWaveform(waveC.ctx, img, waveC.w, waveC.h, DEFAULT_PALETTE);
        else drawIdle(waveC.ctx, waveC.w, waveC.h, DEFAULT_PALETTE, 'NO SIGNAL');
      }

      const paradeC = prep(parade);
      if (paradeC) {
        if (img) drawParade(paradeC.ctx, img, paradeC.w, paradeC.h, DEFAULT_PALETTE);
        else drawIdle(paradeC.ctx, paradeC.w, paradeC.h, DEFAULT_PALETTE, 'NO SIGNAL');
      }

      const vectorC = prep(vector);
      if (vectorC) {
        if (img) drawVector(vectorC.ctx, img, vectorC.w, vectorC.h, DEFAULT_PALETTE);
        else drawIdle(vectorC.ctx, vectorC.w, vectorC.h, DEFAULT_PALETTE, 'AWAITING FRAME');
      }

      const specC = prep(spec);
      if (specC) {
        if (analyserRef.current) drawSpectrum(specC.ctx, analyserRef.current, specC.w, specC.h, DEFAULT_PALETTE, spectrumState.current);
        else drawIdle(specC.ctx, specC.w, specC.h, DEFAULT_PALETTE, 'AUDIO IDLE');
      }

      const meter = meterFromAnalyser(analyserRef.current, meterScratch.current);
      if (meterScratch.current === null && analyserRef.current) {
        meterScratch.current = new Uint8Array(analyserRef.current.fftSize);
      }
      if (rmsRef.current) {
        const dbfs = Number.isFinite(meter.rms) ? meter.rms : -60;
        const pct = Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
        rmsRef.current.style.width = `${pct}%`;
        rmsRef.current.dataset.hot = dbfs > -6 ? 'true' : 'false';
      }
      if (peakRef.current) {
        peakRef.current.textContent = Number.isFinite(meter.peak) ? meter.peak.toFixed(1) : '—';
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="stage" data-focus={step.focus} data-step={step.id} data-index={index}>
      <div className="stage__bar">
        <span className="stage__tape">{copy.tapeLabel}</span>
        {step.flag && <span className="stage__flag">{step.flag}</span>}
        <span className="stage__tc tnum" ref={tcRef}>
          00:00:00:00
        </span>
        <span className="stage__rec">
          <i aria-hidden="true" /> {copy.live}
        </span>
      </div>

      <div className="stage__picture">
        <video
          ref={videoRef}
          className="stage__video"
          poster="/demo/tape-poster.jpg"
          muted
          playsInline
          loop={false}
          preload="auto"
          aria-label={copy.tapeLabel}
        >
          <source src="/demo/tape.mp4" type="video/mp4" />
          <source src="/demo/tape.webm" type="video/webm" />
        </video>
        <div className="stage__scan" aria-hidden="true" />
        {step.id === 'desk' && (
          <div className="stage__keys" aria-hidden="true">
            <span className="keycap">J</span>
            <span className="keycap">K</span>
            <span className="keycap">L</span>
            <em>{copy.keys.scrub}</em>
            <span className="keycap">T</span>
            <em>{copy.keys.mark}</em>
            <span className="keycap">Ctrl</span>
            <span className="keycap">S</span>
            <em>{copy.keys.save}</em>
          </div>
        )}
        <div className="stage__corner stage__corner--tl" aria-hidden="true" />
        <div className="stage__corner stage__corner--br" aria-hidden="true" />
        {needsPlay && (
          <button type="button" className="stage__run" onClick={startTape}>
            <span aria-hidden="true">▶</span> {copy.runTape}
          </button>
        )}
      </div>

      <div className="stage__scopes">
        <figure className="scope scope--wave">
          <figcaption className="scope__head">
            <span>{copy.monitorLabels.waveform}</span>
            <span className="scope__note">{copy.monitors.waveformNote}</span>
          </figcaption>
          <canvas ref={waveRef} className="scope__canvas" />
        </figure>

        <figure className="scope scope--parade">
          <figcaption className="scope__head">
            <span>{copy.monitorLabels.parade}</span>
            <span className="scope__note">{copy.monitors.paradeNote}</span>
          </figcaption>
          <canvas ref={paradeRef} className="scope__canvas" />
        </figure>

        <figure className="scope scope--vector">
          <figcaption className="scope__head">
            <span>{copy.monitorLabels.vector}</span>
            <span className="scope__note">{copy.monitors.vectorNote}</span>
          </figcaption>
          <canvas ref={vectorRef} className="scope__canvas" />
        </figure>

        <figure className="scope scope--spec">
          <figcaption className="scope__head">
            <span>{copy.monitorLabels.spectrum}</span>
            <span className="scope__note">
              {armed ? copy.monitors.spectrumNote : <em className="scope__idle">{copy.audioIdle}</em>}
            </span>
          </figcaption>
          <canvas ref={specRef} className="scope__canvas" />
        </figure>

        <figure className="scope scope--level">
          <figcaption className="scope__head">
            <span>{copy.monitorLabels.level}</span>
            <span className="scope__note tnum">
              <span ref={peakRef}>—</span> peak
            </span>
          </figcaption>
          <div className="level">
            <div className="level__track">
              <div className="level__rms" ref={rmsRef} />
            </div>
            <div className="level__scale tnum" aria-hidden="true">
              <span>−60</span>
              <span>−30</span>
              <span>−18</span>
              <span>−6</span>
              <span>0</span>
            </div>
          </div>
        </figure>
      </div>

      {step.id === 'paper' && (
        <div className="stage__paper">
          <div className="paper__head">
            <span>{copy.paper.title}</span>
            <span className="paper__meta">{copy.paper.meta}</span>
          </div>
          <ul className="paper__rows">
            {copy.paper.rows.map((r) => (
              <li key={r.tc} className="paper__row">
                <span className="tnum">{r.tc}</span>
                <span className="paper__what">{r.what}</span>
                <span className={r.verdict === 'FAIL' ? 'paper__verdict is-fail' : 'paper__verdict is-warn'}>
                  {r.verdict}
                </span>
              </li>
            ))}
          </ul>
          <div className="paper__foot">{copy.paper.signed}</div>
        </div>
      )}

      <div className="ruler" aria-hidden="true">
        <div className="ruler__ticks" />
        {TAPE_MARKS.map((m) => (
          <span key={m.t} className="ruler__mark" style={{ left: `${(m.t / 40) * 100}%` }} title={m.label} />
        ))}
        <div className="ruler__head" ref={headRef} />
      </div>
    </div>
  );
};

export default ArrivalStage;

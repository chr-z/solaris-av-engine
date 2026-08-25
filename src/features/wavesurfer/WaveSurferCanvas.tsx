// Solaris v3 — F6 troca #1: renderer wavesurfer.js v7 (chunk LAZY).
//
// Este módulo só é baixado via import() dinâmico quando o timeline tem
// peaks prontos — o chunk do wavesurfer (~12.5KB gzip) nunca entra no
// bundle inicial. O fallback para o render legado fica no pai
// (WaveformTimeline) e cobre: chunk falhando, sem peaks ou ambiente sem
// canvas (testes/jsdom mockam este componente).
//
// Cor dB-por-barra: o v7 converte waveColor array em GRADIENTE vertical,
// então usamos renderFunction + geometria pura de waveformRender.ts —
// mesmo visual por barra do render legado, agora com zoom/peaks nativos.
import React, { useEffect, useRef, useState } from 'react';
import type WaveSurferType from 'wavesurfer.js';
import {
  buildWaveSurferOptions,
  resamplePeaksMax,
  computeBarGeometry,
  paintBars,
} from './waveformRender';

interface WaveSurferCanvasProps {
  /** Peaks normalizados 0..1 vindos do useAudioWaveform (cache preservado). */
  peaks: number[];
  duration: number;
  currentTime: number;
}

/**
 * Desenha as barras num canvas próprio do wavesurfer e sincroniza o
 * playhead via setTime. Seek/drag continuam sendo tratados pelo PAI
 * (handlers de mouse já existentes) — aqui é só render.
 */
const WaveSurferCanvas: React.FC<WaveSurferCanvasProps> = ({
  peaks,
  duration,
  currentTime,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Instância viva em ref para os effects lerem sem recriar o ws.
  const wsRef = useRef<WaveSurferType | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);

  // Criação única + carga dos peaks.
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container || peaks.length === 0 || !(duration > 0)) return;

    (async () => {
      try {
        const { default: WaveSurfer } = await import('wavesurfer.js');
        if (cancelled || !containerRef.current) return;

        // Max-pooling determinístico preserva transientes (clip de 20ms
        // não some); densidade alta o suficiente p/ painel de QC.
        const sampled = resamplePeaksMax(peaks, 1200);
        const options = buildWaveSurferOptions({
          height: 32, // h-8 do painel legado
          barWidth: 2,
          barGap: 1,
        });

        const ws = WaveSurfer.create({
          ...options,
          container: containerRef.current,
          // Cor dB-por-barra: desenhamos nós (array em waveColor seria
          // gradiente vertical). O v7 clona o desenho pro canvas de
          // progresso, então a régua azul acompanha as mesmas barras.
          renderFunction: (channelData: Float32Array[], style: unknown) => {
            const canvas = (style as { canvas?: HTMLCanvasElement }).canvas;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            const bars = computeBarGeometry({
              widthCss: canvas.clientWidth || canvas.width,
              heightCss: 32,
              pixelRatio: window.devicePixelRatio || 1,
              barWidthCss: 2,
              barGapCss: 1,
              sampledPeaks: Array.from(channelData[0] ?? []),
            });
            paintBars(
              ctx as unknown as Parameters<typeof paintBars>[0],
              bars,
            );
          },
          // Seek é responsabilidade do pai (handlers de mouse unificados).
          dragToSeek: false,
        } as never);

        wsRef.current = ws;
        readyRef.current = false;

        ws.on('ready', () => {
          if (cancelled) return;
          readyRef.current = true;
          setReady(true);
        });

        // url vazio + channelData => zero rede, decode local dos peaks.
        await ws.load('', [Float32Array.from(sampled)], duration);
      } catch (err) {
        // Falha do chunk/deco: sinaliza pro pai cair no fallback legado.
        if (!cancelled) {
          console.warn('[wavesurfer] falha ao inicializar:', err);
          window.dispatchEvent(new CustomEvent('solaris:waveform-fallback'));
        }
      }
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      const ws = wsRef.current;
      wsRef.current = null;
      setReady(false);
      try {
        ws?.destroy();
      } catch {
        /* destroy duplo tolerado */
      }
    };
    // peaks/duration mudam => recarrega (nova mídia). currentTime NÃO está
    // aqui de propósito: playhead é sincronizado no effect abaixo.
  }, [peaks, duration]);

  // Playhead: espelha currentTime no cursor/progressão do ws.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !readyRef.current) return;
    try {
      ws.setTime(currentTime);
    } catch {
      /* antes do ready o setTime é ignorado mesmo */
    }
  }, [currentTime, ready]);

  return (
    <div
      ref={containerRef}
      data-testid="wavesurfer-canvas"
      className="absolute inset-0"
      aria-hidden="true"
    />
  );
};

export default WaveSurferCanvas;

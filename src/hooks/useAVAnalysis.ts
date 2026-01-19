import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnalysisData, VideoAnalysisData } from '../types';

const INITIAL_ANALYSIS_DATA: AnalysisData = {
  video: null,
  volume: 0,
  frequency: null,
};

const ANALYSIS_FPS = 15;
const ANALYSIS_INTERVAL = 1000 / ANALYSIS_FPS;

export const useAVAnalysis = (videoRef: React.RefObject<HTMLVideoElement>, videoSrc: string | null) => {
  const [analysisData, setAnalysisData] = useState<AnalysisData>(INITIAL_ANALYSIS_DATA);
  const [isAudioReady, setIsAudioReady] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const intervalIdRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const cleanupAudio = useCallback(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    // Aggressively close context to prevent hardware limit errors (max 6 contexts usually)
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(e => console.error("Error closing AudioContext:", e));
    }
    audioContextRef.current = null;
    setIsAudioReady(false);
  }, []);

  const cleanup = useCallback(() => {
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = 0;
    }
    cleanupAudio();
  }, [cleanupAudio]);

  const runVideoAnalysis = useCallback((): VideoAnalysisData | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.readyState < 2) {
      return null;
    }

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const offscreenCanvas = canvasRef.current;
    // 'willReadFrequently' is critical for performance when calling getImageData loop
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) return null;

    const analysisWidth = 128;
    const analysisHeight = Math.round(analysisWidth * (video.videoHeight / video.videoWidth));
    
    if (offscreenCanvas.width !== analysisWidth || offscreenCanvas.height !== analysisHeight) {
      offscreenCanvas.width = analysisWidth;
      offscreenCanvas.height = analysisHeight;
    }
    
    try {
      ctx.drawImage(video, 0, 0, analysisWidth, analysisHeight);
      const pixels = ctx.getImageData(0, 0, analysisWidth, analysisHeight);
      return {
          width: pixels.width,
          height: pixels.height,
          data: pixels.data
      };
    } catch(e) {
      console.error("Frame analysis failed (CORS restriction likely).", e);
      return null;
    }
  }, [videoRef]);
    
  const setupAudio = useCallback(() => {
    const videoElement = videoRef.current;
    if (!videoElement || sourceNodeRef.current) return;

    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioContext = audioContextRef.current;
      
      if (audioContext.state === 'suspended') {
          audioContext.resume();
      }
      
      analyserRef.current = audioContext.createAnalyser();
      analyserRef.current.fftSize = 512;
      analyserRef.current.smoothingTimeConstant = 0.2;
      
      sourceNodeRef.current = audioContext.createMediaElementSource(videoElement);
      sourceNodeRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContext.destination);
      setIsAudioReady(true);
    } catch (e) {
        console.warn("Audio analysis init failed. Video might be muted or trackless.", e);
        cleanupAudio();
    }
  }, [videoRef, cleanupAudio]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !videoSrc) {
      cleanup();
      setAnalysisData(INITIAL_ANALYSIS_DATA);
      return;
    }

    const loop = () => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended) {
        if (intervalIdRef.current) {
          clearInterval(intervalIdRef.current);
          intervalIdRef.current = 0;
        }
        return;
      }

      const newVideoData = runVideoAnalysis();
      let newVolume = 0;
      let newFrequencyData = null;

      if (analyserRef.current) {
        const analyser = analyserRef.current;
        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(frequencyData);
        newFrequencyData = frequencyData;

        const timeDomainData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(timeDomainData);
        let peak = 0.0;
        for (const amplitude of timeDomainData) {
            const val = Math.abs((amplitude / 128.0) - 1.0);
            if (val > peak) peak = val;
        }
        newVolume = peak;
      }
      
      setAnalysisData(prev => ({
          volume: analyserRef.current ? newVolume : prev.volume,
          frequency: analyserRef.current ? newFrequencyData : prev.frequency,
          video: newVideoData ?? prev.video
      }));
    };

    const startLoop = () => {
        if (!intervalIdRef.current && videoElement && !videoElement.paused) {
            intervalIdRef.current = window.setInterval(loop, ANALYSIS_INTERVAL);
        }
    };

    const handlePlay = () => {
        setupAudio();
        startLoop();
    };

    const handlePauseOrEnd = () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = 0;
      }
    };
    
    const analyzeStaticFrame = () => {
        setTimeout(() => {
            const newVideoData = runVideoAnalysis();
            if (newVideoData) {
                setAnalysisData(prev => ({ ...prev, video: newVideoData }));
            }
        }, 50);
    };

    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePauseOrEnd);
    videoElement.addEventListener('ended', handlePauseOrEnd);
    videoElement.addEventListener('seeked', analyzeStaticFrame);
    videoElement.addEventListener('loadeddata', analyzeStaticFrame);
    videoElement.addEventListener('emptied', cleanup);

    if (videoElement.readyState >= 2 && videoElement.paused) {
        analyzeStaticFrame();
    }

    return () => {
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePauseOrEnd);
      videoElement.removeEventListener('ended', handlePauseOrEnd);
      videoElement.removeEventListener('seeked', analyzeStaticFrame);
      videoElement.removeEventListener('loadeddata', analyzeStaticFrame);
      videoElement.removeEventListener('emptied', cleanup);
      cleanup();
    };
  }, [videoRef, videoSrc, setupAudio, cleanup, runVideoAnalysis]);

  return { analysisData, isAudioReady };
};
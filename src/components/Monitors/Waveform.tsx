import React, { useRef, useEffect, useCallback } from 'react';
import { VideoAnalysisData } from '../types';

interface WaveformProps {
  pixelData: VideoAnalysisData | null;
  isZoomed?: boolean;
}

const Waveform: React.FC<WaveformProps> = ({ pixelData, isZoomed = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pixelDataRef = useRef(pixelData);
  pixelDataRef.current = pixelData;
  const histogramRef = useRef<Uint32Array | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const currentPixelData = pixelDataRef.current;

    // Use willReadFrequently to optimize for frequent pixel manipulation
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (!ctx || !canvas) return;
    
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    if (canvasWidth === 0 || canvasHeight === 0) return;

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (isZoomed) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.font = '12px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        for (let i = 0; i <= 10; i++) {
            const y = canvasHeight - (i / 10) * canvasHeight;
            const sharpY = Math.round(y) + 0.5;

            ctx.beginPath();
            ctx.moveTo(0, sharpY);
            ctx.lineTo(canvasWidth, sharpY);
            ctx.stroke();

            if (i > 0) {
                 const textY = y > 20 ? y - 10 : y + 10;
                 ctx.fillText(`${i * 10}%`, 8, textY);
            }
        }
        ctx.restore();
    }
    
    if (!currentPixelData) {
      return;
    }

    const { width, height, data } = currentPixelData;
    
    const histSize = canvasWidth * 256;
    if (!histogramRef.current || histogramRef.current.length !== histSize) {
        histogramRef.current = new Uint32Array(histSize);
    }
    const histogram = histogramRef.current;
    histogram.fill(0);

    let maxVal = 1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // Calculate Luma (Y) component
        const luma = Math.floor(0.299 * r + 0.587 * g + 0.114 * b);
        
        const histX = Math.floor((x / width) * canvasWidth);
        const index = histX * 256 + luma;
        histogram[index]++;
        if(histogram[index] > maxVal) maxVal = histogram[index];
      }
    }
    
    // Draw Luma Trace
    ctx.fillStyle = '#a0ffa0';
    for (let x = 0; x < canvasWidth; x++) {
        for (let y = 0; y < 256; y++) {
            const magnitude = histogram[x * 256 + y];
            if (magnitude > 0) {
                // Logarithmic intensity scaling for better visibility
                const alpha = Math.min(1.0, Math.log(magnitude + 1) / Math.log(maxVal + 1) * 2);
                ctx.globalAlpha = alpha;
                ctx.fillRect(x, canvasHeight - (y / 255) * canvasHeight, 1, Math.ceil(canvasHeight/255));
            }
        }
    }
    ctx.globalAlpha = 1.0;

  }, [isZoomed]);
  
  useEffect(() => {
    redraw();
  }, [pixelData, redraw]);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          redraw();
        }
      }
    });

    resizeObserver.observe(container);
    
    const { width, height } = container.getBoundingClientRect();
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    redraw();
    
    return () => resizeObserver.disconnect();
  }, [redraw]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full bg-gray-900 rounded-md"></canvas>
    </div>
  );
};

export default Waveform;
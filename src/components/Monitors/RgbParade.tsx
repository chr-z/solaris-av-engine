import React, { useRef, useEffect, useCallback } from 'react';
import { VideoAnalysisData } from '../../types';

interface RgbParadeProps {
  pixelData: VideoAnalysisData | null;
  isZoomed?: boolean;
}

const RgbParade: React.FC<RgbParadeProps> = ({ pixelData, isZoomed = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pixelDataRef = useRef(pixelData);
  pixelDataRef.current = pixelData;
  const histogramsRef = useRef<{ r: Uint32Array | null; g: Uint32Array | null; b: Uint32Array | null; }>({ r: null, g: null, b: null });

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const currentPixelData = pixelDataRef.current;
    
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

    const paradeWidth = Math.floor(canvasWidth / 3);
    if (paradeWidth <= 0) return;

    const histSize = 256 * paradeWidth;
    
    if (!histogramsRef.current.r || histogramsRef.current.r.length !== histSize) {
        histogramsRef.current.r = new Uint32Array(histSize);
        histogramsRef.current.g = new Uint32Array(histSize);
        histogramsRef.current.b = new Uint32Array(histSize);
    }

    const rHistogram = histogramsRef.current.r!;
    const gHistogram = histogramsRef.current.g!;
    const bHistogram = histogramsRef.current.b!;
    
    rHistogram.fill(0);
    gHistogram.fill(0);
    bHistogram.fill(0);
    
    let maxR = 1, maxG = 1, maxB = 1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const paradeX = Math.floor((x / width) * paradeWidth);
        
        rHistogram[paradeX * 256 + r]++;
        gHistogram[paradeX * 256 + g]++;
        bHistogram[paradeX * 256 + b]++;
      }
    }
    
    for (let x = 0; x < paradeWidth; x++) {
        for(let val = 0; val < 256; val++) {
            maxR = Math.max(maxR, rHistogram[x * 256 + val]);
            maxG = Math.max(maxG, gHistogram[x * 256 + val]);
            maxB = Math.max(maxB, bHistogram[x * 256 + val]);
        }
    }

    const drawChannel = (histogram: Uint32Array, offsetX: number, color: string, maxVal: number) => {
      ctx.fillStyle = color;
      for (let x = 0; x < paradeWidth; x++) {
        for (let y = 0; y < 256; y++) {
          const magnitude = histogram[x * 256 + y];
          if (magnitude > 0) {
            const alpha = Math.min(1, Math.log(magnitude + 1) / Math.log(maxVal + 1));
            ctx.globalAlpha = alpha;
            ctx.fillRect(offsetX + x, canvasHeight - (y / 255) * canvasHeight, 1, Math.ceil(canvasHeight/255));
          }
        }
      }
      ctx.globalAlpha = 1.0;
    };

    drawChannel(rHistogram, 0, '#ff0000', maxR);
    drawChannel(gHistogram, paradeWidth, '#00ff00', maxG);
    drawChannel(bHistogram, paradeWidth * 2, '#0000ff', maxB);

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

export default RgbParade;
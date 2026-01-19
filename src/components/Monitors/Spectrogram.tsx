import React, { useRef, useEffect } from 'react';

interface SpectrogramProps {
  frequencyData: Uint8Array | null;
  isReady: boolean;
}

const Spectrogram: React.FC<SpectrogramProps> = ({ frequencyData, isReady }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frequencyData) return;

    // Fast I/O context
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    if (canvasWidth <= 1 || canvasHeight <= 0) return;

    // Shift previous frame left
    const imageData = ctx.getImageData(1, 0, canvasWidth - 1, canvasHeight);
    ctx.putImageData(imageData, 0, 0);

    // Draw new vertical strip
    const barWidth = 1;
    for (let i = 0; i < frequencyData.length; i++) {
      const value = frequencyData[i];
      // Logarithmic mapping for better visual representation of frequencies
      const y = Math.round(Math.pow(1 - (i / frequencyData.length), 2) * (canvasHeight - 1));
      
      const percent = value / 255;
      const hue = 240 - percent * 240; // Heatmap style: Blue (low) -> Red (high)
      ctx.fillStyle = `hsl(${hue}, 100%, ${20 + percent * 60}%)`;
      ctx.fillRect(canvasWidth - barWidth, y, barWidth, 1);
    }
  }, [frequencyData]);
  
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (!isReady) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Audio Unavailable', canvas.width / 2, canvas.height / 2);
        }
    }
  }
  
  useEffect(() => {
    if (!isReady) {
        clearCanvas();
    }
  }, [isReady]);

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
          clearCanvas();
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [isReady]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full bg-gray-900 rounded-md"></canvas>
    </div>
  );
};

export default Spectrogram;
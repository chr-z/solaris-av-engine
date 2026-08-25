// Solaris v3 — Feature Pack "Analista Feliz" — F5 gráfico ao vivo (chunk lazy).
//
// Wrapper mínimo em volta do echarts (dependência npm, nada de CDN —
// offline-first da spec E). Só é baixado quando o painel ao vivo abre,
// então o custo do bundle inicial fica intocado.

import React, { useEffect, useRef } from 'react';
// Import modular (echarts/core): só o que o painel usa — derruba o chunk
// lazy de ~1.1MB para uma fração sem perder nada do gráfico de barras.
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

/** Option aceita qualquer shape suportado pelo setOption (versão-proof). */
type ChartOption = Parameters<echarts.ECharts['setOption']>[0];

export interface EChartsLiveChartProps {
  option: ChartOption;
  /** Altura em px (largura sempre 100%). */
  height?: number;
  testId?: string;
  /** Descrição acessível do gráfico (o canvas em si é opaco p/ leitores). */
  ariaLabel?: string;
}

export default function EChartsLiveChart({
  option,
  height = 280,
  testId = 'live-chart',
  ariaLabel,
}: EChartsLiveChartProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // Init uma vez; dispose no unmount. Em ambientes sem canvas (testes/jsdom)
  // init pode falhar — o painel segue útil sem o desenho.
  useEffect(() => {
    if (!containerRef.current) return undefined;
    try {
      chartRef.current = echarts.init(containerRef.current);
    } catch {
      chartRef.current = null;
    }
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      chartRef.current?.setOption(option);
    } catch {
      /* ambiente sem renderer: ignora */
    }
  }, [option]);

  useEffect(() => {
    const onResize = (): void => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      role="img"
      aria-label={ariaLabel}
      style={{ width: '100%', height }}
    />
  );
}

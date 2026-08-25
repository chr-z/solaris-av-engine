// Solaris v3 — F6 troca #1: integração WaveformTimeline com renderer lazy v7.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import WaveformTimeline from '../components/Monitors/WaveformTimeline';

// Renderer v7 mockado: provamos a WIRING (lazy mount/unmount/fallback),
// não o canvas em si (wavesurfer real precisa de canvas 2D medível).
vi.mock('../features/wavesurfer/WaveSurferCanvas', () => ({
  default: (props: { duration: number; currentTime: number }) => (
    <div
      data-testid="ws-canvas"
      data-duration={props.duration}
      data-current={props.currentTime}
    />
  ),
}));

const LEGACY_BAR_SELECTOR = 'div[class*="w-[2px]"]';

describe('F6 WaveformTimeline — renderer v7 lazy com fallback legado', () => {
  beforeEach(() => {
    cleanup();
  });

  const baseProps = {
    duration: 100,
    currentTime: 25,
    onSeek: () => undefined,
    waveform: [0.1, 0.5, 0.9],
    isLoading: false,
  };

  it('com peaks prontos monta o renderer v7 e esconde barras/régua legadas', async () => {
    const { container } = render(<WaveformTimeline {...baseProps} />);
    const canvas = await screen.findByTestId('ws-canvas');
    expect(canvas).toBeTruthy();
    expect((canvas as HTMLElement).dataset.duration).toBe('100');
    // legado fora do ar enquanto o v7 está de pé
    expect(container.querySelector(LEGACY_BAR_SELECTOR)).toBeNull();
    // régua de progresso legada também não deve pintar por cima
    expect(
      container.querySelector('div[class*="bg-solar-accent/60"]'),
    ).toBeNull();
    // scrubber continua existindo nos dois modos
    expect(
      container.querySelector('div[class*="bg-white rounded-full"]'),
    ).not.toBeNull();
  });

  it('isLoading mostra spinner e NÃO monta o v7', () => {
    const { container } = render(
      <WaveformTimeline {...baseProps} isLoading={true} />,
    );
    expect(screen.queryByTestId('ws-canvas')).toBeNull();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('sem peaks não há v7 nem barras (estado neutro sem crash)', () => {
    const { container } = render(
      <WaveformTimeline {...baseProps} waveform={[]} />,
    );
    expect(screen.queryByTestId('ws-canvas')).toBeNull();
    expect(container.querySelector(LEGACY_BAR_SELECTOR)).toBeNull();
    expect(container.textContent).toBeDefined();
  });

  it('evento de fallback derruba o v7 e volta às barras legadas', async () => {
    const { container } = render(<WaveformTimeline {...baseProps} />);
    await screen.findByTestId('ws-canvas');

    act(() => {
      window.dispatchEvent(new Event('solaris:waveform-fallback'));
    });

    expect(screen.queryByTestId('ws-canvas')).toBeNull();
    const bars = container.querySelectorAll(LEGACY_BAR_SELECTOR);
    expect(bars.length).toBe(3); // uma barra por peak
    // régua de progresso legada volta junto (playhead visível)
    expect(
      container.querySelector('div[class*="bg-solar-accent/60"]'),
    ).not.toBeNull();
  });

  it('trocar a mídia (nova referência de peaks) reabilita o v7 após fallback', async () => {
    const first = [0.1, 0.5];
    const second = [0.2, 0.8, 0.3];
    const { rerender, container } = render(
      <WaveformTimeline {...baseProps} waveform={first} />,
    );

    act(() => {
      window.dispatchEvent(new Event('solaris:waveform-fallback'));
    });
    expect(container.querySelectorAll(LEGACY_BAR_SELECTOR).length).toBe(2);

    rerender(<WaveformTimeline {...baseProps} waveform={second} />);
    expect(await screen.findByTestId('ws-canvas')).toBeTruthy();
    expect(container.querySelector(LEGACY_BAR_SELECTOR)).toBeNull();
  });

  it('scrubber reflete currentTime proporcional à duração', () => {
    const { container } = render(
      <WaveformTimeline {...baseProps} currentTime={50} duration={200} />,
    );
    const knob = container.querySelector(
      'div[class*="bg-white rounded-full"]',
    ) as HTMLElement | null;
    expect(knob).not.toBeNull();
    expect(knob!.style.left).toBe('25%'); // 50/200
  });

  it('seek por mouse converte posição em tempo', () => {
    const onSeek = vi.fn();
    const { container } = render(
      <WaveformTimeline {...baseProps} onSeek={onSeek} duration={100} />,
    );
    const strip = container.firstElementChild as HTMLElement;
    // jsdom: getBoundingClientRect zera tudo — mockamos manualmente
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 500,
      top: 0,
      height: 48,
      right: 500,
      bottom: 48,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    } as DOMRect);
    fireEvent.mouseDown(strip, { clientX: 250 }); // metade → 50s
    expect(onSeek).toHaveBeenCalledWith(50);
  });
});

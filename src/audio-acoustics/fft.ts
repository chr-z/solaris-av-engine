/**
 * FFT radix-2 iterativa, zero deps, precisa (Float64).
 * Twiddles pré-computados por instância — reuse o objeto FFT para muitos frames.
 */

/** Janela Hann periódica (amplitude zero nas bordas, adequada para STFT/OLA). */
export function hannWindow(N: number): Float64Array {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N));
  return w;
}

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export class FFT {
  readonly n: number;
  private readonly levels: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;

  constructor(n: number) {
    if (!isPow2(n)) throw new Error(`FFT: n deve ser potência de 2, recebido ${n}`);
    this.n = n;
    this.levels = Math.round(Math.log2(n));
    this.cosTable = new Float64Array(n / 2);
    this.sinTable = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / n);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }

  /** FFT in-place (forward). re/im devem ter length == n. */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    if (re.length !== n || im.length !== n) throw new Error('FFT: buffers de tamanho errado');

    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
      const j = reverseBits(i, this.levels);
      if (j > i) {
        let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }

    // Borboletas
    for (let size = 2; size <= n; size *= 2) {
      const halfsize = size / 2;
      const tablestep = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
          const l = j + halfsize;
          const tpre = re[l] * this.cosTable[k] + im[l] * this.sinTable[k];
          const tpim = -re[l] * this.sinTable[k] + im[l] * this.cosTable[k];
          re[l] = re[j] - tpre;
          im[l] = im[j] - tpim;
          re[j] += tpre;
          im[j] += tpim;
        }
      }
    }
  }

  /** IFFT in-place (truque do conjugado + escala 1/n). */
  inverse(re: Float64Array, im: Float64Array): void {
    for (let i = 0; i < this.n; i++) im[i] = -im[i];
    this.transform(re, im);
    const inv = 1 / this.n;
    for (let i = 0; i < this.n; i++) {
      re[i] *= inv;
      im[i] = -im[i];
    }
  }

  /** Espectro de magnitude (bins 0..n/2) de um sinal real, com janela opcional. */
  magnitudeSpectrum(samples: Float64Array | Float32Array, win?: Float64Array): Float64Array {
    const n = this.n;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const len = Math.min(samples.length, n);
    for (let i = 0; i < len; i++) re[i] = win ? samples[i] * win[i] : samples[i];
    this.transform(re, im);
    const mags = new Float64Array(n / 2 + 1);
    for (let i = 0; i <= n / 2; i++) mags[i] = Math.hypot(re[i], im[i]);
    return mags;
  }
}

function reverseBits(x: number, bits: number): number {
  let y = 0;
  for (let i = 0; i < bits; i++) {
    y = (y << 1) | (x & 1);
    x >>>= 1;
  }
  return y;
}

/**
 * Escolhe tamanho de FFT (potência de 2) que comporta o kernel INTEIRO.
 * Lição P2: truncar o kernel em fftSize/2 corta a cauda da IR e fabrica um
 * reverb falso-curto (RT60 1.2s media 0.2s) — o teste vira mentira dele mesmo.
 */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Convolução por overlap-add (FFT), circular-safe para IRs curtas ou longas. */
export function convolveFFTOla(
  signal: Float64Array,
  kernel: Float64Array,
  fftSize = 16384
): Float64Array {
  const K = kernel.length;
  // A FFT precisa comportar kernel inteiro + bloco: size >= 2*K garante
  // bloco útil de ~K samples sem aliasing circular.
  const size = Math.max(fftSize, nextPow2(2 * K));
  if (!isPow2(size)) throw new Error('convolveFFTOla: fftSize deve ser potência de 2');
  const fft = new FFT(size);

  // Kernel completo no domínio da frequência (zero-pad até size)
  const kre = new Float64Array(size);
  const kim = new Float64Array(size);
  for (let i = 0; i < K; i++) kre[i] = kernel[i];
  fft.transform(kre, kim);

  const outLen = signal.length + K - 1; // overlap-add: output = sig + ir - 1 samples
  const out = new Float64Array(outLen);
  const blockSize = size - K + 1; // overlap-add sem aliasing

  const bre = new Float64Array(size);
  const bim = new Float64Array(size);
  for (let start = 0; start < signal.length; start += blockSize) {
    const len = Math.min(blockSize, signal.length - start);
    bre.fill(0); bim.fill(0);
    for (let i = 0; i < len; i++) bre[i] = signal[start + i];
    fft.transform(bre, bim);
    for (let i = 0; i < size; i++) {
      const re = bre[i] * kre[i] - bim[i] * kim[i];
      bim[i] = bre[i] * kim[i] + bim[i] * kre[i];
      bre[i] = re;
    }
    fft.inverse(bre, bim);
    for (let i = 0; i < Math.min(len + K - 1, size); i++) {
      out[start + i] += bre[i];
    }
  }
  return out.subarray(0, outLen) as Float64Array;
}

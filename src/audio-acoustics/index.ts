/** Solaris Audio Acoustics — API pública do motor (P1+P3). */
export {
  FFT,
  hannWindow,
  isPow2,
  convolveFFTOla,
} from './fft';
export {
  rmsTime,
  rmsFromSpectrum,
  spectralFlatness,
  spectralCentroid,
  bandEnergies,
  samplePeak,
  dcOffset,
  amplitudeEnvelope,
  type BandEnergies,
} from './features';
export {
  detectClip,
  estimateTHDFromSpectrum,
  type ClipResult,
} from './clipping';
export {
  detectHum,
  estimateNoiseFloorDb,
  percentile,
  sibilanceRatioDb,
  type HumResult,
} from './noise';
export { detectEcho, type EchoResult } from './echo';
export {
  analyzeReverb,
  type ReverbResult,
} from './reverb';
export {
  classifyReverb,
  type ReverbResult as ReverbResultType,
} from './reverb';
export * from './fixtures';
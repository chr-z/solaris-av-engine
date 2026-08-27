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
  extractReverbFeatureVector,
  extractReverbFeaturesDetailed,
  REVERB_ML_FEATURE_COUNT,
  type Rt60DetectorSnapshot,
} from './reverbFeatures';
export {
  analyzeReverbWithML,
  reverbMlPredict,
  reverbMlEligible,
  setReverbMlRuntime,
  type ReverbMlResult,
  type ReverbMlRuntime,
} from './reverbMl';
export {
  classifyReverb,
  type ReverbResult as ReverbResultType,
} from './reverb';
export * from './fixtures';
export {
  analyzeAudioPcm,
  analyzeAudio,
  AnalysisCancelledError,
  AcousticShiftAccumulator,
  type AcousticReport,
  type AcousticOptions,
  type AcousticProgress,
  type AcousticStage,
  type AcousticShift,
  type AxisResult,
  type TimelineMark,
  type Severity,
  type StudioBaseline,
} from './audioAcoustics';
export {
  getStudioBaseline,
  saveStudioBaseline,
  clearStudioBaseline,
  resolveBaselineOptions,
  type StudioAcousticBaseline,
} from './baselineStore';
export {
  createAnalysisCache,
  makeMediaFingerprint,
  type AnalysisCache,
  type AnalysisCacheOptions,
  type CacheStorageLike,
} from './analysisCache';
export {
  runAnalysis,
  runSync,
  setWorkerFactory,
  type AnalysisRun,
  type AnalysisOutcome,
} from './worker/analysisRunner';
export {
  buildAcousticQCSection,
  acousticSheetColumns,
  renderAcousticQCSectionHtml,
  SHEET_COLUMNS_HEADERS,
  ACOUSTIC_AXIS_KEYS,
  type AcousticQCSection,
  type AcousticSheetColumns,
} from './qcIntegration';
export {
  buildPanelRows,
  buildTimelineMarks,
  overallVerdict,
  formatClock,
  canMarkReference,
  referenceFromReport,
  SEVERITY_BAR_CLASS,
  SEVERITY_DOT_CLASS,
  AXIS_LABEL_PT,
  AXIS_LABEL_EN,
  type PanelAxisRow,
  type PanelTimelineMark,
} from './panelModel';
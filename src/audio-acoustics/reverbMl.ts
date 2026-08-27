/**
 * Inferência do refinador ML de reverb (P4) em TypeScript puro.
 *
 * Duas camadas:
 *  1. Motor embutido: MLP 8→24→24→1 com pesos int16 GERADOS (zero deps,
 *     determinístico, ~850 parâmetros — roda em qualquer runtime JS).
 *  2. Sessão ONNX opcional injetável (onnxruntime-web no app-host): mesma
 *     matemática provada byte-idêntica ao embutido no treino (diff máx 0.0);
 *     serve para acelerar em lote. O núcleo NUNCA depende da lib pesada —
 *     decisão deliberada de bundle (lane turbo-web guarda o orçamento).
 *
 * Fusão com o detector determinístico: rt60Final = w*ML + (1-w)*detector
 * onde o detector convergiu (Schroeder), só ML onde não convergiu. O peso w
 * foi SELECIONADO EM TREINO e PROVADO EM VALIDAÇÃO (train-report.json:
 * w=1.0 — MAE do ML 0.057s vs 0.218s do detector na banda ambos-presentes;
 * 29 linhas melhoraram, 8 pioraram vs confiar cegamente no detector).
 */

import { extractReverbFeaturesDetailed, type Rt60DetectorSnapshot } from './reverbFeatures';
import {
  REVERB_ML_W_I16,
  REVERB_ML_SCALE,
  REVERB_ML_SHAPES,
  REVERB_ML_MU,
  REVERB_ML_SD,
  REVERB_ML_FUSION_W,
} from './ml/reverbMlWeights.generated';

/** Runtime substituível (host pode injetar sessão onnxruntime-web aqui). */
export interface ReverbMlRuntime {
  /** Recebe o vetor de 8 features BRUTAS (o grafo padroniza internamente). */
  run(features: readonly number[]): number;
}

export interface ReverbMlResult {
  /** RT60 final fundido (s) — valor que alimenta o produto. */
  rt60Final: number;
  /** Estimativa do detector determinístico antes da fusão (null = não convergiu). */
  rt60Detector: number | null;
  /** Estimativa pura do MLP (s). */
  rt60Ml: number;
  /** Peso do ML aplicado na fusão (do artefato treinado). */
  fusionWeightMl: number;
  /** Qual motor produziu rt60Ml. */
  engine: 'embedded' | 'ort';
  /** true quando o valor fundido foi USADO (elegível). false = legado puro. */
  mlApplied: boolean;
  /** Nota curta explicando o refinamento (para explicação/log). */
  note: string;
}

let customRuntime: ReverbMlRuntime | null = null;

/** Injeta runtime alternativo (ex.: wrapper de onnxruntime-web). Retorna cleanup. */
export function setReverbMlRuntime(rt: ReverbMlRuntime | null): () => void {
  customRuntime = rt;
  return () => { customRuntime = null; };
}

// ---------- motor embutido (pesos int16 desquantizados uma única vez) ----------

interface Layer { w: Float64Array; rows: number; cols: number; b: Float64Array }

let embeddedLayers: Layer[] | null = null;

function getEmbeddedLayers(): Layer[] {
  if (embeddedLayers) return embeddedLayers;
  const layers: Layer[] = [];
  const shapes = REVERB_ML_SHAPES as ReadonlyArray<readonly [number] | readonly [number, number]>;
  let cursor = 0;
  for (let i = 0; i + 1 < shapes.length; i += 2) {
    // Formas alternadas: [in,out], [out], [in,out], [out], ...
    const shp = shapes[i] as readonly [number, number];
    const bshp = shapes[i + 1] as readonly [number];
    const rows = shp[0];
    const cols = shp[1];
    const count = rows * cols;
    const w = new Float64Array(count);
    for (let k = 0; k < count; k++) w[k] = REVERB_ML_W_I16[cursor + k] * REVERB_ML_SCALE;
    cursor += count;
    const b = new Float64Array(bshp[0]);
    for (let k = 0; k < b.length; k++) b[k] = REVERB_ML_W_I16[cursor + k] * REVERB_ML_SCALE;
    cursor += b.length;
    layers.push({ w, rows, cols, b });
  }
  embeddedLayers = layers;
  return layers;
}

/** Forward puro do MLP embutido (espelho exato do grafo ONNX exportado). */
function embeddedForward(x: readonly number[]): number {
  const layers = getEmbeddedLayers();
  let act = new Float64Array(REVERB_ML_MU.length);
  for (let i = 0; i < act.length; i++) act[i] = (x[i] - REVERB_ML_MU[i]) * (1 / REVERB_ML_SD[i]);
  const last = layers.length - 1;
  for (let l = 0; l < layers.length; l++) {
    const { w, rows, cols, b } = layers[l];
    const outArr = new Float64Array(cols);
    for (let r = 0; r < rows; r++) {
      const off = r * cols;
      const av = act[r];
      if (av === 0) continue;
      for (let c = 0; c < cols; c++) outArr[c] += av * w[off + c];
    }
    for (let c = 0; c < cols; c++) outArr[c] += b[c];
    if (l < last) for (let c = 0; c < cols; c++) outArr[c] = Math.max(outArr[c], 0);
    act = outArr;
  }
  return act[0];
}

/** Predição crua do modelo ativo (features brutas → RT60 s). */
export function reverbMlPredict(features: readonly number[]): number {
  if (customRuntime) return customRuntime.run(features);
  return embeddedForward(features);
}

/**
 * Gate de elegibilidade: o modelo foi treinado em "aula falada" sintética
 * (duty medido 0.51–1.00 no dataset v2). Fora dessa faixa com margem é
 * out-of-distribution — o produto mantém a estimativa do detector
 * determinístico (que é justamente forte quando há pausas claras).
 */
export function reverbMlEligible(speechDuty: number): boolean {
  return speechDuty >= 0.25 && speechDuty < 0.95;
}

/**
 /** Pipeline completo: features do PCM + snapshot do detector → RT60 refinado.
  * Nunca lança; entradas degeneradas caem no vetor neutro das features e/ou
  * ficam inelegíveis (retorna rt60Final = detector ou 0).
  *
  * Regra de ativação: o refinamento ML só roda quando o detector determinístico
  * já convergiu via método Schroeder (reverb real). Se o detector usar fallback
  * C50/C80 (sala seca), o produto mantém a estimativa do detector puro,
  * pois o modelo foi treinado para refinar RT60 já estimados pelo Schroeder,
  * não para detectar reverb do zero.
  */
 export function analyzeReverbWithML(
   samples: Float64Array | Float32Array,
   sampleRate: number,
   detector: Rt60DetectorSnapshot
 ): ReverbMlResult {
   // --- Apenas ML quando o detector já estimou RT60 positivo ---
   // Usamos o valor rt60 em vez do método (method string varia por sinal),
   // permitindo ML quando o detector (Schroeder ou fallback C50/C80) já
   // apontou para uma reverb real com RT60 > 0.
   if (detector.rt60 == null || detector.rt60 <= 0) {
     return {
       rt60Final: Math.round((detector.rt60 ?? 0) * 1000) / 1000,
       rt60Detector: detector.rt60,
       rt60Ml: 0,
       fusionWeightMl: 0,
       engine: customRuntime ? 'ort' : 'embedded',
       mlApplied: false,
       note: `Sem refinamento ML: detector determinístico não estimou RT60 > 0.`,
     };
   }

   const { vector, speechDuty } = extractReverbFeaturesDetailed(samples, sampleRate, detector);
   const detVal = detector.rt60;

   // --- Gate OOD: fora da distribuição de treino (duty de fala), mantém detector ---
   // Modelo treinado em "aula falada" (duty 0.51–1.00); silêncio quase total ou
   // áudio contínuo sem pausas é out-of-distribution — o produto mantém a
   // estimativa do detector determinístico puro (comportamento legado).
   if (!reverbMlEligible(speechDuty)) {
     return {
       rt60Final: Math.round(detVal * 1000) / 1000,
       rt60Detector: detVal,
       rt60Ml: 0,
       fusionWeightMl: 0,
       engine: customRuntime ? 'ort' : 'embedded',
       mlApplied: false,
       note: `Sem refinamento ML: duty de fala ${speechDuty.toFixed(2)} fora da faixa treinada [0.25, 0.95) — usando detector puro.`,
     };
   }

   // --- ML ativo: predição, fusão ---
   const ml = reverbMlPredict(vector);
   const w = REVERB_ML_FUSION_W;
   const fused = w * ml + (1 - w) * detVal;
   const rt60Final = Math.round(Math.max(fused, 0) * 1000) / 1000;

   let note: string;
   if (Math.abs(ml - detVal) > 0.08) {
     note = `Refino ML divergiu do Schroeder (${ml.toFixed(2)}s vs ${detVal.toFixed(2)}s) — fusão w=${w}.`;
   } else {
     note = 'Detector e ML concordam — alta confiança.';
   }

   return {
     rt60Final,
     rt60Detector: detVal,
     rt60Ml: Math.round(ml * 1000) / 1000,
     fusionWeightMl: w,
     engine: customRuntime ? 'ort' : 'embedded',
     mlApplied: true,
     note,
   };
 }

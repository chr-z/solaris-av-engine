/**
 * Gerador de dataset p/ treino do refinador ML de reverb (P4). v2
 *
 * Mudanças v2 (após a suíte do produto expor shift de distribuição):
 *  - amplitude contínua 0.14–0.58 (antes: só 0.35–0.55 — o teste L0.15 quebrou)
 *  - padrões de fala contínuos (word/pause uniformes) em vez de 3 ritmos fixos
 *  - round-trip codec REAL em ~40% das amostras (ffmpeg-static: mp3 96k /
 *    m4a 128k) — codec espalha energia p/ pausas e enganava o modelo v1
 *
 * Roda em Node via esbuild (a partir da RAIZ do repo):
 *   npx esbuild tools/reverb-ml/generate-dataset.ts --bundle --platform=node \
 *     --format=cjs --outfile=.tmp-reverb-gen.cjs && node .tmp-reverb-gen.cjs
 *
 * Saídas (tools/reverb-ml/out/):
 *   features.jsonl | meta.json | validation-cases.json
 */

import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSpeechLike, addReverb, addWhiteNoise, makeRng } from '../../src/audio-acoustics/fixtures';
import { analyzeReverb } from '../../src/audio-acoustics/reverb';
import { extractReverbFeatureVector } from '../../src/audio-acoustics/reverbFeatures';

// ATENÇÃO: rodar da RAIZ do repo (o bundle esbuild achata __dirname p/
// node_modules) — caminho resolvido do cwd de execução.
const OUT_DIR = resolve(process.cwd(), 'tools', 'reverb-ml', 'out');

const SR_MAIN = 44100;
const FFMPEG = require(resolve(process.cwd(), 'node_modules/ffmpeg-static')) as string;

/** Round-trip lossy REAL: PCM → wav → mp3/m4a → PCM (mesma taxa). */
function codecRoundTrip(pcm: Float64Array, sr: number, kind: 'mp3' | 'm4a'): Float64Array {
  const dir = mkdtempSync(join(tmpdir(), 'reverbml-'));
  try {
    const wav = join(dir, 'in.wav');
    const out = join(dir, kind === 'mp3' ? 'out.mp3' : 'out.m4a');
    // wav f64 little-endian mono
    const header = Buffer.alloc(44);
    const dataLen = pcm.length * 8;
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLen, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(3, 20); // IEEE float
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sr, 24);
    header.writeUInt32LE(sr * 8, 28);
    header.writeUInt16LE(8, 32);
    header.writeUInt16LE(64, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLen, 40);
    const buf = Buffer.allocUnsafe(dataLen);
    for (let i = 0; i < pcm.length; i++) buf.writeDoubleLE(pcm[i], i * 8);
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(wav, Buffer.concat([header, buf]));
    const br = kind === 'mp3' ? ['-b:a', '96k'] : ['-b:a', '128k'];
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', wav, ...(kind === 'm4a' ? ['-c:a', 'aac'] : []), ...br, out]);
    const decoded = execFileSync(FFMPEG, ['-v', 'error', '-i', out, '-f', 'f64le', '-ac', '1', '-ar', String(sr), 'pipe:1'], { maxBuffer: 256 * 1024 * 1024 });
    const n = Math.min(Math.floor(decoded.length / 8), pcm.length);
    const res = new Float64Array(pcm.length);
    for (let i = 0; i < n; i++) res[i] = decoded.readDoubleLE(i * 8);
    return res;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Row { x: number[]; y: number }

function synthSample(opts: {
  truthRt60: number;
  snrDb: number | null;
  sr: number;
  seed: number;
  codec: 'none' | 'mp3' | 'm4a';
}): Row {
  const { truthRt60, snrDb, sr, seed, codec } = opts;
  const rng = makeRng(seed);
  // Padrão contínuo: 7–10 palavras, durações uniformes (generaliza ritmos).
  const nWords = 7 + Math.floor(rng() * 4);
  const pattern = Array.from({ length: nWords }, () => ({
    word: 0.22 + rng() * 0.63,
    pause: 0.1 + rng() * 0.45,
  }));
  const amp = 0.14 + rng() * 0.44;
  const wetGain = truthRt60 > 0 ? 0.75 + rng() * 0.5 : 0;

  let sig = makeSpeechLike(pattern, sr, amp, seed);
  if (truthRt60 > 0) sig = addReverb(sig, truthRt60, sr, wetGain);
  // v3: ruído DEPOIS do codec — cadeia física realista (sala/mic com ruído →
  // compressão no upload). Na v2 o import de addWhiteNoise existia mas a
  // chamada nunca foi feita: dataset inteiro limpo e casos "n12" de validação
  // eram idênticos aos "clean" (bug achado pela suíte do produto em 26/08).
  if (snrDb !== null) sig = addWhiteNoise(sig, snrDb, seed + 1);
  if (codec !== 'none') sig = codecRoundTrip(sig, sr, codec);

  const det = analyzeReverb(sig, sr);
  const x = extractReverbFeatureVector(sig, sr, {
    rt60: det.rt60Method === 'schroeder' ? det.rt60 : null,
    c50: det.c50,
  });
  return { x, y: truthRt60 };
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const rows: string[] = [];
  const valCases: Array<Record<string, unknown>> = [];

  const rt60s = [0, 0.3, 0.45, 0.6, 0.9, 1.2];
  const noises: Array<number | null> = [null, 20, 12];
  const codecs: Array<'none' | 'mp3' | 'm4a'> = ['none', 'mp3', 'm4a'];
  const nSeeds = 5;

  let idx = 0;
  const detErrs: number[] = [];
  for (const rt of rt60s) {
    for (const snr of noises) {
      for (let s = 0; s < nSeeds; s++) {
        for (const codec of codecs) {
          idx++;
          const seed = 20000 + idx * 13;
          const sr = idx % 5 === 0 ? 48000 : SR_MAIN;
          const row = synthSample({ truthRt60: rt, snrDb: snr, sr, seed, codec });
          rows.push(JSON.stringify(row));
          detErrs.push(Math.abs((row.x[0] || 0) - rt));
          if (s === 0 && (snr === null || snr === 12)) {
            valCases.push({
              name: `rt${String(rt).replace('.', '_')}_s${s}_${snr === null ? 'clean' : `n${snr}`}_${codec}`,
              truthRt60: rt,
              snrDb: snr,
              codec,
              sr,
              seed,
              x: row.x,
            });
          }
        }
      }
    }
  }

  const meanAbsDetErr = detErrs.reduce((a, b) => a + b, 0) / detErrs.length;
  const meta = {
    featureCount: 8,
    count: rows.length,
    featureOrder: ['rt60Det', 'c50', 'envDecay', 'pauseFill', 'tailRatio', 'flatnessPause', 'centroidVar', 'speechDuty'],
    label: 'truthRt60SecDryIsZero',
    meanAbsDetectorError: Number(meanAbsDetErr.toFixed(4)),
    v: 3,
    note: 'v3: ruído branco REAL (snr 20/12) após codec — v2 rotulava snr mas nunca aplicava (dataset todo limpo)',
  };
  writeFileSync(join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(join(OUT_DIR, 'features.jsonl'), rows.join('\n') + '\n');
  writeFileSync(join(OUT_DIR, 'validation-cases.json'), JSON.stringify(valCases, null, 2));
  console.log(`OK ${rows.length} amostras | meanAbsDetectorErr=${meanAbsDetErr.toFixed(3)}s | casos validação=${valCases.length}`);
}

main();

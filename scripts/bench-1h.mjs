// Benchmark P2: 1h de áudio sintético analisado em <90s.
// Gera 1h uma vez (Float32, ~635MB), fatia em 12 blocos de 5min via subarray
// (zero-copy) e cronometra SOMENTE o analyzeAudioPcm de cada bloco.
import { makeSpeechLike } from '../src/audio-acoustics/fixtures';
import { analyzeAudioPcm } from '../src/audio-acoustics/audioAcoustics';

const SR = 44100;
const CHUNK_SEC = 300;

console.log('gerando 1h de fala sintética...');
const tGen0 = Date.now();
const AULA = Array.from({ length: Math.ceil((CHUNK_SEC * 2) / 2) }, () => ({ word: 0.4, pause: 0.6 }));
const totalSec = 3600;
const chunks = [];
for (let start = 0; start < totalSec; start += CHUNK_SEC) {
  const sec = Math.min(CHUNK_SEC, totalSec - start);
  const pattern = Array.from({ length: Math.ceil(sec / 1) }, () => ({ word: 0.4, pause: 0.6 }));
  chunks.push(makeSpeechLike(pattern, SR, 0.5));
}
const genSecs = ((Date.now() - tGen0) / 1000).toFixed(1);
const totalSamples = chunks.reduce((a, c) => a + c.length, 0);
console.log(`gerado: ${totalSamples} samples (${(totalSamples / SR / 60).toFixed(1)} min equivalentes) em ${genSecs}s`);

const t0 = Date.now();
let analyzed = 0;
for (const c of chunks) {
  const tB = Date.now();
  const rep = analyzeAudioPcm(c, SR);
  analyzed += c.length;
  console.log(`bloco ${(analyzed / SR / 60).toFixed(0)}min: ${(Date.now() - tB) / 1000}s | overall=${rep.overallScore}`);
}
const wall = (Date.now() - t0) / 1000;
console.log(`\nTOTAL análise 1h equivalente: ${wall.toFixed(1)}s (alvo <90s) => ${wall < 90 ? 'PASS' : 'FAIL'}`);

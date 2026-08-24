// Cross-check extracted entries vs MVP runtime constants (inconformityScores + categoryMaxScores)
import fs from 'node:fs';
const entries = JSON.parse(fs.readFileSync(new URL('./.extracted.json', import.meta.url), 'utf8'));
const constantsSrc = fs.readFileSync('C:/Yui/data/saas/solaris-web-mvp/utils/constants.ts', 'utf8');

function parseMap(name) {
  const start = constantsSrc.indexOf(`export const ${name}`);
  const bodyStart = constantsSrc.indexOf('{', start);
  let depth = 0, end = bodyStart;
  for (let i = bodyStart; i < constantsSrc.length; i++) {
    if (constantsSrc[i] === '{') depth++;
    if (constantsSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = constantsSrc.slice(bodyStart + 1, end);
  const map = {};
  const re = /'((?:[^'\\]|\\.)+)':\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) map[m[1].replace(/\\'/g, "'")] = Number(m[2]);
  return map;
}

const scores2025 = parseMap('inconformityScores');
const catMax = parseMap('categoryMaxScores');

let mismatches = [];
// Known internal divergence of the MVP itself: catalog (inconformityDetails.ts) vs
// runtime constants.ts have these two scores swapped. Spec says follow the catalog,
// so these two mismatches are tolerated and reported as WARN.
const KNOWN_MVP_DIVERGENCE = new Set(['Ruídos ambiente', 'Ruído de atrito no microfone']);
const warnings = [];
for (const [name, v] of Object.entries(scores2025)) {
  const e = entries.find((x) => x.name === name);
  if (!e) { mismatches.push(`missing entry: ${name}`); continue; }
  if (e.score2025 !== v) {
    const msg = `score2025 ${name}: catalog=${e.score2025} runtime=${v}`;
    if (KNOWN_MVP_DIVERGENCE.has(name)) warnings.push(msg);
    else mismatches.push(msg);
  }
}
for (const e of entries) {
  if (!(e.name in scores2025)) mismatches.push(`entry not in MVP scores: ${e.name}`);
}

const cats = {};
for (const e of entries) {
  cats[e.type] = (cats[e.type] || 0) + e.score2025;
}
for (const [c, max] of Object.entries(catMax)) {
  const sum = Math.round((cats[c] || 0) * 100) / 100;
  if (sum !== max) mismatches.push(`catMax ${c}: sum(2025)=${sum} mvp=${max}`);
}

console.log('mvp-score-count:', Object.keys(scores2025).length);
console.log('category sums:', JSON.stringify(cats));
console.log('TOTAL FINAL (sum of max):', Math.round(Object.values(catMax).reduce((a, b) => a + b, 0) * 100) / 100);
if (warnings.length) { console.log('WARN (known MVP divergence, catalog wins):'); warnings.forEach(x => console.log(' ~', x)); }
if (mismatches.length) { console.log('MISMATCHES:'); mismatches.forEach(x => console.log(' -', x)); process.exit(1); }
console.log('CROSS-CHECK OK');

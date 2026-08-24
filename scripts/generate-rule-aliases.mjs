// Generates the v2-EN -> seed-id alias table by zipping the two formSections
// positionally, validating category + score against the v2 runtime tables.
import fs from 'node:fs';

const v2src = fs.readFileSync('C:/Yui/data/saas/solaris-av-engine/src/utils/constants.ts', 'utf8');
const seed = JSON.parse(fs.readFileSync(new URL('../src/config/scoring-rules.seed.json', import.meta.url), 'utf8'));

function parseSections(src) {
  const start = src.indexOf('export const formSections');
  const bodyStart = src.indexOf('{', start);
  let depth = 0, end = bodyStart;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(bodyStart + 1, end);
  const sections = {};
  const re = /'([^']+)':\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    sections[m[1]] = [...m[2].matchAll(/'((?:[^'\\]|\\.)+)'/g)].map((x) => x[1]);
  }
  return sections;
}

function parseMap(src, name) {
  const start = src.indexOf(`export const ${name}`);
  const bodyStart = src.indexOf('{', start);
  let depth = 0, end = bodyStart;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(bodyStart + 1, end);
  const map = {};
  const re = /'((?:[^'\\]|\\.)+)':\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) map[m[1].replace(/\\'/g, "'")] = m[2];
  return map;
}

const v2Sections = parseSections(v2src);
// PT-BR field names live in the MVP's constants.ts (v2 is fully English).
const mvpSrc = fs.readFileSync('C:/Yui/data/saas/solaris-web-mvp/utils/constants.ts', 'utf8');
const mvpSections = parseSections(mvpSrc);
const v2Cat = parseMap(v2src, 'inconformityToCategoryMap');
const v2ScoresRaw = parseMap(v2src, 'inconformityScores');

// v2 inconformityScores values are numbers written without quotes; reparse numeric
const scoresBody = v2src.slice(v2src.indexOf('export const inconformityScores'));
const v2Scores = {};
{
  const re = /'((?:[^'\\]|\\.)+)':\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(scoresBody)) !== null) v2Scores[m[1].replace(/\\'/g, "'")] = Number(m[2]);
}

const BOOL_SECTIONS_V2 = ['Framing', 'Lighting', 'Video Quality', 'Scenery & Assets', 'Audio'];
const BOOL_SECTIONS_PT = ['Enquadramento', 'Iluminação', 'Qualidade de Vídeo', 'Cenário & Material', 'Áudio'];

const seedByName = new Map(seed.rules.map((r) => [r.name, r]));
const CAT_MAP = {
  ENQUADRAMENTO: 'FRAMING SCORE',
  ILUMINAÇÃO: 'LIGHTING SCORE',
  OUTROS: 'VIDEO SCORE',
  CENÁRIO: 'SCENERY SCORE',
  ÁUDIO: 'AUDIO SCORE',
};

const aliases = {}; // EN name -> seed id
const colAliases = {}; // score column -> [categoryId]
const problems = [];

// Known v2 translation drift (documented): the v2 port moved 'Material fora dos
// padrões' from category OUTROS to SCENERY and swapped two audio scores vs the
// MVP catalog. The seed follows the MVP catalog per spec; these three are WARN.
const KNOWN_V2_DRIFT = new Set([
  'cat mismatch Non-Standard Assets',
  'score mismatch Environmental Noise',
  'score mismatch Microphone Friction Noise',
]);
const warnings = [];
for (let s = 0; s < BOOL_SECTIONS_V2.length; s++) {
  const enNames = v2Sections[BOOL_SECTIONS_V2[s]];
  const ptNames = mvpSections[BOOL_SECTIONS_PT[s]];
  if (enNames.length !== ptNames.length) problems.push(`section size mismatch: ${BOOL_SECTIONS_V2[s]}`);
  for (let i = 0; i < Math.min(enNames.length, ptNames.length); i++) {
    const en = enNames[i];
    const pt = ptNames[i];
    const rule = seedByName.get(pt);
    if (!rule) { problems.push(`seed rule missing for ${pt}`); continue; }
    // Validate against v2 runtime: category must agree
    if (v2Cat[en] !== CAT_MAP[rule.categoryId]) {
      const msg = `cat mismatch ${en}: v2=${v2Cat[en]} seed=${CAT_MAP[rule.categoryId]}`;
      if ([...KNOWN_V2_DRIFT].some((k) => msg.startsWith(k))) warnings.push('WARN ' + msg);
      else problems.push(msg);
    }
    // Validate score parity (catalog wins over the 2 known swapped entries)
    const v2s = v2Scores[en];
    if (v2s !== rule.scoresByYear['2025']) {
      const msg = `score mismatch ${en}: v2=${v2s} seed2025=${rule.scoresByYear['2025']}`;
      if ([...KNOWN_V2_DRIFT].some((k) => msg.startsWith(k))) warnings.push('WARN ' + msg);
      else problems.push(msg);
    }
    aliases[en] = rule.id;
    colAliases[v2Cat[en]] = rule.categoryId;
  }
}

if (problems.length) {
  console.log('PROBLEMS:');
  problems.forEach((p) => console.log(' -', p));
  process.exit(1);
}
console.log(JSON.stringify({ aliases, colAliases }, null, 2));

// One-shot extraction: MVP inconformityDetails.ts -> structured entries
// Line-oriented parser (no giant regex); fidelity verified downstream by tests.
import fs from 'node:fs';

const src = fs.readFileSync('C:/Yui/data/saas/solaris-web-mvp/utils/inconformityDetails.ts', 'utf8');
const lines = src.split(/\r?\n/);

function unquote(raw) {
  // raw includes surrounding single quotes
  let inner = raw.slice(1, -1);
  inner = inner.replace(/\\n/g, '\n').replace(/\\(['"])/g, '$1');
  return inner;
}

const entries = [];
let current = null;
for (const line of lines) {
  const start = line.match(/^ {2}'(.+)': \{$/);
  if (start) { current = { name: unquote("'" + start[1] + "'"), fields: {} }; continue; }
  const end = line.match(/^ {2}\},?$/);
  if (end) { if (current) entries.push(current); current = null; continue; }
  if (!current) continue;
  const fm = line.match(/^ {4}([A-Za-z0-9]+): (.+?),?$/);
  if (fm) current.fields[fm[1]] = fm[2];
}

function fieldValue(raw) {
  if (raw == null) return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith("'")) return unquote(raw);
  return raw;
}

const out = entries.map((e) => ({
  name: e.name,
  type: fieldValue(e.fields.type),
  definition: fieldValue(e.fields.definition),
  analystAction: fieldValue(e.fields.analystAction),
  grade: Number(fieldValue(e.fields.grade)),
  score2024: parseFloat(String(fieldValue(e.fields.score2024)).replace(',', '.')),
  score2025: parseFloat(String(fieldValue(e.fields.score2025)).replace(',', '.')),
}));

if (out.length < 40 || out.some((e) => !e.type || !Number.isFinite(e.grade) || !Number.isFinite(e.score2025))) {
  console.error('FAIL: bad extraction', { count: out.length });
  process.exit(1);
}
fs.writeFileSync(new URL('./.extracted.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('extracted:', out.length);

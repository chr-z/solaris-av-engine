// Generates src/config/scoring-rules.seed.json from extracted MVP entries.
import fs from 'node:fs';

const entries = JSON.parse(fs.readFileSync(new URL('./.extracted.json', import.meta.url), 'utf8'));

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const CATEGORY_ORDER = ['ENQUADRAMENTO', 'ILUMINAÇÃO', 'OUTROS', 'CENÁRIO', 'ÁUDIO'];
const seenIds = new Set();
const rules = entries.map((e) => {
  const id = slugify(e.name);
  if (seenIds.has(id)) throw new Error('duplicate id: ' + id);
  seenIds.add(id);
  return {
    id,
    name: e.name,
    categoryId: e.type,
    definition: e.definition,
    analystAction: e.analystAction,
    grade: e.grade,
    scoresByYear: { '2024': e.score2024, '2025': e.score2025 },
    active: true,
  };
});

const categories = CATEGORY_ORDER.map((id) => ({ id }));

const config = {
  version: 1,
  effectiveFrom: '2025-01-01',
  meta: {
    name: 'Solaris Scoring Rules',
    source: 'Ported from Solaris-Web-MVP utils/inconformityDetails.ts (43 entries, verbatim PT-BR)',
    notes: [
      "Divergência interna conhecida do MVP: 'Ruídos ambiente' e 'Ruído de atrito no microfone' têm scores trocados entre o catálogo (inconformityDetails.ts) e o constants.ts em produção. Seguido o catálogo, conforme especificação v3.",
    ],
  },
  categories,
  rules,
};

const out = new URL('../src/config/scoring-rules.seed.json', import.meta.url);
fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n');
console.log('written:', rules.length, 'rules ->', out.pathname);

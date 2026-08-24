// Solaris v3 — ScoringEngine
// Pure, deterministic scoring of an O.S. from analyst markings ("marcações")
// against a versioned RulesConfig ported from the Gran MVP.
//
// Algorithm (identical to the MVP runtime):
//   penalty(category) = Σ score(rule, year) for each marked, active rule
//   categoryScore     = max(0, round2(categoryMax − penalty))
//   FINAL             = Σ categoryScore
// where categoryMax = Σ score(rule, year) over every ACTIVE rule of the category,
// so an untouched category yields exactly its maximum (5.00 total across the
// five seeded categories), matching the sheet the Gran runs today.

export interface ScoredRule {
  /** Stable machine id (slug). Legacy MVP names remain resolvable via `name`. */
  id: string;
  /** Original PT-BR column/header name used by the Gran sheet. */
  name: string;
  categoryId: string;
  definition?: string;
  analystAction?: string;
  /** Impact grade 1..3 (documental; does not affect math). */
  grade: number;
  /** Penalty points per year of vigência, e.g. { "2024": 0.2, "2025": 0.3 }. */
  scoresByYear: Record<string, number>;
  /** Deactivated rules stop contributing to max AND to penalties. */
  active: boolean;
}

export interface RulesConfig {
  version: number;
  effectiveFrom: string;
  meta?: { name?: string; source?: string; notes?: string[] };
  categories: Array<{ id: string; label?: string }>;
  rules: ScoredRule[];
}

/** One analyst marking. Resolve by ruleId (v3) or ruleName (legacy MVP header). */
export interface Marcacao {
  ruleId?: string;
  ruleName?: string;
  /** Repeat count (default 1). Multiplies the penalty. */
  count?: number;
}

export interface AppliedPenalty {
  ruleId: string;
  name: string;
  categoryId: string;
  grade: number;
  unitScore: number;
  count: number;
  penalty: number;
}

export interface CategoryBreakdown {
  categoryId: string;
  maxScore: number;
  penalties: number;
  finalScore: number;
}

export interface OsScoreResult {
  /** Final O.S. score (2-decimal safe). Max = sum of category maxima (seed: 5.00). */
  finalScore: number;
  categories: CategoryBreakdown[];
  applied: AppliedPenalty[];
  /** Markings that matched no rule — surfaced so data problems are visible. */
  unknown: string[];
  /** Markings referencing deactivated rules (excluded from math). */
  inactive: string[];
  /** Marking referenced a rule lacking the requested year. */
  missingYear: string[];
  configVersion: number;
  configEffectiveFrom: string;
}

export interface ScoreOptions {
  /** Vigência year key looked up in scoresByYear (default '2025'). */
  year?: string | number;
}

const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/** Formats a score using PT-BR decimal comma, as written into the Gran sheet. */
export function formatScorePtBr(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

/**
 * Validates a RulesConfig and returns a list of problems (empty = valid).
 * Used by the AdminConsole before persisting/imported configs.
 */
export function validateRulesConfig(config: RulesConfig): string[] {
  const problems: string[] = [];
  if (!config || !Array.isArray(config.rules)) return ['config.rules must be an array'];
  if (!Array.isArray(config.categories)) problems.push('config.categories must be an array');
  if (!Number.isInteger(config.version) || config.version < 1) {
    problems.push('config.version must be a positive integer');
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const categoryIds = new Set((config.categories ?? []).map((c) => c.id));
  for (const rule of config.rules) {
    if (!rule.id) problems.push(`rule without id: ${JSON.stringify(rule.name)}`);
    else if (seenIds.has(rule.id)) problems.push(`duplicate rule id: ${rule.id}`);
    else seenIds.add(rule.id);
    if (seenNames.has(rule.name)) problems.push(`duplicate rule name: ${rule.name}`);
    seenNames.add(rule.name);
    if (![1, 2, 3].includes(rule.grade)) problems.push(`grade out of 1..3: ${rule.id}`);
    if (!rule.scoresByYear || typeof rule.scoresByYear !== 'object') {
      problems.push(`scoresByYear missing: ${rule.id}`);
    } else {
      for (const [year, score] of Object.entries(rule.scoresByYear)) {
        if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
          problems.push(`invalid score ${year} for ${rule.id}: ${String(score)}`);
        }
      }
    }
    if (categoryIds.size > 0 && !categoryIds.has(rule.categoryId)) {
      problems.push(`unknown categoryId "${rule.categoryId}" in ${rule.id}`);
    }
  }
  return problems;
}

function assertNoDuplicateIds(rules: ScoredRule[]): void {
  const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.id)) throw new Error(`ScoringEngine: duplicate rule id "${r.id}"`);
    seen.add(r.id);
  }
}

/** Resolves a rule by id first, then by exact legacy name. */
export function resolveRule(rules: ScoredRule[], ref: { ruleId?: string; ruleName?: string }): ScoredRule | undefined {
  if (ref.ruleId) return rules.find((r) => r.id === ref.ruleId);
  if (ref.ruleName) return rules.find((r) => r.name === ref.ruleName);
  return undefined;
}

function pickScore(rule: ScoredRule, yearKey: string): number | undefined {
  const direct = rule.scoresByYear[yearKey];
  if (direct !== undefined) return direct;
  // Numeric-tolerant lookup ("2025" vs 2025 keys).
  for (const [k, v] of Object.entries(rule.scoresByYear)) {
    if (String(k) === yearKey) return v;
  }
  return undefined;
}

/**
 * Calculates the final O.S. score. Deterministic: same inputs → deep-equal output,
 * independent of marcacoes order.
 */
export function calculateOsScore(
  marcacoes: Marcacao[],
  config: RulesConfig | ScoredRule[],
  options: ScoreOptions = {},
): OsScoreResult {
  const isArrayOnly = Array.isArray(config);
  const rules: ScoredRule[] = isArrayOnly ? config : config.rules;
  const version = isArrayOnly ? 0 : config.version;
  const effectiveFrom = isArrayOnly ? '' : config.effectiveFrom;
  const declaredCategories = isArrayOnly ? [] : config.categories.map((c) => c.id);

  assertNoDuplicateIds(rules);

  const yearKey = String(options.year ?? 2025);

  // Categories present in the config (declared order wins; extras appended sorted).
  const categorySet = new Set<string>(declaredCategories);
  for (const r of rules) categorySet.add(r.categoryId);
  const categories = declaredCategories.filter((c) => categorySet.has(c));
  for (const c of [...categorySet].sort()) if (!categories.includes(c)) categories.push(c);

  // Aggregate penalties per category (accumulate in integer cents to avoid FP drift).
  const penaltiesCents = new Map<string, number>();
  for (const c of categories) penaltiesCents.set(c, 0);

  const applied: AppliedPenalty[] = [];
  const unknown: string[] = [];
  const inactive: string[] = [];
  const missingYear: string[] = [];

  for (const m of marcacoes) {
    const label = m.ruleId ?? m.ruleName ?? '<empty>';
    const rule = resolveRule(rules, m);
    if (!rule) {
      if (!unknown.includes(label)) unknown.push(label);
      continue;
    }
    if (!rule.active) {
      if (!inactive.includes(label)) inactive.push(label);
      continue;
    }
    const unit = pickScore(rule, yearKey);
    if (unit === undefined) {
      if (!missingYear.includes(label)) missingYear.push(label);
      continue;
    }
    const count = Math.max(1, Math.trunc(m.count ?? 1));
    const penalty = round2(unit * count);
    applied.push({
      ruleId: rule.id,
      name: rule.name,
      categoryId: rule.categoryId,
      grade: rule.grade,
      unitScore: unit,
      count,
      penalty,
    });
    penaltiesCents.set(
      rule.categoryId,
      (penaltiesCents.get(rule.categoryId) ?? 0) + Math.round(penalty * 100),
    );
  }

  // Category maxima consider only ACTIVE rules with a score for the requested year.
  const breakdown: CategoryBreakdown[] = categories.map((categoryId) => {
    let maxCents = 0;
    for (const r of rules) {
      if (!r.active || r.categoryId !== categoryId) continue;
      const s = pickScore(r, yearKey);
      if (s !== undefined) maxCents += Math.round(s * 100);
    }
    const penCents = penaltiesCents.get(categoryId) ?? 0;
    const maxScore = round2(maxCents / 100);
    const penalties = round2(penCents / 100);
    return {
      categoryId,
      maxScore,
      penalties,
      finalScore: round2(Math.max(0, maxCents - penCents) / 100),
    };
  });

  const finalCents = breakdown.reduce((acc, b) => acc + Math.round(b.finalScore * 100), 0);

  // Canonical order: config category order, then rule id — same inputs yield
  // deep-equal output regardless of marcacoes order.
  const catIndex = new Map(categories.map((c, i) => [c, i]));
  applied.sort(
    (a, b) =>
      (catIndex.get(a.categoryId) ?? Number.MAX_SAFE_INTEGER) -
        (catIndex.get(b.categoryId) ?? Number.MAX_SAFE_INTEGER) || a.ruleId.localeCompare(b.ruleId),
  );

  return {
    finalScore: round2(finalCents / 100),
    categories: breakdown,
    applied,
    unknown,
    inactive,
    missingYear,
    configVersion: version,
    configEffectiveFrom: effectiveFrom,
  };
}

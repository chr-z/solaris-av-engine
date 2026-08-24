// Solaris v3 P13 — markable-rule detection shared by the ScoringEngine bridge
// consumers and the recurring-inconformity dashboard ranking.
//
// A "marking" is a sheet cell whose value is exactly 'TRUE' in a column that
// resolves to an ACTIVE scoring rule (v2 EN header via RULE_ALIASES, or the
// legacy MVP PT-BR name natively present in the seed). This is the same
// contract used by engineBridge.recalculateScoresWithEngine when analysts
// tick checkboxes, so the dashboard ranking and the live score math can never
// disagree about what counts as marked.
//
// Pure data only: no React, no DOM, no fetch.

import type { RowData } from '../services/sheetSync';
import { RULE_ALIASES } from '../config/ruleAliases';
import { SEED_RULES_CONFIG, DEFAULT_SCORING_YEAR } from '../config/scoringRules';
import type { RulesConfig } from '../engine/scoring';

/** One markable column: the sheet header plus the rule it feeds. */
export interface MarkableRule {
  /** Exact sheet header that carries the checkbox ('TRUE'/'FALSE'). */
  header: string;
  ruleId: string;
  /** English display name (alias header); PT-BR native names fall back to it. */
  nameEn: string;
  categoryId: string;
}

/**
 * Canonical detection table for a config: every ACTIVE rule paired with the
 * EN header alias that maps to it (first alias wins — the alias map is 1:1
 * today, so this is deterministic). Legacy PT-BR names resolve through the
 * rule's own `name`, which the seed stores natively.
 */
export function buildMarkableRules(
  config: RulesConfig = SEED_RULES_CONFIG,
): MarkableRule[] {
  const enHeaderByRuleId = new Map<string, string>();
  for (const [header, ruleId] of Object.entries(RULE_ALIASES)) {
    if (!enHeaderByRuleId.has(ruleId)) enHeaderByRuleId.set(ruleId, header);
  }
  const rules: MarkableRule[] = [];
  for (const rule of config.rules ?? []) {
    if (!rule.active) continue;
    const header =
      enHeaderByRuleId.get(rule.id) ??
      // Legacy PT-BR columns: the MVP wrote the rule name straight into the
      // header row, so the native name is itself a markable header.
      rule.name;
    rules.push({
      header,
      ruleId: rule.id,
      nameEn: enHeaderByRuleId.get(rule.id) ?? rule.name,
      categoryId: rule.categoryId,
    });
  }
  return rules;
}

/**
 * Unit penalty of one rule for a vigência year. Unknown years (or rules
 * without that year key) score 0 — the ranking never invents penalties.
 */
export function ruleUnitScore(
  ruleId: string,
  year: string | number = DEFAULT_SCORING_YEAR,
  config: RulesConfig = SEED_RULES_CONFIG,
): number {
  const rule = (config.rules ?? []).find((r) => r.id === ruleId);
  const raw = rule?.scoresByYear?.[String(year)];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Extracts the marked rule ids of ONE row, in the config's canonical order
 * (seed order, which mirrors the Gran checklist). Cell must be exactly
 * 'TRUE' — 'true', 'YES', 1 or anything else is not a marking.
 */
export function collectMarkings(
  headers: string[],
  cells: RowData,
  rules: MarkableRule[],
): string[] {
  if (!Array.isArray(headers) || !cells) return [];
  const indexByHeader = new Map<string, number>();
  headers.forEach((h, idx) => {
    const key = typeof h === 'string' ? h.trim() : '';
    if (key && !indexByHeader.has(key)) indexByHeader.set(key, idx);
  });
  const marked: string[] = [];
  for (const rule of rules) {
    const idx = indexByHeader.get(rule.header);
    if (idx === undefined) continue;
    const value = cells[idx]?.value;
    if (value === 'TRUE') marked.push(rule.ruleId);
  }
  return marked;
}

/** Convenience for callers that only need the default table. */
export const DEFAULT_MARKABLE_RULES: MarkableRule[] = buildMarkableRules();

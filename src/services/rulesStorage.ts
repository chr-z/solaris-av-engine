// Solaris v3 — versioned RulesConfig persistence.
//
// Storage adapter pattern: default sink is localStorage; tests inject an
// in-memory store. Kept free of React/Firebase so it stays unit-testable.

import {
  validateRulesConfig,
  type RulesConfig,
} from '../engine/scoring';
import { SEED_RULES_CONFIG } from '../config/scoringRules';

const CONFIG_KEY = 'solaris.v3.rules-config';

export interface RulesStorage {
  get(): string | null;
  set(value: string): void;
}

export const localRulesStorage: RulesStorage = {
  get: () => localStorage.getItem(CONFIG_KEY),
  set: (v) => localStorage.setItem(CONFIG_KEY, v),
};

/** Loads the effective config: locally edited > shipped seed. */
export function loadRulesConfig(storage: RulesStorage = localRulesStorage): RulesConfig {
  try {
    const raw = storage.get();
    if (raw) {
      const parsed = JSON.parse(raw) as RulesConfig;
      if (validateRulesConfig(parsed).length === 0) return parsed;
    }
  } catch { /* fall back to seed */ }
  return SEED_RULES_CONFIG;
}

export function persistRulesConfig(config: RulesConfig, storage: RulesStorage = localRulesStorage): void {
  storage.set(JSON.stringify(config));
}

export function resetRulesToSeed(storage: RulesStorage = localRulesStorage): RulesConfig {
  try { storage.set(''); } catch { /* noop */ }
  try { localStorage.removeItem(CONFIG_KEY); } catch { /* noop */ }
  return SEED_RULES_CONFIG;
}

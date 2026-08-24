// Loads the versioned seed RulesConfig ported from the Gran MVP catalog.
import seedJson from './scoring-rules.seed.json';
import type { RulesConfig } from '../engine/scoring';

export const SEED_RULES_CONFIG = seedJson as unknown as RulesConfig;

/** Default vigência year used when none is provided (matches MVP's current math). */
export const DEFAULT_SCORING_YEAR = 2025;

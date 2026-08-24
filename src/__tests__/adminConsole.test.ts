// Tests for the v3 AdminConsole plumbing: hash routing, admin role resolution,
// guest identity persistence and the versioned rules storage adapter.

import { describe, it, expect, afterEach } from 'vitest';
import { ADMIN_ROUTE, isAdminHash } from '../utils/adminRoute';
import {
  resolveAdminSource,
  isLocalAdmin,
  setLocalAdmin,
  persistGuestEmail,
  readGuestEmail,
  clearGuestEmail,
  LOCAL_ADMIN_EMAILS,
} from '../hooks/adminRoleCore';
import {
  loadRulesConfig,
  persistRulesConfig,
  resetRulesToSeed,
  type RulesStorage,
} from '../services/rulesStorage';
import { SEED_RULES_CONFIG } from '../config/scoringRules';
import type { RulesConfig } from '../engine/scoring';

afterEach(() => {
  window.localStorage.clear();
});

describe('admin hash routing', () => {
  it('matches the exact #/admin route', () => {
    expect(isAdminHash('#/admin')).toBe(true);
  });

  it('accepts subpaths and query strings under #/admin', () => {
    expect(isAdminHash('#/admin/rules')).toBe(true);
    expect(isAdminHash('#/admin?tab=scoring')).toBe(true);
  });

  it('rejects lookalikes and unrelated hashes', () => {
    expect(isAdminHash('#/administrator')).toBe(false); // prefix must not leak
    expect(isAdminHash('#/Admin')).toBe(false); // case-sensitive
    expect(isAdminHash('#')).toBe(false);
    expect(isAdminHash('')).toBe(false);
    expect(isAdminHash('#main-workspace')).toBe(false);
  });

  it('exports the canonical route constant used by links', () => {
    expect(ADMIN_ROUTE).toBe('#/admin');
  });
});

describe('resolveAdminSource (pure RBAC decision)', () => {
  it('grants via Firebase claim regardless of the local allowlist', () => {
    expect(resolveAdminSource('admin', 'stranger@example.com')).toBe('firebase-claim');
  });

  it('falls back to the allowlist only when there is no claim', () => {
    expect(resolveAdminSource(undefined, LOCAL_ADMIN_EMAILS[0])).toBe('local-fallback');
    // A wrong claim value denies even an allowlisted email (claim wins).
    expect(resolveAdminSource('analyst', LOCAL_ADMIN_EMAILS[0])).toBe('none');
  });

  it('denies without claim and without allowlist membership', () => {
    expect(resolveAdminSource(undefined, 'random@example.com')).toBe('none');
    expect(resolveAdminSource(undefined, null)).toBe('none');
  });
});

describe('local admin allowlist + guest identity', () => {
  it('recognizes seeded allowlist emails case-insensitively', () => {
    expect(isLocalAdmin(LOCAL_ADMIN_EMAILS[0].toUpperCase())).toBe(true);
    expect(isLocalAdmin('nobody@example.com')).toBe(false);
    expect(isLocalAdmin(null)).toBe(false);
    expect(isLocalAdmin(undefined)).toBe(false);
  });

  it('setLocalAdmin grants and revokes custom entries', () => {
    setLocalAdmin('temp.admin@example.com');
    expect(isLocalAdmin('TEMP.ADMIN@EXAMPLE.COM')).toBe(true);
    setLocalAdmin(null); // revoke everyone
    expect(isLocalAdmin('temp.admin@example.com')).toBe(false);
    expect(isLocalAdmin(LOCAL_ADMIN_EMAILS[0])).toBe(false);
  });

  it('persists and clears the guest email round-trip', () => {
    persistGuestEmail('guest@solaris.demo');
    expect(readGuestEmail()).toBe('guest@solaris.demo');
    clearGuestEmail();
    expect(readGuestEmail()).toBeNull();
  });
});

describe('versioned rules storage adapter', () => {
  const memStorage = (): RulesStorage => {
    let backing: string | null = null;
    return { get: () => backing, set: (v) => { backing = v; } };
  };

  it('falls back to the shipped seed when nothing is persisted', () => {
    expect(loadRulesConfig(memStorage())).toBe(SEED_RULES_CONFIG);
  });

  it('returns a persisted valid config over the seed', () => {
    const storage = memStorage();
    const edited: RulesConfig = {
      ...SEED_RULES_CONFIG,
      version: SEED_RULES_CONFIG.version + 3,
      rules: [...SEED_RULES_CONFIG.rules, {
        ...SEED_RULES_CONFIG.rules[0],
        id: 'custom-rule',
        name: 'Regra custom',
      }],
    };
    persistRulesConfig(edited, storage);
    expect(loadRulesConfig(storage)).toEqual(edited);
    expect(loadRulesConfig(storage)?.rules.some((r) => r.id === 'custom-rule')).toBe(true);
  });

  it('ignores corrupted JSON and invalid configs (seed wins)', () => {
    const broken: RulesStorage = { get: () => '{not json', set: () => { /* noop */ } };
    expect(loadRulesConfig(broken)).toBe(SEED_RULES_CONFIG);

    const invalid: RulesStorage = {
      get: () => JSON.stringify({ ...SEED_RULES_CONFIG, version: 0 }), // version must be >= 1
      set: () => { /* noop */ },
    };
    expect(loadRulesConfig(invalid)).toBe(SEED_RULES_CONFIG);
  });

  it('reset restores the seed exactly', () => {
    const storage = memStorage();
    persistRulesConfig({ ...SEED_RULES_CONFIG, version: 99 }, storage);
    expect(resetRulesToSeed(storage)).toBe(SEED_RULES_CONFIG);
    expect(storage.get() ?? '').toBe('');
  });
});

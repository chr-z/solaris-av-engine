import { describe, it, expect, afterEach } from 'vitest';
import {
  FREE_FLAGS,
  PRO_FLAGS,
  flagsForEdition,
  verifyLocalEntitlement,
  loadStoredEntitlement,
  persistStoredEntitlement,
  resolveEditionFromSources,
  shouldRevalidate,
  isFeatureUnlocked,
  describeFeature,
  LICENSE_CACHE_KEY,
  REVALIDATE_INTERVAL_MS,
} from '../licensing/core';
import { newTestKeyPair, issueTestToken } from '../licensing/__tests__/keypair';

// Memory storage double
function memoryStorage(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
} {
  const map = new Map<string, string>();
  return {
    getItem: k => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: k => void map.delete(k),
  };
}

const NOW = 1_700_000_000_000;

describe('feature flag matrix', () => {
  it('free tier keeps QC report export and locks A/B compare', () => {
    expect(FREE_FLAGS.qcReportExport).toBe(true);
    expect(FREE_FLAGS.abCompareMode).toBe(false);
  });

  it('pro tier unlocks every feature', () => {
    expect(PRO_FLAGS.qcReportExport).toBe(true);
    expect(PRO_FLAGS.abCompareMode).toBe(true);
  });

  it('flagsForEdition maps editions to frozen flag sets', () => {
    expect(flagsForEdition('free')).toEqual(FREE_FLAGS);
    expect(flagsForEdition('pro')).toEqual(PRO_FLAGS);
    expect(Object.isFrozen(flagsForEdition('pro'))).toBe(true);
    expect(Object.isFrozen(flagsForEdition('free'))).toBe(true);
  });

  it('isFeatureUnlocked reads the right column of the matrix', () => {
    expect(isFeatureUnlocked(FREE_FLAGS, 'abCompareMode')).toBe(false);
    expect(isFeatureUnlocked(PRO_FLAGS, 'abCompareMode')).toBe(true);
    expect(isFeatureUnlocked(PRO_FLAGS, 'qcReportExport')).toBe(true);
  });
});

describe('local entitlement verification (Ed25519)', () => {
  it('accepts a real Pro token and rejects a token from another key', async () => {
    const issuer = await newTestKeyPair('kid-1');
    const attacker = await newTestKeyPair('attacker');
    const { token } = await issueTestToken(issuer, { issuedAt: NOW, subject: 'order:P1' });

    expect(await verifyLocalEntitlement(token, NOW, issuer.publicKeys)).toMatchObject({ verified: true });
    expect(await verifyLocalEntitlement(token, NOW, attacker.publicKeys)).toMatchObject({ verified: false });
  });

  it('returns expired with claims when past the absolute cutoff', async () => {
    const issuer = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(issuer, {
      issuedAt: NOW - 1000,
      termEndsAt: NOW - 500,
      graceEndsAt: NOW - 100,
    });
    const result = await verifyLocalEntitlement(token, NOW, issuer.publicKeys);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('expired');
    expect(result.claims?.edition).toBe('pro');
  });

  it('returns not-verified for missing/malformed tokens without throwing', async () => {
    const issuer = await newTestKeyPair('kid-1');
    await expect(verifyLocalEntitlement(null, NOW, issuer.publicKeys)).resolves.toMatchObject({ verified: false });
    await expect(verifyLocalEntitlement('garbage', NOW, issuer.publicKeys)).resolves.toMatchObject({
      verified: false,
      reason: 'malformed',
    });
  });
});

describe('stored entitlement persistence', () => {
  afterEach(() => persistStoredEntitlement(memoryStorage(), null));

  it('persists and loads an entitlement entry round-trip', () => {
    const storage = memoryStorage();
    persistStoredEntitlement(storage, { token: 'T', activationId: 'a1', verifiedAt: 1234 });
    expect(loadStoredEntitlement(storage)).toEqual({ token: 'T', activationId: 'a1', verifiedAt: 1234 });
  });

  it('removing a stored entitlement clears storage', () => {
    const storage = memoryStorage();
    persistStoredEntitlement(storage, { token: 'T', activationId: null, verifiedAt: 0 });
    persistStoredEntitlement(storage, null);
    expect(loadStoredEntitlement(storage)).toBeNull();
  });

  it('tolerates missing/corrupt storage without throwing', () => {
    expect(loadStoredEntitlement(undefined)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('boom');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadStoredEntitlement(broken)).toBeNull();
    const badJson = memoryStorage();
    badJson.setItem(LICENSE_CACHE_KEY, '{not-json');
    expect(loadStoredEntitlement(badJson)).toBeNull();
    const wrongShape = memoryStorage();
    wrongShape.setItem(LICENSE_CACHE_KEY, JSON.stringify({ token: 42 }));
    expect(loadStoredEntitlement(wrongShape)).toBeNull();
  });
});

describe('revalidation scheduling', () => {
  it('is due when never revalidated or past the interval', () => {
    expect(shouldRevalidate(null, NOW)).toBe(false);
    expect(shouldRevalidate({ token: 't', activationId: null, verifiedAt: 0 }, NOW)).toBe(false);
    expect(shouldRevalidate({ token: 't', activationId: 'a', verifiedAt: 0 }, NOW)).toBe(true);
    expect(shouldRevalidate({ token: 't', activationId: 'a', verifiedAt: NOW - REVALIDATE_INTERVAL_MS - 1 }, NOW)).toBe(true);
    expect(shouldRevalidate({ token: 't', activationId: 'a', verifiedAt: NOW }, NOW)).toBe(false);
  });
});

describe('edition resolution order', () => {
  it('verified Pro entitlement wins over env override', () => {
    expect(resolveEditionFromSources(true, 'free')).toEqual({
      edition: 'pro',
      source: { kind: 'stored-license' },
    });
  });

  it('env override applies when no entitlement is verified', () => {
    expect(resolveEditionFromSources(false, 'pro')).toEqual({
      edition: 'pro',
      source: { kind: 'env-override' },
    });
  });

  it('unknown env values fall back to free', () => {
    expect(resolveEditionFromSources(false, undefined)).toEqual({ edition: 'free', source: { kind: 'none' } });
    expect(resolveEditionFromSources(false, 'enterprise')).toEqual({ edition: 'free', source: { kind: 'none' } });
  });
});

describe('feature labels', () => {
  it('describes known features and has a safe default', () => {
    expect(describeFeature('abCompareMode')).toBe('A/B Compare');
    expect(describeFeature('qcReportExport')).toBe('QC Report Export');
    expect(describeFeature('nonexistent' as never)).toBe('Solaris Pro feature');
  });
});

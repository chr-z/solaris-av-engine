import { describe, it, expect, afterEach } from 'vitest';
import {
  FREE_FLAGS,
  PRO_FLAGS,
  flagsForEdition,
  parseLicenseKey,
  validateLicenseKey,
  verifyLicenseSignature,
  loadStoredLicense,
  persistStoredLicense,
  resolveEditionFromSources,
  isFeatureUnlocked,
  describeFeature,
  LICENSE_KEY_PREFIX,
} from '../licensing/core';

// --- HMAC helper (Node webcrypto mirrors the browser WebCrypto path) -------
const { webcrypto } = await import('node:crypto');

async function signWithNode(secret: string, message: string): Promise<string> {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const SECRET = 'test-secret-solaris-worker';

function makeKey(
  edition: 'pro' | 'free',
  expiresAt: number,
  payload = 'dGVzdA',
  version = 1,
): string {
  const body = `${LICENSE_KEY_PREFIX}-${version}-${expiresAt}-${edition}-${payload}`;
  return `${body}.PENDING`;
}

/** Builds a fully signed key through Node's crypto (independent of impl under test). */
async function makeSignedKey(
  edition: 'pro' | 'free',
  expiresAt: number,
  payload = 'dGVzdA',
): Promise<string> {
  const pending = makeKey(edition, expiresAt, payload);
  const body = pending.slice(0, pending.lastIndexOf('.'));
  const signature = await signWithNode(SECRET, body);
  return `${body}.${signature}`;
}

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

describe('license key parsing', () => {
  it('parses a structurally valid pro key', () => {
    const result = parseLicenseKey('SOLARIS-1-0-pro-dGVzdA.c2ln');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.license.edition).toBe('pro');
      expect(result.license.expiresAt).toBe(0);
      expect(result.license.version).toBe(1);
      expect(result.license.payload).toBe('dGVzdA');
      expect(result.license.signature).toBe('c2ln');
    }
  });

  it('rejects malformed keys for every structural reason', () => {
    expect(parseLicenseKey(null).ok).toBe(false);
    expect(parseLicenseKey(undefined).ok).toBe(false);
    expect(parseLicenseKey('').ok).toBe(false);
    expect(parseLicenseKey('no-dot-here').ok).toBe(false);
    expect(parseLicenseKey('SOLARIS-1-0-pro.dGVzdA.sig').ok).toBe(false); // wrong segment count
    expect(parseLicenseKey('SOLARI-1-0-pro-dGVzdA.sig').ok).toBe(false); // wrong prefix
    expect(parseLicenseKey('SOLARIS-x-0-pro-dGVzdA.sig').ok).toBe(false); // non-numeric version
    expect(parseLicenseKey('SOLARIS-1--5-pro-dGVzdA.sig').ok).toBe(false); // negative expiry
    expect(parseLicenseKey('SOLARIS-1-0-enterprise-dGVzdA.sig').ok).toBe(false); // unknown edition
    // base64url violations
    expect(parseLicenseKey('SOLARIS-1-0-pro-dG+zdA.sig').ok).toBe(false);
    expect(parseLicenseKey('SOLARIS-1-0-pro-dGVzdA.s/ig').ok) .toBe(false);
  });

  it('accepts expiry far in the future and zero (never)', () => {
    expect(parseLicenseKey('SOLARIS-1-4102444800000-pro-dGVzdA.sig').ok).toBe(true);
    expect(parseLicenseKey('SOLARIS-1-0-free-dGVzdA.sig').ok).toBe(true);
  });
});

describe('license validation with signature + clock', () => {
  it('accepts a correctly signed, unexpired pro key', async () => {
    const key = await makeSignedKey('pro', 0);
    const result = await validateLicenseKey(key, SECRET, 1_700_000_000_000);
    expect(result.valid).toBe(true);
    expect(result.license?.edition).toBe('pro');
  });

  it('rejects a key signed with a different secret', async () => {
    const key = await makeSignedKey('pro', 0);
    const result = await validateLicenseKey(key, 'wrong-secret', Date.now());
    expect(result.valid).toBe(false);
  });

  it('rejects an expired key with reason=expired', async () => {
    const pastExpiry = 1_600_000_000_000;
    const key = await makeSignedKey('pro', pastExpiry);
    const result = await validateLicenseKey(key, SECRET, 1_700_000_000_000);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects tampered bodies (signature covers the full prefix)', async () => {
    const key = await makeSignedKey('pro', 0, 'dGVzdA');
    const tampered = key.replace('-pro-', '-free-');
    const result = await validateLicenseKey(tampered, SECRET, Date.now());
    expect(result.valid).toBe(false);
  });

  it('verifyLicenseSignature agrees with node-signed values and rejects junk', async () => {
    const body = `${LICENSE_KEY_PREFIX}-1-0-pro-dGVzdA`;
    const signature = await signWithNode(SECRET, body);
    await expect(verifyLicenseSignature(SECRET, body, signature)).resolves.toBe(true);
    await expect(verifyLicenseSignature(SECRET, body, 'not-a-real-signature')).resolves.toBe(false);
  });

  it('validateLicenseKey returns invalid for malformed input without throwing', async () => {
    await expect(validateLicenseKey('garbage', SECRET)).resolves.toMatchObject({ valid: false });
    await expect(validateLicenseKey(null, SECRET)).resolves.toMatchObject({ valid: false });
  });
});

describe('stored license persistence', () => {
  afterEach(() => persistStoredLicense(memoryStorage(), null));

  it('persists and loads a license entry round-trip', () => {
    const storage = memoryStorage();
    persistStoredLicense(storage, { key: 'KEY-123', activatedAt: 1234 });
    const loaded = loadStoredLicense(storage);
    expect(loaded).toEqual({ key: 'KEY-123', activatedAt: 1234 });
  });

  it('removing a stored license clears storage', () => {
    const storage = memoryStorage();
    persistStoredLicense(storage, { key: 'K', activatedAt: 1 });
    persistStoredLicense(storage, null);
    expect(loadStoredLicense(storage)).toBeNull();
  });

  it('tolerates missing/corrupt storage without throwing', () => {
    expect(loadStoredLicense(undefined)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('boom');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadStoredLicense(broken)).toBeNull();
    const badJson = memoryStorage();
    badJson.setItem('solaris.proLicense', '{not-json');
    expect(loadStoredLicense(badJson)).toBeNull();
    const wrongShape = memoryStorage();
    wrongShape.setItem('solaris.proLicense', JSON.stringify({ key: 42 }));
    expect(loadStoredLicense(wrongShape)).toBeNull();
  });
});

describe('edition resolution order', () => {
  it('stored Pro license wins over env override', () => {
    const resolved = resolveEditionFromSources(true, 'free');
    expect(resolved).toEqual({ edition: 'pro', source: { kind: 'stored-license' } });
  });

  it('env override applies when no license is stored', () => {
    expect(resolveEditionFromSources(false, 'pro')).toEqual({
      edition: 'pro',
      source: { kind: 'env-override' },
    });
  });

  it('unknown env values fall back to free', () => {
    expect(resolveEditionFromSources(false, undefined)).toEqual({
      edition: 'free',
      source: { kind: 'none' },
    });
    expect(resolveEditionFromSources(false, 'enterprise')).toEqual({
      edition: 'free',
      source: { kind: 'none' },
    });
  });
});

describe('feature labels', () => {
  it('describes known features and has a safe default', () => {
    expect(describeFeature('abCompareMode')).toBe('A/B Compare');
    expect(describeFeature('qcReportExport')).toBe('QC Report Export');
    expect(describeFeature('nonexistent' as never)).toBe('Solaris Pro feature');
  });
});

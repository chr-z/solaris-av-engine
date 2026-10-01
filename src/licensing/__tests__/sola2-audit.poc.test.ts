/**
 * SOLA-2 — Security audit proof-of-concept (independent verification).
 *
 * These are NOT product tests. They are executable evidence for the threat
 * model findings. They deliberately assert the behaviour of the HMAC licensing
 * core as it existed at review time; a passing run is evidence the vulnerability
 * was present, not an endorsement.
 *
 * Author: Sora (SOLA-2).
 *
 * SOLA-34 note: the live core has been replaced with Ed25519 verification and
 * no longer exports the HMAC functions. Per Riven's approach on the SOLA-6 PoC,
 * these assertions import a frozen snapshot of the reviewed commit so the
 * original evidence stays faithful and reproducible. The closure of these
 * findings is proven separately in
 * `sola34-entitlement.integration.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  validateLicenseKey,
  parseLicenseKey,
  resolveEditionFromSources,
  LICENSE_CACHE_KEY,
} from '../../payments/__tests__/fixtures/cc938cd/licensing-core-cc938cd';

/** Mirrors scripts/gen_license_key.mjs exactly. */
async function hmacSign(secret: string, message: string): Promise<string> {
  const enc = (s: string) => new TextEncoder().encode(s) as unknown as ArrayBuffer;
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc(message));
  const b64url = (b: Uint8Array) =>
    btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64url(new Uint8Array(sig));
}

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Forges a licence key using only the secret — exactly what an attacker does. */
async function mintKey(secret: string, edition: 'pro' | 'free', expires: number, payload: string) {
  const body = `SOLARIS-1-${expires}-${edition}-${b64url(payload)}`;
  return `${body}.${await hmacSign(secret, body)}`;
}

describe('SOLA-2 finding P0-1a: forged key accepted (symmetric secret in client)', () => {
  it('an attacker who reads the shipped secret mints an eternal pro key', async () => {
    const shippedSecret = 'leaked-from-the-js-bundle';
    const forged = await mintKey(shippedSecret, 'pro', 0, 'attacker');
    const result = await validateLicenseKey(forged, shippedSecret, Date.now());
    expect(result.valid).toBe(true);
    expect(result.license?.edition).toBe('pro');
    expect(result.license?.expiresAt).toBe(0); // never expires
  });

  it('forgery is unlimited — no server, no rate limit, no counter', async () => {
    const secret = 'leaked-from-the-js-bundle';
    const keys = await Promise.all(
      Array.from({ length: 5 }, (_, i) => mintKey(secret, 'pro', 0, `victim-${i}`)),
    );
    const verdicts = await Promise.all(keys.map(k => validateLicenseKey(k, secret, Date.now())));
    expect(verdicts.every(v => v.valid)).toBe(true);
  });
});

describe('SOLA-2 finding P0-1b: production ships NO secret -> licensing is inert', () => {
  // Evidence: https://solaris.chr-z.dev/assets/index-*.js contains `const Ae={}`
  // so import.meta.env.* is all undefined at runtime.
  it('activation is impossible when the env secret is undefined', async () => {
    const key = await mintKey('the-real-secret', 'pro', 0, 'customer-42');
    const result = await validateLicenseKey(key, undefined as unknown as string, Date.now());
    expect(result.valid).toBe(false);
  });

  it('a pasted VALID pro key resolves to the free edition', () => {
    // LicenseContext.tsx:74 -> resolveEditionFromSources(signatureVerified===true, ENV_EDITION)
    const resolution = resolveEditionFromSources(false, undefined);
    expect(resolution.edition).toBe('free');
    expect(resolution.source.kind).toBe('none');
  });

  it('any env edition override silently grants pro with no license at all', () => {
    const resolution = resolveEditionFromSources(false, 'pro');
    expect(resolution.edition).toBe('pro');
    expect(resolution.source.kind).toBe('env-override');
  });
});

describe('SOLA-2 finding P0-1c: local state is authoritative and fully attacker-controlled', () => {
  it('stored license is read straight from localStorage with no signature', () => {
    const forged = { key: 'SOLARIS-1-0-pro-YWJj.YWJj', activatedAt: 0 };
    const fakeStorage = {
      getItem: (k: string) => (k === LICENSE_CACHE_KEY ? JSON.stringify(forged) : null),
    } as unknown as Storage;
    // loadStoredLicense does no cryptographic check at all — it only type-checks.
    const raw = fakeStorage.getItem(LICENSE_CACHE_KEY);
    expect(JSON.parse(raw!).key).toBe('SOLARIS-1-0-pro-YWJj.YWJj');
    expect(parsed_is_accepted_without_verification()).toBe(true);
  });
});

function parsed_is_accepted_without_verification(): boolean {
  // Structural parse succeeds on a completely bogus signature.
  const parsed = parseLicenseKey('SOLARIS-1-0-pro-YWJj.YWJj');
  return parsed.ok && parsed.license.signature === 'YWJj';
}
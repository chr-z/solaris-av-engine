import { describe, it, expect } from 'vitest';
import {
  fromBase64Url,
  licenseOfflineCutoff,
  parseLicenseToken,
  toBase64Url,
  verifyLicenseToken,
} from '../token';
import { newTestKeyPair, issueTestToken } from './keypair';

const NOW = Date.now();

describe('base64url helpers', () => {
  it('round-trips and rejects invalid input', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 62, 63]);
    const encoded = toBase64Url(bytes);
    expect(fromBase64Url(encoded)).toEqual(bytes);
    expect(fromBase64Url('a+b')).toBeNull(); // non-url alphabet
    expect(fromBase64Url('a/b')).toBeNull();
    expect(fromBase64Url('')).toBeNull();
  });
});

describe('Ed25519 licence token — structure', () => {
  it('parses a real issued token', async () => {
    const pair = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(pair, { subject: 'order:P1001' });
    const parsed = parseLicenseToken(token);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.header.kid).toBe('kid-1');
      expect(parsed.header.alg).toBe('Ed25519');
      expect(parsed.claims.edition).toBe('pro');
      expect(parsed.claims.sub).toBe('order:P1001');
    }
  });

  it('rejects malformed tokens for every structural reason', () => {
    expect(parseLicenseToken(null).ok).toBe(false);
    expect(parseLicenseToken('').ok).toBe(false);
    expect(parseLicenseToken('not-a-token').ok).toBe(false);
    expect(parseLicenseToken('a.b').ok).toBe(false); // 2 segments
    expect(parseLicenseToken('a.b.c.d').ok).toBe(false); // 4 segments
    expect(parseLicenseToken('!!!.@@@.###').ok).toBe(false);
    // Valid base64url but not JSON
    expect(parseLicenseToken(`${toBase64Url(new TextEncoder().encode('nope'))}.x.y`).ok).toBe(false);
    // Legacy HMAC format must fail closed
    expect(parseLicenseToken('SOLARIS-1-0-pro-dGVzdA.c2ln').ok).toBe(false);
  });
});

describe('Ed25519 licence token — verification', () => {
  it('accepts a real token and rejects a forged one from a different key', async () => {
    const issuer = await newTestKeyPair('issuer');
    const attacker = await newTestKeyPair('attacker');
    const { token } = await issueTestToken(issuer, { subject: 'customer-42', issuedAt: NOW });

    const good = await verifyLicenseToken(token, issuer.publicKeys, NOW);
    expect(good.valid).toBe(true);

    // The attacker does not hold the issuer's private key.
    const forged = await verifyLicenseToken(token, attacker.publicKeys, Date.now());
    expect(forged).toMatchObject({ valid: false, reason: 'unknown-kid' });
  });

  it('rejects a token whose payload was tampered after signing', async () => {
    const pair = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(pair, { subject: 'victim' });
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    payload.sub = 'attacker';
    payload.edition = 'pro';
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tampered = `${h}.${tamperedPayload}.${s}`;
    expect(await verifyLicenseToken(tampered, pair.publicKeys, Date.now())).toMatchObject({
      valid: false,
      reason: 'bad-signature',
    });
  });

  it('rejects an unknown kid (rotated/compromised key)', async () => {
    const pair = await newTestKeyPair('old-kid');
    const { token } = await issueTestToken(pair);
    expect(await verifyLicenseToken(token, { 'new-kid': pair.publicKeyB64u }, Date.now())).toMatchObject({
      valid: false,
      reason: 'unknown-kid',
    });
  });

  it('honours the absolute grace window: past exp is valid, past grace_exp is expired', async () => {
    const pair = await newTestKeyPair('kid-1');
    const issuedAt = 1_700_000_000_000;
    const termEndsAt = issuedAt + 1000;
    const graceEndsAt = termEndsAt + 1000; // absolute offline cutoff
    const { token } = await issueTestToken(pair, { issuedAt, termEndsAt, graceEndsAt });

    // Inside the paid term
    expect((await verifyLicenseToken(token, pair.publicKeys, issuedAt + 500)).valid).toBe(true);
    // Past exp but inside grace (outage tolerance) — still valid
    const inGrace = await verifyLicenseToken(token, pair.publicKeys, termEndsAt + 500);
    expect(inGrace.valid).toBe(true);
    // Past the absolute cutoff — expired, claims still returned for the matrix
    const expired = await verifyLicenseToken(token, pair.publicKeys, graceEndsAt + 1);
    expect(expired).toMatchObject({ valid: false, reason: 'expired' });
    expect(expired.claims?.grace_exp).toBe(graceEndsAt);
  });

  it('rejects a not-yet-valid token', async () => {
    const pair = await newTestKeyPair('kid-1');
    const issuedAt = 2_000_000_000_000;
    const { token } = await issueTestToken(pair, { issuedAt, termEndsAt: issuedAt + 1000, graceEndsAt: issuedAt + 2000 });
    expect(await verifyLicenseToken(token, pair.publicKeys, issuedAt - 10_000)).toMatchObject({
      valid: false,
      reason: 'not-yet-valid',
    });
  });

  it('is delimiter-safe: a subject containing -, +, ., / and emoji still verifies', async () => {
    const pair = await newTestKeyPair('kid-1');
    const subject = 'order:zz>>+/.-é😀';
    const { token } = await issueTestToken(pair, { subject, issuedAt: NOW });
    const parsed = parseLicenseToken(token);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.claims.sub).toBe(subject);
    expect((await verifyLicenseToken(token, pair.publicKeys, NOW)).valid).toBe(true);
  });

  it('exposes the offline cutoff with grace first', async () => {
    expect(licenseOfflineCutoff({ edition: 'pro', sub: 'x', iat: 0, exp: 100, grace_exp: 200 })).toBe(200);
    expect(licenseOfflineCutoff({ edition: 'pro', sub: 'x', iat: 0, exp: 100, grace_exp: 0 })).toBe(100);
  });
});

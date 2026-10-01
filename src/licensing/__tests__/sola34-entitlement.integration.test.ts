/**
 * SOLA-34 acceptance: the entitlement path end to end.
 *
 * Proves the four "Done when" behaviours at the logic level:
 *  - a real purchased key unlocks Pro;
 *  - a forged key is rejected via a server round-trip;
 *  - tampered localStorage does not grant entitlement;
 *  - outage / expiry / revocation follow the decided matrix.
 *
 * The built-bundle check (`scripts/check_bundle_secrets.mjs`) covers the fifth.
 */

import { describe, it, expect } from 'vitest';
import {
  LICENSE_CACHE_KEY,
  loadStoredEntitlement,
  persistStoredEntitlement,
  resolveEditionFromSources,
  verifyLocalEntitlement,
} from '../core';
import { handleActivate, handleRevalidate } from '../server/http';
import { MemoryActivationStore, activateLicense } from '../server/activation';
import { newTestKeyPair, issueTestToken } from './keypair';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function memoryStorage(seed?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('SOLA-34 · real key unlocks Pro', () => {
  it('issues a key, verifies it locally, and resolves to Pro', async () => {
    const issuer = await newTestKeyPair('sol-2026a');
    const { token } = await issueTestToken(issuer, {
      subject: 'order:P1001',
      issuedAt: NOW - DAY,
      termEndsAt: NOW + 364 * DAY,
      graceEndsAt: NOW + 394 * DAY,
    });

    const local = await verifyLocalEntitlement(token, NOW, issuer.publicKeys);
    expect(local.verified).toBe(true);
    expect(local.claims?.edition).toBe('pro');
    expect(resolveEditionFromSources(local.verified && local.claims?.edition === 'pro', undefined)).toEqual({
      edition: 'pro',
      source: { kind: 'stored-license' },
    });
  });
});

describe('SOLA-34 · forged key rejected via server round-trip', () => {
  it('the server denies a token signed by a key it does not trust', async () => {
    const attacker = await newTestKeyPair('attacker');
    const serverRing = (await newTestKeyPair('sol-2026a')).publicKeys;
    const { token } = await issueTestToken(attacker, { subject: 'order:ATTACKER', issuedAt: NOW - DAY });

    const res = await handleActivate({ token }, { publicKeys: serverRing, store: new MemoryActivationStore() });
    expect(res.status).toBe(200); // authoritative denial, not an outage
    expect(res.body.entitled).toBe(false);
    expect(res.body.status).toBe('invalid');
  });

  it('the client rejects the same forged key before any network call', async () => {
    const attacker = await newTestKeyPair('attacker');
    const clientRing = (await newTestKeyPair('sol-2026a')).publicKeys;
    const { token } = await issueTestToken(attacker, { subject: 'order:ATTACKER', issuedAt: NOW - DAY });
    expect(await verifyLocalEntitlement(token, NOW, clientRing)).toMatchObject({ verified: false, reason: 'unknown-kid' });
  });
});

describe('SOLA-34 · tampered localStorage grants nothing', () => {
  it('a fabricated cache record resolves to free', async () => {
    const storage = memoryStorage({
      [LICENSE_CACHE_KEY]: JSON.stringify({ token: 'a.b.c', activationId: 'forged', verifiedAt: NOW }),
    });
    const entry = loadStoredEntitlement(storage);
    expect(entry?.token).toBe('a.b.c'); // type-check passes…
    const local = await verifyLocalEntitlement(entry?.token, NOW);
    expect(local.verified).toBe(false); // …but the token does not verify
    expect(resolveEditionFromSources(false, undefined).edition).toBe('free');
  });

  it('extending the cache window does not extend the signed entitlement', async () => {
    const issuer = await newTestKeyPair('sol-2026a');
    const { token } = await issueTestToken(issuer, {
      issuedAt: NOW - 2 * DAY,
      termEndsAt: NOW - DAY,
      graceEndsAt: NOW - 1000, // already past the absolute cutoff
    });
    const tampered = JSON.stringify({ token, activationId: 'x', verifiedAt: NOW + 10 * DAY });
    const storage = memoryStorage({ [LICENSE_CACHE_KEY]: tampered });
    const entry = loadStoredEntitlement(storage);
    expect(await verifyLocalEntitlement(entry?.token, NOW, issuer.publicKeys)).toMatchObject({
      verified: false,
      reason: 'expired',
    });
  });

  it('persist/load round-trips a legitimate cache entry', () => {
    const storage = memoryStorage();
    persistStoredEntitlement(storage, { token: 't.t.t', activationId: 'a1', verifiedAt: NOW });
    expect(loadStoredEntitlement(storage)).toEqual({ token: 't.t.t', activationId: 'a1', verifiedAt: NOW });
    persistStoredEntitlement(storage, null);
    expect(loadStoredEntitlement(storage)).toBeNull();
  });
});

describe('SOLA-34 · outage / expiry / revocation matrix', () => {
  it('outage: the signed token keeps Pro working until grace_exp, then stops', async () => {
    const issuer = await newTestKeyPair('sol-2026a');
    const { token } = await issueTestToken(issuer, {
      issuedAt: NOW - 10 * DAY,
      termEndsAt: NOW - DAY, // term already over
      graceEndsAt: NOW + 20 * DAY, // absolute server-issued cutoff
    });
    // No server call at all (outage) — still entitled while inside grace.
    expect((await verifyLocalEntitlement(token, NOW, issuer.publicKeys)).verified).toBe(true);
    // After the absolute cutoff, free — offline revocation lag is bounded.
    expect(await verifyLocalEntitlement(token, NOW + 21 * DAY, issuer.publicKeys)).toMatchObject({
      verified: false,
      reason: 'expired',
    });
  });

  it('expiry: a token past grace is denied on activation', async () => {
    const pair = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(pair, {
      issuedAt: NOW - 10 * DAY,
      termEndsAt: NOW - 9 * DAY,
      graceEndsAt: NOW - 8 * DAY,
    });
    const res = await handleActivate({ token }, { publicKeys: pair.publicKeys, store: new MemoryActivationStore() });
    expect(res.body).toMatchObject({ entitled: false, status: 'expired' });
  });

  it('revocation: revalidation denies a revoked activation', async () => {
    const pair = await newTestKeyPair('kid-1');
    const store = new MemoryActivationStore();
    const { token } = await issueTestToken(pair, { issuedAt: NOW - DAY, subject: 'order:P2' });
    const activated = await activateLicense({ token, publicKeys: pair.publicKeys, store, now: NOW });
    store.revokeSubject('order:P2', NOW + 1, 'chargeback');
    const res = await handleRevalidate(
      { token, activationId: activated.activationId! },
      { publicKeys: pair.publicKeys, store, now: NOW + 1 },
    );
    expect(res.body).toMatchObject({ entitled: false, status: 'revoked' });
  });
});

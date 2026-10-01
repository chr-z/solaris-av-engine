import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_ACTIVATIONS,
  MemoryActivationStore,
  activateLicense,
  revalidateActivation,
} from '../activation';
import { newTestKeyPair, issueTestToken } from '../../__tests__/keypair';

const NOW = 1_700_000_000_000;

function baseInput(pair: Awaited<ReturnType<typeof newTestKeyPair>>, token: string, store = new MemoryActivationStore()) {
  return { token, publicKeys: pair.publicKeys, store, now: NOW };
}

describe('server-side activation', () => {
  it('activates a valid Pro token and reports server-issued bounds', async () => {
    const pair = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    const result = await activateLicense(baseInput(pair, token));
    expect(result.entitled).toBe(true);
    expect(result.status).toBe('active');
    expect(result.edition).toBe('pro');
    expect(result.activationId).toBeTruthy();
    expect(result.graceExp).toBeGreaterThan(NOW);
  });

  it('is idempotent for the same token (no double counting)', async () => {
    const pair = await newTestKeyPair('kid-1');
    const store = new MemoryActivationStore();
    const { token } = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    const first = await activateLicense(baseInput(pair, token, store));
    const second = await activateLicense(baseInput(pair, token, store));
    expect(second.activationId).toBe(first.activationId);
    expect(store.countForSubject('order:P1')).toBe(1);
  });

  it('enforces the per-subject activation ceiling', async () => {
    const pair = await newTestKeyPair('kid-1');
    const store = new MemoryActivationStore();
    const a = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    const b = await issueTestToken(pair, { issuedAt: NOW - 2000, subject: 'order:P1' });
    const first = await activateLicense({ ...baseInput(pair, a.token, store), maxActivations: 1 });
    const second = await activateLicense({ ...baseInput(pair, b.token, store), maxActivations: 1 });
    expect(first.entitled).toBe(true);
    expect(second).toMatchObject({ entitled: false, status: 'activation_limit' });
    expect(DEFAULT_MAX_ACTIVATIONS).toBeGreaterThan(1);
  });

  it('rejects a free-edition token as not a Pro entitlement', async () => {
    const pair = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(pair, { edition: 'free', subject: 'order:P1' });
    expect(await activateLicense(baseInput(pair, token))).toMatchObject({
      entitled: false,
      status: 'invalid',
      reason: 'not_a_pro_token',
    });
  });

  it('rejects a forged/unknown-kid token', async () => {
    const issuer = await newTestKeyPair('issuer');
    const other = await newTestKeyPair('other');
    const { token } = await issueTestToken(issuer, { issuedAt: NOW - 1000 });
    expect(await activateLicense(baseInput(other, token))).toMatchObject({
      entitled: false,
      status: 'invalid',
      reason: 'token_unknown-kid',
    });
  });

  it('marks past-grace tokens expired', async () => {
    const pair = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(pair, {
      issuedAt: NOW - 5000,
      termEndsAt: NOW - 4000,
      graceEndsAt: NOW - 3000,
    });
    expect(await activateLicense(baseInput(pair, token))).toMatchObject({
      entitled: false,
      status: 'expired',
      reason: 'token_expired',
    });
  });

  it('grants grace when past the paid term but inside the absolute cutoff', async () => {
    const pair = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(pair, {
      issuedAt: NOW - 5000,
      termEndsAt: NOW - 1000,
      graceEndsAt: NOW + 10_000,
    });
    const result = await activateLicense(baseInput(pair, token));
    expect(result).toMatchObject({ entitled: true, status: 'grace', edition: 'pro' });
  });

  it('revocation takes effect for a subject and for a single activation', async () => {
    const pair = await newTestKeyPair('kid-1');
    const store = new MemoryActivationStore();
    const { token } = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    const activated = await activateLicense(baseInput(pair, token, store));
    expect(activated.activationId).toBeTruthy();

    store.revoke(activated.activationId!, NOW, 'chargeback');
    expect(await revalidateActivation({
      token,
      activationId: activated.activationId!,
      publicKeys: pair.publicKeys,
      store,
      now: NOW + 1,
    })).toMatchObject({ entitled: false, status: 'revoked' });

    // A different key of the same subject was already revoked too.
    store.revokeSubject('order:P1', NOW, 'refund');
    expect(store.countForSubject('order:P1')).toBe(0);
  });

  it('revalidate rejects unknown activations and token/activation mismatches', async () => {
    const pair = await newTestKeyPair('kid-1');
    const store = new MemoryActivationStore();
    const a = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    const b = await issueTestToken(pair, { issuedAt: NOW - 2000, subject: 'order:P1' });
    const activated = await activateLicense(baseInput(pair, a.token, store));

    expect(await revalidateActivation({
      token: a.token,
      activationId: 'does-not-exist',
      publicKeys: pair.publicKeys,
      store,
      now: NOW,
    })).toMatchObject({ status: 'invalid', reason: 'unknown_activation' });

    expect(await revalidateActivation({
      token: b.token,
      activationId: activated.activationId!,
      publicKeys: pair.publicKeys,
      store,
      now: NOW,
    })).toMatchObject({ status: 'invalid', reason: 'activation_token_mismatch' });
  });
});

describe('SOLA-34 remediation · adversarial controls', () => {
  it('R-03: a revoked subject cannot activate with a different valid token', async () => {
    const pair = await newTestKeyPair('kid-1');
    const store = new MemoryActivationStore();
    const a = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    const b = await issueTestToken(pair, { issuedAt: NOW - 2000, subject: 'order:P1' });
    expect((await activateLicense(baseInput(pair, a.token, store))).entitled).toBe(true);

    store.revokeSubject('order:P1', NOW + 1, 'chargeback');
    // Previously the second token activated cleanly (Riven R-03).
    expect(await activateLicense({ ...baseInput(pair, b.token, store), now: NOW + 2 })).toMatchObject({
      entitled: false,
      status: 'revoked',
    });
  });

  it('R-04: a concurrent activation burst cannot exceed the ceiling', async () => {
    const pair = await newTestKeyPair('kid-1');
    const store = new MemoryActivationStore();
    const tokens = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        issueTestToken(pair, { issuedAt: NOW - 1000 - i * 1000, subject: 'order:BURST' }),
      ),
    );
    const results = await Promise.all(
      tokens.map(t => activateLicense({ token: t.token, publicKeys: pair.publicKeys, store, now: NOW, maxActivations: 5 })),
    );
    const granted = results.filter(r => r.entitled).length;
    expect(granted).toBe(5);
    expect(store.countForSubject('order:BURST')).toBe(5);
  });

  it('R-07: an invalid maxActivations configuration fails closed', async () => {
    const pair = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    for (const bad of [-1, 0, Number.NaN]) {
      expect(
        await activateLicense({ token, publicKeys: pair.publicKeys, store: new MemoryActivationStore(), now: NOW, maxActivations: bad }),
      ).toMatchObject({ entitled: false, reason: 'invalid_max_activations_config' });
    }
  });
});

import { describe, it, expect } from 'vitest';
import { deriveGraceEnd, issueLicenseToken } from '../issue';
import { createWebhookSignature, MemoryReplayStore, timingSafeEqualHex, verifyWebhookSignature } from '../webhook';
import { handleActivate, handlePaymentWebhook, handleRevalidate, type WebhookApiDeps } from '../http';
import { MemoryActivationStore } from '../activation';
import { verifyLicenseToken } from '../../token';
import { newTestKeyPair, issueTestToken } from '../../__tests__/keypair';

const NOW = 1_700_000_000_000;

describe('issuance guards', () => {
  it('refuses to mint an eternal token with no term and no grace', async () => {
    const pair = await newTestKeyPair('kid-1');
    await expect(
      issueLicenseToken(
        { kid: 'kid-1', subject: 'x', edition: 'pro', issuedAt: NOW, termEndsAt: 0, graceEndsAt: 0 },
        pair.sign,
      ),
    ).rejects.toThrow(/eternal/);
  });

  it('refuses a grace cutoff before the term ends', async () => {
    const pair = await newTestKeyPair('kid-1');
    await expect(
      issueLicenseToken(
        { kid: 'kid-1', subject: 'x', edition: 'pro', issuedAt: NOW, termEndsAt: NOW + 10_000, graceEndsAt: NOW + 5_000 },
        pair.sign,
      ),
    ).rejects.toThrow(/graceEndsAt precedes/);
  });

  it('derives an absolute grace end after the term', () => {
    expect(deriveGraceEnd(NOW, NOW, 1000)).toBe(NOW + 1000);
    expect(deriveGraceEnd(0, NOW, 1000)).toBe(NOW + 1000);
  });
});

describe('webhook transport verification', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ subject: 'order:P1', termDays: 365 });

  it('accepts a correctly signed, fresh webhook', async () => {
    const header = await createWebhookSignature(secret, Math.floor(NOW / 1000), body);
    expect(await verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now: NOW })).toMatchObject({
      ok: true,
    });
  });

  it('rejects a bad signature', async () => {
    const header = await createWebhookSignature('wrong-secret', Math.floor(NOW / 1000), body);
    expect(await verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now: NOW })).toMatchObject({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a replayed or stale timestamp', async () => {
    const stale = await createWebhookSignature(secret, Math.floor((NOW - 10 * 60 * 1000) / 1000), body);
    expect(await verifyWebhookSignature({ rawBody: body, signatureHeader: stale, secret, now: NOW })).toMatchObject({
      ok: false,
      reason: 'timestamp_out_of_window',
    });
  });

  it('detects replay via the durable replay store', async () => {
    const header = await createWebhookSignature(secret, Math.floor(NOW / 1000), body);
    const store = new MemoryReplayStore();
    const first = await verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now: NOW, eventId: 'evt-1', replayStore: store });
    const second = await verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now: NOW, eventId: 'evt-1', replayStore: store });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: 'replay' });
  });

  it('fails closed when an event id is present but no replay store is supplied', async () => {
    const header = await createWebhookSignature(secret, Math.floor(NOW / 1000), body);
    expect(
      await verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now: NOW, eventId: 'evt-1' }),
    ).toMatchObject({ ok: false, reason: 'replay_store_unavailable' });
  });

  it('a tampered body fails even with a valid-looking header', async () => {
    const header = await createWebhookSignature(secret, Math.floor(NOW / 1000), body);
    expect(
      await verifyWebhookSignature({ rawBody: `${body} `, signatureHeader: header, secret, now: NOW }),
    ).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('compares hex in constant time semantics (equal length only)', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false);
  });
});

describe('HTTP handlers', () => {
  it('handleActivate rejects a forged token with 200 + entitled:false (server round-trip)', async () => {
    const issuer = await newTestKeyPair('issuer');
    const other = await newTestKeyPair('other');
    const { token } = await issueTestToken(issuer);
    const res = await handleActivate({ token }, { publicKeys: other.publicKeys, store: new MemoryActivationStore(), now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.entitled).toBe(false);
  });

  it('handleActivate accepts a real token and returns an activation id', async () => {
    const pair = await newTestKeyPair('kid-1');
    const store = new MemoryActivationStore();
    const { token } = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    const res = await handleActivate({ token }, { publicKeys: pair.publicKeys, store, now: NOW });
    expect(res.body).toMatchObject({ entitled: true, status: 'active', edition: 'pro' });
    expect(typeof res.body.activationId).toBe('string');
  });

  it('handleRevalidate reports revocation', async () => {
    const pair = await newTestKeyPair('kid-1');
    const store = new MemoryActivationStore();
    const { token } = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    const activated = await handleActivate({ token }, { publicKeys: pair.publicKeys, store, now: NOW });
    const activationId = activated.body.activationId as string;
    store.revoke(activationId, NOW, 'refund');
    const res = await handleRevalidate({ token, activationId }, { publicKeys: pair.publicKeys, store, now: NOW });
    expect(res.body).toMatchObject({ entitled: false, status: 'revoked' });
  });

  it('R-09: rejects a malformed/oversized activationId before it reaches the store', async () => {
    const pair = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(pair, { issuedAt: NOW - 1000 });
    const res = await handleRevalidate(
      { token, activationId: 'x'.repeat(65536) },
      { publicKeys: pair.publicKeys, store: new MemoryActivationStore(), now: NOW },
    );
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('missing_activation_id');
  });

  it('R-10: a denial never reflects the attacker-controlled subject or reason', async () => {
    const attacker = await newTestKeyPair('attacker');
    const server = await newTestKeyPair('sol-2026a');
    const { token } = await issueTestToken(attacker, {
      issuedAt: NOW - 1000,
      subject: 'INJECTED<script>alert(1)</script>',
    });
    const res = await handleActivate({ token }, { publicKeys: server.publicKeys, store: new MemoryActivationStore(), now: NOW });
    expect(res.body).toMatchObject({ entitled: false, status: 'invalid', edition: 'free' });
    expect(res.body.subject).toBeUndefined();
    expect(res.body.reason).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('INJECTED');
  });
});

describe('webhook → issuance pipeline', () => {
  it('refuses issuance when the transport signature is invalid', async () => {
    const pair = await newTestKeyPair('kid-1');
    const deps: WebhookApiDeps = {
      publicKeys: pair.publicKeys,
      store: new MemoryActivationStore(),
      webhookSecret: 'whsec_test',
      sign: pair.sign,
      kid: pair.kid,
      now: NOW,
      replayStore: new MemoryReplayStore(),
      resolveGrant: () => ({ subject: 'order:P1' }),
    };
    const res = await handlePaymentWebhook('{"subject":"order:P1"}', 't=1,v1=deadbeef', 'evt-1', deps);
    expect(res.status).toBe(401);
    expect(res.body.issued).toBeUndefined();
  });

  it('issues a token that verifies and activates after a valid webhook', async () => {
    const pair = await newTestKeyPair('kid-1');
    const body = JSON.stringify({ subject: 'order:P1', termDays: 365 });
    const header = await createWebhookSignature('whsec_test', Math.floor(NOW / 1000), body);
    const deps: WebhookApiDeps = {
      publicKeys: pair.publicKeys,
      store: new MemoryActivationStore(),
      webhookSecret: 'whsec_test',
      sign: pair.sign,
      kid: pair.kid,
      now: NOW,
      replayStore: new MemoryReplayStore(),
      resolveGrant: raw => {
        const parsed = JSON.parse(raw) as { subject: string };
        return { subject: parsed.subject };
      },
    };
    const res = await handlePaymentWebhook(body, header, 'evt-1', deps);
    expect(res.status).toBe(200);
    expect(res.body.issued).toBe(true);
    const token = res.body.token as string;
    expect((await verifyLicenseToken(token, pair.publicKeys, NOW)).valid).toBe(true);
  });

  it('rejects a replayed delivery at the adapter level (same event id)', async () => {
    const pair = await newTestKeyPair('kid-1');
    const body = JSON.stringify({ subject: 'order:P1', termDays: 365 });
    const header = await createWebhookSignature('whsec_test', Math.floor(NOW / 1000), body);
    const deps: WebhookApiDeps = {
      publicKeys: pair.publicKeys,
      store: new MemoryActivationStore(),
      webhookSecret: 'whsec_test',
      sign: pair.sign,
      kid: pair.kid,
      now: NOW,
      replayStore: new MemoryReplayStore(),
      resolveGrant: raw => ({ subject: (JSON.parse(raw) as { subject: string }).subject }),
    };
    const first = await handlePaymentWebhook(body, header, 'evt-dup', deps);
    const second = await handlePaymentWebhook(body, header, 'evt-dup', deps);
    expect(first.status).toBe(200);
    expect(first.body.issued).toBe(true);
    expect(second.status).toBe(401);
    expect(second.body.reason).toBe('replay');
    expect(second.body.token).toBeUndefined();
  });
});

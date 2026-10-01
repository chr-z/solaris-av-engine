/**
 * SOLA-23 (Riven) — adversarial proof-of-concept suite for the SOLA-6
 * payment → licence binding model reviewed at commit `cc938cd`.
 *
 * These tests do NOT assert desired behaviour. Each one asserts that a
 * trust-boundary weakness IS PRESENT, so that a future fix flips the test red.
 * A passing run of this file is evidence of a finding, not of correctness.
 *
 * Nothing here contacts a network, a PSP or a bank, and no real payment is
 * involved: every "settlement" is a hand-built object literal.
 */

import { describe, it, expect } from 'vitest';
import {
  bindPaymentToLicense,
  confirmSettlement,
  settlementFingerprint,
  type Confirmation,
  type Order,
  type SettlementEvent,
} from '../index';
/**
 * Frozen snapshot of `src/licensing/core.ts` at the reviewed commit `cc938cd`.
 *
 * This review is pinned to that commit. The licensing core is concurrently
 * being refactored in the worktree (Ed25519 server-side entitlement work), which
 * removes the HMAC exports these assertions exercise. Importing the snapshot
 * keeps every F-01/F-02/F-09 assertion a faithful test of the code that was
 * actually reviewed, and keeps this suite green as that refactor lands.
 */
import {
  parseLicenseKey,
  validateLicenseKey,
  verifyLicenseSignature,
} from './fixtures/cc938cd/licensing-core-cc938cd';

// --- Minimal re-implementation of scripts/gen_license_key.mjs -----------------
// Kept byte-identical to the shipped generator (HMAC-SHA256 via WebCrypto, the
// same base64url alphabet) so the forged keys below are exactly what the real
// generator would emit.

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function mintKey(
  secret: string,
  edition: 'pro' | 'free',
  expires: string,
  payload: string,
): Promise<string> {
  const enc = (s: string) => new TextEncoder().encode(s);
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const body = `SOLARIS-1-${expires}-${edition}-${b64url(enc(payload))}`;
  const sig = await crypto.subtle.sign('HMAC', key, enc(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/**
 * The literal recovered from a production-shaped client bundle. Reproduced by
 * building any module that reads `import.meta.env.VITE_SOLARIS_LICENSE_SECRET`
 * with that variable set: Vite statically inlines the *value* into the emitted
 * chunk as a plaintext string constant.
 */
const SECRET_FROM_CLIENT_BUNDLE = 'SUPER-SECRET-hmac-key-do-not-ship-9f2c';

const order = (o: Partial<Order> = {}): Order => ({
  id: 'P1001',
  amountCents: 15000,
  currency: 'BRL',
  status: 'open',
  document: '11122233344',
  pixKey: 'pro@acme.com',
  ...o,
});

const event = (e: Partial<SettlementEvent> = {}): SettlementEvent => ({
  eventId: 'evt-1',
  source: 'psp_webhook',
  sourceVerified: true,
  amountCents: 15000,
  paidAt: 1_700_000_000_000,
  txId: 'P1001',
  ...e,
});

// =============================================================================
// F-01  CRITICAL — the licence signing secret is a client-bundle constant.
// =============================================================================

describe('F-01 CRITICAL: anyone who reads the bundle can mint a Pro licence', () => {
  it('a Pro key signed with the bundle-embedded secret validates on the client', async () => {
    const forged = await mintKey(SECRET_FROM_CLIENT_BUNDLE, 'pro', '0', 'order:ATTACKER');
    expect(forged.startsWith('SOLARIS-1-0-pro-')).toBe(true);

    const result = await validateLicenseKey(forged, SECRET_FROM_CLIENT_BUNDLE, Date.now());
    expect(result.valid).toBe(true);
    expect(result.license?.edition).toBe('pro');
  });

  it('expiry is attacker-chosen and clock-rolled-back expiry validates', async () => {
    // --expires 0 is the generator default and 0 means "never expires", so a
    // forged entitlement is unrevokable and time-independent.
    const neverExpires = await mintKey(SECRET_FROM_CLIENT_BUNDLE, 'pro', '0', 'order:ATTACKER');
    const farFuture = await validateLicenseKey(neverExpires, SECRET_FROM_CLIENT_BUNDLE, 9_999_999_999_999);
    expect(farFuture.valid).toBe(true);

    // A genuinely expired key validates against a client clock set in the past:
    // expiry is enforced only against the user's own clock.
    const expired = await mintKey(SECRET_FROM_CLIENT_BUNDLE, 'pro', '1000', 'order:ATTACKER');
    expect((await validateLicenseKey(expired, SECRET_FROM_CLIENT_BUNDLE, 500)).valid).toBe(true);
    expect((await validateLicenseKey(expired, SECRET_FROM_CLIENT_BUNDLE, 5_000)).valid).toBe(false);
  });
});

// =============================================================================
// F-02  HIGH — licence-key delimiter defect: unparseable keys, no recovery.
// =============================================================================

describe('F-02 HIGH: payload base64url containing "-" yields an unparseable key', () => {
  it('exact documented repro: order:>>>', async () => {
    // docs/pix-payment-binding.md §6.3 repro, confirmed.
    expect(Buffer.from('order:>>>').toString('base64')).toBe('b3JkZXI6Pj4+');
    const key = await mintKey(SECRET_FROM_CLIENT_BUNDLE, 'pro', '0', 'order:>>>');
    const body = key.slice(0, key.lastIndexOf('.'));
    expect(body.split('-').length).toBe(6);
    expect(parseLicenseKey(key)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('end-to-end: a settled order whose id triggers it yields an unusable licence', async () => {
    // Real pipeline: settlement -> confirmation -> grant -> key.
    const paid = order({ id: '>>>', reference: undefined });
    const confirmation = confirmSettlement(paid, event({ txId: '>>>' }));
    expect(confirmation.ok).toBe(true);

    const issued = bindPaymentToLicense(confirmation, paid);
    expect(issued.ok && issued.grant.payload).toBe('order:>>>');

    const key = await mintKey(SECRET_FROM_CLIENT_BUNDLE, 'pro', '0', issued.ok ? issued.grant.payload : '');
    // Money settled, licence issued, customer cannot activate:
    expect(await validateLicenseKey(key, SECRET_FROM_CLIENT_BUNDLE, Date.now())).toEqual({ valid: false });
  });

  it('the trigger is narrow but real: only base64 "+" breaks it, not alnum ids', async () => {
    // Refines the doc claim: UUID/ULID order ids are safe; ids whose 3-byte group
    // lands on "+" are not. Severity is availability, not privilege escalation,
    // because the parser is fail-closed.
    const safe = await mintKey(SECRET_FROM_CLIENT_BUNDLE, 'pro', '0', 'order:9f2c1a3e-5b7d-4c11-9a2f-6d8e0c1b3a4d');
    expect(parseLicenseKey(safe).ok).toBe(true);
    const broken = await mintKey(SECRET_FROM_CLIENT_BUNDLE, 'pro', '0', 'order:zz>>');
    expect(parseLicenseKey(broken)).toEqual({ ok: false, reason: 'malformed' });
  });
});

// =============================================================================
// F-03  CRITICAL — `sourceVerified` is a caller-supplied boolean, not an
//        enforced property. The trust boundary is the caller's honesty.
// =============================================================================

describe('F-03 CRITICAL: sourceVerified is spoofable by the caller', () => {
  it('the same settlement is rejected when honestly labelled manual_import', () => {
    // This is the gate working — but only because the caller told the truth.
    const result = confirmSettlement(
      order(),
      event({ source: 'manual_import', sourceVerified: false }),
    );
    expect(result).toEqual({ ok: false, reason: 'unverified_source' });
  });

  it('relabelling the untrusted object to psp_webhook + verified auto-confirms it', () => {
    // A CSV row / chat paste / user assertion is just a plain object. Flipping
    // two fields on attacker-reachable data crosses the boundary. Nothing in
    // src/payments verifies a signature, a TLS peer or a bank.
    const untrustedInput = {
      amountCents: 15000,
      payerDocument: '11122233344',
      eventId: 'row-17',
    };
    const result = confirmSettlement(
      order(),
      {
        ...untrustedInput,
        source: 'psp_webhook',
        sourceVerified: true,
        paidAt: Date.now(),
      },
    );
    expect(result).toMatchObject({ ok: true, orderId: 'P1001', rule: 'document+amount' });
  });

  it('a webhook body containing sourceVerified:true is self-asserting', () => {
    // If the ingress adapter spreads the parsed request body into
    // SettlementEvent, the attacker supplies the flag. There is no code path in
    // this module that can tell the difference.
    const body = JSON.parse('{"source":"psp_webhook","sourceVerified":true,"amountCents":15000,"txId":"P1001"}');
    const result = confirmSettlement(order(), { ...body, eventId: 'x', paidAt: 1 });
    expect(result).toMatchObject({ ok: true, rule: 'txId' });
  });

  it('manual_import cannot auto-confirm under the DEFAULT policy — this part holds', () => {
    // The doc's claim is correct for the default policy: even a verified
    // manual_import is refused.
    const result = confirmSettlement(order(), event({ source: 'manual_import', sourceVerified: true }));
    expect(result).toEqual({ ok: false, reason: 'source_not_auto' });
  });

  it('but a caller-supplied policy re-opens manual_import auto-confirmation', () => {
    // `policy` is an ordinary function argument, so the trust boundary is
    // configurable by whoever calls confirmSettlement. An operator import
    // adapter that passes a widened policy turns every CSV row into a licence.
    const policy = {
      toleranceCents: 1,
      autoConfirmSources: ['manual_import', 'psp_webhook', 'bank_api'] as const,
    };
    expect(
      confirmSettlement(order(), event({ source: 'manual_import', sourceVerified: true }), { policy }),
    ).toMatchObject({ ok: true });
  });

  it('so sourceVerified is the single decisive bit, and it is caller-authored', () => {
    // One flag decides everything. Nothing in this module validates a signature.
    const variants = [
      { source: 'psp_webhook', sourceVerified: true },
      { source: 'bank_api', sourceVerified: true },
      { source: 'psp_webhook', sourceVerified: false },
      { source: 'manual_import', sourceVerified: false },
    ] as const;
    const outcomes = variants.map(v => confirmSettlement(order(), event(v)).ok);
    expect(outcomes).toEqual([true, true, false, false]);
  });
});

// =============================================================================
// F-04  HIGH — ambiguity is NOT always reported: identifier collisions are
//        silently resolved by whichever order the caller passes in.
// =============================================================================

describe('F-04 HIGH: document / pixKey collisions silently confirm an order', () => {
  const orderA = order({ id: 'P1001', document: '11122233344', pixKey: 'pro@acme.com' });
  const orderB = order({ id: 'P1002', document: '11122233344', pixKey: 'pro@acme.com' });

  it('two open orders share the payer document; the module picks the caller order', () => {
    const ambiguous = event({ e2eId: undefined, txId: undefined, payerDocument: '111.222.333-44' });
    expect(confirmSettlement(orderA, ambiguous, { openOrders: [orderA, orderB] })).toMatchObject({
      ok: true,
      rule: 'document+amount',
    });
  });

  it('identical collision via a shared Pix key', () => {
    const ambiguous = event({ e2eId: undefined, txId: undefined, payerKey: 'PRO@ACME.COM' });
    expect(confirmSettlement(orderA, ambiguous, { openOrders: [orderA, orderB] })).toMatchObject({
      ok: true,
      rule: 'pixKey+amount',
    });
  });

  it('the `ambiguous` reason is unreachable for identifier rules (control case)', () => {
    // Same two colliding orders, but matched only by amount: ambiguity IS
    // reported. So the module reports ambiguity in its weakest rule and guesses
    // in its stronger ones — the opposite of the documented guarantee.
    const noIdentifiers = event({ e2eId: undefined, txId: undefined, payerDocument: undefined, payerKey: undefined });
    expect(confirmSettlement(orderA, noIdentifiers, { openOrders: [orderA, orderB] })).toEqual({
      ok: false,
      reason: 'ambiguous',
    });
  });
});

// =============================================================================
// F-05  HIGH — txIdInReference is a substring test on an attacker-chosen txid.
// =============================================================================

describe('F-05 HIGH: attacker-chosen txId substring-matches any order reference', () => {
  it('an empty txId matches EVERY order that has a reference', () => {
    const target = order({ id: 'P2002', reference: 'CUSTOMER-REF-P2002-XYZ' });
    // "abc".includes("") === true, and `txId !== undefined` admits "".
    expect(confirmSettlement(target, event({ txId: '', payerDocument: undefined }))).toMatchObject({
      ok: true,
      rule: 'txIdInReference',
    });
  });

  it('a short txid collides with an unrelated longer reference', () => {
    const target = order({ id: 'P3003', reference: 'ORDER-P3003' });
    expect(confirmSettlement(target, event({ txId: 'P30', payerDocument: undefined }))).toMatchObject({
      ok: true,
      rule: 'txIdInReference',
    });
  });

  it('the attacker redirects a real payment to a different order id', () => {
    const victim = order({ id: 'P4004', reference: 'ACME-BULK-P4004', document: '99988877766' });
    const confirmation = confirmSettlement(victim, event({ txId: '', payerDocument: undefined }));
    expect(confirmation.ok).toBe(true);
    // Paid order P1001, licence granted for P4004.
    const grant = bindPaymentToLicense(confirmation, victim);
    expect(grant.ok && grant.grant.payload).toBe('order:P4004');
  });
});

// =============================================================================
// F-06  MEDIUM — replay protection and idempotency are caller-enforced, and the
//        fingerprint anchor is substitutable.
// =============================================================================

describe('F-06 MEDIUM: replay/idempotency depend entirely on caller state', () => {
  it('replay is detected only when the caller persists the fingerprint set', () => {
    const e = event({ txId: 'P1001' });
    expect(confirmSettlement(order(), e, { seenFingerprints: new Set([settlementFingerprint(e)]) })).toEqual({
      ok: false,
      reason: 'fingerprint_replay',
    });
    // Same event, no persisted state -> accepted again.
    expect(confirmSettlement(order(), e).ok).toBe(true);
  });

  it('the same Pix payment with a different identifier present yields a different fingerprint', () => {
    const first = event({ eventId: 'delivery-1', e2eId: 'E2E-1', txId: 'T1' });
    const retry = event({ eventId: 'delivery-2', e2eId: undefined, txId: 'P1001' });
    expect(settlementFingerprint(first)).not.toBe(settlementFingerprint(retry));

    const seen = new Set([settlementFingerprint(first)]);
    expect(confirmSettlement(order(), retry, { seenFingerprints: seen }).ok).toBe(true);
  });

  it('a PSP that rotates eventId and sends no e2eId/txId defeats replay detection entirely', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const retry = event({
        eventId: `retry-${i}`,
        e2eId: undefined,
        txId: undefined,
        payerKey: undefined,
        payerDocument: undefined,
      });
      // Falls through to the weakest rule (unique amount) — still confirms,
      // because `openOrders` is caller state, and the order is still `open`.
      const confirmation = confirmSettlement(order(), retry, {
        seenFingerprints: seen,
        openOrders: [order()],
      });
      seen.add(settlementFingerprint(retry));
      expect(confirmation.ok).toBe(true);
      // A new grant every time, because existingGrants is not consulted across
      // distinct events and order.status was never flipped by the caller.
      const issued = bindPaymentToLicense(confirmation, order(), { existingGrants: [] });
      expect(issued.ok && issued.replay).toBe(false);
    }
  });

  it('existence of the idempotency key is the only durable de-dup lever', () => {
    // Correct by design, but it only works if the future store enforces it.
    const forged: Confirmation = {
      ok: true,
      orderId: 'P1001',
      rule: 'e2eId',
      amountCents: 1,
      eventId: 'e',
      source: 'bank_api',
    };
    const issued = bindPaymentToLicense(forged, order());
    expect(issued.ok && issued.grant.idempotencyKey).toBe('sola6:pix:P1001:v1');
  });
});

// =============================================================================
// F-07  HIGH — bindPaymentToLicense is not a trust boundary: no status check,
//        no amount re-check, accepts a hand-forged Confirmation.
// =============================================================================

describe('F-07 HIGH: issuance re-validates nothing (TOCTOU)', () => {
  const confirmation: Confirmation = {
    ok: true,
    orderId: 'P1001',
    rule: 'e2eId',
    amountCents: 15000,
    eventId: 'evt-1',
    source: 'bank_api',
  };

  it('issues for an order cancelled or refunded after confirmation', () => {
    for (const status of ['cancelled', 'paid'] as const) {
      expect(bindPaymentToLicense(confirmation, order({ status })).ok).toBe(true);
    }
  });

  it('does not re-check the amount against the order at issuance time', () => {
    const wrongAmount: Confirmation = { ...confirmation, amountCents: 1 };
    expect(bindPaymentToLicense(wrongAmount, order({ amountCents: 999_999 })).ok).toBe(true);
  });

  it('accepts a Confirmation fabricated without ever calling confirmSettlement', () => {
    const forged = { ...confirmation, eventId: 'never-happened', source: 'bank_api' as const };
    expect(bindPaymentToLicense(forged, order()).ok).toBe(true);
  });
});

// =============================================================================
// F-08  MEDIUM — tolerance and confirmation policy are caller-supplied, with no
//        upper bound, so the amount check can be waived by configuration.
// =============================================================================

describe('F-08 MEDIUM: caller-supplied policy can waive the amount check', () => {
  it('a 1-cent underpayment is accepted by default', () => {
    expect(confirmSettlement(order(), event({ amountCents: 14999 })).ok).toBe(true);
  });

  it('an unbounded tolerance accepts a 1-cent payment for a R$15.000 order', () => {
    const policy = { toleranceCents: Number.MAX_SAFE_INTEGER, autoConfirmSources: ['psp_webhook', 'bank_api'] as const };
    expect(confirmSettlement(order(), event({ amountCents: 1 }), { policy }).ok).toBe(true);
  });

  it('paidAt is never read: no settlement-time or clock window is enforced', () => {
    expect(confirmSettlement(order(), event({ paidAt: 0 })).ok).toBe(true);
  });
});

// =============================================================================
// F-09  LOW — non-constant-time MAC comparison.
// =============================================================================

describe('F-09 LOW: licence MAC comparison is a plain string equality', () => {
  it('verifyLicenseSignature compares with ===', async () => {
    const good = await mintKey(SECRET_FROM_CLIENT_BUNDLE, 'pro', '0', 'order:x');
    const sig = good.slice(good.lastIndexOf('.') + 1);
    expect(await verifyLicenseSignature(SECRET_FROM_CLIENT_BUNDLE, good.slice(0, good.lastIndexOf('.')), sig)).toBe(true);
    // Not exploitable while the secret is already public (F-01); it is a
    // defence-in-depth gap if issuance ever moves server-side.
    expect(await verifyLicenseSignature(SECRET_FROM_CLIENT_BUNDLE, 'tampered', sig)).toBe(false);
  });
});
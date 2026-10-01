import { describe, it, expect } from 'vitest';
import {
  bindPaymentToLicense,
  canTransition,
  confirmSettlement,
  licenseIdempotencyKey,
  normalizeDocument,
  normalizePixKey,
  nextStates,
  settlementFingerprint,
  type LicenseGrant,
  type Order,
  type SettlementEvent,
} from '../index';

function openOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'P1001',
    amountCents: 15000,
    currency: 'BRL',
    status: 'open',
    document: '11122233344',
    ...overrides,
  };
}

function settled(overrides: Partial<SettlementEvent> = {}): SettlementEvent {
  return {
    eventId: 'evt-1',
    source: 'psp_webhook',
    sourceVerified: true,
    amountCents: 15000,
    paidAt: 1_700_000_000_000,
    txId: 'P1001',
    ...overrides,
  };
}

describe('normalisation (adapted from chr-z/pix-concilia)', () => {
  it('keeps document digits only', () => {
    expect(normalizeDocument('111.222.333-44')).toBe('11122233344');
    expect(normalizeDocument('')).toBeNull();
    expect(normalizeDocument(undefined)).toBeNull();
  });

  it('normalises pix keys by type', () => {
    expect(normalizePixKey('Pix@Example.COM')).toBe('pix@example.com');
    expect(normalizePixKey('+55 (61) 99999-0000')).toBe('5561999990000');
    expect(normalizePixKey('123e4567-e89b-12d3-a456-426614174000')).toBe('123e4567e89b12d3a456426614174000');
    expect(normalizePixKey('   ')).toBeNull();
  });
});

describe('reliable payment confirmation', () => {
  it('confirms an exact e2eId match with the right amount', () => {
    const order = openOrder();
    const event = settled({ e2eId: 'P1001', txId: undefined });
    expect(confirmSettlement(order, event)).toMatchObject({ ok: true, rule: 'e2eId', orderId: 'P1001' });
  });

  it('confirms an exact txId match', () => {
    expect(confirmSettlement(openOrder(), settled())).toMatchObject({ ok: true, rule: 'txId' });
  });

  it('confirms a txId embedded in the order reference', () => {
    const order = openOrder({ id: 'P9', reference: 'invoice P1001 master' });
    const event = settled({ txId: 'P1001' });
    expect(confirmSettlement(order, event)).toMatchObject({ ok: true, rule: 'txIdInReference' });
  });

  it('confirms by payer document when the amount matches', () => {
    const order = openOrder({ id: 'P2' });
    const event = settled({ txId: 'OTHER', payerDocument: '111.222.333-44' });
    expect(confirmSettlement(order, event)).toMatchObject({ ok: true, rule: 'document+amount' });
  });

  it('confirms by payer pix key when the amount matches', () => {
    const order = openOrder({ id: 'P3', pixKey: 'pix@example.com' });
    const event = settled({ txId: 'OTHER', payerKey: 'PIX@example.com' });
    expect(confirmSettlement(order, event)).toMatchObject({ ok: true, rule: 'pixKey+amount' });
  });

  it('confirms a unique amount among open orders', () => {
    const order = openOrder({ id: 'P4', document: undefined });
    const event = settled({ txId: 'NOT-AN-ID', eventId: 'evt-9' });
    const others = [openOrder({ id: 'P5', amountCents: 9900 })];
    expect(confirmSettlement(order, event, { openOrders: [order, ...others] })).toMatchObject({
      ok: true,
      rule: 'uniqueAmount',
    });
  });

  it('never guesses when two open orders share the amount', () => {
    const order = openOrder({ id: 'P6', document: undefined });
    const event = settled({ txId: 'NOT-AN-ID' });
    const twin = openOrder({ id: 'P7' });
    expect(confirmSettlement(order, event, { openOrders: [order, twin] })).toEqual({
      ok: false,
      reason: 'ambiguous',
    });
  });

  it('rejects an amount mismatch even on a strong identifier match', () => {
    const event = settled({ amountCents: 15002 }); // 2 cents off, tolerance 1
    expect(confirmSettlement(openOrder(), event)).toEqual({ ok: false, reason: 'amount_mismatch' });
  });

  it('accepts a one-cent tolerance (default policy)', () => {
    const event = settled({ amountCents: 15001 });
    expect(confirmSettlement(openOrder(), event)).toMatchObject({ ok: true, rule: 'txId' });
  });

  it('rejects non-integer cents', () => {
    expect(confirmSettlement(openOrder(), settled({ amountCents: 15000.5 }))).toEqual({
      ok: false,
      reason: 'non_integer_cents',
    });
  });

  it('rejects a non-positive amount', () => {
    expect(confirmSettlement(openOrder(), settled({ amountCents: 0 }))).toEqual({
      ok: false,
      reason: 'non_positive_amount',
    });
  });

  it('rejects an unverified source (screenshot / user assertion class)', () => {
    expect(confirmSettlement(openOrder(), settled({ sourceVerified: false }))).toEqual({
      ok: false,
      reason: 'unverified_source',
    });
  });

  it('never auto-confirms a manual CSV import', () => {
    const event = settled({ source: 'manual_import', sourceVerified: true });
    expect(confirmSettlement(openOrder(), event)).toEqual({ ok: false, reason: 'source_not_auto' });
  });

  it('rejects payment against a non-open order', () => {
    const paid = openOrder({ status: 'paid' });
    expect(confirmSettlement(paid, settled())).toEqual({ ok: false, reason: 'order_not_open' });
  });

  it('rejects a replayed settlement event', () => {
    const event = settled();
    const seen = new Set([settlementFingerprint(event)]);
    expect(confirmSettlement(openOrder(), event, { seenFingerprints: seen })).toEqual({
      ok: false,
      reason: 'fingerprint_replay',
    });
  });

  it('reports when nothing matches', () => {
    const order = openOrder({ id: 'P8', document: undefined });
    const event = settled({ txId: 'NOPE', eventId: 'evt-x', amountCents: 9999 });
    expect(confirmSettlement(order, event, { openOrders: [order] })).toEqual({
      ok: false,
      reason: 'no_match',
    });
  });
});

describe('payment → licence binding', () => {
  const order = openOrder();
  const confirmed = confirmSettlement(order, settled());

  it('refuses to bind an unconfirmed payment', () => {
    const failed = confirmSettlement(order, settled({ sourceVerified: false }));
    expect(bindPaymentToLicense(failed, order)).toEqual({ ok: false, reason: 'not_confirmed' });
  });

  it('refuses to bind to a different order', () => {
    const other = openOrder({ id: 'P-OTHER' });
    expect(bindPaymentToLicense(confirmed, other)).toEqual({ ok: false, reason: 'order_id_mismatch' });
  });

  it('issues a deterministic, idempotent grant', () => {
    const first = bindPaymentToLicense(confirmed, order, { now: 42 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.replay).toBe(false);
    expect(first.grant.idempotencyKey).toBe(licenseIdempotencyKey('P1001'));
    expect(first.grant.confirmedByEventId).toBe('evt-1');
    expect(first.grant.issuedAt).toBe(42);
  });

  it('replays an existing grant instead of issuing a second licence', () => {
    const first = bindPaymentToLicense(confirmed, order, { now: 42 });
    if (!first.ok) throw new Error('expected grant');
    const grants: LicenseGrant[] = [first.grant];
    const second = bindPaymentToLicense(confirmed, order, { existingGrants: grants, now: 99 });
    expect(second).toMatchObject({ ok: true, replay: true });
    if (second.ok) expect(second.grant.issuedAt).toBe(42);
  });
});

describe('pipeline state machine (order → … → delivery)', () => {
  it('allows the happy path only', () => {
    expect(canTransition('created', 'awaiting_payment')).toBe(true);
    expect(canTransition('awaiting_payment', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'license_issued')).toBe(true);
    expect(canTransition('license_issued', 'activated')).toBe(true);
    expect(canTransition('activated', 'delivered')).toBe(true);
  });

  it('blocks skipping confirmation or issuance', () => {
    expect(canTransition('created', 'confirmed')).toBe(false);
    expect(canTransition('awaiting_payment', 'license_issued')).toBe(false);
    expect(canTransition('confirmed', 'activated')).toBe(false);
  });

  it('treats delivered and cancelled as terminal', () => {
    expect(nextStates('delivered')).toEqual([]);
    expect(nextStates('cancelled')).toEqual([]);
    expect(canTransition('delivered', 'activated')).toBe(false);
  });

  it('permits cancellation before delivery but not after', () => {
    expect(canTransition('awaiting_payment', 'cancelled')).toBe(true);
    expect(canTransition('license_issued', 'cancelled')).toBe(true);
    expect(canTransition('activated', 'cancelled')).toBe(false);
  });
});

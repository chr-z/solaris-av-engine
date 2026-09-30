/**
 * SOLA-6 — Reliable payment confirmation.
 *
 * Deterministic, conservative matching of a *settled* Pix payment against an
 * order. The rule order is adapted from chr-z/pix-concilia (MIT), which is the
 * only validated Pix asset found under chr-z (it reconciles received Pix; it
 * does not emit BR Code):
 *
 *   1. exact e2eId / txId
 *   2. txId present in the order reference
 *   3. payer document match (amount within tolerance)
 *   4. payer Pix key match (amount within tolerance)
 *   5. unique amount among open orders
 *   otherwise: report. Never guess.
 *
 * Additional gates required for *issuing* a licence (stricter than plain
 * reconciliation):
 *   - the settlement source must be verified and auto-confirmable;
 *   - the order must still be open;
 *   - the event must not be a replay (same source + eventId seen before);
 *   - the amount must match within tolerance (exact txid match does not waive
 *     the amount check, unlike a read-only reconciliation report).
 */

import {
  ConfirmationPolicy,
  DEFAULT_CONFIRMATION_POLICY,
  Order,
  SettlementEvent,
  isIntegerCents,
  normalizeDocument,
  normalizePixKey,
} from './types';

export type MatchRule =
  | 'e2eId'
  | 'txId'
  | 'txIdInReference'
  | 'document+amount'
  | 'pixKey+amount'
  | 'uniqueAmount';

export type ConfirmFailureReason =
  | 'non_integer_cents'
  | 'non_positive_amount'
  | 'unverified_source'
  | 'source_not_auto'
  | 'order_not_open'
  | 'fingerprint_replay'
  | 'amount_mismatch'
  | 'ambiguous'
  | 'no_match';

export interface ConfirmSuccess {
  ok: true;
  orderId: string;
  rule: MatchRule;
  amountCents: number;
  /** Source event identity, propagated to issuance for traceability. */
  eventId: string;
  source: SettlementEvent['source'];
}

export interface ConfirmFailure {
  ok: false;
  reason: ConfirmFailureReason;
}

export type Confirmation = ConfirmSuccess | ConfirmFailure;

export interface ConfirmContext {
  /** Other open orders, used only for the unique-amount rule. */
  openOrders?: readonly Order[];
  /** Fingerprints already consumed by a previous confirmation. */
  seenFingerprints?: ReadonlySet<string>;
  policy?: ConfirmationPolicy;
}

/** Stable identity of a settlement event, for replay detection. */
export function settlementFingerprint(event: SettlementEvent): string {
  const anchor = event.e2eId ?? event.txId ?? event.eventId;
  return `${event.source}:${anchor}`;
}

function withinTolerance(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function confirmSettlement(
  order: Order,
  event: SettlementEvent,
  context: ConfirmContext = {},
): Confirmation {
  const policy = context.policy ?? DEFAULT_CONFIRMATION_POLICY;

  // 0. Structural money checks first: integer, positive cents on both sides.
  if (!isIntegerCents(order.amountCents) || !isIntegerCents(event.amountCents)) {
    return { ok: false, reason: 'non_integer_cents' };
  }
  if (order.amountCents <= 0 || event.amountCents <= 0) {
    return { ok: false, reason: 'non_positive_amount' };
  }
  if (!Number.isInteger(policy.toleranceCents) || policy.toleranceCents < 0) {
    return { ok: false, reason: 'amount_mismatch' };
  }

  // 1. Trust boundary: only authenticated, auto-confirmable sources.
  if (!event.sourceVerified) return { ok: false, reason: 'unverified_source' };
  if (!policy.autoConfirmSources.includes(event.source)) {
    return { ok: false, reason: 'source_not_auto' };
  }

  // 2. Order must still be open.
  if (order.status !== 'open') return { ok: false, reason: 'order_not_open' };

  // 3. Replay protection: one settlement event confirms at most one order.
  const fingerprint = settlementFingerprint(event);
  if (context.seenFingerprints?.has(fingerprint)) {
    return { ok: false, reason: 'fingerprint_replay' };
  }

  const tolerance = policy.toleranceCents;
  const payerDocument = normalizeDocument(event.payerDocument);
  const payerKey = normalizePixKey(event.payerKey);

  const referenceMatch =
    event.txId !== undefined && order.reference !== undefined && order.reference.includes(event.txId);
  const documentMatch =
    payerDocument !== null && order.document !== undefined && normalizeDocument(order.document) === payerDocument;
  const keyMatch =
    payerKey !== null && order.pixKey !== undefined && normalizePixKey(order.pixKey) === payerKey;

  let rule: MatchRule | null = null;
  if (event.e2eId !== undefined && event.e2eId === order.id) rule = 'e2eId';
  else if (event.txId !== undefined && event.txId === order.id) rule = 'txId';
  else if (referenceMatch) rule = 'txIdInReference';
  else if (documentMatch) rule = 'document+amount';
  else if (keyMatch) rule = 'pixKey+amount';

  if (rule !== null) {
    // A strong identifier still requires the amount to match before issuing.
    if (!withinTolerance(order.amountCents, event.amountCents, tolerance)) {
      return { ok: false, reason: 'amount_mismatch' };
    }
    return {
      ok: true,
      orderId: order.id,
      rule,
      amountCents: event.amountCents,
      eventId: event.eventId,
      source: event.source,
    };
  }

  // 4. Weak fallback: a single open order with this exact amount. Ambiguity is
  //    reported, never resolved by guessing.
  const candidates = (context.openOrders ?? []).filter(
    candidate => candidate.status === 'open' && withinTolerance(candidate.amountCents, event.amountCents, tolerance),
  );
  if (candidates.length === 1 && candidates[0].id === order.id) {
    return {
      ok: true,
      orderId: order.id,
      rule: 'uniqueAmount',
      amountCents: event.amountCents,
      eventId: event.eventId,
      source: event.source,
    };
  }
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: false, reason: 'no_match' };
}

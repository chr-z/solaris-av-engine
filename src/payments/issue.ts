/**
 * SOLA-6 — Bind a confirmed payment to a licence issuance request.
 *
 * This is the *binding* half of the pipeline. It does not sign anything: signing
 * stays in the server-side licensing path (see `src/licensing/core.ts` and
 * `scripts/gen_license_key.mjs`), where the HMAC secret lives. The binding
 * produces a deterministic, idempotent grant so a retried webhook cannot issue
 * two licences for one order.
 */

import type { Confirmation } from './confirm';
import type { Order } from './types';

export interface LicenseGrant {
  orderId: string;
  /** Deterministic id for this payment→licence binding (idempotency key). */
  idempotencyKey: string;
  /** Opaque order/customer reference embedded in the signed licence key. */
  payload: string;
  /** Traceability: the settlement event that confirmed the order. */
  confirmedByEventId: string;
  confirmedBySource: string;
  issuedAt: number;
}

export type IssueResult =
  | { ok: true; grant: LicenseGrant; replay: boolean }
  | { ok: false; reason: 'not_confirmed' | 'order_id_mismatch' };

/**
 * Stable idempotency key. Changing the version suffix intentionally starts a new
 * grant lineage; do NOT change it without a migration, or already-issued
 * licences will be re-issued.
 */
export function licenseIdempotencyKey(orderId: string): string {
  return `sola6:pix:${orderId}:v1`;
}

/**
 * Payload embedded in the licence key. Deterministic so re-issuing the same
 * order yields the same key. NOTE: the current key format splits the body on
 * `-`, so the caller must ensure the base64url encoding of this payload does
 * not introduce `-` (see the SOLA-6 report / SOLA-5 licensing finding).
 */
export function licensePayload(orderId: string): string {
  return `order:${orderId}`;
}

export function bindPaymentToLicense(
  confirmation: Confirmation,
  order: Order,
  context: { existingGrants?: readonly LicenseGrant[]; now?: number } = {},
): IssueResult {
  if (!confirmation.ok) return { ok: false, reason: 'not_confirmed' };
  if (confirmation.orderId !== order.id) return { ok: false, reason: 'order_id_mismatch' };

  const idempotencyKey = licenseIdempotencyKey(order.id);
  const existing = context.existingGrants?.find(grant => grant.idempotencyKey === idempotencyKey);
  if (existing) return { ok: true, grant: existing, replay: true };

  return {
    ok: true,
    replay: false,
    grant: {
      orderId: order.id,
      idempotencyKey,
      payload: licensePayload(order.id),
      confirmedByEventId: confirmation.eventId,
      confirmedBySource: confirmation.source,
      issuedAt: context.now ?? Date.now(),
    },
  };
}

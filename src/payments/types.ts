/**
 * SOLA-6 — Pix payment → licence issuance binding: shared model.
 *
 * PURE, framework-free definitions. This module does NOT emit BR Code and does
 * NOT talk to a bank. It models the *reliable* half of the pipeline:
 *
 *   order → reliable payment confirmation → licence issuance → activation → delivery
 *
 * Design rules (agreed with the SOLA-6 brief):
 *   - Money is integer cents. Never `float` (mirrors pix-concilia's rule that
 *     money never accepts floating-point artefacts).
 *   - A payment is only confirmed from an *authoritative, verified* settlement
 *     source (PSP webhook or bank API). Screenshots, user assertions and other
 *     untrusted claims are not a source kind at all, so they cannot be passed in.
 *   - Matching is deterministic and conservative: on ambiguity it reports,
 *     it never guesses (adapted from chr-z/pix-concilia, MIT).
 *   - Signing secrets stay server-side. This module never holds a secret.
 *
 * BR Code emission (the copy-and-paste / QR payload) is intentionally OUT of
 * scope until a bank-validated implementation is located and approved: see
 * docs/pix-payment-binding.md.
 */

export type Currency = 'BRL';

/** Where a settlement event came from. Trust is *not* implied by the kind. */
export type PaymentSourceKind =
  | 'psp_webhook' // payment provider callback (server-to-server)
  | 'bank_api' // bank settlement/statement API
  | 'manual_import'; // operator CSV/OFX import — never auto-confirms

/** An order the customer is expected to pay for. */
export interface Order {
  /** Internal order id. Also the preferred Pix `txid` reference. */
  id: string;
  /** Integer cents, positive. */
  amountCents: number;
  currency: Currency;
  status: OrderStatus;
  /** Normalized CPF/CNPJ digits (no masks) when known. */
  document?: string;
  /** Normalized Pix key (digits, lowercase e-mail, or EVP UUID) when known. */
  pixKey?: string;
  /** Free-text reference that may embed the txid/e2eid. */
  reference?: string;
}

export type OrderStatus = 'open' | 'paid' | 'cancelled';

/** A settlement notification. Only `sourceVerified` events may auto-confirm. */
export interface SettlementEvent {
  /** Unique id from the source; used for idempotency / replay detection. */
  eventId: string;
  source: PaymentSourceKind;
  /**
   * True only when the *transport* is authenticated end-to-end (verified
   * webhook signature, mTLS bank feed). A CSV import or a chat paste is false.
   */
  sourceVerified: boolean;
  /** Integer cents, positive. */
  amountCents: number;
  /** Unix ms when the bank/provider says the funds settled. */
  paidAt: number;
  /** Pix end-to-end id (E2E ID) when available. */
  e2eId?: string;
  /** Pix txid / provider reference when available. */
  txId?: string;
  /** Payer CPF/CNPJ (raw); normalized before matching. */
  payerDocument?: string;
  /** Payer Pix key (raw); normalized before matching. */
  payerKey?: string;
  /** Free description from the statement. */
  description?: string;
}

export interface ConfirmationPolicy {
  /** Absolute tolerance in integer cents. Default 1 (one centavo). */
  toleranceCents: number;
  /** Sources allowed to auto-confirm. `manual_import` is never auto. */
  autoConfirmSources: readonly PaymentSourceKind[];
}

export const DEFAULT_CONFIRMATION_POLICY: ConfirmationPolicy = Object.freeze({
  toleranceCents: 1,
  autoConfirmSources: Object.freeze(['psp_webhook', 'bank_api'] as const),
});

// --- Normalisation (adapted from chr-z/pix-concilia, MIT) --------------------

/** Keeps digits only; returns null for empty input. */
export function normalizeDocument(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

/**
 * Normalizes a Pix key: e-mail is lowercased; masked numbers (CPF/CNPJ/phone)
 * keep digits only; alphanumeric keys (EVP random keys/UUIDs) are lowercased and
 * stripped to `[a-z0-9]`.
 *
 * This is a deliberate hardening over chr-z/pix-concilia, which collapses any
 * key containing digits to digits only (so two different UUID keys could
 * collide on their digit subsequence). Keeping the alphanumeric form avoids
 * that false-match vector.
 */
export function normalizePixKey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.includes('@')) return value.toLowerCase();
  if (!/[A-Za-z]/.test(value)) {
    const digits = value.replace(/\D/g, '');
    return digits.length > 0 ? digits : null;
  }
  const alnum = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return alnum.length > 0 ? alnum : null;
}

export function isIntegerCents(value: number): boolean {
  return Number.isInteger(value);
}

// --- Pipeline state machine --------------------------------------------------

/**
 * Order lifecycle. `delivered` and `cancelled` are terminal.
 * Activation happens client-side (paste of the signed key); delivery is the
 * hand-off of that key.
 */
export type PipelineState =
  | 'created'
  | 'awaiting_payment'
  | 'confirmed'
  | 'license_issued'
  | 'activated'
  | 'delivered'
  | 'cancelled';

const TRANSITIONS: Readonly<Record<PipelineState, readonly PipelineState[]>> = Object.freeze({
  created: Object.freeze(['awaiting_payment', 'cancelled'] as const),
  awaiting_payment: Object.freeze(['confirmed', 'cancelled'] as const),
  confirmed: Object.freeze(['license_issued', 'cancelled'] as const),
  license_issued: Object.freeze(['activated', 'cancelled'] as const),
  activated: Object.freeze(['delivered'] as const),
  delivered: Object.freeze([] as const),
  cancelled: Object.freeze([] as const),
});

export function canTransition(from: PipelineState, to: PipelineState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStates(from: PipelineState): readonly PipelineState[] {
  return TRANSITIONS[from];
}

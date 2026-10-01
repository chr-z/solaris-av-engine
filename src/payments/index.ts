/**
 * SOLA-6 — Pix payment → licence issuance binding (public surface).
 *
 * See docs/pix-payment-binding.md for the architecture, trust boundaries and the
 * BR Code finding.
 */

export type {
  ConfirmationPolicy,
  Currency,
  Order,
  OrderStatus,
  PaymentSourceKind,
  PipelineState,
  SettlementEvent,
} from './types';
export {
  DEFAULT_CONFIRMATION_POLICY,
  canTransition,
  isIntegerCents,
  nextStates,
  normalizeDocument,
  normalizePixKey,
} from './types';

export type {
  ConfirmContext,
  ConfirmFailure,
  ConfirmFailureReason,
  ConfirmSuccess,
  Confirmation,
  MatchRule,
} from './confirm';
export { confirmSettlement, settlementFingerprint } from './confirm';

export type { IssueResult, LicenseGrant } from './issue';
export { bindPaymentToLicense, licenseIdempotencyKey, licensePayload } from './issue';

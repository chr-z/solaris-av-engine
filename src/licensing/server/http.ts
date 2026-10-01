/**
 * SOLARIS entitlement HTTP handlers (SOLA-34) — transport-agnostic and pure.
 *
 * Framework adapters (`api/license/*.ts` for the existing Vercel-style routes)
 * are thin wrappers over these. Keeping the logic here makes the server path
 * testable without a running HTTP server.
 *
 * Response contract used by the client (`LicenseContext.tsx`):
 *  - HTTP 200 + `{ entitled: boolean }` is AUTHORITATIVE (grant or deny).
 *  - Any non-2xx / network failure is treated as an OUTAGE: the client keeps the
 *    signed, time-bounded entitlement until `grace_exp`.
 */

import type { PublicKeyRing } from '../token';
import {
  activateLicense,
  revalidateActivation,
  type ActivateResult,
  type ActivationStore,
} from './activation';
import { deriveGraceEnd, issueLicenseToken, type Ed25519Signer } from './issue';
import { verifyWebhookSignature } from './webhook';

export interface LicenseApiDeps {
  publicKeys: PublicKeyRing;
  store: ActivationStore;
  maxActivations?: number;
  /** Injectable server clock (tests); defaults to Date.now(). */
  now?: number;
}

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

function publicResult(result: ActivateResult): Record<string, unknown> {
  return {
    entitled: result.entitled,
    status: result.status,
    edition: result.edition,
    ...(result.activationId ? { activationId: result.activationId } : {}),
    ...(result.kid ? { kid: result.kid } : {}),
    ...(result.subject ? { subject: result.subject } : {}),
    ...(result.exp !== undefined ? { exp: result.exp } : {}),
    ...(result.graceExp !== undefined ? { graceExp: result.graceExp } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

function readToken(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const token = (body as { token?: unknown }).token;
  return typeof token === 'string' && token.length > 0 && token.length <= 8192 ? token : null;
}

export async function handleActivate(body: unknown, deps: LicenseApiDeps): Promise<HttpResult> {
  const token = readToken(body);
  if (!token) return { status: 400, body: { entitled: false, status: 'invalid', reason: 'missing_token' } };
  const result = await activateLicense({ token, publicKeys: deps.publicKeys, store: deps.store, maxActivations: deps.maxActivations, now: deps.now });
  return { status: 200, body: publicResult(result) };
}

export async function handleRevalidate(body: unknown, deps: LicenseApiDeps): Promise<HttpResult> {
  const token = readToken(body);
  if (!token) return { status: 400, body: { entitled: false, status: 'invalid', reason: 'missing_token' } };
  const activationId =
    typeof body === 'object' && body !== null ? (body as { activationId?: unknown }).activationId : undefined;
  if (typeof activationId !== 'string' || activationId.length === 0) {
    return { status: 400, body: { entitled: false, status: 'invalid', reason: 'missing_activation_id' } };
  }
  const result = await revalidateActivation({ token, activationId, publicKeys: deps.publicKeys, store: deps.store, now: deps.now });
  return { status: 200, body: publicResult(result) };
}

// --- Webhook → issuance ------------------------------------------------------

export interface WebhookApiDeps extends LicenseApiDeps {
  webhookSecret: string;
  sign: Ed25519Signer;
  kid: string;
  now?: number;
  toleranceMs?: number;
  seenEventIds?: Set<string>;
  /** Maps a verified raw webhook body to a licence subject, or null to ignore. */
  resolveGrant: (rawBody: string) => { subject: string; termMs?: number; graceMs?: number } | null;
}

/**
 * Server-verified payment webhook: HMAC/timestamp/replay gate first, then
 * issuance. A webhook that fails the transport gate never reaches issuance.
 */
export async function handlePaymentWebhook(
  rawBody: string,
  signatureHeader: string | undefined,
  eventId: string | undefined,
  deps: WebhookApiDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = deps.now ?? Date.now();
  const verified = await verifyWebhookSignature({
    rawBody,
    signatureHeader: signatureHeader ?? '',
    secret: deps.webhookSecret,
    now,
    toleranceMs: deps.toleranceMs,
    eventId,
    seenEventIds: deps.seenEventIds,
  });
  if (!verified.ok) return { status: 401, body: { ok: false, reason: verified.reason } };

  const grant = deps.resolveGrant(rawBody);
  if (!grant) return { status: 202, body: { ok: true, issued: false } };

  const termEndsAt = grant.termMs && grant.termMs > 0 ? now + grant.termMs : 0;
  const graceEndsAt = deriveGraceEnd(termEndsAt, now, grant.graceMs);
  const issued = await issueLicenseToken(
    { kid: deps.kid, subject: grant.subject, edition: 'pro', issuedAt: now, termEndsAt, graceEndsAt },
    deps.sign,
  );
  return { status: 200, body: { ok: true, issued: true, token: issued.token, graceExp: graceEndsAt } };
}

/**
 * SOLARIS payment-webhook transport verification (SOLA-34 / SOLA-6 gap).
 *
 * The SOLA-6 report established that no webhook signature verification existed
 * anywhere: `confirmSettlement` trusts a caller-supplied `sourceVerified`
 * boolean, so the transport was the real trust boundary and it was missing.
 * This module closes that gap.
 *
 * Signed string: ASCII `${timestamp}.${rawBody}`, HMAC-SHA256, lowercase hex.
 * Header: `t=<unix seconds>,v1=<hex>`. Timestamp window + replay protection are
 * enforced here, before any settlement matching runs.
 *
 * The HMAC secret is a shared PSP/provider secret and stays server-side. It is
 * intentionally NOT an Ed25519 key: webhook authenticity proves the transport,
 * while licence authenticity is proven separately by the Ed25519 signature.
 */

export const WEBHOOK_TOLERANCE_MS_DEFAULT = 5 * 60 * 1000;

export type WebhookFailureReason =
  | 'malformed'
  | 'timestamp_out_of_window'
  | 'bad_signature'
  | 'replay'
  | 'crypto-unavailable';

export type WebhookVerifyResult =
  | { ok: true; timestamp: number; eventId?: string }
  | { ok: false; reason: WebhookFailureReason };

export interface WebhookVerifyInput {
  /** Exact request body bytes as received (never a re-serialised object). */
  rawBody: string;
  /** `t=<unix seconds>,v1=<hex>` (extra fields ignored). */
  signatureHeader: string;
  secret: string;
  now?: number;
  toleranceMs?: number;
  /** Stable provider event id, used for replay de-duplication. */
  eventId?: string;
  /** Persisted set of already-consumed event ids (caller owns persistence). */
  seenEventIds?: Set<string>;
}

/** Length-independent, constant-time-ish comparison of equal-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } | null {
  if (typeof header !== 'string' || header.length === 0) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      if (!/^\d+$/.test(value)) return null;
      timestamp = Number.parseInt(value, 10);
    } else if (key === 'v1') {
      signatures.push(value);
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto unavailable');
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await subtle.sign('HMAC', key, new TextEncoder().encode(message) as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Produces the `t=...,v1=...` header value. Used by providers and tests. */
export async function createWebhookSignature(secret: string, timestampSeconds: number, rawBody: string): Promise<string> {
  const hex = await hmacSha256Hex(secret, `${timestampSeconds}.${rawBody}`);
  return `t=${timestampSeconds},v1=${hex}`;
}

/**
 * Verifies a webhook's authenticity and freshness. Returns `ok` only when the
 * HMAC matches, the timestamp is inside the window, and the event is not a
 * replay. On success with an `eventId`, the id is added to `seenEventIds`.
 */
export async function verifyWebhookSignature(input: WebhookVerifyInput): Promise<WebhookVerifyResult> {
  const now = input.now ?? Date.now();
  const tolerance = input.toleranceMs ?? WEBHOOK_TOLERANCE_MS_DEFAULT;
  if (typeof input.rawBody !== 'string' || typeof input.secret !== 'string' || input.secret.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed' };

  if (!Number.isFinite(tolerance) || tolerance < 0) return { ok: false, reason: 'malformed' };
  const timestampMs = parsed.timestamp * 1000;
  if (Math.abs(now - timestampMs) > tolerance) return { ok: false, reason: 'timestamp_out_of_window' };

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return { ok: false, reason: 'crypto-unavailable' };

  let expected: string;
  try {
    expected = await hmacSha256Hex(input.secret, `${parsed.timestamp}.${input.rawBody}`);
  } catch {
    return { ok: false, reason: 'crypto-unavailable' };
  }
  const matched = parsed.signatures.some(sig => timingSafeEqualHex(sig.toLowerCase(), expected));
  if (!matched) return { ok: false, reason: 'bad_signature' };

  if (input.eventId !== undefined && input.seenEventIds?.has(input.eventId)) {
    return { ok: false, reason: 'replay' };
  }
  if (input.eventId !== undefined && input.seenEventIds) input.seenEventIds.add(input.eventId);

  return { ok: true, timestamp: timestampMs, ...(input.eventId !== undefined ? { eventId: input.eventId } : {}) };
}

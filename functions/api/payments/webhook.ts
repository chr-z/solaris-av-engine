/**
 * Cloudflare Pages Function — POST /api/payments/webhook (SOLA-34).
 *
 * Server-verified payment webhook → licence issuance. The transport gate
 * (HMAC + timestamp window + replay) runs before any issuance. Requires:
 *   SOLARIS_PAYMENT_WEBHOOK_SECRET  shared provider secret (server-side only)
 *   SOLARIS_LICENSE_SIGNING_KEY_PKCS8  base64url Ed25519 PKCS#8 (self-host);
 *       production should use a KMS/HSM signer instead of an env key.
 *   SOLARIS_LICENSE_KID             key id matching the client's public ring
 *
 * A PSP-specific body -> subject mapping belongs in `resolveGrant`; until the
 * provider contract is fixed it accepts `{"subject":"<ref>","termDays":N}`.
 */

import { handlePaymentWebhook } from '../../../src/licensing/server/http';
import { MemoryActivationStore } from '../../../src/licensing/server/activation';
import { KvActivationStore, type MinimalKv } from '../../../src/licensing/server/kvStore';
import { importEd25519SignerFromPkcs8, type Ed25519Signer } from '../../../src/licensing/server/issue';
import { LICENSE_PUBLIC_KEYS } from '../../../src/licensing/keys';

interface Env {
  SOLARIS_LICENSE_KV?: MinimalKv;
  SOLARIS_PAYMENT_WEBHOOK_SECRET?: string;
  SOLARIS_LICENSE_SIGNING_KEY_PKCS8?: string;
  SOLARIS_LICENSE_KID?: string;
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const memory = new MemoryActivationStore();

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const env = context.env;
  if (!env.SOLARIS_PAYMENT_WEBHOOK_SECRET) {
    return json(500, { ok: false, reason: 'webhook_secret_not_configured' });
  }
  if (!env.SOLARIS_LICENSE_SIGNING_KEY_PKCS8 || !env.SOLARIS_LICENSE_KID) {
    return json(501, { ok: false, reason: 'signer_not_configured' });
  }
  const rawBody = await context.request.text();
  const signatureHeader = context.request.headers.get('x-solaris-signature') ?? undefined;
  const eventId = context.request.headers.get('x-solaris-event-id') ?? undefined;

  let sign: Ed25519Signer;
  try {
    sign = await importEd25519SignerFromPkcs8(decodeBase64Url(env.SOLARIS_LICENSE_SIGNING_KEY_PKCS8));
  } catch {
    return json(500, { ok: false, reason: 'signer_import_failed' });
  }

  const store = env.SOLARIS_LICENSE_KV ? new KvActivationStore(env.SOLARIS_LICENSE_KV) : memory;
  const result = await handlePaymentWebhook(rawBody, signatureHeader, eventId, {
    publicKeys: LICENSE_PUBLIC_KEYS,
    store,
    webhookSecret: env.SOLARIS_PAYMENT_WEBHOOK_SECRET,
    sign,
    kid: env.SOLARIS_LICENSE_KID,
    resolveGrant: body => {
      try {
        const parsed = JSON.parse(body) as { subject?: unknown; termDays?: unknown; graceDays?: unknown };
        if (typeof parsed.subject !== 'string' || parsed.subject.length === 0) return null;
        return {
          subject: parsed.subject,
          termMs: typeof parsed.termDays === 'number' ? parsed.termDays * 86_400_000 : undefined,
          graceMs: typeof parsed.graceDays === 'number' ? parsed.graceDays * 86_400_000 : undefined,
        };
      } catch {
        return null;
      }
    },
  });
  return json(result.status, result.body);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Cloudflare Pages Function — POST /api/license/revalidate (SOLA-34).
 *
 * Revocation check. Returns HTTP 200 + `{entitled:false,status:'revoked'|...}`
 * on an authoritative denial; an outage is a non-2xx/network failure that the
 * client interprets as "keep the signed entitlement until grace_exp".
 *
 * Requires the durable `SOLARIS_LICENSE_KV` binding; without it revocation is
 * meaningless, so we fail loudly (503) rather than pretend to check.
 */

import { handleRevalidate } from '../../../src/licensing/server/http';
import { KvActivationStore, type MinimalKv } from '../../../src/licensing/server/kvStore';
import { LICENSE_PUBLIC_KEYS } from '../../../src/licensing/keys';

interface Env {
  SOLARIS_LICENSE_KV?: MinimalKv;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const kv = context.env.SOLARIS_LICENSE_KV;
  if (!kv) return json(503, { entitled: false, status: 'invalid', reason: 'license_store_unconfigured' });

  const body = await context.request.json().catch(() => null);
  const result = await handleRevalidate(body, { publicKeys: LICENSE_PUBLIC_KEYS, store: new KvActivationStore(kv) });
  return json(result.status, result.body);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

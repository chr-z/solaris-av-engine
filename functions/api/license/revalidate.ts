/**
 * Cloudflare Pages Function — POST /api/license/revalidate (SOLA-34).
 *
 * Revocation check. Returns HTTP 200 + `{entitled:false,status:'revoked'|...}`
 * on an authoritative denial; an outage is a non-2xx/network failure that the
 * client interprets as "keep the signed entitlement until grace_exp".
 */

import { handleRevalidate } from '../../../src/licensing/server/http';
import { MemoryActivationStore } from '../../../src/licensing/server/activation';
import { KvActivationStore, type MinimalKv } from '../../../src/licensing/server/kvStore';
import { LICENSE_PUBLIC_KEYS } from '../../../src/licensing/keys';

interface Env {
  SOLARIS_LICENSE_KV?: MinimalKv;
}

const memory = new MemoryActivationStore();

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const body = await context.request.json().catch(() => null);
  const store = context.env.SOLARIS_LICENSE_KV ? new KvActivationStore(context.env.SOLARIS_LICENSE_KV) : memory;
  const result = await handleRevalidate(body, { publicKeys: LICENSE_PUBLIC_KEYS, store });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

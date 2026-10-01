/**
 * Cloudflare Pages Function — POST /api/license/activate (SOLA-34).
 *
 * Thin transport wrapper over the tested pure handler. Durable activation
 * counting/revocation require the `SOLARIS_LICENSE_KV` KV binding; without it
 * the per-isolate in-memory store is used (documented degradation).
 */

import { handleActivate } from '../../../src/licensing/server/http';
import { MemoryActivationStore } from '../../../src/licensing/server/activation';
import { KvActivationStore, type MinimalKv } from '../../../src/licensing/server/kvStore';
import { LICENSE_PUBLIC_KEYS } from '../../../src/licensing/keys';

interface Env {
  SOLARIS_LICENSE_KV?: MinimalKv;
  SOLARIS_MAX_ACTIVATIONS?: string;
}

const memory = new MemoryActivationStore();

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const body = await context.request.json().catch(() => null);
  const store = context.env.SOLARIS_LICENSE_KV ? new KvActivationStore(context.env.SOLARIS_LICENSE_KV) : memory;
  const parsedMax = Number.parseInt(context.env.SOLARIS_MAX_ACTIVATIONS ?? '', 10);
  const result = await handleActivate(body, {
    publicKeys: LICENSE_PUBLIC_KEYS,
    store,
    maxActivations: Number.isFinite(parsedMax) ? parsedMax : undefined,
  });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

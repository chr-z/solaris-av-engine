/**
 * Cloudflare Pages Function — POST /api/license/activate (SOLA-34).
 *
 * Durable activation counting and revocation require the `SOLARIS_LICENSE_KV`
 * KV binding. Without it we FAIL LOUDLY (503) instead of silently degrading to a
 * per-isolate in-memory counter that loses all revocation state on cold start
 * (Riven R-11 / Naomi deployment finding). Wire the binding in the Pages project
 * before serving this route.
 */

import { handleActivate } from '../../../src/licensing/server/http';
import { KvActivationStore, type MinimalKv } from '../../../src/licensing/server/kvStore';
import { LICENSE_PUBLIC_KEYS } from '../../../src/licensing/keys';

interface Env {
  SOLARIS_LICENSE_KV?: MinimalKv;
  SOLARIS_MAX_ACTIVATIONS?: string;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const kv = context.env.SOLARIS_LICENSE_KV;
  if (!kv) return json(503, { entitled: false, status: 'invalid', reason: 'license_store_unconfigured' });

  let maxActivations: number | undefined;
  const rawMax = context.env.SOLARIS_MAX_ACTIVATIONS;
  if (rawMax !== undefined && rawMax !== '') {
    const parsed = Number(rawMax);
    if (!Number.isInteger(parsed) || parsed < 1) {
      // Fail closed: never let a bad value silently remove the ceiling (Riven R-07).
      return json(500, { entitled: false, status: 'invalid', reason: 'invalid_max_activations_config' });
    }
    maxActivations = parsed;
  }

  const body = await context.request.json().catch(() => null);
  const result = await handleActivate(body, {
    publicKeys: LICENSE_PUBLIC_KEYS,
    store: new KvActivationStore(kv),
    maxActivations,
  });
  return json(result.status, result.body);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

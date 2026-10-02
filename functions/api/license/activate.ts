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
import { resolvePublicKeyRing } from '../../../src/licensing/keys';

interface Env {
  SOLARIS_LICENSE_KV?: MinimalKv;
  SOLARIS_MAX_ACTIVATIONS?: string;
  /**
   * Operator entitlement ring as JSON `{ kid -> base64url public key }` (SOLA-104).
   *
   * NOT a `VITE_` variable: Pages Functions read `context.env` at request time,
   * and `VITE_` only ever reaches the client bundle. The client ring
   * (`LicenseContext`) and this server ring must therefore be fed separately —
   * a token signed by a rotated key the client trusts must also verify here.
   */
  SOLARIS_LICENSE_PUBLIC_KEYS?: string;
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
  const publicKeys = resolvePublicKeyRing(context.env.SOLARIS_LICENSE_PUBLIC_KEYS);
  // Fail loud rather than silently verifying against the built-in ring: a
  // configured-but-unparseable ring is a deployment error that would otherwise
  // reject every paying customer with no signal anywhere.
  if (context.env.SOLARIS_LICENSE_PUBLIC_KEYS && Object.keys(publicKeys).length === 0) {
    return json(500, { entitled: false, status: 'invalid', reason: 'license_ring_not_configured' });
  }
  const result = await handleActivate(body, {
    publicKeys,
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

/**
 * SOLARIS public key ring (SOLA-34).
 *
 * PUBLIC keys only. This is the whole point of Ed25519: the client can verify
 * but cannot sign. The matching private key is non-exportable in the operator's
 * KMS/HSM and is never present in this repository or in any built bundle.
 *
 * Rotation: add a new `kid` entry here (and sign new tokens with it), then
 * revoke the old key server-side. Existing tokens keep verifying by `kid`
 * until they reach their signed `grace_exp`.
 *
 * Operators may override/extend the ring at build time with
 * `VITE_SOLARIS_LICENSE_PUBLIC_KEYS` (a JSON object of kid -> base64url public
 * key). That variable is a public key by definition and is safe to ship.
 */

import type { PublicKeyRing } from './token';

/** Built-in ring. Only public keys — verified by `scripts/check_bundle_secrets.mjs`. */
export const LICENSE_PUBLIC_KEYS: PublicKeyRing = Object.freeze({
  'sol-2026a': 'Ly4Oo8LBgLEX2cCHiOo4OLpja01FiSi2LtwJ1cBXlTc',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Merge an optional env-provided ring over the built-in keys. Public data. */
export function resolvePublicKeyRing(envRaw?: string): PublicKeyRing {
  if (!envRaw) return LICENSE_PUBLIC_KEYS;
  try {
    const parsed: unknown = JSON.parse(envRaw);
    if (!isRecord(parsed)) return LICENSE_PUBLIC_KEYS;
    const merged: Record<string, string> = { ...LICENSE_PUBLIC_KEYS };
    for (const [kid, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value)) {
        merged[kid] = value;
      }
    }
    return Object.freeze(merged);
  } catch {
    return LICENSE_PUBLIC_KEYS;
  }
}

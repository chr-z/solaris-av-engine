/**
 * Cloudflare Workers-native Firebase ID token verification (SOLA-35, P1-4).
 *
 * The Vercel-era `api/_lib/verifyAuth.ts` used `firebase-admin`, which cannot
 * run in the Workers runtime. This module reimplements the same contract with
 * WebCrypto and `fetch` only:
 *   - a Bearer token (or the `fb_id_token` cookie, for <video>/<img> requests
 *     that cannot set headers) is required;
 *   - the JWT is verified against Google's Firebase JWKS with RS256;
 *   - `aud`, `iss`, `exp`, `iat`, `sub` are all checked;
 *   - it fails CLOSED: any missing/invalid/expired token yields 401 and no
 *     handler ever runs with an anonymous caller.
 *
 * Revocation (`verifyIdToken(idToken, true)` in the old code) is performed via
 * the Identity Toolkit `accounts:lookup` endpoint when `FIREBASE_API_KEY` is
 * configured; without it verification is signature/claims-only, documented as
 * a limitation rather than silently assumed.
 */

import type { ServerEnv } from './env';

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** Firebase ID tokens are RS256 and rotate; cache the JWKS briefly. */
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

/** DOM `JsonWebKey` omits `kid` in older TS libs; Google JWKS always sets it. */
export interface Jwk extends JsonWebKey {
  kid?: string;
}

export interface JsonWebKeySet {
  keys: Jwk[];
}

export interface FirebaseClaims {
  sub?: string;
  user_id?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
  [key: string]: unknown;
}

export type AuthResult = { uid: string; claims: FirebaseClaims } | { response: Response };

export interface AuthDeps {
  fetch?: typeof fetch;
  now?: () => number;
  subtle?: SubtleCrypto;
  /** Pre-fetched key set (tests). When omitted the module fetches + caches it. */
  jwks?: JsonWebKeySet;
}

export function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---------------------------------------------------------------------------
// base64url + JWT decode
// ---------------------------------------------------------------------------

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export function base64UrlToBytes(input: string): Uint8Array {
  if (!BASE64URL_RE.test(input)) throw new Error('invalid base64url');
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
}

interface DecodedJwt {
  header: { alg?: string; kid?: string; typ?: string };
  claims: FirebaseClaims;
  signingInput: Uint8Array;
  signature: Uint8Array;
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');
  const [rawHeader, rawPayload, rawSignature] = parts;
  return {
    header: decodeJsonSegment(rawHeader),
    claims: decodeJsonSegment(rawPayload),
    signingInput: new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
    signature: base64UrlToBytes(rawSignature),
  };
}

// ---------------------------------------------------------------------------
// signature + claim verification
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  projectId: string;
  jwks: JsonWebKeySet;
  now?: number;
  clockSkewSeconds?: number;
  subtle?: SubtleCrypto;
}

export type VerifyResult = { ok: true; uid: string; claims: FirebaseClaims } | { ok: false; reason: string };

export async function verifyFirebaseIdToken(
  token: string,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const subtle = options.subtle ?? (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) return { ok: false, reason: 'no_crypto' };

  let decoded: DecodedJwt;
  try {
    decoded = decodeJwt(token);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const { header, claims, signingInput, signature } = decoded;
  if (header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'unsupported_alg' };

  const jwk = options.jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown_kid' };

  let valid = false;
  try {
    const key = await subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valid = await subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
  } catch {
    return { ok: false, reason: 'verify_error' };
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const skew = options.clockSkewSeconds ?? CLOCK_SKEW_SECONDS;

  if (claims.aud !== options.projectId) return { ok: false, reason: 'bad_audience' };
  if (claims.iss !== `https://securetoken.google.com/${options.projectId}`) {
    return { ok: false, reason: 'bad_issuer' };
  }
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) {
    return { ok: false, reason: 'expired' };
  }
  if (typeof claims.iat !== 'number' || claims.iat - skew > now) {
    return { ok: false, reason: 'issued_in_future' };
  }
  const uid = typeof claims.sub === 'string' ? claims.sub : '';
  if (!uid || uid.length > 128) return { ok: false, reason: 'bad_subject' };

  return { ok: true, uid, claims };
}

// ---------------------------------------------------------------------------
// JWKS fetch + cache
// ---------------------------------------------------------------------------

interface CachedJwks {
  keys: Jwk[];
  fetchedAt: number;
  expiresAt: number;
}

let cachedJwks: CachedJwks | null = null;

export function resetJwksCache(): void {
  cachedJwks = null;
}

export async function fetchFirebaseJwks(deps: AuthDeps = {}): Promise<JsonWebKeySet> {
  const doFetch = deps.fetch ?? fetch;
  const now = (deps.now ?? Date.now)();
  if (cachedJwks && cachedJwks.expiresAt > now) return { keys: cachedJwks.keys };

  try {
    const res = await doFetch(JWKS_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
    const body = (await res.json()) as JsonWebKeySet;
    if (!body || !Array.isArray(body.keys)) throw new Error('JWKS malformed');
    const maxAgeHeader = res.headers.get('cache-control') ?? '';
    const maxAgeMatch = /max-age=(\d+)/.exec(maxAgeHeader);
    const ttl = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : JWKS_TTL_MS;
    cachedJwks = { keys: body.keys, fetchedAt: now, expiresAt: now + Math.min(ttl, JWKS_TTL_MS) };
    return { keys: body.keys };
  } catch (err) {
    // Serve a stale key set only if it is not ancient; otherwise fail closed.
    if (cachedJwks && now - cachedJwks.fetchedAt < JWKS_MAX_STALE_MS) {
      return { keys: cachedJwks.keys };
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ---------------------------------------------------------------------------
// request-level guard
// ---------------------------------------------------------------------------

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function extractIdToken(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  return readCookie(request.headers.get('cookie'), 'fb_id_token');
}

async function checkRevoked(idToken: string, env: ServerEnv, deps: AuthDeps): Promise<boolean> {
  if (!env.FIREBASE_API_KEY) return false; // not configured: documented limitation
  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    // Fail CLOSED, matching firebase-admin's check-revoked behaviour: a lookup
    // failure withholds access rather than silently trusting a possibly
    // revoked token.
    if (!res.ok) return true;
    const body = (await res.json()) as { users?: unknown[] };
    return !(Array.isArray(body.users) && body.users.length > 0);
  } catch {
    return true;
  }
}

/**
 * Authentication gate. Returns `{ uid, claims }` on success, or `{ response }`
 * carrying a deliberate JSON 401/500 that the caller must return unchanged.
 */
export async function requireFirebaseIdToken(
  request: Request,
  env: ServerEnv,
  deps: AuthDeps = {},
): Promise<AuthResult> {
  const idToken = extractIdToken(request);
  if (!idToken) return { response: jsonError(401, 'Authentication required.') };

  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    return { response: jsonError(500, 'Server configuration error.') };
  }

  let jwks: JsonWebKeySet;
  try {
    jwks = deps.jwks ?? (await fetchFirebaseJwks(deps));
  } catch {
    return { response: jsonError(500, 'Server configuration error.') };
  }

  const result = await verifyFirebaseIdToken(idToken, {
    projectId,
    jwks,
    now: deps.now?.(),
    subtle: deps.subtle,
  });
  if (!result.ok) return { response: jsonError(401, 'Invalid or expired session.') };

  if (await checkRevoked(idToken, env, deps)) {
    return { response: jsonError(401, 'Invalid or expired session.') };
  }

  return { uid: result.uid, claims: result.claims };
}

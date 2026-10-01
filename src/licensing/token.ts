/**
 * SOLARIS entitlement token (Ed25519, RFC 8032) — pure, verify-only core.
 *
 * SOLA-34 (P0-1a..d). This module replaces the symmetric HMAC licence key. It
 * holds NO secret and can only verify: the signing private key lives in a
 * KMS/HSM on the server (`src/licensing/server/`). Anything that can verify a
 * token therefore cannot mint one.
 *
 * Wire format (canonical, delimiter-safe):
 *
 *   base64url(header) "." base64url(payload) "." base64url(signature)
 *
 * The signature is Ed25519 over the ASCII bytes of `header_b64 "." payload_b64`
 * (JWS compact serialization). Verification never re-serialises the JSON, so no
 * JSON canonicalisation is required and a payload containing any byte (including
 * `-`, `+` or `.`) cannot break parsing — the old `SOLARIS-...` format split on
 * `-` and broke as soon as a base64url payload contained one.
 *
 *   header  = {"alg":"Ed25519","typ":"SOLARIS-LICENSE","kid":"<key id>","v":1}
 *   payload = {"edition":"pro","sub":"<order/customer>","iat":<ms>,
 *              "exp":<ms>,"grace_exp":<ms>}
 *
 * `exp` is the paid-term end; `grace_exp` is the absolute, server-issued offline
 * cutoff. Entitlement stays valid offline until `grace_exp`, which bounds
 * revocation lag while making sure backend downtime never bricks a payer.
 */

export type SolarisEdition = 'free' | 'pro';

export const LICENSE_TOKEN_TYP = 'SOLARIS-LICENSE';
export const LICENSE_TOKEN_VERSION = 1;
export const LICENSE_ALG = 'Ed25519';
/** Legacy HMAC prefix — recognised only so old keys fail closed with a reason. */
export const LEGACY_LICENSE_PREFIX = 'SOLARIS';

export interface LicenseTokenHeader {
  alg: typeof LICENSE_ALG;
  typ: typeof LICENSE_TOKEN_TYP;
  /** Key id — lets a compromised signing key be rotated without a client ship. */
  kid: string;
  v: number;
}

export interface LicenseClaims {
  edition: SolarisEdition;
  /** Opaque subject reference (order/customer/installation), not PII. */
  sub: string;
  /** Unix ms issued-at, from the server clock. */
  iat: number;
  /** Unix ms paid-term end; 0 = no term end. */
  exp: number;
  /** Unix ms absolute offline cutoff, server-issued; 0 = unbounded (avoid). */
  grace_exp: number;
}

/** kid -> raw Ed25519 public key as base64url (32 bytes). Public by design. */
export type PublicKeyRing = Readonly<Record<string, string>>;

export interface ParsedLicenseToken {
  header: LicenseTokenHeader;
  claims: LicenseClaims;
  signature: Uint8Array;
  /** ASCII bytes the signature covers. */
  signingInput: string;
}

export type TokenParseResult = ({ ok: true } & ParsedLicenseToken) | { ok: false; reason: 'malformed' };

export type TokenVerifyFailureReason =
  | 'malformed'
  | 'unknown-kid'
  | 'bad-signature'
  | 'expired'
  | 'not-yet-valid'
  | 'no-term'
  | 'crypto-unavailable';

export type TokenVerifyResult =
  | { valid: true; header: LicenseTokenHeader; claims: LicenseClaims; keyId: string }
  | { valid: false; reason: TokenVerifyFailureReason; header?: LicenseTokenHeader; claims?: LicenseClaims; keyId?: string };

// --- base64url ---------------------------------------------------------------

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict base64url decode; returns null on any invalid input (fail closed). */
export function fromBase64Url(value: string): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0 || !BASE64URL_RE.test(value)) return null;
  const padLength = (4 - (value.length % 4)) % 4;
  if (value.length % 4 === 1) return null; // impossible base64 length
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function encodeUtf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

// --- structural parsing ------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseHeader(value: unknown): LicenseTokenHeader | null {
  if (!isRecord(value)) return null;
  const { alg, typ, kid, v } = value;
  if (alg !== LICENSE_ALG || typ !== LICENSE_TOKEN_TYP) return null;
  if (typeof kid !== 'string' || kid.length === 0) return null;
  if (!isFiniteNonNegativeInteger(v)) return null;
  return { alg: LICENSE_ALG, typ: LICENSE_TOKEN_TYP, kid, v };
}

function parseClaims(value: unknown): LicenseClaims | null {
  if (!isRecord(value)) return null;
  const { edition, sub, iat, exp, grace_exp } = value;
  if (edition !== 'free' && edition !== 'pro') return null;
  if (typeof sub !== 'string') return null;
  if (!isFiniteNonNegativeInteger(iat) || !isFiniteNonNegativeInteger(exp) || !isFiniteNonNegativeInteger(grace_exp)) {
    return null;
  }
  return { edition, sub, iat, exp, grace_exp };
}

/**
 * Structural parse only — no signature, no clock. A structurally valid but
 * forged token is still rejected by `verifyLicenseToken`.
 */
export function parseLicenseToken(raw: unknown): TokenParseResult {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8192) {
    return { ok: false, reason: 'malformed' };
  }
  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerB64, payloadB64, signatureB64] = parts;
  const headerBytes = fromBase64Url(headerB64);
  const payloadBytes = fromBase64Url(payloadB64);
  const signature = fromBase64Url(signatureB64);
  if (!headerBytes || !payloadBytes || !signature) return { ok: false, reason: 'malformed' };
  if (signature.length !== 64) return { ok: false, reason: 'malformed' };

  let headerJson: unknown;
  let payloadJson: unknown;
  try {
    headerJson = JSON.parse(decodeUtf8(headerBytes));
    payloadJson = JSON.parse(decodeUtf8(payloadBytes));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const header = parseHeader(headerJson);
  const claims = parseClaims(payloadJson);
  if (!header || !claims) return { ok: false, reason: 'malformed' };

  return { ok: true, header, claims, signature, signingInput: `${headerB64}.${payloadB64}` };
}

// --- signature verification --------------------------------------------------

/** Ed25519 verification via WebCrypto. Returns false (never throws) on failure. */
export async function verifyEd25519(
  publicKeyRaw: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return false;
  try {
    const key = await subtle.importKey('raw', publicKeyRaw as unknown as ArrayBuffer, { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return await subtle.verify({ name: 'Ed25519' }, key, signature as unknown as ArrayBuffer, message as unknown as ArrayBuffer);
  } catch {
    return false;
  }
}

/** Absolute offline cutoff for these claims. 0 means unbounded. */
export function licenseOfflineCutoff(claims: LicenseClaims): number {
  if (claims.grace_exp > 0) return claims.grace_exp;
  return claims.exp;
}

/**
 * Full verification: structure + signature + clock. Expired tokens still return
 * their claims so a caller can apply the outage/grace matrix.
 */
export async function verifyLicenseToken(
  raw: unknown,
  publicKeys: PublicKeyRing,
  now: number = Date.now(),
  options: { clockSkewMs?: number } = {},
): Promise<TokenVerifyResult> {
  const parsed = parseLicenseToken(raw);
  if (!parsed.ok) return { valid: false, reason: 'malformed' };

  const keyB64 = publicKeys[parsed.header.kid];
  if (typeof keyB64 !== 'string') return { valid: false, reason: 'unknown-kid', header: parsed.header };
  const publicKeyRaw = fromBase64Url(keyB64);
  if (!publicKeyRaw || publicKeyRaw.length !== 32) {
    return { valid: false, reason: 'unknown-kid', header: parsed.header };
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return { valid: false, reason: 'crypto-unavailable', header: parsed.header };

  const signatureOk = await verifyEd25519(publicKeyRaw, parsed.signature, encodeUtf8(parsed.signingInput));
  if (!signatureOk) {
    return { valid: false, reason: 'bad-signature', header: parsed.header, claims: parsed.claims };
  }

  // Defence in depth (Riven R-12): `issue.ts` refuses to mint a token with no
  // term and no grace, but the verifier must not honour one from any other
  // issuer. A signature-valid but eternal token is rejected here.
  if (parsed.claims.exp === 0 && parsed.claims.grace_exp === 0) {
    return { valid: false, reason: 'no-term', header: parsed.header, claims: parsed.claims };
  }

  const skew = options.clockSkewMs ?? 0;
  if (parsed.claims.iat > 0 && now + skew < parsed.claims.iat) {
    return { valid: false, reason: 'not-yet-valid', header: parsed.header, claims: parsed.claims };
  }
  const cutoff = licenseOfflineCutoff(parsed.claims);
  if (cutoff > 0 && now > cutoff) {
    return { valid: false, reason: 'expired', header: parsed.header, claims: parsed.claims };
  }
  return { valid: true, header: parsed.header, claims: parsed.claims, keyId: parsed.header.kid };
}

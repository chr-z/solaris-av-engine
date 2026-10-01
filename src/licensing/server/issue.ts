/**
 * SOLARIS server-side entitlement issuance (SOLA-34).
 *
 * The private Ed25519 key is NEVER here. Issuance receives an injected signer —
 * a KMS/HSM adapter in production, an in-process key in tests — and produces a
 * token whose claims are absolute and server-issued.
 *
 * `grace_exp` is derived at issuance and signed into the token, so a tampered
 * client store cannot extend the offline window. Refresh issues a new token.
 */

import type { LicenseClaims, LicenseTokenHeader, SolarisEdition } from '../token';
import {
  LICENSE_ALG,
  LICENSE_TOKEN_TYP,
  LICENSE_TOKEN_VERSION,
  encodeUtf8,
  toBase64Url,
} from '../token';

/** Ed25519 signer. Production: a non-exportable KMS/HSM key. Test: raw key. */
export type Ed25519Signer = (message: Uint8Array) => Promise<Uint8Array>;

/** Default offline tolerance after the paid term ends (revocation lag bound). */
export const DEFAULT_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface LicenseIssueRequest {
  kid: string;
  subject: string;
  edition: SolarisEdition;
  /** Server clock ms. */
  issuedAt: number;
  /** Paid-term end (ms); 0 = no term end. */
  termEndsAt: number;
  /** Absolute offline cutoff (ms); 0 = fall back to termEndsAt. */
  graceEndsAt: number;
}

export interface BuiltLicenseToken {
  token: string;
  header: LicenseTokenHeader;
  claims: LicenseClaims;
  signingInput: string;
}

function assertIssueRequest(req: LicenseIssueRequest): void {
  if (!req.kid) throw new Error('issue: kid is required');
  if (typeof req.subject !== 'string' || req.subject.length === 0) throw new Error('issue: subject is required');
  if (!Number.isInteger(req.issuedAt) || req.issuedAt < 0) throw new Error('issue: issuedAt must be unix ms');
  if (!Number.isInteger(req.termEndsAt) || req.termEndsAt < 0) throw new Error('issue: termEndsAt must be unix ms or 0');
  if (!Number.isInteger(req.graceEndsAt) || req.graceEndsAt < 0) {
    throw new Error('issue: graceEndsAt must be unix ms or 0');
  }
  // Both zero would mint an eternal, unrevocable-offline licence; refuse it.
  if (req.termEndsAt === 0 && req.graceEndsAt === 0) {
    throw new Error('issue: refusing to mint a token with no term and no grace (eternal offline entitlement)');
  }
  if (req.graceEndsAt > 0 && req.graceEndsAt < req.issuedAt) {
    throw new Error('issue: graceEndsAt precedes issuedAt');
  }
  if (req.termEndsAt > 0 && req.graceEndsAt > 0 && req.graceEndsAt < req.termEndsAt) {
    throw new Error('issue: graceEndsAt precedes termEndsAt');
  }
}

/** Absolute grace cutoff from a policy, clamped to be >= the paid-term end. */
export function deriveGraceEnd(termEndsAt: number, issuedAt: number, graceMs: number = DEFAULT_GRACE_MS): number {
  const base = termEndsAt > 0 ? termEndsAt : issuedAt;
  return base + Math.max(0, graceMs);
}

/**
 * Builds the token without signing — useful for deterministic tests and for
 * inspecting the exact signing input.
 */
export function buildLicenseTokenUnsigned(req: LicenseIssueRequest): Omit<BuiltLicenseToken, 'token'> {
  assertIssueRequest(req);
  const header: LicenseTokenHeader = {
    alg: LICENSE_ALG,
    typ: LICENSE_TOKEN_TYP,
    kid: req.kid,
    v: LICENSE_TOKEN_VERSION,
  };
  const claims: LicenseClaims = {
    edition: req.edition,
    sub: req.subject,
    iat: req.issuedAt,
    exp: req.termEndsAt,
    grace_exp: req.graceEndsAt,
  };
  // Fixed key order is deterministic but not security-relevant: the verifier
  // signs/verifies the encoded bytes, never a re-serialised object.
  const headerB64 = toBase64Url(encodeUtf8(JSON.stringify(header)));
  const payloadB64 = toBase64Url(encodeUtf8(JSON.stringify(claims)));
  return { header, claims, signingInput: `${headerB64}.${payloadB64}` };
}

/**
 * Builds a signer from a non-extractable WebCrypto key. The key may come from a
 * KMS/HSM adapter; `importEd25519SignerFromPkcs8` is the self-host fallback for
 * an operator-provided key. The key material is never exported after import.
 */
export function createWebCryptoSigner(privateKey: CryptoKey): Ed25519Signer {
  return async (message: Uint8Array) => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('WebCrypto unavailable');
    const signature = await subtle.sign({ name: 'Ed25519' }, privateKey, message as unknown as ArrayBuffer);
    return new Uint8Array(signature);
  };
}

/** Imports an Ed25519 PKCS#8 private key as a non-extractable signer (self-host). */
export async function importEd25519SignerFromPkcs8(pkcs8: ArrayBuffer | Uint8Array): Promise<Ed25519Signer> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto unavailable');
  const key = await subtle.importKey('pkcs8', pkcs8 as unknown as ArrayBuffer, { name: 'Ed25519' }, false, ['sign']);
  return createWebCryptoSigner(key);
}

/** Issues a signed token. The signer owns the private key (KMS/HSM). */
export async function issueLicenseToken(req: LicenseIssueRequest, sign: Ed25519Signer): Promise<BuiltLicenseToken> {
  const unsigned = buildLicenseTokenUnsigned(req);
  const signature = await sign(encodeUtf8(unsigned.signingInput));
  if (!signature || signature.length !== 64) {
    throw new Error('issue: Ed25519 signer must return a 64-byte signature');
  }
  return { ...unsigned, token: `${unsigned.signingInput}.${toBase64Url(signature)}` };
}

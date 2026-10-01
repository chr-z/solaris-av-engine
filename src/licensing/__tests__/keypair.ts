/**
 * Test-only Ed25519 helpers (SOLA-34). Not a test file itself; imported by the
 * licensing tests to exercise the real sign/verify/issue code paths.
 */

import { webcrypto } from 'node:crypto';
import type { Ed25519Signer } from '../server/issue';
import { createWebCryptoSigner, issueLicenseToken, type LicenseIssueRequest } from '../server/issue';
import type { PublicKeyRing } from '../token';
import { toBase64Url } from '../token';

export interface TestKeyPair {
  kid: string;
  publicKeyB64u: string;
  publicKeys: PublicKeyRing;
  sign: Ed25519Signer;
  /** Raw Ed25519 private key, for forging/mis-signing in negative tests. */
  privateKey: CryptoKey;
}

const encoder = new TextEncoder();

export async function newTestKeyPair(kid = 'sol-test'): Promise<TestKeyPair> {
  const keyPair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as unknown as CryptoKeyPair;
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', keyPair.publicKey));
  const publicKeyB64u = toBase64Url(raw);
  return {
    kid,
    publicKeyB64u,
    publicKeys: Object.freeze({ [kid]: publicKeyB64u }),
    sign: createWebCryptoSigner(keyPair.privateKey),
    privateKey: keyPair.privateKey,
  };
}

export async function forgeSigner(privateKey: CryptoKey): Promise<Ed25519Signer> {
  return createWebCryptoSigner(privateKey);
}

export interface IssueOptions {
  subject?: string;
  edition?: 'pro' | 'free';
  issuedAt?: number;
  termEndsAt?: number;
  graceEndsAt?: number;
  kid?: string;
}

/** Issue a token with the real production issuer against a test signer. */
export async function issueTestToken(
  keyPair: TestKeyPair,
  options: IssueOptions = {},
): Promise<{ token: string; req: LicenseIssueRequest }> {
  const issuedAt = options.issuedAt ?? 1_700_000_000_000;
  const termEndsAt = options.termEndsAt ?? issuedAt + 365 * 86_400_000;
  const graceEndsAt = options.graceEndsAt ?? termEndsAt + 30 * 86_400_000;
  const req: LicenseIssueRequest = {
    kid: options.kid ?? keyPair.kid,
    subject: options.subject ?? 'order:P1001',
    edition: options.edition ?? 'pro',
    issuedAt,
    termEndsAt,
    graceEndsAt,
  };
  const built = await issueLicenseToken(req, keyPair.sign);
  return { token: built.token, req };
}

/** Signs an arbitrary signing-input with a key — used to craft bad tokens. */
export async function signInput(sign: Ed25519Signer, input: string): Promise<string> {
  const signature = await sign(encoder.encode(input));
  return toBase64Url(signature);
}

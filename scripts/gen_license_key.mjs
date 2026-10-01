#!/usr/bin/env node
/**
 * Solaris Pro licence issuer (SOLA-34) — Ed25519, server-side only.
 *
 * Replaces the old HMAC-SHA256 generator. The signing key is an Ed25519 PKCS#8
 * key that must stay server-side (KMS/HSM or a server secret); it is never a
 * VITE_ variable and never part of the client bundle.
 *
 *   SOLARIS_LICENSE_SIGNING_KEY_PKCS8=<b64url pkcs8> \
 *     node scripts/gen_license_key.mjs --kid sol-2026a --subject order:P1001 --days 365
 *
 * Or with a keypair file produced by gen_license_keypair.mjs:
 *   node scripts/gen_license_key.mjs --key ./signing-key.json --subject order:P1001 --days 365
 *
 * The token format mirrors `src/licensing/server/issue.ts`; the
 * `scripts/__tests__` guard verifies script output against the runtime verifier
 * so the two cannot drift silently.
 */

import { webcrypto as crypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ALG = 'Ed25519';
const TYP = 'SOLARIS-LICENSE';
const VERSION = 1;
const DEFAULT_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const args = { kid: '', subject: '', days: '365', graceDays: '30', edition: 'pro', key: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--kid') args.kid = argv[++i];
    else if (arg === '--subject') args.subject = argv[++i];
    else if (arg === '--days') args.days = argv[++i];
    else if (arg === '--grace-days') args.graceDays = argv[++i];
    else if (arg === '--edition') args.edition = argv[++i];
    else if (arg === '--key') args.key = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: SOLARIS_LICENSE_SIGNING_KEY_PKCS8=<b64url pkcs8> node scripts/gen_license_key.mjs ' +
          '--kid <id> --subject <ref> [--days 365] [--grace-days 30] [--key <keypair.json>]',
      );
      process.exit(0);
    }
  }
  return args;
}

const b64url = buffer =>
  Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fromB64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

function resolveSigningKey(args) {
  if (args.key) {
    const parsed = JSON.parse(readFileSync(args.key, 'utf8'));
    if (!parsed.privateKeyPkcs8B64u) throw new Error(`No privateKeyPkcs8B64u in ${args.key}`);
    if (!args.kid && parsed.kid) args.kid = parsed.kid;
    return fromB64url(parsed.privateKeyPkcs8B64u);
  }
  const env = process.env.SOLARIS_LICENSE_SIGNING_KEY_PKCS8;
  if (!env) {
    throw new Error(
      'Missing signing key. Set SOLARIS_LICENSE_SIGNING_KEY_PKCS8 or pass --key <keypair.json>.',
    );
  }
  return fromB64url(env);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.kid) throw new Error('--kid is required (must match the client public ring)');
  if (!args.subject) throw new Error('--subject is required (opaque order/customer reference)');
  if (args.edition !== 'pro' && args.edition !== 'free') throw new Error('--edition must be pro or free');
  const days = Number.parseInt(args.days, 10);
  const graceDays = Number.parseInt(args.graceDays, 10);
  if (!Number.isFinite(days) || days < 0) throw new Error('--days must be a non-negative integer');
  if (!Number.isFinite(graceDays) || graceDays < 0) throw new Error('--grace-days must be a non-negative integer');

  const issuedAt = Date.now();
  const termEndsAt = days === 0 ? 0 : issuedAt + days * 86_400_000;
  const graceEndsAt = (termEndsAt > 0 ? termEndsAt : issuedAt) + (graceDays * 86_400_000 || DEFAULT_GRACE_MS);

  const header = { alg: ALG, typ: TYP, kid: args.kid, v: VERSION };
  const claims = { edition: args.edition, sub: args.subject, iat: issuedAt, exp: termEndsAt, grace_exp: graceEndsAt };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header), 'utf8'));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle
    .importKey('pkcs8', resolveSigningKey(args), { name: 'Ed25519' }, false, ['sign'])
    .then(key => crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(signingInput)));
  const token = `${signingInput}.${b64url(new Uint8Array(signature))}`;
  process.stdout.write(`${token}\n`);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Solaris Pro license key generator (S6.1).
 *
 * Signs offline activation keys with HMAC-SHA256. Run from the repo root:
 *
 *   SOLARIS_LICENSE_SECRET='your-secret' node scripts/gen_license_key.mjs \
 *     --edition pro --expires 0 --payload customer-42
 *
 * The secret lives ONLY in your environment (or CI secret store) — never in
 * the repo, never in a VITE_ variable.
 */

import { webcrypto as crypto } from 'node:crypto';

function parseArgs(argv) {
  const args = { edition: 'pro', expires: '0', payload: 'customer' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--edition') args.edition = argv[++i];
    else if (arg === '--expires') args.expires = argv[++i];
    else if (arg === '--payload') args.payload = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: SOLARIS_LICENSE_SECRET=... node scripts/gen_license_key.mjs [--edition pro|free] [--expires <unix-ms|0>] [--payload <ref>]');
      process.exit(0);
    }
  }
  return args;
}

const b64url = buffer =>
  Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function main() {
  const secret = process.env.SOLARIS_LICENSE_SECRET;
  if (!secret) {
    console.error('Error: SOLARIS_LICENSE_SECRET is not set. Example:');
    console.error("  SOLARIS_LICENSE_SECRET='long-random-string' node scripts/gen_license_key.mjs");
    process.exit(1);
  }

  const { edition, expires, payload } = parseArgs(process.argv);
  if (edition !== 'pro' && edition !== 'free') {
    console.error(`Error: unknown edition "${edition}" (expected "pro" or "free")`);
    process.exit(1);
  }
  if (!/^\d+$/.test(expires)) {
    console.error('Error: --expires must be a unix timestamp in ms, or 0 for no expiry');
    process.exit(1);
  }

  const version = '1';
  const payloadB64 = b64url(payload);
  const body = `SOLARIS-${version}-${expires}-${edition}-${payloadB64}`;
  const key = await crypto.subtle
    .importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then(k => crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)))
    .then(sig => `${body}.${b64url(new Uint8Array(sig))}`);

  console.log(key);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

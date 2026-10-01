#!/usr/bin/env node
/**
 * SOLARIS Ed25519 licence keypair generator (SOLA-34).
 *
 * Generates the *signing* keypair. The PUBLIC key goes into the client
 * (`src/licensing/keys.ts`, safe to ship). The PRIVATE key must never be
 * committed: store it in a KMS/HSM, or as a server secret, and delete the local
 * file afterwards.
 *
 *   node scripts/gen_license_keypair.mjs --kid sol-2026a --out ./signing-key.json
 *
 * Output:
 *   - stdout: PUBLIC_KEY_B64U=<...>  KID=<...>
 *   - file:   { kid, publicKeyB64u, privateKeyPkcs8B64u } (mode 0600)
 */

import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = { kid: 'sol-2026a', out: 'solaris-license-signing-key.json' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--kid') args.kid = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/gen_license_keypair.mjs [--kid <id>] [--out <file>]');
      process.exit(0);
    }
  }
  return args;
}

const b64url = buffer =>
  Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function main() {
  const { kid, out } = parseArgs(process.argv);
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  const payload = {
    kid,
    publicKeyB64u: b64url(publicKey),
    privateKeyPkcs8B64u: b64url(privateKeyPkcs8),
    createdAt: new Date().toISOString(),
    warning: 'PRIVATE KEY — store in KMS/HSM or a server secret; never commit.',
  };
  writeFileSync(out, JSON.stringify(payload, null, 2), { mode: 0o600 });
  process.stdout.write(`PUBLIC_KEY_B64U=${payload.publicKeyB64u}\nKID=${kid}\nPRIVATE_KEY_FILE=${out}\n`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Bundle signing-material guard (SOLA-34).
 *
 * Fails if a built client bundle contains anything capable of minting a
 * licence, or if the verification-only public key went missing. Run after
 * `vite build`; also wired into CI and the deploy workflow.
 *
 *   node scripts/check_bundle_secrets.mjs [distDir=dist]
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const distDir = process.argv[2] ?? 'dist';
// Built-in verification key from src/licensing/keys.ts (public, expected).
const EXPECTED_PUBLIC_KEY = 'Ly4Oo8LBgLEX2cCHiOo4OLpja01FiSi2LtwJ1cBXlTc';

const FORBIDDEN = [
  { name: 'PEM private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Ed25519 PKCS#8 private key (base64)', re: /MC4CAQAwBQYDK2VwBCIEIA/ },
  { name: 'Ed25519 PKCS#8 private key (hex)', re: /302e020100300506032b657004220420/ },
  { name: 'signing-key env var name', re: /SOLARIS_LICENSE_SIGNING_KEY_PKCS8/ },
  { name: 'webhook secret env var name', re: /SOLARIS_PAYMENT_WEBHOOK_SECRET/ },
  { name: 'legacy VITE HMAC secret', re: /VITE_SOLARIS_LICENSE_SECRET/ },
  { name: 'HMAC key import for licensing', re: /name:\s*["']HMAC["'][\s\S]{0,120}(sign|verify)/ },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|mjs|cjs|css|html|map)$/.test(entry)) out.push(full);
  }
  return out;
}

function main() {
  if (!existsSync(distDir)) {
    console.error(`check_bundle_secrets: ${distDir} not found — run the build first.`);
    process.exit(1);
  }
  const files = walk(distDir);
  if (files.length === 0) {
    console.error(`check_bundle_secrets: no build artifacts under ${distDir}.`);
    process.exit(1);
  }

  let violations = 0;
  let publicKeySeen = false;
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (content.includes(EXPECTED_PUBLIC_KEY)) publicKeySeen = true;
    for (const { name, re } of FORBIDDEN) {
      if (re.test(content)) {
        console.error(`::error::${name} found in ${file}`);
        violations += 1;
      }
    }
  }
  if (!publicKeySeen) {
    console.error('::error::verification public key missing from the bundle — offline activation would be inert.');
    violations += 1;
  }
  if (violations > 0) {
    console.error(`check_bundle_secrets: FAILED with ${violations} violation(s).`);
    process.exit(1);
  }
  console.log(`check_bundle_secrets: OK — ${files.length} artifacts scanned; verification key present; no signing material.`);
}

main();

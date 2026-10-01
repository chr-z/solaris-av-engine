#!/usr/bin/env node
/**
 * Bundle signing-material guard (SOLA-34).
 *
 * Fails if a built client bundle contains anything capable of minting a
 * licence, or if the verification-only public key went missing. Run after
 * `vite build`; also wired into CI and the deploy workflow.
 *
 *   node scripts/check_bundle_secrets.mjs [distDir=dist]
 *   node scripts/check_bundle_secrets.mjs --self-test
 *
 * SOLA-34 remediation (Riven R-01): the base64url PKCS#8 detector used a prefix
 * ending in `A`, which only matched ~4% of real keys (the last base64 character
 * encodes random seed bits). The prefix is now constant, the hex variant is
 * kept, and the walker scans every artifact type (`.json`, `.pem`, `.txt`, …),
 * not just JS/CSS/HTML — a leaked keypair JSON or PEM previously sailed through.
 *
 * `--self-test` generates a real key and emits it in each supported encoding,
 * then asserts the scanner catches every one. A guard without a negative test
 * silently rots; run this in CI alongside the dist scan.
 */

import { readdirSync, readFileSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const distDir = process.argv[2] ?? 'dist';
// Built-in verification key from src/licensing/keys.ts (public, expected).
export const EXPECTED_PUBLIC_KEY = 'Ly4Oo8LBgLEX2cCHiOo4OLpja01FiSi2LtwJ1cBXlTc';

/** Files larger than this are skipped by the walker (not licence material). */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export const FORBIDDEN = [
  { name: 'PEM private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // Constant DER prefix of an Ed25519 PKCS#8 key (30 2e 02 01 00 30 05 06 03
  // 2b 65 70 04 22 04 20). The old literal ended in `A`, matching ~4% of keys.
  { name: 'Ed25519 PKCS#8 private key (base64)', re: /MC4CAQAwBQYDK2VwBCIEI/ },
  { name: 'Ed25519 PKCS#8 private key (hex)', re: /302e020100300506032b657004220420/ },
  { name: 'keypair JSON field', re: /privateKeyPkcs8B64u/ },
  { name: 'signing-key env var name', re: /SOLARIS_LICENSE_SIGNING_KEY_PKCS8/ },
  { name: 'webhook secret env var name', re: /SOLARIS_PAYMENT_WEBHOOK_SECRET/ },
  { name: 'legacy VITE HMAC secret', re: /VITE_SOLARIS_LICENSE_SECRET/ },
  { name: 'HMAC key import for licensing', re: /name:\s*["']HMAC["'][\s\S]{0,120}(sign|verify)/ },
];

/** Recursively collects scannable files. Every regular file under the cap. */
export function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (stat.isFile() && stat.size <= MAX_FILE_BYTES) out.push(full);
  }
  return out;
}

/** Scans a directory. Returns violation details plus whether the public key appeared. */
export function scanDirectory(dir) {
  if (!existsSync(dir)) throw new Error(`${dir} not found`);
  const files = walk(dir);
  const violations = [];
  let publicKeySeen = false;
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (content.includes(EXPECTED_PUBLIC_KEY)) publicKeySeen = true;
    for (const { name, re } of FORBIDDEN) {
      if (re.test(content)) violations.push({ file, name });
    }
  }
  return { files, violations, publicKeySeen };
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest().catch(error => {
      console.error(error);
      process.exit(1);
    });
    return;
  }

  let report;
  try {
    report = scanDirectory(distDir);
  } catch (error) {
    console.error(`check_bundle_secrets: ${error.message} — run the build first.`);
    process.exit(1);
  }
  if (report.files.length === 0) {
    console.error(`check_bundle_secrets: no build artifacts under ${distDir}.`);
    process.exit(1);
  }

  for (const { file, name } of report.violations) {
    console.error(`::error::${name} found in ${file}`);
  }
  if (!report.publicKeySeen) {
    console.error('::error::verification public key missing from the bundle — offline activation would be inert.');
  }
  const violations = report.violations.length + (report.publicKeySeen ? 0 : 1);
  if (violations > 0) {
    console.error(`check_bundle_secrets: FAILED with ${violations} violation(s).`);
    process.exit(1);
  }
  console.log(
    `check_bundle_secrets: OK — ${report.files.length} artifacts scanned; verification key present; no signing material.`,
  );
}

/** Generates a real key and asserts the scanner catches every encoded form. */
export async function runSelfTest() {
  const b64url = buffer =>
    Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const b64u = b64url(pkcs8);
  const hex = Buffer.from(pkcs8).toString('hex');
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----\n`;

  const dir = mkdtempSync(join(tmpdir(), 'solaris-bundle-guard-'));
  const samples = {
    'key.js': `export const k = ${JSON.stringify(b64u)};\n`,
    'key.json': JSON.stringify({ kid: 'x', privateKeyPkcs8B64u: b64u }),
    'key.pem': pem,
    'key.txt': hex,
    'nested/key.map': JSON.stringify({ sourcesContent: [b64u] }),
  };
  try {
    for (const [name, content] of Object.entries(samples)) {
      const full = join(dir, name);
      mkdirFor(full);
      writeFileSync(full, content);
    }
    const report = scanDirectory(dir);
    const missed = Object.keys(samples).filter(name => !report.violations.some(v => v.file.endsWith(name)));
    if (missed.length > 0) {
      console.error(`check_bundle_secrets: SELF-TEST FAILED — scanner missed: ${missed.join(', ')}`);
      process.exit(1);
    }
    // A clean directory must produce no violations (no false positives).
    const cleanDir = mkdtempSync(join(tmpdir(), 'solaris-bundle-clean-'));
    writeFileSync(join(cleanDir, 'app.js'), 'export const answer = 42;\n');
    const clean = scanDirectory(cleanDir);
    rmSync(cleanDir, { recursive: true, force: true });
    if (clean.violations.length > 0) {
      console.error('check_bundle_secrets: SELF-TEST FAILED — false positive on a clean file');
      process.exit(1);
    }
    console.log('check_bundle_secrets: self-test OK — all 5 encodings detected, clean file passed.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mkdirFor(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

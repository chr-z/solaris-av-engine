/**
 * SOLA-34 R-01 regression: the bundle signing-material guard must catch a real
 * Ed25519 PKCS#8 key regardless of encoding. The old base64url literal matched
 * ~4% of generated keys (its last char encoded random bits), so a leaked key in
 * the bundle could pass CI. This test generates real keys and asserts detection.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { webcrypto } from 'node:crypto';
// @ts-expect-error - plain ESM script, no type declarations
import { scanDirectory } from '../../../scripts/check_bundle_secrets.mjs';

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'solaris-guard-test-'));
  dirs.push(dir);
  return dir;
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('bundle signing-material guard (Riven R-01)', () => {
  it('detects real PKCS#8 keys encoded as base64url JS, JSON, PEM, hex and map', async () => {
    const dir = tmp();
    const pkcs8Keys: Uint8Array[] = [];
    for (let i = 0; i < 25; i += 1) {
      const pair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as unknown as CryptoKeyPair;
      pkcs8Keys.push(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)));
    }
    const primary = pkcs8Keys[0];
    const b64u = b64url(primary);
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'key.js'), `export const k = ${JSON.stringify(b64u)};\n`);
    writeFileSync(join(dir, 'key.json'), JSON.stringify({ kid: 'x', privateKeyPkcs8B64u: b64u }));
    writeFileSync(
      join(dir, 'key.pem'),
      `-----BEGIN PRIVATE KEY-----\n${Buffer.from(primary).toString('base64')}\n-----END PRIVATE KEY-----\n`,
    );
    writeFileSync(join(dir, 'key.txt'), Buffer.from(primary).toString('hex'));
    writeFileSync(join(dir, 'nested', 'key.map'), JSON.stringify({ sourcesContent: [b64u] }));

    const report = scanDirectory(dir);
    for (const name of ['key.js', 'key.json', 'key.pem', 'key.txt', 'nested/key.map']) {
      expect(report.violations.some((v: { file: string }) => v.file.endsWith(name))).toBe(true);
    }

    // Every generated key must be caught in base64url form, not just the first.
    for (let i = 0; i < pkcs8Keys.length; i += 1) {
      const sub = tmp();
      writeFileSync(join(sub, `k${i}.js`), `const k=${JSON.stringify(b64url(pkcs8Keys[i]))};`);
      const single = scanDirectory(sub);
      expect(single.violations.length, `key #${i} evaded the guard`).toBeGreaterThan(0);
    }
  });

  it('does not flag a clean bundle (no false positive)', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'app.js'), 'export const answer = 42;\n');
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Solaris</title>\n');
    const report = scanDirectory(dir);
    expect(report.violations).toEqual([]);
  });
});

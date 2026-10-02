/**
 * SOLA-142 Fix B regression: the secret scan's narrow allowlist covers ONLY
 * the bundle guard's deliberate PEM generator lines — keyed by file path AND
 * fixture marker, never a blanket suppression.
 *
 * This test pins that contract from both sides:
 *   - the two reviewed fixture lines ARE allowlisted (scan stays green);
 *   - a NEW PEM-looking literal anywhere else — including a static key pasted
 *     into one of the allowlisted files WITHOUT the generator marker — is
 *     NOT allowlisted (scan still catches it);
 *   - Google API key hits are NEVER allowlisted (a real leak must fail);
 *   - the regex set itself is unchanged (no weakening).
 *
 * Self-reference note: secret-shaped literals below are built via
 * concatenation so this test file stays self-clean under the scan it pins.
 */

import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error - plain ESM script, no type declarations
import { ALLOWLIST, SECRET_PATTERNS, isAllowlisted, scanTrackedFiles } from '../../scripts/check_tracked_secrets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

// Contiguous secret-shaped literals, assembled so this file is self-clean.
const PEM = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const GOOGLE_KEY = ['AIzaSyAO_FJ2SlqU8Q4STEHLGCilw', '_Y9_11qcW8'].join('');
const FIXTURE_A_LINE = `  const pem = \`${PEM}\\n\${Buffer.from(pkcs8).toString('base64')}\\n-----END PRIVATE KEY-----\\n\`;`;
const FIXTURE_B_LINE = `      \`${PEM}\\n\${Buffer.from(primary).toString('base64')}\\n-----END PRIVATE KEY-----\\n\`,`;
// A pasted static key block: same header, but no generator marker on the line.
const STATIC_KEY_LINE = `${PEM} MIIEvQIBADANBgkqhkiG9w0BAQEFAASC`;
const OTHER_FILE = 'src/server/api/handlers.ts';

describe('SOLA-142 Fix B — secret-scan allowlist is narrow and pinned', () => {
  it('keeps the full CI regex set (no weakening)', () => {
    const sources = SECRET_PATTERNS.map((p: { source?: string; re: RegExp }) =>
      String(p.source ?? p.re?.source ?? p.re),
    );
    expect(sources.some((s: string) => s.includes('AIza') && s.includes('{35}'))).toBe(true);
    expect(sources.some((s: string) => s.includes('PRIVATE KEY'))).toBe(true);
    expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(5);
  });

  it('covers exactly the two reviewed guard fixtures', () => {
    expect(ALLOWLIST.length).toBe(2);
    expect(isAllowlisted('scripts/check_bundle_secrets.mjs', 'PEM private key', FIXTURE_A_LINE)).toBe(
      true,
    );
    expect(
      isAllowlisted('src/licensing/__tests__/bundleGuard.test.ts', 'PEM private key', FIXTURE_B_LINE),
    ).toBe(true);
  });

  it('fails a NEW PEM-looking literal in any other file', () => {
    expect(isAllowlisted(OTHER_FILE, 'PEM private key', STATIC_KEY_LINE)).toBe(false);
    expect(isAllowlisted(OTHER_FILE, 'PEM private key', `${PEM}\nMIIBIjANBgkqh`)).toBe(false);
  });

  it('fails a NEW PEM-looking literal in an allowlisted file without the fixture marker', () => {
    // Pasting a static key into the fixture file must still break the scan:
    // suppression requires the generator marker on the SAME line.
    expect(
      isAllowlisted('scripts/check_bundle_secrets.mjs', 'PEM private key', STATIC_KEY_LINE),
    ).toBe(false);
    expect(
      isAllowlisted(
        'src/licensing/__tests__/bundleGuard.test.ts',
        'PEM private key',
        STATIC_KEY_LINE,
      ),
    ).toBe(false);
  });

  it('never allowlists a Google API key hit', () => {
    const keyLine = `const url = 'https://www.youtube.com/youtubei/v1/player?key=${GOOGLE_KEY}';`;
    expect(GOOGLE_KEY.length).toBe(39);
    for (const entry of ALLOWLIST as Array<{ file: string }>) {
      expect(isAllowlisted(entry.file, 'Google API key', keyLine)).toBe(false);
    }
    expect(isAllowlisted(OTHER_FILE, 'Google API key', keyLine)).toBe(false);
    expect(
      SECRET_PATTERNS.some((p: { name: string; re: RegExp }) => p.name === 'Google API key' && p.re.test(keyLine)),
    ).toBe(true);
  });

  it('reports zero violations on the current tracked tree (scan exit 0)', () => {
    const report = scanTrackedFiles(REPO_ROOT) as {
      violations: Array<{ file: string }>;
      envFiles: string[];
    };
    expect(report.envFiles).toEqual([]);
    expect(report.violations).toEqual([]);
  });
});

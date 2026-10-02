#!/usr/bin/env node
/**
 * Tracked-tree secret scan (SOLA-142 Fix B).
 *
 * Replaces the inline `grep` step that used to live in `.github/workflows/ci.yml`.
 * The regex set is byte-for-byte the CI set it replaces — nothing weakened,
 * nothing added. What changed is precision: the bundle guard's own deliberate
 * PEM *generator* lines (which build a throwaway key at test time and commit
 * no secret) are suppressed by a narrow allowlist keyed by file path AND
 * fixture marker. A contiguous PEM-looking literal anywhere else — including
 * a NEW literal added to those same files without the generator marker —
 * still fails the scan.
 *
 *   node scripts/check_tracked_secrets.mjs [cwd=process.cwd()]
 *
 * Self-reference note: the allowlist pins below deliberately build the PEM
 * header via concatenation (`PEM_HEAD + ' ' + PEM_TAIL`) so this file itself
 * contains no contiguous secret-shaped literal. That is the same `grep -v
 * grep` self-exclusion every scanner needs, not a suppression: a contiguous
 * header committed anywhere still matches.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECRET_PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'OpenAI key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'GitHub token', re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'PEM private key', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
];

// Built without a contiguous literal so this scanner file is self-clean.
const PEM_HEAD = '-----BEGIN';
const PEM_TAIL = 'PRIVATE KEY-----';
const PEM_HEADER = `${PEM_HEAD} ${PEM_TAIL}`;

/**
 * Narrow, reviewed allowlist (SOLA-142). Each entry suppresses ONE pattern in
 * ONE file and only on lines that also carry the fixture marker — the
 * generator expression proving the line builds a throwaway key at runtime
 * rather than embedding one. Never a whole-file or whole-pattern waiver.
 */
export const ALLOWLIST = [
  {
    file: 'scripts/check_bundle_secrets.mjs',
    pattern: 'PEM private key',
    requireLineContains: [PEM_HEADER, 'Buffer.from(pkcs8)'],
    reason: 'SOLA-142 reviewed: bundle-guard self-test generator (throwaway key, no committed secret)',
  },
  {
    file: 'src/licensing/__tests__/bundleGuard.test.ts',
    pattern: 'PEM private key',
    requireLineContains: [PEM_HEADER, 'Buffer.from(primary)'],
    reason: 'SOLA-142 reviewed: bundle-guard regression fixture generator (throwaway key, no committed secret)',
  },
];

/**
 * True only when the match is covered by a reviewed entry: exact file path,
 * exact pattern name, and every fixture marker present on the same line.
 */
export function isAllowlisted(file, patternName, line) {
  return ALLOWLIST.some(
    (entry) =>
      entry.file === file &&
      entry.pattern === patternName &&
      entry.requireLineContains.every((marker) => line.includes(marker)),
  );
}

function trackedFiles(cwd) {
  const out = execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function trackedEnvFiles(cwd) {
  try {
    const out = execFileSync('git', ['ls-files', '--', '.env', '.env.*', '*.env'], {
      cwd,
      encoding: 'utf8',
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Scans every tracked file line-by-line (the CI `grep` is line-oriented, so
 * this is equivalent for the single-line pattern set) and returns violations
 * plus the suppressed allowlist hits for the report.
 */
export function scanTrackedFiles(cwd = process.cwd()) {
  const root = resolve(cwd);
  const violations = [];
  const allowlisted = [];
  for (const file of trackedFiles(root)) {
    let content;
    try {
      content = readFileSync(resolve(root, file), 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\0')) continue; // grep -I skips binary; so do we
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const { name, re } of SECRET_PATTERNS) {
        if (!re.test(line)) continue;
        if (isAllowlisted(file, name, line)) {
          allowlisted.push({ file, line: i + 1, name });
        } else {
          violations.push({ file, line: i + 1, name, text: line.trim().slice(0, 160) });
        }
      }
    }
  }
  const envFiles = trackedEnvFiles(root);
  return { violations, allowlisted, envFiles };
}

function main() {
  const cwd = process.argv[2] ?? process.cwd();
  let report;
  try {
    report = scanTrackedFiles(cwd);
  } catch (error) {
    console.error(`check_tracked_secrets: failed to list tracked files — ${error.message}`);
    process.exit(1);
  }
  for (const { file, line, name } of report.allowlisted) {
    console.log(`check_tracked_secrets: allowlisted ${name} in ${file}:${line} (reviewed fixture)`);
  }
  for (const { file, line, name } of report.violations) {
    console.error(`::error::Potential secret (${name}) found in ${file}:${line}`);
  }
  if (report.envFiles.length > 0) {
    console.error('::error::An environment file is tracked in git:');
    for (const file of report.envFiles) console.error(`::error::  ${file}`);
  }
  const total = report.violations.length + report.envFiles.length;
  if (total > 0) {
    console.error(`check_tracked_secrets: FAILED with ${total} violation(s).`);
    process.exit(1);
  }
  console.log(
    `check_tracked_secrets: OK — ${report.allowlisted.length} reviewed fixture line(s) allowlisted, no secrets in tracked tree.`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

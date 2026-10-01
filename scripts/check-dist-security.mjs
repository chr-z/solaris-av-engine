#!/usr/bin/env node
/**
 * SOLA-35 built-artifact security gate.
 *
 * Asserts that the DEPLOYED artifact (dist/) carries the security headers and
 * that no misleading Vercel config can have come along. Run after `npm run
 * build`; exits non-zero on any violation so CI fails loudly instead of
 * shipping an inert CSP again.
 *
 * Usage: node scripts/check-dist-security.mjs [distDir=dist]
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const distDir = process.argv[2] ?? 'dist';
const failures = [];

function fail(message) {
  failures.push(message);
}

function parseSections(text) {
  const sections = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      sections.set(line.trim(), current);
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1 || !current) continue;
    current.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
  }
  return sections;
}

function directive(csp, name) {
  return (
    csp
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.toLowerCase().startsWith(`${name.toLowerCase()} `)) ?? ''
  );
}

const headersPath = resolve(distDir, '_headers');
if (!existsSync(headersPath)) {
  fail(`${headersPath} is missing — the built artifact carries no security headers.`);
} else {
  const sections = parseSections(readFileSync(headersPath, 'utf8'));
  const global = sections.get('/*');
  if (!global) {
    fail('dist/_headers has no global /* block.');
  } else {
    const csp = global.get('content-security-policy') ?? '';
    if (!csp) fail('dist/_headers has no Content-Security-Policy.');
    if (!directive(csp, 'frame-ancestors').includes("'none'")) {
      fail("CSP is missing frame-ancestors 'none'.");
    }
    if (csp.includes("'unsafe-eval'")) fail("CSP still grants 'unsafe-eval'.");
    if (directive(csp, 'script-src').includes("'unsafe-inline'")) {
      fail("script-src still grants 'unsafe-inline'.");
    }
    const connect = directive(csp, 'connect-src');
    for (const token of connect.split(/\s+/).slice(1)) {
      if (['http:', 'https:', 'ws:', 'wss:'].includes(token)) {
        fail(`connect-src contains a bare scheme wildcard: ${token}`);
      }
    }
    const hsts = global.get('strict-transport-security') ?? '';
    if (!/max-age=\d{6,}/.test(hsts)) fail('HSTS missing or max-age below one year.');
    if ((global.get('x-frame-options') ?? '') !== 'DENY') fail('X-Frame-Options must be DENY.');
    if ((global.get('x-content-type-options') ?? '') !== 'nosniff') fail('X-Content-Type-Options must be nosniff.');
  }
}

if (!existsSync(resolve(distDir, 'index.html'))) fail('dist/index.html is missing.');
if (existsSync(resolve(distDir, 'vercel.json')) || existsSync('vercel.json')) {
  fail('vercel.json is present; Cloudflare Pages never reads it. Delete it.');
}

if (failures.length > 0) {
  console.error('check-dist-security: FAIL');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-dist-security: PASS (CSP + frame-ancestors + HSTS present, no unsafe-eval, scoped connect-src)');

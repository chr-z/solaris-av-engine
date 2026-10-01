import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SOLA-35 / threat-model P1-3: the CSP and the whole header block lived in
 * vercel.json, which Cloudflare Pages never reads. These tests assert the
 * headers against the SOURCE artifact (`public/_headers`, copied verbatim to
 * `dist/_headers` by Vite) and, when a build exists, against `dist/_headers`.
 */

function parseHeadersFile(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    if (!/^\s/.test(rawLine)) {
      current = new Map();
      sections.set(rawLine.trim(), current);
      continue;
    }
    const idx = rawLine.indexOf(':');
    if (idx === -1 || !current) continue;
    current.set(rawLine.slice(0, idx).trim().toLowerCase(), rawLine.slice(idx + 1).trim());
  }
  return sections;
}

function directive(csp: string, name: string): string {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(`${name.toLowerCase()} `));
  return found ?? '';
}

const ROOT = process.cwd();

function readHeaders(relPath: string): Map<string, Map<string, string>> {
  return parseHeadersFile(readFileSync(resolve(ROOT, relPath), 'utf8'));
}

const ARTIFACTS = [
  ['public/_headers', readHeaders('public/_headers')] as const,
  ...(existsSync(resolve(ROOT, 'dist/_headers'))
    ? [['dist/_headers', readHeaders('dist/_headers')] as const]
    : []),
];

describe.each(ARTIFACTS)('%s security headers', (_label, headers) => {
  const global = headers.get('/*');

  it('defines a global /* header block', () => {
    expect(global).toBeDefined();
  });

  it('sets a Content-Security-Policy with frame-ancestors', () => {
    const csp = global?.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(directive(csp, 'frame-ancestors')).toContain("'none'");
  });

  it('removes the unnecessary exercisable script sources', () => {
    const csp = global?.get('content-security-policy') ?? '';
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('scopes connect-src to concrete origins (no bare scheme wildcards)', () => {
    const csp = global?.get('content-security-policy') ?? '';
    const connect = directive(csp, 'connect-src');
    expect(connect).toContain("'self'");
    for (const token of connect.split(/\s+/).slice(1)) {
      expect(['http:', 'https:', 'ws:', 'wss:']).not.toContain(token);
    }
  });

  it('sets HSTS, anti-clickjacking and nosniff', () => {
    expect(global?.get('strict-transport-security')).toMatch(/max-age=(\d+)/);
    const maxAge = Number(/max-age=(\d+)/.exec(global?.get('strict-transport-security') ?? '')?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
    expect(global?.get('x-frame-options')).toBe('DENY');
    expect(global?.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('dead configuration cannot silently return', () => {
  it('does not ship a misleading vercel.json', () => {
    expect(existsSync(resolve(ROOT, 'vercel.json'))).toBe(false);
  });
});

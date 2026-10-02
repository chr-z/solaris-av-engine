/**
 * SOLA-142 Fix A regression: the committed Innertube Google API key must never
 * reappear in source or in the built client bundle.
 *
 * - `src/server/api/youtube.ts` sources the key at runtime from the
 *   server-only `YOUTUBE_INNERTUBE_API_KEY` binding (Cloudflare Pages env /
 *   `process.env` on Node). It must never contain an `AIza` literal, never
 *   reference `import.meta.env`, and never use a `VITE_` variable (SOLA-120:
 *   a bare `import.meta.env` reference serialises the whole env object into
 *   the client bundle and would leak the key to every visitor).
 * - A missing binding throws `youtube_api_key_missing` (operator
 *   misconfiguration, surfaced as 503 by the handler) instead of silently
 *   returning null.
 * - The `dist/` assertion runs when a build exists (CI builds before the
 *   guard steps); on a source-only checkout it passes on the source
 *   assertions alone.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getInnertubeApiKey,
  innertubePlayerUrl,
  INNERTUBE_PLAYER_BASE,
  resolveYouTubeStream,
} from '../youtube';

const GOOGLE_KEY_RE = /AIza[0-9A-Za-z_-]{35}/;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkFiles(full, out);
    else if (stat.isFile() && stat.size <= 8 * 1024 * 1024) out.push(full);
  }
  return out;
}

describe('SOLA-142 Fix A — Innertube key is server-sourced, never committed', () => {
  it('contains no hardcoded Google API key in server source', () => {
    for (const rel of [
      'src/server/api/youtube.ts',
      'src/server/api/handlers.ts',
      'src/server/api/env.ts',
    ]) {
      const content = readFileSync(join(REPO_ROOT, rel), 'utf8');
      expect(GOOGLE_KEY_RE.test(content), `${rel} must not contain an AIza literal`).toBe(false);
    }
  });

  it('never sources the key from import.meta.env or a VITE_ variable', () => {
    const content = readFileSync(join(REPO_ROOT, 'src/server/api/youtube.ts'), 'utf8');
    // Comments may name the hazard; code must not reference it. Strip both
    // comment forms before asserting so documentation stays precise.
    const code = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(code).not.toContain('import.meta.env');
    expect(code).not.toMatch(/VITE_[A-Z_]+/);
    expect(content).toContain('YOUTUBE_INNERTUBE_API_KEY');
  });

  it('builds the player URL from the supplied key only', () => {
    expect(innertubePlayerUrl('test-key-123')).toBe(
      `${INNERTUBE_PLAYER_BASE}?key=test-key-123`,
    );
    expect(() => innertubePlayerUrl('')).toThrow('youtube_api_key_missing');
  });

  it('throws youtube_api_key_missing when no server key is configured', async () => {
    const saved = process.env.YOUTUBE_INNERTUBE_API_KEY;
    delete process.env.YOUTUBE_INNERTUBE_API_KEY;
    try {
      expect(getInnertubeApiKey(undefined, {})).toBeUndefined();
      await expect(
        resolveYouTubeStream('dQw4w9WgXcQ', { fetch: (async () => new Response('x')) as never }),
      ).rejects.toThrow('youtube_api_key_missing');
    } finally {
      if (saved !== undefined) process.env.YOUTUBE_INNERTUBE_API_KEY = saved;
    }
  });

  it('sends the configured key (never a committed literal) to the player endpoint', async () => {
    let requestedUrl = '';
    const doFetch = (async (url: string) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ streamingData: { formats: [] } }), { status: 200 });
    }) as never;
    await resolveYouTubeStream('dQw4w9WgXcQ', { fetch: doFetch }, 'server-side-key');
    expect(requestedUrl).toBe(`${INNERTUBE_PLAYER_BASE}?key=server-side-key`);
    expect(GOOGLE_KEY_RE.test(requestedUrl)).toBe(false);
  });

  it('leaves no Google API key literal in dist/ when a build exists', () => {
    const dist = join(REPO_ROOT, 'dist');
    if (!existsSync(dist)) return;
    const offenders: string[] = [];
    for (const file of walkFiles(dist)) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (GOOGLE_KEY_RE.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { handleApi, apiRouteNames } from '../handlers';
import type { Jwk } from '../auth';
import type { ServerEnv } from '../env';

const PROJECT_ID = 'sola-test';
const env: ServerEnv = { FIREBASE_PROJECT_ID: PROJECT_ID };

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let privateKey: CryptoKey;
let jwks: { keys: Jwk[] };

beforeAll(async () => {
  const pair = (await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  const exported = (await webcrypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk;
  jwks = { keys: [{ kty: 'RSA', n: exported.n, e: exported.e, kid: 'test-kid', alg: 'RS256', use: 'sig' }] };
});

async function signIdToken(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: 'test-kid', typ: 'JWT' };
  const claims = {
    sub: 'user-1',
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = await webcrypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

const deps = (): Record<string, unknown> => ({
  jwks,
  subtle: webcrypto.subtle as unknown as SubtleCrypto,
  fetch: async () => new Response('{}', { status: 200 }),
});

const METHOD: Record<string, string> = {
  '/api/get-sheets-data': 'GET',
  '/api/sheet-headers': 'GET',
  '/api/sheet-row': 'GET',
  '/api/drive-proxy': 'GET',
  '/api/drive-folder-contents': 'GET',
  '/api/youtube-proxy': 'GET',
  '/api/set-auth-cookie': 'POST',
  '/api/dashboard-events': 'GET',
};

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return handleApi({
    request: new Request(`https://app.test${path}`, { method: METHOD[path] ?? 'GET', ...init }),
    env,
    deps: deps(),
  });
}

describe('/api/* — authentication is enforced on every handler', () => {
  for (const path of apiRouteNames()) {
    it(`${path} returns a deliberate JSON 401 when unauthenticated (never HTML)`, async () => {
      const res = await call(path);
      expect(res.status).toBe(401);
      expect(res.headers.get('content-type')).toContain('application/json');
      const text = await res.text();
      expect(text).not.toContain('<!DOCTYPE');
      expect(JSON.parse(text)).toHaveProperty('error');
    });
  }
});

describe('/api/* — routing safety', () => {
  it('unknown API path returns JSON 404, never the SPA shell', async () => {
    const res = await call('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.text()).not.toContain('<!DOCTYPE');
  });

  // Regression: SOLA-48. deploy.yml used to assert JSON on
  // /api/get-sheets-data, but that route authenticates FIRST and correctly
  // answers an anonymous probe with a JSON 401 — so a healthy deploy failed the
  // guard. The deploy probe must use an unauthenticated path that proves
  // routing (unknown /api/* -> JSON 404, never the SPA shell) without
  // depending on auth outcome. These two tests pin the contract the guard
  // relies on, and would fail if the anonymous 404 ever became HTML or 200.
  it('deploy-guard probe path (unknown /api/*) is JSON 404 for an ANONYMOUS caller', async () => {
    const res = await call('/api/__deploy_guard_probe__');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const text = await res.text();
    expect(text).not.toContain('<!DOCTYPE');
    expect(JSON.parse(text)).toHaveProperty('error');
  });

  it('an authenticated route answers an anonymous probe with JSON 401 (why the old guard failed)', async () => {
    const res = await call('/api/get-sheets-data');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.text()).not.toContain('<!DOCTYPE');
  });

  it('rejects a malformed or wrongly-signed token with 401', async () => {
    const res = await handleApi({
      request: new Request('https://app.test/api/dashboard-events', {
        headers: { Authorization: 'Bearer not.a.jwt' },
      }),
      env,
      deps: deps(),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a token for a different project with 401', async () => {
    const token = await signIdToken({ aud: 'other-project' });
    const res = await handleApi({
      request: new Request('https://app.test/api/dashboard-events', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
      deps: deps(),
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid token (dashboard events returns an empty JSON feed)', async () => {
    const token = await signIdToken();
    const res = await handleApi({
      request: new Request('https://app.test/api/dashboard-events', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
      deps: deps(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [] });
  });
});

describe('/api/youtube-proxy — SSRF inputs are rejected after auth', () => {
  for (const target of ['http://127.0.0.1:22/', 'http://169.254.169.254/']) {
    it(`rejects url=${target}`, async () => {
      const token = await signIdToken();
      const res = await handleApi({
        request: new Request(
          `https://app.test/api/youtube-proxy?url=${encodeURIComponent(target)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
        env,
        deps: deps(),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain('<!DOCTYPE');
    });
  }
});

describe('/api/set-auth-cookie — bootstrap requires a Firebase ID token', () => {
  it('returns 401 when the credential is missing', async () => {
    const res = await call('/api/set-auth-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'google-oauth-token' }),
    });
    expect(res.status).toBe(401);
  });

  it('sets HttpOnly cookies when the ID token is valid', async () => {
    const idToken = await signIdToken();
    const res = await handleApi({
      request: new Request('https://app.test/api/set-auth-cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'google-oauth-token', idToken }),
      }),
      env,
      deps: deps(),
    });
    expect(res.status).toBe(200);
    const cookies =
      (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const joined = cookies.join('\n');
    expect(joined).toContain('g_token=');
    expect(joined).toContain('fb_id_token=');
    expect(joined).toContain('HttpOnly');
  });
});

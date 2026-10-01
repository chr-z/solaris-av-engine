/**
 * Minimal, Workers-native Google REST client (SOLA-35, P1-4 port).
 *
 * The Vercel handlers used the Node-only `googleapis` SDK. Pages Functions
 * cannot. This module talks to the same REST endpoints with `fetch` and mints
 * service-account access tokens with WebCrypto (RS256) — no Node built-ins.
 */

import type { ServerEnv } from './env';
import { jsonError, type AuthDeps } from './auth';
import { serviceAccountJson } from './env';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEFAULT_READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DEFAULT_WRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export interface GoogleDeps {
  fetch?: typeof fetch;
  subtle?: SubtleCrypto;
  now?: () => number;
}

function b64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('empty pem');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface ServiceAccount {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}

export function parseServiceAccount(env: ServerEnv): ServiceAccount {
  const raw = serviceAccountJson(env);
  if (!raw) throw new Error('service_account_missing');
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key) throw new Error('service_account_invalid');
  return parsed;
}

interface CachedToken {
  token: string;
  expiresAt: number;
  scope: string;
}

let cachedServiceToken: CachedToken | null = null;

export function resetServiceTokenCache(): void {
  cachedServiceToken = null;
}

/**
 * Mints (and briefly caches) a service-account access token for `scope`.
 * Throws on missing/invalid configuration; callers translate that to a 500.
 */
export async function getServiceAccessToken(
  env: ServerEnv,
  scope: string,
  deps: GoogleDeps = {},
): Promise<string> {
  const now = (deps.now ?? Date.now)();
  if (cachedServiceToken && cachedServiceToken.scope === scope && cachedServiceToken.expiresAt > now + 30_000) {
    return cachedServiceToken.token;
  }
  const subtle = deps.subtle ?? (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) throw new Error('no_crypto');
  const doFetch = deps.fetch ?? fetch;

  const account = parseServiceAccount(env);
  const iat = Math.floor(now / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope,
    aud: account.token_uri ?? TOKEN_ENDPOINT,
    iat,
    exp: iat + 3600,
  };
  const signingInput = `${b64Url(new TextEncoder().encode(JSON.stringify(header)))}.${b64Url(
    new TextEncoder().encode(JSON.stringify(claims)),
  )}`;
  const key = await subtle.importKey(
    'pkcs8',
    pemToDer(account.private_key as string),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${b64Url(new Uint8Array(signature))}`;

  const res = await doFetch(account.token_uri ?? TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token_http_${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('token_missing');
  cachedServiceToken = {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
    scope,
  };
  return body.access_token;
}

/** Reader token for the master sheet. */
export function getSheetsReadToken(env: ServerEnv, deps: GoogleDeps = {}): Promise<string> {
  return getServiceAccessToken(env, env.SOLARIS_GOOGLE_SCOPES ?? DEFAULT_READ_SCOPE, deps);
}

export function getSheetsWriteScope(): string {
  return DEFAULT_WRITE_SCOPE;
}

async function googleJson<T>(
  url: string,
  accessToken: string,
  deps: GoogleDeps,
  init: RequestInit = {},
): Promise<T> {
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`google_http_${res.status}`);
  return (await res.json()) as T;
}

export interface ValueRange {
  values?: string[][];
}

export function sheetsValuesGet(
  spreadsheetId: string,
  range: string,
  accessToken: string,
  deps: GoogleDeps = {},
  valueRenderOption = 'FORMATTED_VALUE',
): Promise<ValueRange> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}/values/${encodeURIComponent(range)}?valueRenderOption=${valueRenderOption}`;
  return googleJson<ValueRange>(url, accessToken, deps);
}

export function sheetsValuesBatchGet(
  spreadsheetId: string,
  ranges: string[],
  accessToken: string,
  deps: GoogleDeps = {},
  valueRenderOption = 'FORMULA',
): Promise<{ valueRanges?: ValueRange[] }> {
  const params = new URLSearchParams();
  for (const range of ranges) params.append('ranges', range);
  params.set('valueRenderOption', valueRenderOption);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}/values:batchGet?${params.toString()}`;
  return googleJson<{ valueRanges?: ValueRange[] }>(url, accessToken, deps);
}

export function sheetsValuesUpdate(
  spreadsheetId: string,
  range: string,
  values: string[][],
  accessToken: string,
  deps: GoogleDeps = {},
): Promise<{ updatedRange?: string }> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  return googleJson<{ updatedRange?: string }>(url, accessToken, deps, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
}

export interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  iconLink?: string;
}

export async function driveFilesList(
  query: string,
  pageToken: string | undefined,
  accessToken: string,
  deps: GoogleDeps = {},
): Promise<{ files?: DriveFile[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    q: query,
    fields: 'nextPageToken, files(id, name, mimeType, iconLink)',
    pageSize: '100',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  if (pageToken) params.set('pageToken', pageToken);
  return googleJson<{ files?: DriveFile[]; nextPageToken?: string }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken,
    deps,
  );
}

export async function driveFileMetadata(
  fileId: string,
  accessToken: string,
  deps: GoogleDeps = {},
): Promise<{ size?: string; mimeType?: string }> {
  const params = new URLSearchParams({ fields: 'size, mimeType', supportsAllDrives: 'true' });
  return googleJson<{ size?: string; mimeType?: string }>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    accessToken,
    deps,
  );
}

/** Raw media response (stream body is passed through untouched). */
export function driveFileMedia(
  fileId: string,
  accessToken: string,
  range: string | null,
  deps: GoogleDeps = {},
): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (range) headers.Range = range;
  return doFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { headers, redirect: 'follow' },
  );
}

export function googleConfigError(): Response {
  return jsonError(500, 'Server configuration error.');
}

export type { AuthDeps };

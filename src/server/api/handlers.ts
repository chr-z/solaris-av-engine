/**
 * Solaris API handlers (SOLA-35, P1-4 port).
 *
 * Pure, runtime-agnostic request handlers implementing the former Vercel
 * routes on top of the Workers-native auth/Google/YouTube modules. A thin
 * Cloudflare Pages Function (`functions/api/[[path]].ts`) dispatches to these,
 * and the vitest suite exercises them directly.
 *
 * Security invariants enforced here for EVERY route:
 *   - authentication runs FIRST (unauthenticated ⇒ 401, never 400/404);
 *   - unknown routes ⇒ deliberate JSON 404 (never the SPA HTML fallback);
 *   - the YouTube input URL is allowlisted before any fetch (SSRF guard).
 */

import type { ServerEnv } from './env';
import {
  AuthResult,
  requireFirebaseIdToken,
  fetchFirebaseJwks,
  jsonError,
  type AuthDeps,
} from './auth';
import type { GoogleDeps } from './google';
import {
  driveFileMedia,
  driveFileMetadata,
  driveFilesList,
  getServiceAccessToken,
  getSheetsReadToken,
  sheetsValuesBatchGet,
  sheetsValuesGet,
  sheetsValuesUpdate,
  type DriveFile,
} from './google';
import { parseYouTubeVideoId, resolveYouTubeStream, safeStreamFetch } from './youtube';

export interface ApiDeps extends AuthDeps, GoogleDeps {
  fetch?: typeof fetch;
}

export interface ApiContext {
  request: Request;
  env: ServerEnv;
  deps?: ApiDeps;
}

type Handler = (ctx: ApiContext) => Promise<Response>;

const HYPERLINK_REGEX = /=HYPERLINK\("([^"]+)"/i;
const DRIVE_RESOURCE_ID_RE = /^[A-Za-z0-9_-]{1,500}$/;
const SPREADSHEET_RANGE = 'ANALYSIS';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

function methodNotAllowed(allow: string[]): Response {
  return new Response(JSON.stringify({ error: `Method not allowed.` }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: allow.join(', ') },
  });
}

async function authenticate(ctx: ApiContext): Promise<AuthResult> {
  return requireFirebaseIdToken(ctx.request, ctx.env, ctx.deps);
}

function userAccessToken(request: Request): string | null {
  const header = request.headers.get('x-google-access-token');
  if (header) return header;
  const cookie = request.headers.get('cookie');
  if (cookie) {
    for (const part of cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === 'g_token') return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

interface CellData {
  value: string;
  link?: string;
}

function toCellData(cell: unknown): CellData {
  const value = String(cell ?? '');
  const match = value.match(HYPERLINK_REGEX);
  return match ? { value: 'Link', link: match[1] } : { value };
}

let sheetsCache: { data: unknown; timestamp: number } | null = null;
const SHEETS_CACHE_TTL_MS = 2 * 60 * 1000;

export function resetSheetsCache(): void {
  sheetsCache = null;
}

const getSheetsData: Handler = async (ctx) => {
  if (ctx.request.method !== 'GET') return methodNotAllowed(['GET']);
  const auth = await authenticate(ctx);
  if ('response' in auth) return auth.response;

  const spreadsheetId = ctx.env.SPREADSHEET_ID;
  if (!spreadsheetId) return jsonError(500, 'System Configuration Error: Spreadsheet ID missing.');

  const force = new URL(ctx.request.url).searchParams.get('force') === 'true';
  if (!force && sheetsCache && Date.now() - sheetsCache.timestamp < SHEETS_CACHE_TTL_MS) {
    return json(sheetsCache.data, 200, { 'X-Cache': 'HIT' });
  }

  try {
    const token = await getSheetsReadToken(ctx.env, ctx.deps);
    const [headerResponse, dataResponse] = await Promise.all([
      sheetsValuesGet(spreadsheetId, `${SPREADSHEET_RANGE}!A1:Z1`, token, ctx.deps),
      sheetsValuesBatchGet(spreadsheetId, [`${SPREADSHEET_RANGE}!A2:Z1000`], token, ctx.deps, 'FORMULA'),
    ]);
    const headers = (headerResponse.values?.[0] ?? []).map((h) => String(h).toUpperCase().trim());
    if (headers.length === 0) throw new Error('headers_unavailable');
    const rawRows = dataResponse.valueRanges?.[0]?.values ?? [];
    const rows = rawRows.map((row, index) => ({
      rowIndex: index + 2,
      row: row.map(toCellData),
    }));
    const payload = { headers, rows };
    sheetsCache = { data: payload, timestamp: Date.now() };
    return json(payload, 200, { 'X-Cache': 'MISS', 'Cache-Control': 'no-store' });
  } catch {
    return jsonError(500, 'Failed to sync with Data Layer.');
  }
};

const getSheetHeaders: Handler = async (ctx) => {
  if (ctx.request.method !== 'GET') return methodNotAllowed(['GET']);
  const auth = await authenticate(ctx);
  if ('response' in auth) return auth.response;
  const spreadsheetId = ctx.env.SPREADSHEET_ID;
  if (!spreadsheetId) return jsonError(500, 'System Configuration Error: Spreadsheet ID missing.');
  try {
    const token = await getSheetsReadToken(ctx.env, ctx.deps);
    const headerResponse = await sheetsValuesGet(spreadsheetId, `${SPREADSHEET_RANGE}!A1:Z1`, token, ctx.deps);
    const headers = (headerResponse.values?.[0] ?? []).map((h) => String(h));
    return json({ headers });
  } catch {
    return jsonError(500, 'Failed to sync with Data Layer.');
  }
};

const sheetRow: Handler = async (ctx) => {
  const auth = await authenticate(ctx);
  if ('response' in auth) return auth.response;

  const spreadsheetId = ctx.env.SPREADSHEET_ID;
  if (!spreadsheetId) return jsonError(500, 'Server Configuration Error.');

  if (ctx.request.method === 'GET') {
    const rowIndex = Number.parseInt(new URL(ctx.request.url).searchParams.get('rowIndex') ?? '', 10);
    if (!Number.isInteger(rowIndex) || rowIndex < 2) return jsonError(400, 'Invalid row index.');
    try {
      const token = await getSheetsReadToken(ctx.env, ctx.deps);
      const range = `${SPREADSHEET_RANGE}!A${rowIndex}:Z${rowIndex}`;
      const [formulaRes, fmtRes] = await Promise.all([
        sheetsValuesGet(spreadsheetId, range, token, ctx.deps, 'FORMULA'),
        sheetsValuesGet(spreadsheetId, range, token, ctx.deps, 'FORMATTED_VALUE'),
      ]);
      const formulas = formulaRes.values?.[0] ?? [];
      const values = fmtRes.values?.[0] ?? [];
      const combined = values.map((value, i) => {
        const formula = String(formulas[i] ?? '');
        const match = formula.match(HYPERLINK_REGEX);
        return { value: value ?? '', link: match ? match[1] : undefined };
      });
      return json(combined);
    } catch {
      return jsonError(500, 'Failed to retrieve row details.');
    }
  }

  if (ctx.request.method === 'POST') {
    const accessToken = userAccessToken(ctx.request);
    if (!accessToken) return jsonError(401, 'Missing Google access token.');
    let body: { rowIndex?: unknown; rowData?: unknown };
    try {
      body = (await ctx.request.json()) as typeof body;
    } catch {
      return jsonError(400, 'Invalid payload schema.');
    }
    const rowIndex = Number(body.rowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 2 || !Array.isArray(body.rowData)) {
      return jsonError(400, 'Invalid payload schema.');
    }
    const values = [
      (body.rowData as Array<{ value?: string; link?: string }>).map((cell) => {
        if (cell?.link && cell?.value) {
          const label = String(cell.value).replace(/"/g, '""');
          return `=HYPERLINK("${cell.link}"; "${label}")`;
        }
        return cell?.value ?? '';
      }),
    ];
    try {
      const range = `${SPREADSHEET_RANGE}!A${rowIndex}:Z${rowIndex}`;
      const result = await sheetsValuesUpdate(spreadsheetId, range, values, accessToken, ctx.deps);
      return json({ success: true, updatedRange: result.updatedRange });
    } catch {
      return jsonError(500, 'Failed to persist changes.');
    }
  }

  return methodNotAllowed(['GET', 'POST']);
};

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------

async function recursiveScan(
  accessToken: string,
  folderId: string,
  deps: ApiDeps | undefined,
  depth = 0,
): Promise<DriveFile[]> {
  if (depth > 5) return [];
  let assets: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const page = await driveFilesList(
      `'${folderId}' in parents and trashed = false`,
      pageToken,
      accessToken,
      deps,
    );
    const files = page.files ?? [];
    pageToken = page.nextPageToken;
    const nested = await Promise.all(
      files.map(async (file) => {
        if (file.mimeType === 'application/vnd.google-apps.folder' && file.id) {
          return recursiveScan(accessToken, file.id, deps, depth + 1);
        }
        if (file.mimeType?.startsWith('video/') || file.mimeType?.startsWith('audio/')) return [file];
        return [];
      }),
    );
    assets = assets.concat(...nested.flat());
  } while (pageToken);
  return assets;
}

const driveFolderContents: Handler = async (ctx) => {
  if (ctx.request.method !== 'GET') return methodNotAllowed(['GET']);
  const auth = await authenticate(ctx);
  if ('response' in auth) return auth.response;
  const accessToken = userAccessToken(ctx.request);
  if (!accessToken) return jsonError(401, 'Missing Google access token.');
  const folderId = new URL(ctx.request.url).searchParams.get('folderId');
  if (!folderId || !DRIVE_RESOURCE_ID_RE.test(folderId)) return jsonError(400, 'Invalid folder ID.');
  try {
    const files = await recursiveScan(accessToken, folderId, ctx.deps);
    return json(files);
  } catch {
    return jsonError(500, 'Failed to scan directory.');
  }
};

const driveProxy: Handler = async (ctx) => {
  if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
    return methodNotAllowed(['GET', 'HEAD']);
  }
  const auth = await authenticate(ctx);
  if ('response' in auth) return auth.response;
  const accessToken = userAccessToken(ctx.request);
  if (!accessToken) return jsonError(401, 'Session expired. Please refresh the page.');
  const fileId = new URL(ctx.request.url).searchParams.get('fileId');
  if (!fileId || !DRIVE_RESOURCE_ID_RE.test(fileId)) return jsonError(400, 'Missing File ID.');

  try {
    if (ctx.request.method === 'HEAD') {
      const metadata = await driveFileMetadata(fileId, accessToken, ctx.deps);
      return new Response(null, {
        status: 200,
        headers: {
          'Content-Type': metadata.mimeType ?? 'video/mp4',
          'Content-Length': metadata.size ?? '0',
          'Accept-Ranges': 'bytes',
        },
      });
    }
    const range = ctx.request.headers.get('range');
    const upstream = await driveFileMedia(fileId, accessToken, range, ctx.deps);
    if (!upstream.ok && upstream.status !== 206) {
      return jsonError(upstream.status === 404 ? 404 : 500, 'Stream initialization failed.');
    }
    const headers = new Headers({ 'Accept-Ranges': 'bytes' });
    for (const name of ['Content-Type', 'Content-Length', 'Content-Range']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: range ? 206 : 200, headers });
  } catch {
    return jsonError(500, 'Stream initialization failed.');
  }
};

// ---------------------------------------------------------------------------
// YouTube proxy
// ---------------------------------------------------------------------------

const youtubeProxy: Handler = async (ctx) => {
  if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
    return methodNotAllowed(['GET', 'HEAD']);
  }
  const auth = await authenticate(ctx);
  if ('response' in auth) return auth.response;

  const rawUrl = new URL(ctx.request.url).searchParams.get('url');
  const videoId = rawUrl ? parseYouTubeVideoId(rawUrl) : null;
  if (!videoId) return jsonError(400, 'Invalid URL.');

  try {
    const format = await resolveYouTubeStream(videoId, ctx.deps);
    if (!format) return jsonError(502, 'Stream unavailable.');
    const range = ctx.request.headers.get('range');
    const upstream = await safeStreamFetch(
      format.url,
      { headers: range ? { Range: range } : undefined },
      ctx.deps,
    );
    if (!upstream.ok && upstream.status !== 206) return jsonError(502, 'Stream unavailable.');

    const headers = new Headers();
    for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (ctx.request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return jsonError(502, 'Stream unavailable.');
  }
};

// ---------------------------------------------------------------------------
// Session bootstrap
// ---------------------------------------------------------------------------

const setAuthCookie: Handler = async (ctx) => {
  if (ctx.request.method !== 'POST') return methodNotAllowed(['POST']);
  let body: { token?: unknown; idToken?: unknown };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return jsonError(401, 'Authentication required.');
  }
  // The Firebase ID token is the credential; without it this is unauthenticated.
  if (typeof body.idToken !== 'string' || body.idToken.length === 0) {
    return jsonError(401, 'Authentication required.');
  }
  if (typeof body.token !== 'string' || body.token.length === 0) {
    return jsonError(400, 'Token payload missing.');
  }

  // Verify the Firebase ID token before granting an authenticated cookie.
  const synthetic = new Request(ctx.request.url, {
    headers: { Authorization: `Bearer ${body.idToken}` },
  });
  const auth = await requireFirebaseIdToken(synthetic, ctx.env, ctx.deps);
  if ('response' in auth) return auth.response;

  const isSecure = new URL(ctx.request.url).protocol === 'https:';
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie('g_token', body.token, isSecure));
  headers.append('Set-Cookie', cookie('fb_id_token', body.idToken, isSecure));
  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
};

function cookie(name: string, value: string, secure: boolean): string {
  const flags = ['HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=86400'];
  if (secure) flags.push('Secure');
  return `${name}=${encodeURIComponent(value)}; ${flags.join('; ')}`;
}

// ---------------------------------------------------------------------------
// Dashboard feed (JSON, never HTML)
// ---------------------------------------------------------------------------

const dashboardEvents: Handler = async (ctx) => {
  if (ctx.request.method !== 'GET') return methodNotAllowed(['GET']);
  const auth = await authenticate(ctx);
  if ('response' in auth) return auth.response;
  // The Vercel tree never shipped an SSE handler. Return a well-formed empty
  // feed so the client's polling fallback is healthy and no HTML is served.
  return json({ events: [] });
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ROUTES: Record<string, Handler> = {
  '/api/get-sheets-data': getSheetsData,
  '/api/sheet-headers': getSheetHeaders,
  '/api/sheet-row': sheetRow,
  '/api/drive-proxy': driveProxy,
  '/api/drive-folder-contents': driveFolderContents,
  '/api/youtube-proxy': youtubeProxy,
  '/api/set-auth-cookie': setAuthCookie,
  '/api/dashboard-events': dashboardEvents,
};

export function apiRouteNames(): string[] {
  return Object.keys(ROUTES);
}

/**
 * Dispatches an `/api/*` request. Unknown paths return a deliberate JSON 404
 * so a Cloudflare Pages SPA fallback can never answer with `index.html`.
 */
export async function handleApi(ctx: ApiContext): Promise<Response> {
  const pathname = new URL(ctx.request.url).pathname.replace(/\/+$/, '') || '/';
  const handler = ROUTES[pathname];
  if (!handler) return jsonError(404, 'Not found.');
  try {
    return await handler(ctx);
  } catch {
    return jsonError(500, 'Internal Server Error.');
  }
}

export { jsonError, fetchFirebaseJwks, getServiceAccessToken };

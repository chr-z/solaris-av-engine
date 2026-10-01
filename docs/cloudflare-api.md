# Cloudflare Pages API surface (SOLA-35)

This documents the port of the former Vercel `api/` tree to Cloudflare Pages
Functions, and the security contract each route enforces.

## Why

The Vercel→Cloudflare migration (`63fa157`) never ported the API. `api/*.ts`
was Vercel-style serverless code that Cloudflare Pages does not execute, so
every `/api/*` path fell through to the SPA fallback and returned `index.html`
with HTTP 200 — silently broken and unauthenticated-by-omission.

## Layout

| Path | Purpose |
|---|---|
| `functions/api/[[path]].ts` | Pages Function catch-all → `handleApi`; guarantees JSON 401/404, never HTML |
| `src/server/api/auth.ts` | Workers-native Firebase ID token verification (WebCrypto/JWKS) |
| `src/server/api/youtube.ts` | Input allowlist + safe stream fetch for the YouTube proxy |
| `src/server/api/google.ts` | Workers-native Google REST client (service-account + user OAuth) |
| `src/server/api/handlers.ts` | The ported routes |
| `public/_headers` | CSP, `frame-ancestors`, HSTS, nosniff (copied to `dist/_headers`) |
| `scripts/check-dist-security.mjs` | Built-artifact header gate run in CI |

Specific Functions under `functions/api/**` (e.g. `license/activate.ts`,
`payments/webhook.ts`) keep their own handlers and take precedence over the
catch-all. Confirm this live after deploy.

## Routes

| Route | Methods | Credential | Notes |
|---|---|---|---|
| `/api/get-sheets-data` | GET | Firebase ID token | Master sheet read, 2 min cache |
| `/api/sheet-headers` | GET | Firebase ID token | Row-1 headers |
| `/api/sheet-row` | GET | Firebase ID token | Service-account read, HYPERLINK resolved |
| `/api/sheet-row` | POST | Firebase ID token + `X-Google-Access-Token` | Delegated Sheets write |
| `/api/drive-proxy` | GET/HEAD | Firebase ID token (cookie ok) + `g_token` cookie or `X-Google-Access-Token` | Byte-range media passthrough |
| `/api/drive-folder-contents` | GET | Firebase ID token + `X-Google-Access-Token` | Recursive Drive scan |
| `/api/youtube-proxy` | GET/HEAD | Firebase ID token (cookie ok) | YouTube input allowlist + resolved-host allowlist |
| `/api/set-auth-cookie` | POST | Firebase ID token in JSON body (`idToken`) | Sets HttpOnly `g_token` + `fb_id_token` |
| `/api/dashboard-events` | GET | Firebase ID token | JSON `{events: []}` (SSE never existed server-side) |
| anything else under `/api/` | any | — | JSON 404 |

`<video>`/`<img>` requests cannot set an `Authorization` header, so media routes
also accept the Firebase ID token from the `fb_id_token` cookie set by
`/api/set-auth-cookie`.

## Configuration (Cloudflare Pages → Settings → Environment variables)

| Variable | Required | Purpose |
|---|---|---|
| `FIREBASE_PROJECT_ID` | yes | Validates ID-token `aud`/`iss`; without it every handler returns 500 |
| `FIREBASE_API_KEY` | no | Enables the `accounts:lookup` revocation check |
| `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` | sheets | Service-account JSON for Sheets reads |
| `SPREADSHEET_ID` | sheets | Master spreadsheet id |
| `SOLARIS_GOOGLE_SCOPES` | no | Space-separated scope override |

## Limitations (honest scope)

- These handlers were reimplemented against raw REST endpoints; they are unit
  tested for security behaviour (401, SSRF rejection, routing) but **not**
  exercised end-to-end against live Google/Firebase credentials in this run.
- Firebase is not configured in the current production environment, so
  authenticated routes fail closed (401) until it is.
- Revocation only runs when `FIREBASE_API_KEY` is set.
- The dashboard feed is an empty JSON payload; the client's polling fallback
  consumes it.

## Rollback

Deployment-shape change only. Redeploy the previous Cloudflare Pages artifact
(`wrangler pages deploy` of the prior build) — a single command. No data
migration, nothing irreversible.

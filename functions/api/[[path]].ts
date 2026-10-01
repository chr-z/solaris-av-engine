/**
 * Cloudflare Pages Function — catch-all for /api/* (SOLA-35, P1-4).
 *
 * The former Vercel `api/` tree was never executed by Cloudflare Pages, so
 * every unknown `/api/*` path fell through to the SPA fallback and returned
 * `index.html` with HTTP 200. This catch-all dispatches the ported routes and
 * returns a deliberate JSON 404 for anything else, so the API surface can
 * never answer with HTML.
 *
 * Route precedence: specific Functions under functions/api/** (e.g.
 * license/activate, payments/webhook) match before this splat. Verify live
 * after deploy (see SOLA-35 verification).
 */

import { handleApi } from '../../src/server/api/handlers';
import type { ServerEnv } from '../../src/server/api/env';

interface PagesContext {
  request: Request;
  env: ServerEnv;
}

export const onRequest = async (context: PagesContext): Promise<Response> =>
  handleApi({ request: context.request, env: context.env });

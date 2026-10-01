/**
 * YouTube proxy hardening (SOLA-35, P1-4 / P1-5).
 *
 * The Vercel-era `/api/youtube-proxy` accepted an attacker-controlled `url`
 * and then fetched a URL derived from YouTube's own response. On revival that
 * becomes a live SSRF primitive. This module makes the two trust boundaries
 * explicit and testable:
 *
 *   1. INPUT allowlist — `url` must be a real YouTube watch/short/embed URL;
 *      anything else (127.0.0.1, 169.254.169.254, file:, metadata hosts) is
 *      rejected before any network call.
 *   2. FETCH allowlist — the resolved stream URL must be on a YouTube media
 *      host (`*.googlevideo.com`) and must not resolve to a private/reserved
 *      address; redirects are followed manually and re-checked on EVERY hop.
 */

export interface FetchDeps {
  fetch?: typeof fetch;
}

/** Hosts accepted as *input*. Keep this list closed. */
export const YOUTUBE_INPUT_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** Hosts accepted as *stream* origins after resolution. Keep this closed. */
const STREAM_HOST_SUFFIXES = ['.googlevideo.com'];
const STREAM_HOST_EXACT = new Set(['googlevideo.com']);

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

function validVideoId(id: string | null | undefined): string | null {
  return typeof id === 'string' && VIDEO_ID_RE.test(id) ? id : null;
}

/**
 * Parses `raw` and returns the 11-char video id only when the URL targets an
 * allowed YouTube host over http(s). Returns null for everything else.
 */
export function parseYouTubeVideoId(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = normaliseHost(url.hostname);
  if (!YOUTUBE_INPUT_HOSTS.has(host)) return null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    return validVideoId(url.pathname.split('/').filter(Boolean)[0]);
  }
  const v = url.searchParams.get('v');
  if (v) return validVideoId(v);
  const match = /\/(?:embed|v|shorts|live)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
  return match ? validVideoId(match[1]) : null;
}

export function isAllowedStreamHost(host: string): boolean {
  const h = normaliseHost(host);
  return STREAM_HOST_EXACT.has(h) || STREAM_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 192 && b === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 88) return true; // 6to4 relay
  if (a === 255) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('::ffff:')) return isPrivateOrReservedHost(h.slice(7));
  return false;
}

/** True for loopback, link-local, private, CGNAT, multicast and metadata hosts. */
export function isPrivateOrReservedHost(rawHost: string): boolean {
  const host = normaliseHost(rawHost);
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  if (host === 'metadata' || host === 'metadata.google.internal') return true;
  if (host.includes(':')) return isPrivateIpv6(host);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  return false;
}

export interface StreamFormat {
  url: string;
  mimeType?: string;
  contentLength?: string;
}

export interface InnertubeFormat {
  url?: string;
  mimeType?: string;
  bitrate?: number;
  contentLength?: string;
  audioQuality?: string;
  audioChannels?: number;
}

const INNERTUBE_PLAYER_URL =
  'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

/**
 * Resolves a playable stream URL via YouTube's public Innertube player API.
 * Formats carrying only a `signatureCipher` (no direct `url`) are skipped; if
 * nothing usable remains the caller gets null and must return a deliberate
 * JSON error rather than fetching anything.
 */
export async function resolveYouTubeStream(
  videoId: string,
  deps: FetchDeps = {},
): Promise<StreamFormat | null> {
  if (!VIDEO_ID_RE.test(videoId)) return null;
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(INNERTUBE_PLAYER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en' } },
      videoId,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    streamingData?: { formats?: InnertubeFormat[]; adaptiveFormats?: InnertubeFormat[] };
  };
  const formats = [
    ...(data.streamingData?.formats ?? []),
    ...(data.streamingData?.adaptiveFormats ?? []),
  ].filter((f): f is InnertubeFormat & { url: string } => typeof f.url === 'string' && f.url.length > 0);
  if (formats.length === 0) return null;
  formats.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const muxed = formats.find(
    (f) =>
      (f.mimeType ?? '').startsWith('video/') &&
      (f.audioQuality !== undefined || (f.audioChannels ?? 0) > 0),
  );
  const chosen = muxed ?? formats[0];
  return { url: chosen.url, mimeType: chosen.mimeType, contentLength: chosen.contentLength };
}

const MAX_REDIRECTS = 5;

/**
 * Fetches an already-resolved media URL with a manual redirect loop that
 * re-validates protocol, host allowlist and public-address rules on every hop.
 */
export async function safeStreamFetch(
  rawUrl: string,
  init: RequestInit,
  deps: FetchDeps = {},
): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('invalid_stream_url');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('bad_protocol');
    if (isPrivateOrReservedHost(url.hostname)) throw new Error('private_host');
    if (!isAllowedStreamHost(url.hostname)) throw new Error('host_not_allowed');

    const res = await doFetch(url.toString(), { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('redirect_without_location');
      url = new URL(location, url);
      continue;
    }
    return res;
  }
  throw new Error('too_many_redirects');
}

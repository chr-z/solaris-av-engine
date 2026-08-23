/**
 * SOLARIS service worker — offline-first app shell (S2.1).
 *
 * Strategy:
 * - App shell + icons: cache-first, precached at install.
 * - Navigations: network-first with offline fallback to the cached shell
 *   (keeps deploys fresh while remaining fully usable offline).
 * - Same-origin static assets (hashed Vite bundles): stale-while-revalidate.
 * - Google-hosted static scripts (GIS/GAPI) and cross-origin media/API:
 *   pass-through (never cached).
 *
 * Version bump `CACHE_VERSION` on deploy-shape changes to invalidate old caches.
 */
const CACHE_VERSION = 'solaris-v2';
const OFFLINE_URLS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(OFFLINE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

/** True for http(s) URLs only — never touch blob:, data:, chrome-extension:. */
function isCacheableScheme(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function isStaticAsset(url, request) {
  if (request.method !== 'GET') return false;
  return (
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|mjs|css|woff2?|png|jpe?g|svg|webp|avif|ico)$/.test(url.pathname)
  );
}

function isGoogleStaticScript(url) {
  return (
    url.hostname === 'apis.google.com' ||
    url.hostname === 'accounts.google.com' && url.pathname.startsWith('/gsi/')
  );
}

async function networkFirstNavigation(event) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(event.request);
    // Opportunistically refresh the offline fallback document.
    if (fresh && fresh.ok && event.request.mode === 'navigate') {
      cache.put('index.html', fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached =
      (await cache.match(event.request)) ||
      (await cache.match('index.html')) ||
      (await cache.match('./'));
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!isCacheableScheme(url)) return;

  // Never intercept Firebase realtime/database/websocket traffic or our API routes.
  if (
    url.hostname.endsWith('firebaseio.com') ||
    url.hostname.includes('firebasedatabase') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Cross-origin Google bootstrap scripts: browser HTTP cache handles them.
  if (url.origin !== self.location.origin) {
    if (isGoogleStaticScript(url)) return;
    return; // default: no SW involvement for other origins (media blobs are blob: URLs anyway)
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (isStaticAsset(url, request)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

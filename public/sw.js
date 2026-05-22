/**
 * Lantern Study – Service Worker
 * Strategy:
 *   - App shell (HTML/CSS/JS bundles): cache-first so the app loads instantly offline
 *   - Supabase / API server requests: network-only (never cache sensitive data)
 *   - Navigation requests: network-first with offline fallback to cached index.html
 */

const CACHE_NAME = 'lantern-v1';

// Files that must be available offline for the app shell to load
const PRECACHE_ASSETS = ['/', '/index.html'];

// ── Install: pre-cache the app shell ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: remove old cache versions ───────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

// ── Fetch: route requests ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Never intercept Supabase or the API server – always go to network
  if (
    url.hostname.includes('supabase') ||
    url.port === '3001' ||
    url.pathname.startsWith('/rest/v1') ||
    url.pathname.startsWith('/auth/v1') ||
    url.pathname.startsWith('/storage/v1')
  ) {
    return;
  }

  // Navigation requests (HTML pages) – network-first, fall back to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets (JS, CSS, fonts, images) – cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // Only cache valid, same-origin or CDN responses
        if (response.ok) {
          const clone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, clone))
            .catch(() => {});
        }
        return response;
      });
    })
  );
});

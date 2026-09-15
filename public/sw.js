/**
 * Lantern Study – Service Worker
 * Strategy:
 *   - install: precache index.html + the entry assets it references, so a cold
 *     offline boot works without depending on browser HTTP-cache luck
 *   - /assets/* (Vite hashed chunks, immutable): cache-first with runtime fill;
 *     responses are cached only when ok AND not HTML (never cache an error
 *     page as a JS chunk)
 *   - Navigation: network-first; cache index.html only after successful HTML response
 *   - API / Supabase: never intercepted
 * CACHE_NAME is replaced at build time (__BUILD_ID__).
 *
 * Registered from index.tsx. Exports nothing — it is a worker script, wired up
 * entirely through the install / activate / fetch / notificationclick listeners
 * below. Touches: the Cache Storage bucket named by CACHE_NAME, and
 * postMessage('notification-click') back to an open client.
 *
 * Gotchas:
 *  - A bumped CACHE_NAME is NOT evidence that a new JS bundle shipped: the
 *    build id is generated per build, not derived from bundle content. Verify a
 *    deploy by comparing the served index-*.js hash, never by this string.
 *  - The whole worker is inert on localhost (IS_LOCAL_DEV) — offline behaviour
 *    cannot be tested against the dev server, only against a built/served app.
 *  - Nothing here intercepts API or Supabase traffic (isApiRequest), so offline
 *    data durability comes from the app's own offline queues, not from the SW.
 */

const CACHE_NAME = 'lantern-__BUILD_ID__';
const IS_LOCAL_DEV =
  self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

function isApiRequest(url) {
  return (
    url.hostname.includes('supabase') ||
    url.port === '3001' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/rest/v1') ||
    url.pathname.startsWith('/auth/v1') ||
    url.pathname.startsWith('/storage/v1')
  );
}

function isHtmlResponse(response) {
  const type = response.headers.get('content-type') || '';
  return type.includes('text/html');
}

/** An asset response safe to serve later as a script/stylesheet. */
function isCacheableAsset(response) {
  return response && response.ok && !isHtmlResponse(response);
}

/**
 * Precache the app shell: index.html plus every /assets/ URL it references.
 * Vite writes hashed asset names into index.html, so parsing it IS the
 * precache manifest — no build-plugin needed. Best-effort per asset: a miss
 * only means that chunk falls back to runtime caching.
 */
async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const indexResponse = await fetch('/index.html', { cache: 'no-cache' });
  if (!indexResponse.ok || !isHtmlResponse(indexResponse)) {
    // Fail the install: activate unconditionally deletes the old cache, so
    // promoting a new SW without a shell would trade a WORKING offline boot
    // for a broken one. The old SW keeps serving until a later retry succeeds.
    throw new Error(`App-shell precache failed (${indexResponse.status})`);
  }
  await cache.put('/index.html', indexResponse.clone());

  const html = await indexResponse.text();
  const assetUrls = new Set();
  const re = /(?:src|href)="(\/assets\/[^"]+)"/g;
  let match;
  while ((match = re.exec(html)) !== null) assetUrls.add(match[1]);

  await Promise.all(
    [...assetUrls].map(async (url) => {
      try {
        const existing = await cache.match(url);
        if (existing) return;
        const response = await fetch(url);
        if (isCacheableAsset(response)) await cache.put(url, response);
      } catch {
        /* runtime caching will pick it up on first use */
      }
    })
  );
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  if (IS_LOCAL_DEV) return;
  // No .catch here: a rejected waitUntil aborts THIS install and leaves the
  // previous SW (and its working cache) in charge. Per-asset failures are
  // already best-effort inside precacheAppShell.
  event.waitUntil(precacheAppShell());
});

// On activation, delete every cache except the current build's and take control
// of open pages immediately. This is why a failed install must NOT promote a new
// SW: activate is unconditional and would drop the last working offline shell.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (IS_LOCAL_DEV) return;
  if (event.request.method !== 'GET') return;

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  if (isApiRequest(url)) return;

  // Hashed Vite chunks are immutable: cache-first, filled at install and at
  // runtime. isCacheableAsset guards against ever caching an HTML error page
  // as a JS chunk (the reason this used to bypass the SW entirely — which
  // also meant the app could not cold-boot offline).
  if (url.pathname.startsWith('/assets/') && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (isCacheableAsset(response)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return response;
        });
      })
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && isHtmlResponse(response)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
  }
});

// Push/notification taps: prefer handing the payload to an already-open tab via
// postMessage (the app routes on 'notification-click') and only openWindow when
// no client exists, so a tap never spawns a duplicate app window.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        if (clients.length > 0) {
          const client = clients[0];
          client.focus();
          client.postMessage({ type: 'notification-click', ...data });
          return;
        }
        const url = typeof data.url === 'string' ? data.url : '/';
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
      .catch(() => {})
  );
});

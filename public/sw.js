/**
 * Lantern Study – Service Worker
 * Strategy:
 *   - /assets/* (Vite hashed chunks): bypass SW — always network
 *   - Navigation: network-first; cache index.html only after successful HTML response
 *   - API / Supabase: never intercepted
 * CACHE_NAME is replaced at build time (__BUILD_ID__).
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

self.addEventListener('install', (event) => {
  self.skipWaiting();
  if (IS_LOCAL_DEV) return;
  event.waitUntil(Promise.resolve());
});

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

  // Hashed Vite chunks must always come from the network (never cache HTML as JS).
  if (url.pathname.startsWith('/assets/')) return;

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

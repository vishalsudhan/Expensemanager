const CACHE_PREFIX = 'expense-manager-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v4`;
const API_CACHE_NAME = `${CACHE_PREFIX}api-v4`;
// Vite dev modules use stable URLs; bypass cache so preview changes remain visible after restarts.
const VITE_DEV_PATHS = [
  '/src/',
  '/@vite/',
  '/@id/',
  '/@fs/',
  '/@react-refresh',
  '/node_modules/.vite/',
];
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

const isApiRequest = (url) => url.origin === self.location.origin && url.pathname.startsWith('/api/');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(CACHE_PREFIX) &&
                key !== CACHE_NAME &&
                key !== API_CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Keep read data available offline: network-first, falling back to the last
// successful response. Only same-origin GET requests are cached.
async function handleApiRequest(event) {
  const { request } = event;

  if (request.method !== 'GET') return;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(
        caches.open(API_CACHE_NAME).then((cache) => cache.put(request, copy)),
      );
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    return new Response(
      JSON.stringify({ error: 'You are offline and this data has not been saved yet.' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (isApiRequest(url)) {
    event.respondWith(handleApiRequest(event));
    return;
  }

  if (VITE_DEV_PATHS.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put('/', copy)),
            );
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)),
            );
          }
          return response;
        }),
    ),
  );
});

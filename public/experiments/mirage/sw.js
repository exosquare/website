/*
 * Directory-scoped observer and shell cache for this experiment.
 * The page, the vision worker, and the runtime are precached here.
 * The model is stored separately in Cache Storage (mirage-model) and is not
 * part of this shell. Cache Storage reads never reach this worker.
 */

const SHELL = 'mirage-shell';
const FILES = [
  './',
  './index.html',
  './mirage.css',
  './main.js',
  './motion.js',
  './rules.js',
  './observe.js',
  './vision-block.js',
  './vision-worker.js',
  './vendor/cactus.js',
  './vendor/cactus.wasm',
  './samples/receipt.jpg',
  './samples/parking.jpg',
  './samples/desk.jpg',
  './samples/menu.jpg',
];

let phase = 'page';

function broadcast(event) {
  self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    for (const client of clients) client.postMessage({ source: 'exo-net', event });
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.source !== 'exo-net') return;
  if (event.data.type === 'phase') {
    phase = event.data.phase;
    event.ports[0]?.postMessage({ ok: true });
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;
  const started = Date.now();
  const method = request.method;
  broadcast({ via: 'service-worker', state: 'start', method, url: request.url, started, phase, phaseRank: 2 });
  event.respondWith((async () => {
    try {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) {
        const length = Number(cached.headers.get('content-length'));
        broadcast({
          via: 'service-worker',
          state: 'end',
          method,
          url: request.url,
          responseURL: cached.url,
          status: cached.status,
          contentType: cached.headers.get('content-type') || '',
          declaredBytes: Number.isFinite(length) ? length : null,
          cached: true,
          started,
          ended: Date.now(),
          phase,
          phaseRank: 2,
        });
        return cached;
      }
      const response = await fetch(request);
      const length = Number(response.headers.get('content-length'));
      broadcast({
        via: 'service-worker',
        state: 'end',
        method,
        url: request.url,
        responseURL: response.url,
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        declaredBytes: Number.isFinite(length) ? length : null,
        cached: false,
        started,
        ended: Date.now(),
        phase,
        phaseRank: 2,
      });
      return response;
    } catch (error) {
      broadcast({
        via: 'service-worker',
        state: 'error',
        method,
        url: request.url,
        error: String(error),
        started,
        ended: Date.now(),
        phase,
        phaseRank: 2,
      });
      throw error;
    }
  })());
});

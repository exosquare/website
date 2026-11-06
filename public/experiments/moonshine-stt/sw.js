/*
 * Pass-through observer for this experiment's directory.
 * It records fetches, including those from the speech worker, then
 * performs the original request unchanged. It does not cache responses.
 * Cache Storage reads never reach this worker.
 */

let phase = 'page';

function broadcast(event) {
  self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      client.postMessage({ source: 'exo-net', event });
    }
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
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
  if (!request.url.startsWith('http')) return;
  const started = Date.now();
  const method = request.method;
  broadcast({
    via: 'service-worker',
    state: 'start',
    method,
    url: request.url,
    started,
    phase,
    phaseRank: 2,
  });
  event.respondWith(
    fetch(request).then(
      (response) => {
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
          started,
          ended: Date.now(),
          phase,
          phaseRank: 2,
        });
        return response;
      },
      (error) => {
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
      },
    ),
  );
});

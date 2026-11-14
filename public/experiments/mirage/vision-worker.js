/*
 * Loads the vendored Cactus runtime and Mirage weights, then describes one image.
 * cactus.js is the unmodified 4.1.0 build. Its fetch and XHR calls are the
 * Emscripten file loader. Nothing in that file names a remote host. This worker
 * refuses any URL that is not this page's origin before that file runs, and it
 * passes the wasm bytes in so the loader does not request them.
 */

const origin = self.location.origin;

function allowed(url) {
  try {
    const parsed = new URL(url, self.location.href);
    return parsed.origin === origin && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

const nativeFetch = self.fetch.bind(self);
self.fetch = function (input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  if (!allowed(raw)) return Promise.reject(new TypeError('Blocked non-local request'));
  return nativeFetch(input, init);
};

const NativeXHR = self.XMLHttpRequest;
function LocalXHR() {
  const xhr = new NativeXHR();
  const open = xhr.open;
  xhr.open = function (_method, url) {
    if (!allowed(url)) throw new DOMException('Blocked non-local request', 'SecurityError');
    return open.apply(xhr, arguments);
  };
  return xhr;
}
self.XMLHttpRequest = LocalXHR;

self.WebSocket = function () {
  throw new DOMException('Blocked non-local socket', 'SecurityError');
};
if (self.navigator) {
  self.navigator.sendBeacon = function () {
    return false;
  };
}

importScripts('vendor/cactus.js');

const MODEL_CACHE = 'mirage-model';
let phase = 'model';
let engine = null;
let modelKept = 0;

function report(event) {
  self.postMessage({ type: 'network', event });
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'phase' && data.phase) phase = data.phase;
  if (data.type === 'load') void load(data);
  if (data.type === 'run') void run(data);
});

const hookedFetch = self.fetch;
self.fetch = async function (input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  const started = Date.now();
  report({ via: 'fetch', state: 'start', method: (init?.method || 'GET').toUpperCase(), url: raw, started, phase, phaseRank: 3 });
  try {
    const response = await hookedFetch(input, init);
    report({
      via: 'fetch',
      state: 'end',
      method: (init?.method || 'GET').toUpperCase(),
      url: raw,
      responseURL: response.url,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      declaredBytes: Number(response.headers.get('content-length')) || null,
      started,
      ended: Date.now(),
      phase,
      phaseRank: 3,
    });
    return response;
  } catch (error) {
    report({
      via: 'fetch',
      state: 'error',
      method: 'GET',
      url: raw,
      error: error instanceof Error ? error.message : String(error),
      started,
      ended: Date.now(),
      phase,
      phaseRank: 3,
    });
    throw error;
  }
};

function fail(message) {
  self.postMessage({ type: 'error', message: message || 'The model did not load.' });
}

async function readModel(url) {
  const cache = await caches.open(MODEL_CACHE);
  const cached = await cache.match(url);
  if (cached) {
    const started = performance.now();
    const bytes = new Uint8Array(await cached.arrayBuffer());
    self.postMessage({
      type: 'progress',
      loaded: bytes.byteLength,
      total: bytes.byteLength,
      fromCache: true,
      elapsed: performance.now() - started,
    });
    return bytes;
  }
  const response = await self.fetch(url);
  if (!response.ok || !response.body) throw new Error('Download interrupted');
  const totalHeader = Number(response.headers.get('content-length'));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    loaded += step.value.byteLength;
    self.postMessage({ type: 'progress', loaded, total, fromCache: false, elapsed: null });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await cache.put(url, new Response(bytes.slice(), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.byteLength) } }));
  return bytes;
}

async function load(data) {
  try {
    const wasmResponse = await self.fetch(data.wasmUrl);
    if (!wasmResponse.ok) throw new Error('The runtime did not load.');
    const wasmBinary = await wasmResponse.arrayBuffer();
    engine = await createCactus({ wasmBinary });
    engine.ccall('cactus_set_threads', 'null', ['number'], [1]);
    const model = await readModel(data.modelUrl);
    modelKept = engine._malloc(model.byteLength);
    if (!modelKept) throw new Error('Not enough memory for the model.');
    engine.HEAPU8.set(model, modelKept);
    const code = engine._cactus_load(modelKept, BigInt(model.byteLength));
    if (code < 0) throw new Error(engine.UTF8ToString(engine._cactus_last_error()) || 'The model did not load.');
    const flags = engine.ccall('cactus_models', 'number', [], []);
    if ((flags & 4) === 0) throw new Error('The model file is not a vision model.');
    self.postMessage({ type: 'ready', bytes: model.byteLength });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function describe(rgb, width, height, options) {
  const image = engine._malloc(rgb.byteLength);
  if (!image) throw new Error('Not enough memory for the image.');
  engine.HEAPU8.set(rgb, image);
  let capacity = 512 * 1024;
  let output = engine._malloc(capacity);
  try {
    const encoded = JSON.stringify(options);
    let code = engine.ccall(
      'cactus_describe',
      'number',
      ['number', 'number', 'number', 'string', 'string', 'string', 'number', 'number'],
      [image, width, height, encoded, null, null, output, capacity],
    );
    if (code >= capacity - 1) {
      engine._free(output);
      capacity = 2 * 1024 * 1024;
      output = engine._malloc(capacity);
      code = engine.ccall(
        'cactus_describe',
        'number',
        ['number', 'number', 'number', 'string', 'string', 'string', 'number', 'number'],
        [image, width, height, encoded, null, null, output, capacity],
      );
    }
    if (code < 0) throw new Error(engine.UTF8ToString(engine._cactus_last_error()) || 'The image could not be read.');
    return JSON.parse(engine.UTF8ToString(output));
  } finally {
    engine._free(image);
    if (output) engine._free(output);
  }
}

async function run(data) {
  if (!engine) {
    fail('The model is not loaded.');
    return;
  }
  const started = performance.now();
  let stageName = 'objects';
  try {
    const rgb = new Uint8Array(data.buffer);
    self.postMessage({ type: 'stage', name: 'objects', state: 'start' });
    const objects = describe(rgb, data.width, data.height, {
      sections: ['objects'],
      fields: ['bbox', 'score'],
      conf: 0.2,
      max_objects: 32,
    });
    self.postMessage({ type: 'stage', name: 'objects', state: 'end' });
    stageName = 'text';
    self.postMessage({ type: 'stage', name: 'text', state: 'start' });
    const text = describe(rgb, data.width, data.height, {
      sections: ['text'],
      fields: ['bbox', 'score'],
      text_conf: 0.15,
      max_text_lines: 32,
    });
    self.postMessage({ type: 'stage', name: 'text', state: 'end' });
    self.postMessage({
      type: 'result',
      objects: objects.objects || [],
      text: text.text || [],
      ms: performance.now() - started,
    });
  } catch (error) {
    self.postMessage({ type: 'stage', name: stageName, state: 'end' });
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error), during: 'run' });
  }
}

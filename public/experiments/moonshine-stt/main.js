import { createBlockVisualizer } from './block-visualizer.js';
import {
  createLedger,
  formatBytes,
  installNetworkHooks,
  requestMatchesFile,
  resourceFromEntry,
} from './observe.js';

const synthetic = new URLSearchParams(location.search).get('synthetic') === '1';
const ledger = createLedger();
const modelFiles = [];

const actionButton = document.querySelector('#action');
const actionHint = document.querySelector('#action-hint');
const sizeNote = document.querySelector('#size-note');
const progressWrap = document.querySelector('#progress-wrap');
const progressBar = document.querySelector('#progress-bar');
const progressLabel = document.querySelector('#progress-label');
const progressFile = document.querySelector('#progress-file');
const deviceLine = document.querySelector('#device');
const statusLine = document.querySelector('#status');
const errorLine = document.querySelector('#speech-error');
const transcript = document.querySelector('#transcript');
const visualizer = createBlockVisualizer(document.querySelector('#mark'));
const swNote = document.querySelector('#sw-note');
const pageSummary = document.querySelector('#page-summary');
const loadSummary = document.querySelector('#load-summary');
const liveSummary = document.querySelector('#live-summary');
const onnxSummary = document.querySelector('#onnx-summary');
const modelList = document.querySelector('#model-files');
const requestList = document.querySelector('#requests');

const state = {
  phase: 'page',
  loading: false,
  ready: false,
  live: false,
  worker: null,
  busy: '',
  cached: false,
  loadFailed: false,
  sessionStart: 0,
  vad: 0,
  vadActive: false,
  cacheMode: false,
};
const progressFiles = new Map();

installNetworkHooks((event) => {
  if (!event.phase) {
    event.phase = ledger.phaseAt(event.started || Date.now());
    event.phaseRank = 2;
  }
  ledger.absorb(event);
}, () => state.phase);

window.__exoOnResource = (entry) => ledger.absorb(resourceFromEntry(entry));
for (const entry of window.__exoResourceQueue || []) ledger.absorb(resourceFromEntry(entry));
if (window.__exoResourceQueue) window.__exoResourceQueue.length = 0;
for (const entry of performance.getEntriesByType('navigation')) {
  ledger.absorb(resourceFromEntry(entry));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.source === 'exo-net' && event.data.event) ledger.absorb(event.data.event);
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    navigator.serviceWorker.controller?.postMessage({
      source: 'exo-net',
      type: 'phase',
      phase: state.phase,
    });
  });
}

ledger.onChange(() => {
  reclassify();
  renderNetwork();
});

function setStatus(text) {
  statusLine.textContent = text;
}

function renderAction() {
  actionButton.disabled = state.loading || !!state.busy;
  actionButton.textContent = state.busy || (state.loading
    ? state.cacheMode ? 'Loading…' : 'Downloading…'
    : state.live ? 'Stop' : state.ready ? 'Start'
    : state.loadFailed ? 'Retry download' : state.cached ? 'Load Model' : 'Download Model');
  actionHint.textContent = state.live
    ? synthetic ? 'Generated audio is running. The microphone is off.' : 'Microphone on. Press Stop when you’re finished.'
    : state.ready ? synthetic ? 'Ready to try with generated audio.' : 'Ready. Press Start to allow microphone access.'
    : state.loading ? 'Loading the model. The microphone is off.'
    : state.cached ? 'Uses model files already saved in this browser.' : 'About 160 MB once, then saved in your browser.';
  document.querySelector('#speech').dataset.state = state.live ? 'live' : state.ready ? 'ready' : state.loading ? 'loading' : 'idle';
}

function setEmptyTranscript(text) {
  const empty = transcript.querySelector('.empty');
  if (empty) empty.textContent = text;
}

function showError(text) {
  errorLine.hidden = !text;
  errorLine.textContent = text || '';
}

async function setPhase(phase) {
  state.phase = phase;
  ledger.setPhase(phase);
  state.worker?.postMessage({ type: 'phase', phase });
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return;
  await new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(resolve, 300);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve();
    };
    controller.postMessage({ source: 'exo-net', type: 'phase', phase }, [channel.port2]);
  });
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function pathOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function kindOf(row) {
  if (row.contentType) return row.contentType.split(';')[0];
  const path = pathOf(row.responseURL || row.url).split('?')[0];
  const ext = path.includes('.') ? path.split('.').pop() : '';
  return ext || 'unknown';
}

function deliveryOf(row) {
  if (row.cached === true || (row.transferBytes === 0 && row.decodedBytes > 0)) return 'HTTP cache';
  if (row.transferBytes > 0) return 'Network';
  if (row.declaredBytes != null) return 'Size hidden';
  return 'Unmeasured';
}

function sumPhase(phase) {
  const list = ledger.rows.filter((row) => row.phase === phase);
  let transferred = 0;
  let decoded = 0;
  let transferKnown = 0;
  let decodedKnown = 0;
  let hidden = 0;
  for (const row of list) {
    if (row.transferBytes == null) hidden += 1;
    else {
      transferred += row.transferBytes;
      transferKnown += 1;
    }
    if (row.decodedBytes != null) {
      decoded += row.decodedBytes;
      decodedKnown += 1;
    }
  }
  return { count: list.length, transferred, decoded, transferKnown, decodedKnown, hidden };
}

function summaryText(title, stats) {
  if (stats.count === 0) return `${title}: 0 requests.`;
  const parts = [`${title}: ${stats.count} request${stats.count === 1 ? '' : 's'}`];
  parts.push(
    stats.transferKnown
      ? `transferred ${formatBytes(stats.transferred)}`
      : 'transferred size not exposed',
  );
  if (stats.decodedKnown) parts.push(`decoded ${formatBytes(stats.decoded)}`);
  if (stats.hidden) parts.push(`${stats.hidden} without transferSize`);
  return `${parts.join(' · ')}.`;
}

function classify(file) {
  const saw =
    file.workerSawNetwork ||
    ledger.rows.some((row) =>
      [row.url, row.responseURL].some((url) => requestMatchesFile(url, file.file)),
    );
  if (saw) return 'network';
  if (file.inCacheBefore) return 'cache-storage';
  return 'unobserved';
}

function reclassify() {
  for (const file of modelFiles) file.source = classify(file);
}

function renderModelFiles() {
  modelList.replaceChildren();
  if (!modelFiles.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = state.loading
      ? 'Weight files will be listed here as the loader reads them.'
      : 'No weight file has been read yet.';
    modelList.append(empty);
  } else {
    for (const file of modelFiles) {
      const item = document.createElement('article');
      item.className = 'req';
      const title = document.createElement('p');
      title.className = 'req-title';
      const source =
        file.source === 'network'
          ? 'Network this visit'
          : file.source === 'cache-storage'
            ? 'Cache Storage, no network request'
            : 'No network request observed, and it was not in Cache Storage beforehand';
      title.textContent = `${file.file} · ${source}`;
      const meta = document.createElement('p');
      meta.className = 'meta';
      const bits = [file.name];
      if (file.readBytes != null) bits.push(`read ${formatBytes(file.readBytes)}`);
      if (file.headerBytes != null) bits.push(`stored ${formatBytes(file.headerBytes)}`);
      if (file.inCacheBefore) bits.push('present before this load');
      meta.textContent = bits.join(' · ');
      item.append(title, meta);
      modelList.append(item);
    }
  }
  const onnx = modelFiles.filter((file) => file.file.endsWith('.onnx'));
  const onnxNet = onnx.filter((file) => file.source === 'network').length;
  const onnxCache = onnx.filter((file) => file.source === 'cache-storage').length;
  if (!state.loading && !state.ready) {
    onnxSummary.textContent =
      'ONNX files are not requested until you press Download Model. A cold first visit downloads about 160 MB (Base weights plus the runtime). A later visit can show no weight requests, because those files are read from Cache Storage.';
  } else if (!onnx.length) {
    onnxSummary.textContent = 'No ONNX file has finished loading yet.';
  } else if (onnxNet === 0 && onnxCache > 0) {
    onnxSummary.textContent = `ONNX network requests this visit: 0. ${onnxCache} ONNX file${onnxCache === 1 ? '' : 's'} read from Cache Storage (transformers-cache). DevTools Disable cache does not bypass that store.`;
  } else {
    onnxSummary.textContent = `ONNX network requests this visit: ${onnxNet}. Cache Storage reads: ${onnxCache}. A cold first visit is about 160 MB (Base weights plus the runtime).`;
  }
}

function renderNetwork() {
  pageSummary.textContent = summaryText('Page', sumPhase('page'));
  const loading = sumPhase('loading');
  loadSummary.textContent = state.loading || state.ready
    ? summaryText('Loading', loading)
    : 'Loading: 0 requests. The model has not been requested.';
  const live = sumPhase('live');
  liveSummary.textContent = state.live
    ? live.count === 0
      ? 'Live capture: 0 requests since the microphone step started. No request was removed from this list.'
      : `${summaryText('Live capture', live)} These started while audio was being captured.`
    : 'Live capture: the microphone step has not started.';
  loadSummary.dataset.count = String(loading.count);
  loadSummary.dataset.transferred = String(loading.transferred);
  liveSummary.dataset.count = String(live.count);
  renderModelFiles();
  requestList.replaceChildren();
  if (!ledger.rows.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No requests yet.';
    requestList.append(empty);
    return;
  }
  for (const row of ledger.rows) {
    const item = document.createElement('article');
    item.className = 'req';
    const title = document.createElement('p');
    title.className = 'req-title';
    const finalHost =
      row.responseURL && hostOf(row.responseURL) !== hostOf(row.url)
        ? `${hostOf(row.url)} → ${hostOf(row.responseURL)}`
        : hostOf(row.responseURL || row.url);
    title.textContent = `${row.phase} · ${finalHost}`;
    const meta = document.createElement('p');
    meta.className = 'meta';
    const size = [
      deliveryOf(row),
      row.transferBytes == null ? 'transferred n/a' : `transferred ${formatBytes(row.transferBytes)}`,
      row.decodedBytes == null ? 'decoded n/a' : `decoded ${formatBytes(row.decodedBytes)}`,
    ];
    if (row.declaredBytes != null) size.push(`content-length ${formatBytes(row.declaredBytes)}`);
    meta.textContent = `${row.method} · ${kindOf(row)} · ${size.join(' · ')} · ${row.via.join(', ')}`;
    const path = document.createElement('p');
    path.className = 'path';
    path.textContent = pathOf(row.url);
    item.append(title, meta, path);
    if (row.error) {
      const err = document.createElement('p');
      err.className = 'meta';
      err.textContent = row.error;
      item.append(err);
    }
    requestList.append(item);
  }
}

function setBar(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) {
    progressBar.removeAttribute('value');
    return;
  }
  progressBar.value = Math.max(0, Math.min(100, ratio * 100));
}

function renderProgress(current) {
  let loaded = 0;
  let total = 0;
  let known = progressFiles.size > 0;
  for (const file of progressFiles.values()) {
    loaded += file.loaded || 0;
    if (file.total == null) known = false;
    else total += file.total;
  }
  const label = state.ready ? 'Loaded' : state.cacheMode ? 'Loading from cache' : 'Downloading';
  if (!progressFiles.size) {
    progressLabel.textContent = 'Starting the runtime';
    setBar(null);
  } else if (known && total > 0) {
    progressLabel.textContent = `${label} ${formatBytes(loaded)} / ${formatBytes(total)}`;
    setBar(loaded / total);
  } else if (typeof current?.progress === 'number') {
    progressLabel.textContent = `${label} ${formatBytes(loaded)}`;
    setBar(current.progress / 100);
  } else {
    progressLabel.textContent = `${label} ${formatBytes(loaded)}`;
    setBar(null);
  }
  progressFile.textContent = current?.file || progressFile.textContent;
}

function upsertModelFile(message) {
  const key = `${message.name}/${message.file}`;
  let file = modelFiles.find((item) => `${item.name}/${item.file}` === key);
  if (!file) {
    file = { name: message.name, file: message.file };
    modelFiles.push(file);
  }
  Object.assign(file, message);
  file.source = classify(file);
  const onnxSeen = modelFiles.filter((item) => item.file.endsWith('.onnx'));
  state.cacheMode =
    onnxSeen.length > 0 &&
    onnxSeen.every((item) => item.inCacheBefore) &&
    !ledger.rows.some(
      (row) =>
        row.phase === 'loading' &&
        onnxSeen.some((item) =>
          [row.url, row.responseURL].some((url) => requestMatchesFile(url, item.file)),
        ),
    );
  renderProgress();
  renderNetwork();
}

function describeDevice(message) {
  if (message.reason === 'no-adapter') {
    deviceLine.textContent = 'WebGPU is not available in this browser. Using WASM.';
  } else if (message.reason === 'webgpu-failed') {
    deviceLine.textContent = `WebGPU did not start (${message.detail || 'load failed'}). Using WASM.`;
  } else if (message.device === 'webgpu') {
    deviceLine.textContent = 'Running on WebGPU. Weights: fp32 encoder and q4 decoder.';
  } else {
    deviceLine.textContent = 'Using WASM.';
  }
}

async function registerObserver() {
  if (!('serviceWorker' in navigator)) {
    swNote.textContent =
      'Service workers are not available here. Resource timing and the fetch, XHR, WebSocket, and sendBeacon wrappers are still recording.';
    return;
  }
  try {
    await navigator.serviceWorker.register('./sw.js');
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    const controlling = !!navigator.serviceWorker.controller;
    swNote.textContent = controlling
      ? 'The service worker is controlling this page, so it can see worker fetches too.'
      : 'The service worker is registered. If it is not controlling the page yet, wrappers and resource timing still record requests.';
  } catch (error) {
    swNote.textContent = `The service worker did not register (${error.message}). Wrappers and resource timing are still recording.`;
  }
}

function onWorkerMessage(event) {
  const data = event.data || {};
  if (data.type === 'network') ledger.absorb(data.event);
  if (data.type === 'progress') {
    const progress = data.progress || {};
    if (progress.file) {
      const key = `${progress.name}/${progress.file}`;
      const prev = progressFiles.get(key) || { loaded: 0, total: null };
      if (progress.loaded != null) prev.loaded = progress.loaded;
      if (progress.total != null && progress.total > 0) prev.total = progress.total;
      if (progress.status === 'done' && prev.total != null) prev.loaded = prev.total;
      progressFiles.set(key, prev);
    }
    renderProgress(progress);
  }
  if (data.type === 'cache-snapshot') {
    const relevant = (data.urls || []).filter((url) =>
      /moonshine-base-ONNX|silero-vad/.test(url),
    );
    const onnx = relevant.filter((url) => url.endsWith('.onnx'));
    state.cacheMode = onnx.length > 0;
    if (onnx.length) state.cached = true;
    renderAction();
  }
  if (data.type === 'model-file') upsertModelFile(data);
  if (data.type === 'device') describeDevice(data);
  if (data.type === 'status' && state.live) setStatus(data.message);
  if (data.type === 'vad') {
    state.vad = Math.max(0, Math.min(1, data.probability || 0));
    state.vadActive = !!data.active;
  }
  if (data.type === 'output') appendTranscript(data);
  if (data.type === 'ready') {
    state.ready = true;
    state.loading = false;
    state.loadFailed = false;
    progressWrap.hidden = true;
    setBar(1);
    setStatus('Ready');
    setEmptyTranscript('Press Start, then speak. Your words will appear here.');
    renderAction();
    void setPhase('ready');
    renderNetwork();
  }
  if (data.type === 'error') failModel(data.message);

}

function appendTranscript(data) {
  const text = (data.text || '').trim();
  if (!text) return;
  const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48;
  transcript.querySelector('.empty')?.remove();
  const line = document.createElement('p');
  line.textContent = text;
  transcript.append(line);
  if (nearBottom) transcript.scrollTop = transcript.scrollHeight;
}

let audioHandle = null;
let captureEpoch = 0;

function releaseAudio() {
  captureEpoch++;
  const handle = audioHandle;
  audioHandle = null;
  state.live = false;
  state.vad = 0;
  state.vadActive = false;
  handle?.stop();
  visualizer.disconnect();
  return handle?.context.close().catch(() => {});
}

function failModel(message) {
  void releaseAudio();
  state.loading = false;
  state.ready = false;
  state.busy = '';
  state.loadFailed = true;
  state.worker?.terminate();
  state.worker = null;
  progressWrap.hidden = true;
  showError(`Speech recognition could not run. Try downloading the model again. ${message || ''}`.trim());
  setStatus('Model unavailable');
  renderAction();
  void setPhase('page');
}

async function loadDemo() {
  if (state.loading || state.ready) return;
  state.loading = true;
  state.cacheMode = state.cached;
  state.worker?.terminate();
  progressFiles.clear();
  modelFiles.length = 0;
  showError('');
  progressWrap.hidden = false;
  progressLabel.textContent = state.cached ? 'Reading saved model files' : 'Preparing download';
  setBar(null);
  setStatus('Loading model');
  renderAction();
  await setPhase('loading');
  await registerObserver();
  const worker = new Worker(new URL('./speech-worker.js', import.meta.url), { type: 'module' });
  state.worker = worker;
  worker.addEventListener('message', (event) => {
    if (state.worker === worker) onWorkerMessage(event);
  });
  worker.addEventListener('error', (event) => {
    if (state.worker === worker) failModel(event.message || 'Worker error');
  });
  worker.postMessage({ type: 'load' });
}

async function startCapture() {
  if (!state.ready || state.live) return;
  showError('');
  const epoch = ++captureEpoch;
  const context = new AudioContext({ latencyHint: 'interactive' });
  let stream = null;
  let source = null;
  let worklet = null;
  let stopped = false;
  const oscillators = [];
  const handle = {
    context,
    stop() {
      if (stopped) return;
      stopped = true;
      oscillators.forEach((oscillator) => oscillator.stop());
      stream?.getTracks().forEach((track) => track.stop());
      worklet?.disconnect();
      source?.disconnect();
    },
  };
  audioHandle = handle;
  try {
    await context.resume();
    if (synthetic) {
      // Kept as a URL-only integration test source, with no additional UI.
      const gain = context.createGain();
      gain.gain.value = 0.12;
      const tone = context.createOscillator();
      tone.frequency.value = 132;
      tone.type = 'sawtooth';
      const lfo = context.createOscillator();
      lfo.frequency.value = 0.8;
      const depth = context.createGain();
      depth.gain.value = 0.1;
      lfo.connect(depth).connect(gain.gain);
      tone.connect(gain);
      tone.start();
      lfo.start();
      oscillators.push(tone, lfo);
      source = gain;
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, autoGainControl: true, noiseSuppression: true,
      } });
      if (epoch !== captureEpoch) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      source = context.createMediaStreamSource(stream);
      stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
        if (state.live && audioHandle === handle) void stopCapture();
      }));
    }
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const mute = context.createGain();
    mute.gain.value = 0;
    analyser.connect(mute).connect(context.destination);
    await context.audioWorklet.addModule(new URL('./vad-processor.js', import.meta.url));
    if (epoch !== captureEpoch) return;
    worklet = new AudioWorkletNode(context, 'vad-processor', {
      numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1,
      channelCountMode: 'explicit', channelInterpretation: 'discrete',
    });
    source.connect(worklet);
    worklet.port.onmessage = (event) => {
      const buffer = event.data?.buffer;
      if (!buffer || !state.worker || !state.live) return;
      const copy = new Float32Array(buffer);
      state.worker.postMessage({ type: 'audio', buffer: copy }, [copy.buffer]);
    };
    state.sessionStart = Date.now();
    await setPhase('live');
    if (epoch !== captureEpoch || !state.ready) return;
    state.live = true;
    state.worker.postMessage({ type: 'listen', on: true });
    visualizer.connect(analyser, { source: synthetic ? 'synthetic' : 'microphone', isSpeech: () => state.vadActive });
    setStatus(synthetic ? 'Generated audio' : 'Listening');
    setEmptyTranscript(synthetic ? 'Generated audio is running. The microphone is off.' : 'Listening. Speak a sentence to begin.');
    renderNetwork();
  } catch (error) {
    if (audioHandle === handle) await releaseAudio();
    else handle.stop();
    throw error;
  }
}

async function stopCapture() {
  state.worker?.postMessage({ type: 'listen', on: false });
  await releaseAudio();
  await setPhase('ready');
  setStatus('Stopped');
  setEmptyTranscript('Press Start whenever you’re ready to speak.');
  renderAction();
  renderNetwork();
}

actionButton.addEventListener('click', async () => {
  if (state.loading || state.busy) return;
  if (!state.ready) {
    try { await loadDemo(); }
    catch (error) { failModel(error.message); }
    return;
  }
  const stopping = state.live;
  state.busy = stopping ? 'Stopping…' : 'Starting…';
  renderAction();
  try {
    if (stopping) await stopCapture();
    else await startCapture();
  } catch (error) {
    const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    showError(denied
      ? 'Microphone access was denied. Allow it in your browser, then press Start again.'
      : `Could not start the microphone. ${error?.message || 'Please try again.'}`);
    setStatus('Microphone off');
  } finally {
    state.busy = '';
    renderAction();
  }
});

async function noteExistingCache() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    state.cached = keys.some((request) => /moonshine-base-ONNX/.test(request.url) && request.url.endsWith('.onnx'));
    if (!state.ready && !state.loading && state.cached) {
      setEmptyTranscript('Your words will appear here. Load the saved model to begin.');
      renderAction();
    }
  } catch { /* Download Model remains the starting action. */ }
}

if (synthetic) sizeNote.textContent = 'Generated audio is used on this test URL. The microphone stays off.';
setStatus('Model not loaded');
renderAction();
renderNetwork();
noteExistingCache();
sizeNote.dataset.ready = 'true';
window.addEventListener('pagehide', () => {
  if (audioHandle) {
    state.worker?.postMessage({ type: 'listen', on: false });
    void releaseAudio();
    state.busy = '';
    setStatus('Stopped');
    renderAction();
  }
});

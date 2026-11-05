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

const loadButton = document.querySelector('#load');
const sizeNote = document.querySelector('#size-note');
const cacheHint = document.querySelector('#cache-hint');
const progressWrap = document.querySelector('#progress-wrap');
const progressFill = document.querySelector('#progress-fill');
const progressBar = document.querySelector('#progress-bar');
const progressLabel = document.querySelector('#progress-label');
const progressFile = document.querySelector('#progress-file');
const deviceLine = document.querySelector('#device');
const statusLine = document.querySelector('#status');
const errorLine = document.querySelector('#speech-error');
const micStep = document.querySelector('#mic-step');
const consent = document.querySelector('#consent');
const micButton = document.querySelector('#mic');
const transcript = document.querySelector('#transcript');
const levelReadout = document.querySelector('#level-readout');
const mark = document.querySelector('#mark');
const markScale = document.querySelector('#mark-scale');
const windowRect = document.querySelector('#window');
const halo = document.querySelector('#halo');
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
  audio: null,
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
      'ONNX files are not requested until you press Load demo. A cold first visit downloads about 160 MB (Base weights plus the runtime). A later visit can show no weight requests, because those files are read from Cache Storage.';
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
    progressFill.style.width = '0%';
    progressBar.removeAttribute('aria-valuenow');
    progressBar.dataset.state = 'indeterminate';
    return;
  }
  const pct = Math.max(0, Math.min(100, ratio * 100));
  progressFill.style.width = `${pct}%`;
  progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
  progressBar.dataset.state = 'determinate';
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
    if (data.error) {
      cacheHint.textContent = `Cache Storage could not be opened (${data.error}).`;
    } else if (onnx.length) {
      cacheHint.textContent =
        'Weight files are already in this browser cache, so this load should read them from Cache Storage instead of downloading about 160 MB again.';
    }
  }
  if (data.type === 'model-file') upsertModelFile(data);
  if (data.type === 'device') describeDevice(data);
  if (data.type === 'status') setStatus(data.message);
  if (data.type === 'vad') {
    state.vad = Math.max(0, Math.min(1, data.probability || 0));
    state.vadActive = !!data.active;
  }
  if (data.type === 'output') appendTranscript(data);
  if (data.type === 'ready') {
    state.ready = true;
    state.loading = false;
    loadButton.disabled = true;
    loadButton.textContent = 'Model ready';
    progressLabel.textContent = progressFiles.size
      ? progressLabel.textContent.replace(/^(Downloading|Loading from cache|Loading)\b/, 'Loaded')
      : 'Model ready';
    setBar(1);
    micStep.hidden = false;
    setStatus('The model is ready. The microphone is still off.');
    void setPhase('ready');
    renderNetwork();
  }
  if (data.type === 'error') {
    state.loading = false;
    loadButton.disabled = false;
    loadButton.textContent = 'Try again (~160 MB)';
    showError(`The model did not load, so transcription has not started. ${data.message}`);
    setStatus('The model did not load.');
  }
}

function appendTranscript(data) {
  const text = (data.text || '').trim();
  if (!text) return;
  const empty = transcript.querySelector('.empty');
  empty?.remove();
  const line = document.createElement('p');
  const stamp = document.createElement('time');
  const ms = Math.max(0, (data.start || Date.now()) - state.sessionStart);
  const total = Math.floor(ms / 1000);
  stamp.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  stamp.dateTime = new Date(data.start || Date.now()).toISOString();
  line.append(stamp, document.createTextNode(` ${text}`));
  transcript.append(line);
}

async function loadDemo() {
  if (state.loading || state.ready) return;
  state.loading = true;
  showError('');
  loadButton.disabled = true;
  progressWrap.hidden = false;
  progressLabel.textContent = 'Starting the runtime';
  setBar(null);
  setStatus('Loading the model. The microphone is still off.');
  await setPhase('loading');
  await registerObserver();
  const worker = new Worker(new URL('./speech-worker.js', import.meta.url), { type: 'module' });
  state.worker = worker;
  worker.addEventListener('message', onWorkerMessage);
  worker.addEventListener('error', (event) => {
    state.loading = false;
    loadButton.disabled = false;
    loadButton.textContent = 'Try again (~160 MB)';
    showError(
      `The model did not load, so transcription has not started. ${event.message || 'Worker error'}`,
    );
  });
  worker.postMessage({ type: 'load' });
}

let audioHandle = null;
let raf = 0;
let level = 0;

function restMark() {
  cancelAnimationFrame(raf);
  level = 0;
  state.vad = 0;
  state.vadActive = false;
  mark.dataset.level = '0';
  mark.dataset.speech = 'false';
  markScale.setAttribute('transform', 'translate(100 100) scale(1) translate(-100 -100)');
  windowRect.setAttribute('y', '18');
  windowRect.setAttribute('height', '52');
  halo.setAttribute('x', '1');
  halo.setAttribute('y', '1');
  halo.setAttribute('width', '198');
  halo.setAttribute('height', '198');
  levelReadout.textContent = '0.00';
}

function animate(analyser) {
  const samples = new Float32Array(analyser.fftSize);
  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    const target = Math.max(Math.min(1, rms / 0.12), state.vadActive ? state.vad : 0);
    level += (target - level) * 0.28;
    const scale = 1 + level * 0.07;
    markScale.setAttribute(
      'transform',
      `translate(100 100) scale(${scale.toFixed(4)}) translate(-100 -100)`,
    );
    windowRect.setAttribute('y', (18 - level * 6).toFixed(1));
    windowRect.setAttribute('height', (52 + level * 48).toFixed(1));
    const inset = 1 - level * 8;
    halo.setAttribute('x', String(inset));
    halo.setAttribute('y', String(inset));
    halo.setAttribute('width', String(200 - inset * 2));
    halo.setAttribute('height', String(200 - inset * 2));
    mark.dataset.level = level.toFixed(3);
    mark.dataset.speech = state.vadActive ? 'true' : 'false';
    levelReadout.textContent = level.toFixed(2);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

async function startCapture() {
  if (!state.ready || state.live) return;
  showError('');
  const micPromise = synthetic
    ? null
    : navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
        },
      });
  const context = new AudioContext({ latencyHint: 'interactive' });
  await context.resume();
  let stream = null;
  let source;
  let extraStop = () => {};
  try {
    if (synthetic) {
      const osc = context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 132;
      const osc2 = context.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = 198;
      const gain = context.createGain();
      gain.gain.value = 0.2;
      const lfo = context.createOscillator();
      lfo.frequency.value = 2.4;
      const depth = context.createGain();
      depth.gain.value = 0.15;
      lfo.connect(depth);
      depth.connect(gain.gain);
      osc.connect(gain);
      osc2.connect(gain);
      osc.start();
      osc2.start();
      lfo.start();
      source = gain;
      extraStop = () => {
        osc.stop();
        osc2.stop();
        lfo.stop();
      };
    } else {
      stream = await micPromise;
      source = context.createMediaStreamSource(stream);
    }
  } catch (error) {
    await context.close();
    const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    showError(
      denied
        ? 'Microphone permission was denied, so capture has not started. Nothing is being recorded.'
        : `The microphone is not available, so capture has not started. ${error?.message || ''}`.trim(),
    );
    setStatus('The microphone is off.');
    return;
  }
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const mute = context.createGain();
  mute.gain.value = 0;
  analyser.connect(mute);
  mute.connect(context.destination);
  await context.audioWorklet.addModule(new URL('./vad-processor.js', import.meta.url));
  const worklet = new AudioWorkletNode(context, 'vad-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'discrete',
  });
  source.connect(worklet);
  worklet.port.onmessage = (event) => {
    const buffer = event.data?.buffer;
    if (!buffer || !state.worker || !state.live) return;
    const copy = new Float32Array(buffer);
    state.worker.postMessage({ type: 'audio', buffer: copy }, [copy.buffer]);
  };
  audioHandle = {
    context,
    stream,
    stop() {
      extraStop();
      stream?.getTracks().forEach((track) => track.stop());
      worklet.disconnect();
      source.disconnect();
    },
  };
  state.sessionStart = Date.now();
  state.live = true;
  await setPhase('live');
  state.worker.postMessage({ type: 'listen', on: true });
  animate(analyser);
  micButton.textContent = synthetic ? 'Stop synthetic audio' : 'Stop microphone';
  setStatus(
    synthetic
      ? 'Synthetic audio is on. The microphone is not open.'
      : 'The microphone is on. Speech is segmented on this device.',
  );
  renderNetwork();
}

async function stopCapture() {
  state.live = false;
  state.worker?.postMessage({ type: 'listen', on: false });
  audioHandle?.stop();
  await audioHandle?.context.close();
  audioHandle = null;
  restMark();
  await setPhase('ready');
  micButton.textContent = synthetic ? 'Start synthetic audio' : 'Start microphone';
  setStatus('Capture stopped. The model stays in this browser.');
  renderNetwork();
}

loadButton.addEventListener('click', () => {
  loadDemo().catch((error) => {
    state.loading = false;
    loadButton.disabled = false;
    loadButton.textContent = 'Try again (~160 MB)';
    showError(`The model did not load, so transcription has not started. ${error.message}`);
  });
});

micButton.addEventListener('click', () => {
  if (state.live) {
    stopCapture();
    return;
  }
  startCapture().catch((error) => {
    showError(`Capture did not start. ${error?.message || ''}`.trim());
    setStatus('The microphone is off.');
  });
});

if (synthetic) {
  consent.textContent =
    'This URL uses a generated tone instead of the microphone, so capture can be tried without a mic. The microphone is not opened. Audio still stays in this browser.';
  micButton.textContent = 'Start synthetic audio';
}

async function noteExistingCache() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    const onnx = keys.filter(
      (request) =>
        /moonshine-base-ONNX|silero-vad/.test(request.url) && request.url.endsWith('.onnx'),
    );
    if (onnx.length) {
      cacheHint.textContent =
        'Weight files are already in this browser cache, so this click should load them from there instead of downloading about 160 MB again.';
    }
  } catch {
    /* the standing explanation still tells the reader what a first visit does */
  }
}

setStatus('Waiting. The download has not started.');
renderNetwork();
noteExistingCache();
sizeNote.dataset.ready = 'true';

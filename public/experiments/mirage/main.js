import { createVisionBlock } from './vision-block.js';
import { decide, groupObjects, percent, readingOrder } from './rules.js';
import { createLedger, formatBytes, installNetworkHooks, resourceFromEntry, watchResources } from './observe.js';
import { mirageMotion as motion } from './motion.js';

const MODEL_HREF = new URL('models/mirage/3d03cee88c0acbe4e71b94b567ab14e6e55f40c9/mirage.cact', document.baseURI).href;
const WASM_HREF = new URL('vendor/cactus.wasm', document.baseURI).href;
const MODEL_CACHE = 'mirage-model';
const MODEL_BYTES = 21611043;
const MAX_EDGE = 1600;
const SIZE_LABEL = formatBytes(MODEL_BYTES);

const params = new URLSearchParams(location.search);
const runProbe = params.get('run-probe') === '1';
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const reducedMedia = matchMedia('(prefers-reduced-motion: reduce)');
const narrowMedia = matchMedia('(max-width: 720px)');

const stage = document.querySelector('#stage');
const frame = document.querySelector('#frame');
const canvas = document.querySelector('#mark');
const overlay = document.querySelector('#overlay');
const block = createVisionBlock(canvas, overlay);
const actionButton = document.querySelector('#action');
const actionHint = document.querySelector('#action-hint');
const statusLine = document.querySelector('#status');
const progressWrap = document.querySelector('#progress-wrap');
const progressBar = document.querySelector('#progress-bar');
const progressLabel = document.querySelector('#progress-label');
const errorLine = document.querySelector('#vision-error');
const decisionEmpty = document.querySelector('#decision-empty');
const decisionBody = document.querySelector('#decision-body');
const verdict = document.querySelector('#verdict');
const because = document.querySelector('#because');
const ruleLine = document.querySelector('#rule-line');
const objectRows = document.querySelector('#object-rows');
const textRows = document.querySelector('#text-rows');
const scaleNote = document.querySelector('#scale-note');
const fileInput = document.querySelector('#file');
const swNote = document.querySelector('#sw-note');
const requestList = document.querySelector('#requests');
const runRequestList = document.querySelector('#run-requests');
const pageCount = document.querySelector('#page-count');
const pageBytes = document.querySelector('#page-bytes');
const modelCount = document.querySelector('#model-count');
const modelBytes = document.querySelector('#model-bytes');
const runCount = document.querySelector('#run-count');
const runBytes = document.querySelector('#run-bytes');
const runRow = document.querySelector('#net-run');

const ledger = createLedger();
const state = {
  phase: 'page',
  worker: null,
  loading: false,
  ready: false,
  cached: false,
  loadFailed: false,
  ran: false,
  running: false,
  image: null,
  label: 'Wireframe block',
  hot: null,
  keyboard: false,
  held: false,
  interacted: false,
  scrollArmed: false,
};

installNetworkHooks((event) => {
  if (!event.phase) {
    event.phase = ledger.phaseAt(event.started || Date.now());
    event.phaseRank = 2;
  }
  ledger.absorb(event);
}, () => state.phase);

function absorbResource(entry) {
  const event = resourceFromEntry(entry);
  event.phase = ledger.phaseAt(event.started || Date.now());
  event.phaseRank = 1;
  ledger.absorb(event);
}
for (const entry of performance.getEntriesByType('resource')) absorbResource(entry);
for (const entry of performance.getEntriesByType('navigation')) absorbResource(entry);
watchResources((event) => {
  event.phase = ledger.phaseAt(event.started || Date.now());
  event.phaseRank = 1;
  ledger.absorb(event);
});
ledger.onChange(renderNetwork);

function setStatus(text) {
  statusLine.textContent = text;
}

function showError(text) {
  errorLine.textContent = text || '';
  errorLine.classList.toggle('show', Boolean(text));
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
    channel.port1.onmessage = () => { clearTimeout(timer); resolve(); };
    controller.postMessage({ source: 'exo-net', type: 'phase', phase }, [channel.port2]);
  });
}

function sumPhase(phase) {
  const rows = ledger.rows.filter((row) => row.phase === phase);
  let transferred = 0;
  let known = 0;
  let declared = 0;
  let declaredKnown = 0;
  for (const row of rows) {
    if (row.transferBytes != null) {
      transferred += row.transferBytes;
      known += 1;
    }
    if (row.declaredBytes != null) {
      declared += row.declaredBytes;
      declaredKnown += 1;
    }
  }
  return { count: rows.length, transferred, known, declared, declaredKnown, rows };
}

function runTransferred(stats) {
  if (stats.transferred > 0) return exactBytes(stats.transferred);
  if (stats.declared > 0) return exactBytes(stats.declared);
  if (stats.known) return exactBytes(stats.transferred);
  return stats.count ? 'n/a' : '0 B';
}

function exactBytes(value) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return `${Math.round(value)} B`;
}

function renderNetwork() {
  const page = sumPhase('page');
  const model = sumPhase('model');
  const run = sumPhase('run');
  pageCount.textContent = String(page.count);
  pageBytes.textContent = page.known ? formatBytes(page.transferred) : page.count ? 'n/a' : '0 B';
  modelCount.textContent = String(model.count);
  modelBytes.textContent = model.known ? formatBytes(model.transferred) : model.count ? 'n/a' : '0 B';
  runCount.textContent = String(run.count);
  runBytes.textContent = runTransferred(run);
  runRow.classList.toggle('warn', run.count > 0);
  runRequestList.replaceChildren();
  if (!run.rows.length) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.textContent = 'No requests while running.';
    runRequestList.append(empty);
  } else {
    for (const row of run.rows) runRequestList.append(requestItem(row));
  }
  requestList.replaceChildren();
  if (!ledger.rows.length) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.textContent = 'No requests yet.';
    requestList.append(empty);
    return;
  }
  for (const row of ledger.rows) requestList.append(requestItem(row));
}

function requestItem(row) {
  const item = document.createElement('article');
  item.className = 'req';
  const title = document.createElement('p');
  title.className = 'req-title';
  let host = row.url;
  try { host = new URL(row.url).host; } catch { /* keep the raw url */ }
  title.textContent = `${row.phase} · ${host}`;
  const meta = document.createElement('p');
  meta.className = 'meta';
  const transferred = row.transferBytes == null ? 'transferred n/a' : `transferred ${row.phase === 'run' ? exactBytes(row.transferBytes) : formatBytes(row.transferBytes)}`;
  meta.textContent = `${row.method || 'GET'} · ${transferred}`;
  const path = document.createElement('p');
  path.className = 'path';
  try {
    const url = new URL(row.url);
    path.textContent = `${url.pathname}${url.search}`;
  } catch {
    path.textContent = row.url;
  }
  item.append(title, meta, path);
  return item;
}

function renderAction() {
  const needsImage = state.ready && !state.image;
  actionButton.disabled = state.loading || state.running || needsImage;
  actionButton.textContent = state.loadFailed && !state.ready
    ? 'Retry download'
    : state.ready
      ? (state.ran ? 'Run again' : 'Run')
      : state.cached
        ? 'Load model'
        : 'Download model';
  if (!state.image && state.ready) actionHint.textContent = 'Choose an image first';
  else if (state.running) actionHint.textContent = 'Reading this image on this device.';
  else if (state.ready) actionHint.textContent = 'Your image never leaves this device. After the model is saved, running it makes no network requests.';
  else if (state.cached) actionHint.textContent = 'Uses the model already saved in this browser. Your image never leaves this device.';
  else actionHint.textContent = `${SIZE_LABEL} once, then saved in your browser. Your image never leaves this device.`;
}

function stageLength(name) {
  const value = parseFloat(getComputedStyle(stage).getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

function fitFrame() {
  const well = frame.parentElement;
  const styles = getComputedStyle(well);
  const pad = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const column = Math.max(120, well.clientWidth - pad);
  const maxH = stageLength('--mirage-well-max');
  if (!state.image) {
    frame.style.width = '100%';
    frame.style.height = `${stageLength('--mirage-frame-empty')}px`;
    return;
  }
  const aspect = state.image.width / state.image.height;
  let width = column;
  let height = width / aspect;
  if (height > maxH) {
    height = maxH;
    width = Math.min(column, height * aspect);
    height = width / aspect;
  }
  frame.style.width = `${Math.round(width)}px`;
  frame.style.height = `${Math.round(height)}px`;
}

function measureTop() {
  const top = document.querySelector('.stage-top');
  if (top) stage.style.setProperty('--stage-top-height', `${top.offsetHeight}px`);
}

async function raster(source) {
  const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const board = document.createElement('canvas');
  board.width = width;
  board.height = height;
  const ctx = board.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let index = 0, write = 0; index < pixels.length; index += 4) {
    rgb[write++] = pixels[index];
    rgb[write++] = pixels[index + 1];
    rgb[write++] = pixels[index + 2];
  }
  if (!(source instanceof ImageBitmap)) bitmap.close();
  return { rgb, width, height, preview: board, scaled: scale < 1 };
}

async function setImage(source, label) {
  showError('');
  const image = await raster(source);
  state.image = image;
  state.label = label;
  canvas.setAttribute('aria-label', label);
  scaleNote.hidden = !image.scaled;
  scaleNote.textContent = image.scaled ? `Scaled to ${MAX_EDGE} px on the long side.` : '';
  fitFrame();
  block.setImage(image.preview, image.width / image.height);
  block.clearBoxes();
  clearResults();
  renderAction();
}

function clearResults() {
  decisionBody.hidden = true;
  decisionBody.classList.remove('show');
  decisionEmpty.hidden = false;
  verdict.textContent = '';
  because.replaceChildren();
  ruleLine.textContent = '';
  objectRows.replaceChildren();
  textRows.replaceChildren();
}

function selectThumb(name) {
  document.querySelectorAll('.thumb').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.sample === name));
  });
}

async function chooseSample(button) {
  const image = button.querySelector('img');
  selectThumb(button.dataset.sample);
  await setImage(image, `${image.alt}, sample`);
}

function sniff(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return '';
}

async function useFile(file) {
  const known = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const kind = known.has(file.type) ? file.type : sniff(header);
  if (!known.has(kind)) {
    showError("That file isn't an image. Use a JPG, PNG or WebP.");
    return;
  }
  try {
    selectThumb('');
    await setImage(file, 'Your image');
  } catch {
    showError("That file isn't an image. Use a JPG, PNG or WebP.");
  }
}

function ensureWorker() {
  if (state.worker) return state.worker;
  const worker = new Worker(new URL('vision-worker.js', import.meta.url));
  state.worker = worker;
  worker.addEventListener('message', (event) => {
    if (state.worker !== worker) return;
    onWorker(event.data || {});
  });
  worker.addEventListener('error', () => {
    if (state.worker === worker) failLoad('The vision worker stopped.');
  });
  return worker;
}

function failLoad(message) {
  state.loading = false;
  state.ready = false;
  state.loadFailed = true;
  state.running = false;
  progressWrap.hidden = true;
  state.worker?.terminate();
  state.worker = null;
  block.fail();
  showError(message || 'The model did not load.');
  setStatus("Couldn't load");
  renderAction();
  void setPhase('page');
}

async function loadModel() {
  if (state.loading || state.ready) return;
  const retrying = state.loadFailed;
  state.loading = true;
  state.loadFailed = false;
  showError('');
  if (retrying) block.recover();
  progressWrap.hidden = false;
  progressBar.value = 0;
  const cached = state.cached;
  const opening = cached ? 'Loading' : 'Downloading 0%';
  progressLabel.textContent = opening;
  setStatus(opening);
  renderAction();
  await setPhase('model');
  block.startDownload();
  const worker = ensureWorker();
  worker.postMessage({ type: 'phase', phase: 'model' });
  worker.postMessage({ type: 'load', modelUrl: MODEL_HREF, wasmUrl: WASM_HREF });
}

function onWorker(data) {
  if (data.type === 'network') ledger.absorb(data.event);
  if (data.type === 'progress') {
    const headerTotal = Number.isFinite(data.total) && data.total > 0 ? data.total : 0;
    const total = headerTotal || (data.loaded > 0 && data.loaded <= MODEL_BYTES ? MODEL_BYTES : 0);
    const known = total > 0;
    if (data.fromCache && data.elapsed != null && data.elapsed < motion.instantThreshold) {
      block.showCachedGrid();
      progressBar.value = 100;
      progressLabel.textContent = 'Loading 100%';
      setStatus('Loading 100%');
      return;
    }
    if (!known) {
      progressLabel.textContent = data.fromCache ? 'Loading' : 'Downloading';
      setStatus(data.fromCache ? 'Loading' : 'Downloading');
      return;
    }
    const ratio = data.loaded / total;
    block.setProgress(ratio, true);
    progressBar.value = Math.round(ratio * 100);
    const label = `${data.fromCache ? 'Loading' : 'Downloading'} ${Math.round(ratio * 100)}%`;
    progressLabel.textContent = label;
    setStatus(label);
  }
  if (data.type === 'ready') {
    state.ready = true;
    state.loading = false;
    state.loadFailed = false;
    state.cached = true;
    progressWrap.hidden = true;
    block.setProgress(1, true);
    setStatus('Ready');
    renderAction();
    void setPhase('page');
  }
  if (data.type === 'stage' && data.state === 'start') {
    setStatus(data.name === 'text' ? 'Reading text' : 'Finding objects');
    block.beginStage(false);
  }
  if (data.type === 'stage' && data.state === 'end') block.endStage();
  if (data.type === 'result') showResult(data);
  if (data.type === 'error') {
    if (data.during === 'run') {
      state.running = false;
      block.endStage();
      block.fail();
      showError('This image could not be read. Press Run again.');
      setStatus('Ready');
      renderAction();
      void setPhase('page');
    } else failLoad(data.message);
  }
}

function showResult(data) {
  state.running = false;
  state.ran = true;
  const objects = (data.objects || []).map((item, index) => ({ ...item, id: `object-${index + 1}` }));
  const text = readingOrder((data.text || []).map((item, index) => ({ ...item, id: `text-${index + 1}` })));
  const decision = decide({ objects, text }, new Date());
  const seconds = Math.max(0, data.ms || 0) / 1000;
  setStatus(`Done in ${seconds.toFixed(1)} s`);
  renderDecision(decision);
  renderObjects(objects);
  renderText(text);
  const boxes = [
    ...objects.map((item) => ({ id: item.id, kind: 'object', name: item.name || 'object', bbox: item.bbox, score: item.score, percent: percent(item.score), group: item.name || 'object' })),
    ...text.map((item) => ({ id: item.id, kind: 'text', name: item.string || 'text', bbox: item.bbox, score: item.score, percent: percent(item.score), group: '' })),
  ];
  block.showBoxes(boxes);
  renderAction();
  void setPhase('page');
  maybeScroll();
}

function renderDecision(decision) {
  decisionEmpty.hidden = true;
  decisionBody.hidden = false;
  verdict.textContent = decision.verdict;
  ruleLine.textContent = decision.rule;
  because.replaceChildren();
  for (const line of decision.because) {
    if (!line.id) {
      const paragraph = document.createElement('p');
      paragraph.className = 'because';
      paragraph.textContent = line.text;
      because.append(paragraph);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'because';
    button.dataset.id = line.id;
    button.textContent = line.text;
    because.append(button);
  }
  if (reducedMedia.matches) decisionBody.classList.add('show');
  else requestAnimationFrame(() => decisionBody.classList.add('show'));
}

function renderObjects(objects) {
  objectRows.replaceChildren();
  const groups = groupObjects(objects);
  const limit = objectRows.dataset.expanded === 'true' ? groups.length : 8;
  groups.slice(0, limit).forEach((group) => objectRows.append(objectRow(group)));
  const rest = groups.length - limit;
  if (rest > 0) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more';
    more.textContent = `and ${rest} more`;
    more.addEventListener('click', () => {
      objectRows.dataset.expanded = 'true';
      renderObjects(objects);
    });
    objectRows.append(more);
  }
}

function objectRow(group) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'evidence-row object-row';
  button.dataset.id = group.bestId;
  button.dataset.group = group.name;
  const name = document.createElement('span');
  name.textContent = group.name;
  const count = document.createElement('span');
  count.className = 'meta';
  count.textContent = String(group.count);
  const score = document.createElement('span');
  score.className = 'meta';
  score.textContent = `${percent(group.score)}%`;
  button.append(name, count, score);
  return button;
}

function renderText(lines) {
  textRows.replaceChildren();
  for (const line of lines) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'evidence-row text-row';
    button.dataset.id = line.id;
    const copy = document.createElement('span');
    copy.textContent = line.string || '(blank)';
    const score = document.createElement('span');
    score.className = 'meta';
    score.textContent = `${percent(line.score)}%`;
    button.append(copy, score);
    textRows.append(button);
  }
}

function maybeScroll() {
  if (state.interacted) return;
  const heading = document.querySelector('#decision-heading');
  const rect = heading.getBoundingClientRect();
  const off = rect.bottom <= 0 || rect.top >= window.innerHeight;
  if (!off) return;
  heading.scrollIntoView({ behavior: reducedMedia.matches ? 'auto' : 'smooth', block: 'start' });
}

function armScroll() {
  state.interacted = false;
  if (state.scrollArmed) return;
  state.scrollArmed = true;
  const mark = () => { state.interacted = true; };
  window.addEventListener('scroll', mark, { capture: true, passive: true });
  window.addEventListener('wheel', mark, { passive: true });
  window.addEventListener('touchstart', mark, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) mark();
  });
}

async function runImage() {
  if (!state.ready || !state.image || state.running) return;
  state.running = true;
  showError('');
  block.recover();
  renderAction();
  await setPhase('run');
  if (runProbe) {
    const probe = fetch(new URL('run-probe.txt', document.baseURI).href);
    probe.catch(() => {});
  }
  const copy = state.image.rgb.slice();
  state.worker.postMessage({ type: 'run', width: state.image.width, height: state.image.height, buffer: copy.buffer }, [copy.buffer]);
  setTimeout(armScroll, 0);
}

function applyHot(id, instant) {
  state.hot = id || null;
  stage.classList.toggle('instant', Boolean(instant));
  const nodes = stage.querySelectorAll('[data-id]');
  nodes.forEach((node) => {
    if (!node.dataset.id) return;
    const group = node.dataset.group;
    const sameGroup = Boolean(
      group
      && node.classList.contains('object-row')
      && stage.querySelector(`[data-id="${CSS.escape(id)}"]`)?.dataset.group === group,
    );
    const on = Boolean(id) && (node.dataset.id === id || sameGroup);
    node.classList.toggle('is-hot', Boolean(on));
    node.classList.toggle('is-dim', Boolean(
      id && !on && (node.classList.contains('box') || node.classList.contains('tag') || node.classList.contains('box-hit')),
    ));
  });
  block.setHot(id);
}

async function registerObserver() {
  if (!('serviceWorker' in navigator)) {
    swNote.textContent = 'Service workers are not available here. Resource timing and the fetch wrappers are still recording.';
    return;
  }
  try {
    await navigator.serviceWorker.register('sw.js');
    await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
    swNote.textContent = navigator.serviceWorker.controller
      ? 'The service worker is controlling this page. It records worker fetches and serves the saved page shell.'
      : 'The service worker is registered. Wrappers and resource timing still record requests.';
  } catch (error) {
    swNote.textContent = `The service worker did not register (${error.message}). Wrappers and resource timing are still recording.`;
  }
}

async function noteCache() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(MODEL_CACHE);
    state.cached = Boolean(await cache.match(MODEL_HREF));
    renderAction();
  } catch { /* Download model remains available. */ }
}

document.querySelectorAll('.thumb').forEach((button) => {
  button.addEventListener('click', () => { void chooseSample(button); });
});
document.querySelector('#own').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void useFile(file);
});
actionButton.addEventListener('click', () => {
  if (actionButton.disabled) return;
  if (!state.ready) {
    loadModel().catch((error) => failLoad(error.message));
    return;
  }
  runImage().catch((error) => {
    state.running = false;
    showError(error.message || 'This image could not be read. Press Run again.');
    renderAction();
  });
});

stage.addEventListener('pointerover', (event) => {
  if (!finePointer.matches) return;
  const id = event.target.closest?.('[data-id]')?.dataset.id;
  if (id) applyHot(id, false);
});
stage.addEventListener('pointerout', (event) => {
  if (!finePointer.matches || state.held) return;
  const next = event.relatedTarget?.closest?.('[data-id]');
  if (!next) applyHot(null, false);
});
stage.addEventListener('focusin', (event) => {
  const id = event.target.closest?.('[data-id]')?.dataset.id;
  if (id) applyHot(id, state.keyboard);
});
stage.addEventListener('focusout', (event) => {
  const next = event.relatedTarget?.closest?.('[data-id]');
  if (!next) applyHot(null, state.keyboard);
});
stage.addEventListener('pointerup', (event) => {
  if (finePointer.matches) return;
  const id = event.target.closest?.('[data-id]')?.dataset.id;
  if (!id) return;
  state.held = true;
  applyHot(id, false);
});
document.addEventListener('pointerdown', (event) => {
  state.keyboard = false;
  if (finePointer.matches || !state.held) return;
  if (!event.target.closest?.('[data-id]')) {
    state.held = false;
    applyHot(null, false);
  }
});
document.addEventListener('keydown', () => { state.keyboard = true; });
narrowMedia.addEventListener('change', fitFrame);
window.addEventListener('resize', () => { fitFrame(); measureTop(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.source === 'exo-net' && event.data.event) ledger.absorb(event.data.event);
  });
}

setStatus('Model not loaded');
renderAction();
renderNetwork();
measureTop();
fitFrame();
registerObserver();
noteCache();

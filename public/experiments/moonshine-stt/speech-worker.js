/*
 * Speech segmentation and Moonshine transcription.
 * Adapted from worker.js in huggingface/transformers.js-examples
 * moonshine-web, licensed under the Apache License, Version 2.0.
 * See ../../licenses/moonshine-web-Apache-2.0.txt
 *
 * Changes: weights load only after a message from the page, WebGPU is
 * reported and WASM is used when WebGPU is missing or fails, progress and
 * Cache Storage hits are reported, and audio buffers are not posted back.
 */

import { installNetworkHooks, watchResources } from './observe.js';

const MODEL_ID = 'onnx-community/moonshine-base-ONNX';
const VAD_ID = 'onnx-community/silero-vad';
const CACHE_NAME = 'transformers-cache';
const RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';
const DEVICE_DTYPE = {
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  wasm: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
};

const SAMPLE_RATE = 16000;
const SPEECH_THRESHOLD = 0.3;
const EXIT_THRESHOLD = 0.1;
const MIN_SILENCE_DURATION_SAMPLES = 400 * (SAMPLE_RATE / 1000);
const SPEECH_PAD_SAMPLES = 80 * (SAMPLE_RATE / 1000);
const MIN_SPEECH_DURATION_SAMPLES = 250 * (SAMPLE_RATE / 1000);
const MAX_BUFFER_DURATION = 30;
const NEW_BUFFER_SIZE = 512;
const MAX_NUM_PREV_BUFFERS = Math.ceil(SPEECH_PAD_SAMPLES / NEW_BUFFER_SIZE);

let phase = 'loading';
const seenUrls = [];

installNetworkHooks((event) => {
  if (event.url) seenUrls.push(event.url);
  if (event.responseURL) seenUrls.push(event.responseURL);
  event.phase = event.phase || phase;
  event.phaseRank = event.phaseRank || 3;
  self.postMessage({ type: 'network', event });
}, () => phase);

watchResources((event) => {
  if (event.url) seenUrls.push(event.url);
  event.phase = phase;
  event.phaseRank = 1;
  self.postMessage({ type: 'network', event });
});

function errorMessage(error) {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

async function supportsWebGPU() {
  try {
    if (!navigator.gpu) return false;
    return !!(await navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function snapshotCache() {
  const urls = [];
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    for (const request of keys) urls.push(request.url);
    return { urls, error: '' };
  } catch (error) {
    return { urls, error: errorMessage(error) };
  }
}

function plainProgress(progress) {
  return {
    status: progress?.status || '',
    name: progress?.name || '',
    file: progress?.file || '',
    progress: typeof progress?.progress === 'number' ? progress.progress : null,
    loaded: typeof progress?.loaded === 'number' ? progress.loaded : null,
    total: typeof progress?.total === 'number' ? progress.total : null,
  };
}

const readBytes = new Map();
let cacheBefore = [];

function wasCached(name, file, url) {
  return cacheBefore.some(
    (cached) =>
      cached === url ||
      (cached.includes(`/${name}/`) &&
        (cached.endsWith(`/${file}`) || cached.includes(`/${file}?`))),
  );
}

async function reportFile(name, file) {
  const url = `https://huggingface.co/${name}/resolve/main/${file}`;
  const key = `${name}/${file}`;
  const remembered = readBytes.get(key) || {};
  let headerBytes = null;
  let inCacheNow = false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url);
    if (cached) {
      inCacheNow = true;
      const length = Number(cached.headers.get('content-length'));
      if (Number.isFinite(length) && length > 0) headerBytes = length;
    }
  } catch {
    /* classification still uses the before-snapshot and the request log */
  }
  self.postMessage({
    type: 'model-file',
    name,
    file,
    url,
    inCacheBefore: wasCached(name, file, url),
    inCacheNow,
    workerSawNetwork: seenUrls.some(
      (seen) => seen.includes(`/${file}`) || seen.endsWith(file),
    ),
    headerBytes,
    readBytes: remembered.total || remembered.loaded || null,
    cacheError: '',
  });
}

function forwardProgress(progress) {
  const plain = plainProgress(progress);
  if (plain.file) {
    const key = `${plain.name}/${plain.file}`;
    const prev = readBytes.get(key) || {};
    if (plain.loaded != null) prev.loaded = plain.loaded;
    if (plain.total != null) prev.total = plain.total;
    readBytes.set(key, prev);
  }
  self.postMessage({ type: 'progress', progress: plain });
  if (plain.status === 'done' && plain.file && plain.name) {
    reportFile(plain.name, plain.file);
  }
}

let transformers = null;
let silero = null;
let transcriber = null;
let device = 'wasm';
let ready = false;
let listening = false;
let inferenceChain = Promise.resolve();
const BUFFER = new Float32Array(MAX_BUFFER_DURATION * SAMPLE_RATE);
let bufferPointer = 0;
let state = null;
let sr = null;
let isRecording = false;
let postSpeechSamples = 0;
let prevBuffers = [];

function reset(offset = 0) {
  self.postMessage({
    type: 'status',
    status: 'recording_end',
    message: 'Transcribing',
  });
  BUFFER.fill(0, offset);
  bufferPointer = offset;
  isRecording = false;
  postSpeechSamples = 0;
}

async function vad(buffer) {
  const input = new transformers.Tensor('float32', buffer, [1, buffer.length]);
  const result = await (inferenceChain = inferenceChain.then(() =>
    silero({ input, sr, state }),
  ));
  state = result.stateN;
  return result.output.data[0];
}

function transcribe(buffer, meta) {
  inferenceChain = inferenceChain.then(async () => {
    const { text } = await transcriber(buffer);
    self.postMessage({ type: 'output', text: text || '', ...meta });
  });
}

function dispatchForTranscription(overflow) {
  const now = Date.now();
  const end =
    now - ((postSpeechSamples + SPEECH_PAD_SAMPLES) / SAMPLE_RATE) * 1000;
  const start = end - (bufferPointer / SAMPLE_RATE) * 1000;
  const overflowLength = overflow?.length ?? 0;
  const speech = BUFFER.slice(0, bufferPointer + SPEECH_PAD_SAMPLES);
  const prevLength = prevBuffers.reduce((sum, chunk) => sum + chunk.length, 0);
  const padded = new Float32Array(prevLength + speech.length);
  let offset = 0;
  for (const prev of prevBuffers) {
    padded.set(prev, offset);
    offset += prev.length;
  }
  padded.set(speech, offset);
  prevBuffers = [];
  transcribe(padded, { start, end, duration: end - start });
  if (overflow) BUFFER.set(overflow, 0);
  reset(overflowLength);
}

async function onAudio(buffer) {
  if (!(buffer instanceof Float32Array) || buffer.length !== NEW_BUFFER_SIZE) return;
  const wasRecording = isRecording;
  const probability = await vad(buffer);
  const isSpeech =
    probability > SPEECH_THRESHOLD || (isRecording && probability >= EXIT_THRESHOLD);
  self.postMessage({
    type: 'vad',
    probability,
    active: isSpeech || isRecording,
  });

  if (!wasRecording && !isSpeech) {
    if (prevBuffers.length >= MAX_NUM_PREV_BUFFERS) prevBuffers.shift();
    prevBuffers.push(new Float32Array(buffer));
    return;
  }

  const remaining = BUFFER.length - bufferPointer;
  if (buffer.length >= remaining) {
    BUFFER.set(buffer.subarray(0, remaining), bufferPointer);
    bufferPointer += remaining;
    dispatchForTranscription(buffer.subarray(remaining));
    return;
  }
  BUFFER.set(buffer, bufferPointer);
  bufferPointer += buffer.length;

  if (isSpeech) {
    if (!isRecording) {
      self.postMessage({
        type: 'status',
        status: 'recording_start',
        message: 'Listening',
      });
    }
    isRecording = true;
    postSpeechSamples = 0;
    return;
  }

  postSpeechSamples += buffer.length;
  if (postSpeechSamples < MIN_SILENCE_DURATION_SAMPLES) return;
  if (bufferPointer < MIN_SPEECH_DURATION_SAMPLES) {
    reset();
    return;
  }
  dispatchForTranscription();
}

async function loadModels(nextDevice, env) {
  const progress_callback = (progress) => forwardProgress(progress);
  silero = await transformers.AutoModel.from_pretrained(VAD_ID, {
    config: { model_type: 'custom' },
    dtype: 'fp32',
    device: 'wasm',
    progress_callback,
  });
  transcriber = await transformers.pipeline(
    'automatic-speech-recognition',
    MODEL_ID,
    {
      device: nextDevice,
      dtype: DEVICE_DTYPE[nextDevice],
      progress_callback,
    },
  );
  await transcriber(new Float32Array(SAMPLE_RATE));
  device = nextDevice;
  if (env) {
    /* env is configured by the caller before either attempt */
  }
}

async function runLoad(forceWasm) {
  const snap = await snapshotCache();
  cacheBefore = snap.urls;
  self.postMessage({ type: 'cache-snapshot', ...snap });
  transformers = await import(RUNTIME_URL);
  const { env, Tensor } = transformers;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;
  const webgpu = !forceWasm && (await supportsWebGPU());
  if (webgpu) {
    self.postMessage({ type: 'device', device: 'webgpu', webgpu: true, reason: 'adapter' });
  } else {
    self.postMessage({
      type: 'device',
      device: 'wasm',
      webgpu: false,
      reason: forceWasm ? 'forced' : 'no-adapter',
    });
  }
  sr = new Tensor('int64', [SAMPLE_RATE], []);
  state = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
  try {
    await loadModels(webgpu ? 'webgpu' : 'wasm', env);
  } catch (error) {
    if (!webgpu) throw error;
    self.postMessage({
      type: 'device',
      device: 'wasm',
      webgpu: true,
      reason: 'webgpu-failed',
      detail: errorMessage(error),
    });
    silero = null;
    transcriber = null;
    await loadModels('wasm', env);
  }
  ready = true;
  self.postMessage({ type: 'ready', device });
}

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === 'phase') {
    phase = data.phase;
    return;
  }
  if (data.type === 'listen') {
    listening = !!data.on;
    return;
  }
  if (data.type === 'load') {
    runLoad(!!data.forceWasm).catch((error) => {
      self.postMessage({ type: 'error', message: errorMessage(error) });
    });
    return;
  }
  if (data.type === 'audio' && ready && listening) {
    const buffer =
      data.buffer instanceof Float32Array
        ? data.buffer
        : new Float32Array(data.buffer);
    onAudio(buffer).catch((error) => {
      self.postMessage({ type: 'error', message: errorMessage(error) });
    });
  }
};

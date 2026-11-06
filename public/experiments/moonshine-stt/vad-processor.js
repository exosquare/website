/*
 * Audio chunking for Silero VAD.
 * Adapted from processor.js in huggingface/transformers.js-examples
 * moonshine-web, licensed under the Apache License, Version 2.0.
 * See ../../licenses/moonshine-web-Apache-2.0.txt
 *
 * Changed: downsample to 16 kHz so Moonshine and Silero receive the
 * rate they expect when the browser keeps a different AudioContext rate.
 */

const TARGET_RATE = 16000;
const CHUNK = 512;

class VADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.carry = 0;
    this.bucket = 0;
    this.count = 0;
    this.chunk = new Float32Array(CHUNK);
    this.filled = 0;
  }

  emit(sample) {
    this.chunk[this.filled++] = sample;
    if (this.filled < CHUNK) return;
    const buffer = this.chunk;
    this.chunk = new Float32Array(CHUNK);
    this.filled = 0;
    this.port.postMessage({ buffer });
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.bucket += input[i];
      this.count += 1;
      this.carry += 1;
      if (this.carry >= this.ratio) {
        this.carry -= this.ratio;
        this.emit(this.bucket / this.count);
        this.bucket = 0;
        this.count = 0;
      }
    }
    return true;
  }
}

registerProcessor('vad-processor', VADProcessor);

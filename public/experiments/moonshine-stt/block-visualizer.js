// A rounded cube built from square grids. Canvas projection keeps the visual
// independent of the speech model and avoids a second GPU rendering runtime.
export function createBlockVisualizer(canvas) {
  const context = canvas.getContext('2d');
  if (!context) {
    canvas.setAttribute('aria-label', 'Visualization unavailable. Speech recognition still works.');
    return { connect() {}, disconnect() {}, destroy() {} };
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reducedMotion.matches;
  let analyser = null;
  let samples;
  let frequencies;
  let voice = () => false;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let lastReadout = 0;
  let width = 0;
  let height = 0;
  let visible = true;
  let amplitude = 0;
  const bands = [0, 0, 0];
  const points = [];
  const edges = [];
  const divisions = 22;

  // An L8 surface rounds only the corners: the silhouette remains a block.
  for (let face = 0; face < 6; face++) {
    const offset = points.length;
    const axis = Math.floor(face / 2);
    for (let row = 0; row <= divisions; row++) {
      for (let col = 0; col <= divisions; col++) {
        const p = [0, 0, 0];
        p[axis] = face % 2 ? -1 : 1;
        p[(axis + 1) % 3] = row * 2 / divisions - 1;
        p[(axis + 2) % 3] = col * 2 / divisions - 1;
        const radius = Math.pow(p.reduce((sum, n) => sum + n ** 8, 0), 1 / 8);
        points.push(p.map((n) => n / radius));
        const index = offset + row * (divisions + 1) + col;
        if (row) edges.push([index - divisions - 1, index]);
        if (col) edges.push([index - 1, index]);
      }
    }
  }
  const projected = points.map(() => [0, 0, 0]);
  const depthBuckets = Array.from({ length: 8 }, () => []);
  let yaw = -0.48;
  let pitch = 0.28;
  let scale = 1;

  function project(x, y, z) {
    const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
    const rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
    const depth = y * Math.sin(pitch) + rz * Math.cos(pitch);
    const perspective = 5 / (5 - depth);
    return [width / 2 + rx * scale * perspective, height / 2 + ry * scale * perspective, depth];
  }

  function draw() {
    if (!width || !height) return;
    context.clearRect(0, 0, width, height);
    const energy = paused ? 0 : amplitude;
    const time = paused ? 0 : elapsed;
    yaw = -0.48 + Math.sin(time * 0.32) * energy * 0.16;
    pitch = 0.28 + Math.sin(time * 0.43) * energy * 0.09;
    scale = Math.min(width * 0.255, height * 0.29);

    // A quiet halo behind the mesh adds depth without blurring its square cells.
    const glow = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, scale * 2.3);
    glow.addColorStop(0, `rgba(164, 205, 219, ${0.055 + energy * 0.045})`);
    glow.addColorStop(1, 'rgba(164, 205, 219, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i];
      const broad = Math.sin(x * 3.2 + time * 2.1) * Math.cos(y * 2.6 - time * 1.5);
      const ripple = Math.sin(y * 7 + z * 5 - time * 3.2) * Math.sin(x * 4 + time);
      const fine = Math.sin(x * 13 - y * 9 + z * 7 + time * 4);
      const displacement = paused ? 0 : energy * (0.065 + broad * (0.07 + bands[0] * 0.07)
        + ripple * bands[1] * 0.09 + fine * bands[2] * 0.045);
      const expansion = 1 + displacement;
      projected[i] = project(x * expansion, y * expansion, z * expansion);
    }
    for (const bucket of depthBuckets) bucket.length = 0;
    for (const edge of edges) {
      const depth = (projected[edge[0]][2] + projected[edge[1]][2]) / 2;
      const bucket = Math.max(0, Math.min(7, Math.floor((depth + 1.8) / 3.6 * 8)));
      depthBuckets[bucket].push(edge);
    }
    // Batch strokes by depth, instead of issuing thousands of canvas strokes.
    for (let depth = 0; depth < depthBuckets.length; depth++) {
      context.beginPath();
      for (const [a, b] of depthBuckets[depth]) {
        context.moveTo(projected[a][0], projected[a][1]);
        context.lineTo(projected[b][0], projected[b][1]);
      }
      const opacity = 0.055 + (depth / 7) ** 2 * (0.7 + energy * 0.14);
      context.strokeStyle = `rgba(209, 230, 237, ${opacity})`;
      context.lineWidth = 0.75;
      context.stroke();
    }

  }

  function sample(delta) {
    analyser.getFloatTimeDomainData(samples);
    analyser.getByteFrequencyData(frequencies);
    let sum = 0;
    for (const value of samples) sum += value * value;
    const rms = Math.sqrt(sum / samples.length);
    const target = Math.min(1, Math.max(0, (rms - 0.003) / 0.15));
    amplitude += (target - amplitude) * (1 - Math.exp(-delta / (target > amplitude ? 0.055 : 0.18)));
    const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
    const ranges = [[70, 300], [300, 2200], [2200, 8000]];
    ranges.forEach(([low, high], index) => {
      const start = Math.max(1, Math.floor(low / hzPerBin));
      const end = Math.min(frequencies.length, Math.ceil(high / hzPerBin));
      let total = 0;
      for (let bin = start; bin < end; bin++) total += frequencies[bin] / 255;
      const targetBand = total / Math.max(1, end - start);
      bands[index] += (targetBand - bands[index]) * (1 - Math.exp(-delta / 0.09));
    });
  }

  function tick(now) {
    frame = 0;
    if (!analyser || document.hidden || !visible) return;
    const delta = Math.min(0.05, lastTime ? (now - lastTime) / 1000 : 1 / 60);
    lastTime = now;
    sample(delta);
    if (!paused) {
      elapsed += delta;
      draw();
    }
    if (now - lastReadout > 100) {
      canvas.dataset.level = amplitude.toFixed(3);
      canvas.dataset.speech = String(voice());
      lastReadout = now;
    }
    frame = requestAnimationFrame(tick);
  }

  function schedule() {
    cancelAnimationFrame(frame);
    lastTime = 0;
    frame = analyser && visible && !document.hidden ? requestAnimationFrame(tick) : 0;
  }

  function onMotionPreference(event) {
    paused = event.matches;
    draw();
  }
  reducedMotion.addEventListener('change', onMotionPreference);
  document.addEventListener('visibilitychange', schedule);
  const resizeObserver = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width;
    height = entry.contentRect.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  });
  resizeObserver.observe(canvas);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  });
  intersectionObserver.observe(canvas);

  function disconnect() {
    analyser = null;
    cancelAnimationFrame(frame);
    frame = 0;
    amplitude = 0;
    elapsed = 0;
    bands.fill(0);
    canvas.dataset.level = '0';
    canvas.dataset.speech = 'false';
    canvas.dataset.source = 'off';
    draw();
  }

  return {
    connect(node, { source = 'microphone', isSpeech = () => false } = {}) {
      analyser = node;
      voice = isSpeech;
      samples = new Float32Array(node.fftSize);
      frequencies = new Uint8Array(node.frequencyBinCount);
      canvas.dataset.source = source;
      schedule();
    },
    disconnect,
    destroy() {
      disconnect();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      reducedMotion.removeEventListener('change', onMotionPreference);
      document.removeEventListener('visibilitychange', schedule);
    },
  };
}

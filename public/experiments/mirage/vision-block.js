import { approach, bindStageMotion, ease, mirageMotion as motion, scanState } from './motion.js';

function channels(value) {
  const text = String(value).trim();
  const hex = text.match(/^#([\da-f]{6})$/i);
  if (hex) {
    const bits = Number.parseInt(hex[1], 16);
    return [(bits >> 16) & 255, (bits >> 8) & 255, bits & 255];
  }
  const short = text.match(/^#([\da-f]{3})$/i);
  if (short) {
    return short[1].split('').map((digit) => Number.parseInt(digit + digit, 16));
  }
  const nums = text.match(/[\d.]+/g);
  return nums && nums.length >= 3 ? nums.slice(0, 3).map(Number) : [0, 0, 0];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function nowMs() {
  return performance.now();
}

function buildLines() {
  const lines = [];
  const seen = new Set();
  const quant = (point) => point.map((value) => Math.round(value * 1000)).join(',');
  function add(start, end) {
    const a = quant(start);
    const b = quant(end);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push([start, end]);
  }
  const faces = [0, 1, 2].flatMap((axis) => [-1, 1].map((sign) => ({ axis, sign })));
  function point(face, u, v) {
    const next = [0, 0, 0];
    next[face.axis] = face.sign;
    next[(face.axis + 1) % 3] = u * 2 - 1;
    next[(face.axis + 2) % 3] = v * 2 - 1;
    return next;
  }
  for (const face of faces) {
    add(point(face, 0, 0), point(face, 1, 0));
    add(point(face, 1, 0), point(face, 1, 1));
    add(point(face, 1, 1), point(face, 0, 1));
    add(point(face, 0, 1), point(face, 0, 0));
  }
  for (let level = 1; level <= 4; level += 1) {
    const divisions = 2 ** level;
    for (const face of faces) {
      for (let index = 1; index < divisions; index += 2) {
        const t = index / divisions;
        add(point(face, t, 0), point(face, t, 1));
        add(point(face, 0, t), point(face, 1, t));
      }
    }
  }
  return lines;
}

const LINES = buildLines();

function project(point, pose) {
  const [x, y, z] = point;
  const yawCos = Math.cos(pose.yaw);
  const yawSin = Math.sin(pose.yaw);
  const pitchCos = Math.cos(pose.pitch);
  const pitchSin = Math.sin(pose.pitch);
  const x1 = x * yawCos + z * yawSin;
  const z1 = -x * yawSin + z * yawCos;
  const y1 = y * pitchCos - z1 * pitchSin;
  const z2 = y * pitchSin + z1 * pitchCos;
  const persp = pose.perspective > 0.001 ? 4.5 / (4.5 - z2) : 1;
  const factor = lerp(1, persp, pose.perspective);
  const cabinet = (1 - pose.perspective) * pose.cabinet * (z < 0 ? 1 : 0);
  return [pose.cx + x1 * pose.hx * factor + cabinet * 0.65, pose.cy + y1 * pose.hy * factor + cabinet, z2];
}

function stageStyleOf(node) {
  return getComputedStyle(node);
}

function strokeColour(style, ink) {
  const mesh = channels(style.getPropertyValue('--mesh'));
  const muted = channels(style.getPropertyValue('--stage-muted'));
  const errorAlpha = parseFloat(style.getPropertyValue('--mirage-error-grid-opacity'));
  const red = lerp(mesh[0], muted[0], ink);
  const green = lerp(mesh[1], muted[1], ink);
  const blue = lerp(mesh[2], muted[2], ink);
  const alpha = lerp(1, Number.isFinite(errorAlpha) ? errorAlpha : 1, ink);
  return `rgba(${red | 0}, ${green | 0}, ${blue | 0}, ${alpha})`;
}

export function createVisionBlock(canvas, overlay) {
  const context = canvas.getContext('2d');
  const svg = overlay.querySelector('svg');
  const labels = overlay.querySelector('.labels');
  const reducedMedia = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedMedia.matches;
  let frame = 0;
  let width = 0;
  let height = 0;
  const births = new Map();
  const state = {
    shown: 1,
    reported: 1,
    progressFrom: 1,
    progressStarted: 0,
    morph: 0,
    morphFrom: 0,
    morphTo: 0,
    morphStarted: 0,
    aspect: 1,
    aspectFrom: 1,
    aspectTo: 1,
    aspectStarted: 0,
    aspectDuration: motion.slow,
    image: null,
    nextImage: null,
    imageOpacity: 0,
    fadeFrom: 0,
    fadeTo: 0,
    fadeStarted: 0,
    fadeDelay: 0,
    fadeDuration: motion.base,
    flat: false,
    gridFade: 0,
    gridFadeFrom: 0,
    gridFadeTo: 0,
    gridFadeStarted: 0,
    ink: 0,
    inkFrom: 0,
    inkTo: 0,
    inkStarted: 0,
    holdLines: false,
    stage: null,
    finish: null,
    hot: null,
  };

  bindStageMotion(canvas);

  function slabDepth() {
    const raw = getComputedStyle(canvas).getPropertyValue('--mirage-slab-depth');
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : 12;
  }

  function pose() {
    const t = state.morph;
    const eased = state.flat && state.morphTo === state.morphFrom ? t : t;
    const cube = Math.min(width, height) * 0.27;
    const slab = slabDepth();
    const aspect = Math.max(0.2, state.aspect);
    const maxW = Math.max(8, width - slab - 6);
    const maxH = Math.max(8, height - slab - 6);
    let faceW = maxW;
    let faceH = faceW / aspect;
    if (faceH > maxH) {
      faceH = maxH;
      faceW = faceH * aspect;
    }
    return {
      yaw: lerp(-0.48, 0, eased),
      pitch: lerp(0.28, 0, eased),
      perspective: 1 - eased,
      cabinet: slab * eased,
      hx: lerp(cube, faceW / 2, eased),
      hy: lerp(cube, faceH / 2, eased),
      hz: lerp(cube, Math.max(slab / 2, 0.5), eased),
      cx: width / 2,
      cy: height / 2,
    };
  }

  function faceBounds(current) {
    const corners = [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map((point) => project(point, current));
    const xs = corners.map((corner) => corner[0]);
    const ys = corners.map((corner) => corner[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
  }

  function tween(from, to, started, duration, curve, now) {
    if (reduced || duration <= 0) return { value: to, done: true };
    const t = Math.max(0, Math.min(1, (now - started) / duration));
    return { value: from + (to - from) * ease(curve, t), done: t >= 1 };
  }

  function update(now) {
    let moving = false;
    if (!state.holdLines && state.shown !== state.reported) {
      const step = tween(state.progressFrom, state.reported, state.progressStarted, motion.fast, motion.out, now);
      state.shown = approach(state.progressFrom, state.reported, reduced ? 1 : Math.min(1, (now - state.progressStarted) / motion.fast));
      moving = moving || !step.done;
      if (step.done) state.shown = state.reported;
    }
    if (state.morph !== state.morphTo) {
      const step = tween(state.morphFrom, state.morphTo, state.morphStarted, motion.slow, motion.inOut, now);
      state.morph = step.value;
      moving = moving || !step.done;
    }
    if (state.aspect !== state.aspectTo) {
      const step = tween(state.aspectFrom, state.aspectTo, state.aspectStarted, state.aspectDuration, motion.inOut, now);
      state.aspect = step.value;
      moving = moving || !step.done;
    }
    if (now >= state.fadeStarted + state.fadeDelay && state.imageOpacity !== state.fadeTo) {
      const step = tween(state.fadeFrom, state.fadeTo, state.fadeStarted + state.fadeDelay, state.fadeDuration, motion.out, now);
      state.imageOpacity = step.value;
      moving = moving || now < state.fadeStarted + state.fadeDelay + state.fadeDuration;
      if (step.done && state.fadeTo === 0 && state.nextImage) {
        state.image = state.nextImage;
        state.nextImage = null;
        state.fadeFrom = 0;
        state.fadeTo = 1;
        state.imageOpacity = 0;
        state.fadeStarted = now;
        state.fadeDelay = 0;
        state.fadeDuration = motion.base;
        moving = true;
      }
    } else if (now < state.fadeStarted + state.fadeDelay) moving = true;
    if (state.ink !== state.inkTo) {
      const step = tween(state.inkFrom, state.inkTo, state.inkStarted, motion.base, motion.out, now);
      state.ink = step.value;
      moving = moving || !step.done;
      if (step.done && state.holdLines && state.inkTo === 0) {
        state.holdLines = false;
        state.progressFrom = state.shown;
        state.progressStarted = now;
        moving = true;
      }
    }
    if (state.gridFade !== state.gridFadeTo) {
      const step = tween(state.gridFadeFrom, state.gridFadeTo, state.gridFadeStarted, motion.base, motion.out, now);
      state.gridFade = step.value;
      moving = moving || !step.done;
    }
    if (state.stage && !reduced) {
      const elapsed = now - state.stage.started;
      const following = state.stage.hasProgress && Math.abs(state.stage.shown - state.stage.reported) > 0.001;
      const traveling = !state.stage.hasProgress && elapsed < motion.instantThreshold + motion.scanPass;
      const fadingIn = elapsed < motion.instantThreshold + motion.fast;
      if (following || traveling || fadingIn) moving = true;
    }
    if (state.finish) {
      const since = now - state.finish.endedAt;
      if (since > motion.fast + motion.fast) state.finish = null;
      else moving = true;
    }
    const due = dueCount();
    for (let index = 0; index < due; index += 1) {
      if (!births.has(index)) births.set(index, now);
      if (now - births.get(index) < motion.fast) moving = true;
    }
    return moving;
  }

  function dueCount() {
    if (state.flat || state.shown >= 1) return LINES.length;
    const edges = Math.min(12, LINES.length);
    return edges + Math.floor(state.shown * (LINES.length - edges));
  }

  function drawGrid(current, colour) {
    const due = dueCount();
    context.beginPath();
    for (let index = 0; index < due; index += 1) {
      const born = births.get(index) ?? 0;
      const reveal = reduced ? 1 : Math.max(0, Math.min(1, (performance.now() - born) / motion.fast));
      const amount = ease(motion.out, reveal);
      const [start, end] = LINES[index];
      const a = project(start, current);
      const b = project(end, current);
      context.moveTo(a[0], a[1]);
      context.lineTo(a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount);
    }
    context.strokeStyle = colour;
    context.lineWidth = 1;
    context.stroke();
  }

  function drawImage(bounds) {
    if (!state.image || state.imageOpacity <= 0.001 || bounds.w < 2 || bounds.h < 2) return;
    context.save();
    context.globalAlpha = state.imageOpacity;
    context.drawImage(state.image, bounds.x, bounds.y, bounds.w, bounds.h);
    context.restore();
    const style = stageStyleOf(canvas);
    const gridOpacity = parseFloat(style.getPropertyValue('--mirage-image-grid-opacity'));
    const errorAlpha = parseFloat(style.getPropertyValue('--mirage-error-grid-opacity'));
    const overlayAlpha = (Number.isFinite(gridOpacity) ? gridOpacity : 0) * state.imageOpacity * (1 - state.gridFade) * (state.ink > 0 ? lerp(1, Number.isFinite(errorAlpha) ? errorAlpha : 1, state.ink) : 1);
    if (overlayAlpha <= 0.001) return;
    context.save();
    context.beginPath();
    context.rect(bounds.x, bounds.y, bounds.w, bounds.h);
    context.clip();
    context.globalAlpha = overlayAlpha;
    context.strokeStyle = strokeColour(style, 0);
    context.lineWidth = 1;
    const gap = 28;
    context.beginPath();
    for (let x = bounds.x; x <= bounds.x + bounds.w; x += gap) {
      context.moveTo(x, bounds.y);
      context.lineTo(x, bounds.y + bounds.h);
    }
    for (let y = bounds.y; y <= bounds.y + bounds.h; y += gap) {
      context.moveTo(bounds.x, y);
      context.lineTo(bounds.x + bounds.w, y);
    }
    context.stroke();
    context.restore();
  }

  function drawScan(bounds) {
    const now = performance.now();
    let scan = null;
    if (state.finish) {
      scan = scanState({
        elapsed: state.finish.stageMs,
        reduced,
        stageMs: state.finish.stageMs,
        sinceEnd: now - state.finish.endedAt,
        hasProgress: state.finish.hasProgress,
        progress: state.finish.progress,
        shown: state.finish.shown,
      });
    } else if (state.stage) {
      scan = scanState({
        elapsed: now - state.stage.started,
        reduced,
        sinceEnd: null,
        hasProgress: state.stage.hasProgress,
        progress: state.stage.reported,
        shown: state.stage.shown,
      });
      if (state.stage.hasProgress && state.stage.shown !== state.stage.reported) {
        state.stage.shown = approach(state.stage.from, state.stage.reported, Math.min(1, (now - state.stage.fromAt) / motion.fast));
      }
    }
    canvas.dataset.scan = scan ? scan.y.toFixed(3) : '';
    if (!scan || scan.opacity <= 0.001) return;
    context.save();
    context.globalAlpha = scan.opacity;
    context.strokeStyle = stageStyleOf(canvas).getPropertyValue('--mesh').trim();
    context.lineWidth = 1;
    const y = bounds.y + scan.y * bounds.h;
    context.beginPath();
    context.moveTo(bounds.x, y);
    context.lineTo(bounds.x + bounds.w, y);
    context.stroke();
    context.restore();
  }

  function placeOverlay(bounds) {
    const show = state.flat && state.morph > 0.98 && state.image;
    overlay.hidden = !show;
    if (!show) return;
    overlay.style.left = `${bounds.x}px`;
    overlay.style.top = `${bounds.y}px`;
    overlay.style.width = `${bounds.w}px`;
    overlay.style.height = `${bounds.h}px`;
  }

  function draw() {
    if (!context || !width || !height) return;
    context.clearRect(0, 0, width, height);
    const current = pose();
    const bounds = faceBounds(current);
    const colour = strokeColour(stageStyleOf(canvas), state.ink);
    if (state.morph < 0.999) drawGrid(current, colour);
    if (state.imageOpacity > 0) drawImage(bounds);
    if (state.image && state.morph > 0.5) drawScan(bounds);
    else canvas.dataset.scan = '';
    placeOverlay(bounds);
    canvas.dataset.mode = state.finish || state.stage ? 'scan' : state.ink > 0.5 ? 'error' : state.flat ? 'slab' : state.shown < 1 ? 'download' : 'idle';
    canvas.dataset.grid = state.shown.toFixed(3);
  }

  function poke() {
    if (frame) return;
    frame = requestAnimationFrame(tick);
    canvas.dataset.raf = '1';
  }

  function tick(now) {
    frame = 0;
    const moving = update(now);
    draw();
    if (moving) {
      frame = requestAnimationFrame(tick);
      canvas.dataset.raf = '1';
    } else canvas.dataset.raf = '0';
  }

  function jump() {
    state.morph = state.morphTo;
    state.aspect = state.aspectTo;
    state.shown = state.reported;
    state.imageOpacity = state.nextImage ? 1 : state.fadeTo;
    if (state.nextImage) {
      state.image = state.nextImage;
      state.nextImage = null;
    }
    state.ink = state.inkTo;
    state.gridFade = state.gridFadeTo;
    state.holdLines = false;
    state.stage = null;
    state.finish = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    canvas.dataset.raf = '0';
    canvas.dataset.scan = '';
    draw();
  }

  reducedMedia.addEventListener('change', () => {
    reduced = reducedMedia.matches;
    bindStageMotion(canvas);
    if (reduced) jump();
    else draw();
  });

  const resize = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  });
  resize.observe(canvas);
  canvas.dataset.raf = '0';
  canvas.dataset.mode = 'idle';
  canvas.dataset.scan = '';

  function showBoxes(items) {
    svg.replaceChildren();
    labels.replaceChildren();
    overlay.querySelectorAll('.box-hit').forEach((node) => node.remove());
    const objects = items.filter((item) => item.kind === 'object').sort((a, b) => b.score - a.score);
    const text = items.filter((item) => item.kind === 'text').sort((a, b) => b.score - a.score);
    const objectGap = reduced ? 0 : boxGap(objects.length);
    const textGap = reduced ? 0 : boxGap(text.length);
    const textStart = objects.length ? (objects.length - 1) * objectGap + motion.base : 0;
    const placed = [];
    function add(item, delay) {
      const [x1, y1, x2, y2] = item.bbox;
      const x = Math.max(0, Math.min(1000, x1));
      const y = Math.max(0, Math.min(1000, y1));
      const w = Math.max(0, Math.min(1000, x2) - x);
      const h = Math.max(0, Math.min(1000, y2) - y);
      if (w < 1 || h < 1) return;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const perimeter = 2 * (w + h);
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.dataset.id = item.id;
      rect.classList.add('box');
      if (item.kind === 'text') rect.classList.add('dashed');
      rect.style.setProperty('--perim', String(perimeter));
      svg.append(rect);
      const hit = document.createElement('div');
      hit.className = 'box-hit';
      hit.dataset.id = item.id;
      hit.setAttribute('aria-hidden', 'true');
      hit.style.left = `${x / 10}%`;
      hit.style.top = `${y / 10}%`;
      hit.style.width = `${w / 10}%`;
      hit.style.height = `${h / 10}%`;
      overlay.append(hit);
      const tab = document.createElement('span');
      tab.className = 'tag';
      tab.dataset.id = item.id;
      tab.textContent = `${item.name} ${item.percent}%`;
      labels.append(tab);
      const tagHeight = 16;
      const tagWidth = Math.min(boundsWidth(), Math.max(36, tab.textContent.length * 6.4 + 8));
      const top = (y / 1000) * boundsHeight();
      const left = Math.max(0, Math.min((x / 1000) * boundsWidth(), Math.max(0, boundsWidth() - tagWidth)));
      const inside = top < tagHeight;
      tab.style.left = `${left}px`;
      tab.style.top = `${inside ? top : top - tagHeight}px`;
      const box = { left, top: inside ? top : top - tagHeight, right: left + tagWidth, bottom: (inside ? top : top - tagHeight) + tagHeight };
      const blocked = placed.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
      if (blocked) tab.remove();
      else placed.push(box);
      if (reduced) {
        rect.classList.add('drawn');
        tab.classList.add('shown');
        return;
      }
      rect.style.transitionDelay = `${delay}ms`;
      tab.style.transitionDelay = `${delay + motion.base}ms`;
      requestAnimationFrame(() => {
        rect.classList.add('drawn');
        tab.classList.add('shown');
      });
    }
    objects.forEach((item, index) => add(item, index * objectGap));
    text.forEach((item, index) => add(item, textStart + index * textGap));
    state.gridFadeFrom = state.gridFade;
    state.gridFadeTo = 1;
    state.gridFadeStarted = nowMs();
    if (reduced) state.gridFade = 1;
    poke();
  }

  function boundsWidth() {
    return parseFloat(overlay.style.width) || canvas.clientWidth || 1;
  }
  function boundsHeight() {
    return parseFloat(overlay.style.height) || canvas.clientHeight || 1;
  }

  function boxGap(count) {
    if (count <= 1 || count > motion.boxStaggerCap) return 0;
    return Math.min(motion.boxStagger, motion.boxStaggerWindow / (count - 1));
  }

  return {
    startDownload() {
      state.reported = reduced || state.flat ? 1 : 0;
      state.progressFrom = state.shown;
      state.progressStarted = nowMs();
      if (!reduced && !state.flat) {
        state.shown = 0;
        births.clear();
      }
      poke();
    },
    setProgress(value, known = true) {
      if (!known) return;
      const next = Math.max(state.reported, Math.max(0, Math.min(1, value)));
      state.progressFrom = state.shown;
      state.reported = next;
      state.progressStarted = nowMs();
      if (reduced) state.shown = next;
      poke();
    },
    showCachedGrid() {
      state.reported = 1;
      state.shown = 1;
      births.clear();
      for (let index = 0; index < LINES.length; index += 1) births.set(index, -1e9);
      draw();
    },
    setImage(source, aspect) {
      const safe = Math.max(0.2, aspect || 1);
      if (!state.image) {
        state.image = source;
        state.flat = true;
        state.morphFrom = state.morph;
        state.morphTo = 1;
        state.morphStarted = nowMs();
        state.aspectFrom = state.aspect;
        state.aspectTo = safe;
        state.aspectStarted = nowMs();
        state.aspectDuration = motion.slow;
        state.fadeFrom = 0;
        state.fadeTo = reduced ? 1 : 0;
        state.imageOpacity = reduced ? 1 : 0;
        state.fadeStarted = nowMs();
        const delay = parseFloat(getComputedStyle(canvas).getPropertyValue('--mirage-image-delay'));
        state.fadeDelay = reduced ? 0 : (Number.isFinite(delay) ? delay : 0);
        state.fadeDuration = motion.base;
        if (!reduced) {
          state.fadeTo = 1;
          state.fadeFrom = 0;
        }
        state.gridFade = 0;
        state.gridFadeTo = 0;
        if (reduced) jump();
        else poke();
        return;
      }
      state.nextImage = source;
      state.aspectFrom = state.aspect;
      state.aspectTo = safe;
      state.aspectStarted = nowMs();
      state.aspectDuration = motion.base;
      state.fadeFrom = state.imageOpacity;
      state.fadeTo = 0;
      state.fadeStarted = nowMs();
      state.fadeDelay = 0;
      state.fadeDuration = motion.fast;
      state.gridFadeFrom = state.gridFade;
      state.gridFadeTo = 0;
      state.gridFadeStarted = nowMs();
      if (reduced) jump();
      else poke();
    },
    beginStage(hasProgress = false) {
      state.stage = { started: nowMs(), hasProgress, reported: 0, shown: 0, from: 0, fromAt: nowMs() };
      poke();
    },
    setStageProgress(value) {
      if (!state.stage) return;
      state.stage.hasProgress = true;
      state.stage.from = state.stage.shown;
      state.stage.fromAt = nowMs();
      state.stage.reported = Math.max(0, Math.min(1, value));
      poke();
    },
    endStage() {
      if (!state.stage) return;
      const elapsed = nowMs() - state.stage.started;
      state.finish = {
        endedAt: nowMs(),
        stageMs: elapsed,
        hasProgress: state.stage.hasProgress,
        progress: state.stage.reported,
        shown: state.stage.shown,
      };
      state.stage = null;
      if (elapsed < motion.instantThreshold) state.finish = null;
      poke();
    },
    showBoxes,
    clearBoxes() {
      svg.replaceChildren();
      labels.replaceChildren();
      overlay.querySelectorAll('.box-hit').forEach((node) => node.remove());
      state.gridFadeFrom = state.gridFade;
      state.gridFadeTo = 0;
      state.gridFadeStarted = nowMs();
      if (reduced) state.gridFade = 0;
      poke();
    },
    setHot(id) {
      state.hot = id;
      overlay.querySelectorAll('[data-id]').forEach((node) => {
        const on = Boolean(id) && node.dataset.id === id;
        node.classList.toggle('is-hot', Boolean(on));
        node.classList.toggle('is-dim', Boolean(id && !on));
      });
    },
    fail() {
      state.inkFrom = state.ink;
      state.inkTo = 1;
      state.inkStarted = nowMs();
      state.stage = null;
      if (reduced) state.ink = 1;
      poke();
    },
    recover() {
      if (state.ink === 0 || reduced) {
        state.ink = 0;
        state.inkTo = 0;
        state.holdLines = false;
        return;
      }
      state.holdLines = true;
      state.inkFrom = state.ink;
      state.inkTo = 0;
      state.inkStarted = nowMs();
      poke();
    },
    destroy() {
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}

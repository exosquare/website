export const COUNT = 435;
export const R = 1;
export const COMPRESS = 16;

export const SERVES = {
  G0: { x: 16, y: 8, vx: 1, vy: 1, pLeft: 8, pRight: 8 },
  G1: { x: 16, y: 3, vx: -2, vy: 1, pLeft: 8, pRight: 8 },
  G2: { x: 8, y: 2, vx: 2, vy: -2, pLeft: 4, pRight: 11 },
  G3: { x: 23, y: 13, vx: -2, vy: 2, pLeft: 11, pRight: 4 },
};

export function demonstrationValue(index) {
  if (index % 23 === 4) return 0;
  const sign = (index * 13 + 5) % 7 < 3 ? -1 : 1;
  const mags = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6];
  let mag = mags[(index * 11 + 4) % mags.length];
  if (index % 37 === 2) mag = 16;
  return sign * mag;
}

export function demonstrationWeights() {
  const weights = new Float64Array(COUNT);
  for (let index = 0; index < COUNT; index += 1) weights[index] = demonstrationValue(index);
  return weights;
}

export function freshWorld(source) {
  return {
    x: source.x,
    y: source.y,
    vx: source.vx,
    vy: source.vy,
    pLeft: source.pLeft,
    pRight: source.pRight,
    elapsedTicks: 0,
    phase: "live",
    terminal: null,
  };
}

export function observe(world, side) {
  if (side === "left") {
    return [world.x / 31, world.y / 15, world.vx / 2, world.vy / 2, world.pLeft / 15, world.pRight / 15];
  }
  return [(31 - world.x) / 31, world.y / 15, -world.vx / 2, world.vy / 2, world.pRight / 15, world.pLeft / 15];
}

function displacement(action) {
  if (action === 1) return 1;
  if (action === 2) return -1;
  return 0;
}

function clampCenter(center) {
  if (center < 1) return 1;
  if (center > 14) return 14;
  return center;
}

function resolveVertical(y, vy) {
  const ty = y + vy;
  if (ty < 0) return { resolvedY: -ty, wallVy: -vy };
  if (ty > 15) return { resolvedY: 30 - ty, wallVy: -vy };
  return { resolvedY: ty, wallVy: vy };
}

function signedUnit(value) {
  return value < 0 ? -1 : 1;
}

function finite(value) {
  return Object.is(value, -0) ? 0 : value;
}

function withTimeout(world, elapsedTicks) {
  if (world.phase === "terminal") return world;
  if (elapsedTicks >= 192) {
    return {
      ...world,
      elapsedTicks: 192,
      phase: "terminal",
      terminal: { reason: "timeout", winner: null },
    };
  }
  return { ...world, elapsedTicks, phase: "live", terminal: null };
}

export function stepWorld(world, leftAction, rightAction) {
  if (world.phase === "terminal") {
    return { error: "terminal" };
  }
  const pLeft = clampCenter(world.pLeft + displacement(leftAction));
  const pRight = clampCenter(world.pRight + displacement(rightAction));
  const vertical = resolveVertical(world.y, world.vy);
  const tx = world.x + world.vx;
  const nextElapsed = world.elapsedTicks + 1;
  const base = {
    pLeft,
    pRight,
    elapsedTicks: nextElapsed,
  };

  if (tx <= 0) {
    const offset = vertical.resolvedY - pLeft;
    if (Math.abs(offset) <= 1) {
      const outgoingVy = offset === -1 ? -2 : offset === 1 ? 2 : signedUnit(vertical.wallVy);
      return withTimeout({
        ...base,
        x: finite(-tx),
        y: finite(vertical.resolvedY),
        vx: finite(-world.vx),
        vy: finite(outgoingVy),
        phase: "live",
        terminal: null,
      }, nextElapsed);
    }
    return {
      ...base,
      x: finite(tx),
      y: finite(vertical.resolvedY),
      vx: finite(world.vx),
      vy: finite(vertical.wallVy),
      phase: "terminal",
      terminal: { reason: "right-point", winner: "right" },
    };
  }

  if (tx >= 31) {
    const offset = vertical.resolvedY - pRight;
    if (Math.abs(offset) <= 1) {
      const outgoingVy = offset === -1 ? -2 : offset === 1 ? 2 : signedUnit(vertical.wallVy);
      return withTimeout({
        ...base,
        x: finite(62 - tx),
        y: finite(vertical.resolvedY),
        vx: finite(-world.vx),
        vy: finite(outgoingVy),
        phase: "live",
        terminal: null,
      }, nextElapsed);
    }
    return {
      ...base,
      x: finite(tx),
      y: finite(vertical.resolvedY),
      vx: finite(world.vx),
      vy: finite(vertical.wallVy),
      phase: "terminal",
      terminal: { reason: "left-point", winner: "left" },
    };
  }

  return withTimeout({
    ...base,
    x: finite(tx),
    y: finite(vertical.resolvedY),
    vx: finite(world.vx),
    vy: finite(vertical.wallVy),
    phase: "live",
    terminal: null,
  }, nextElapsed);
}

export function quantize(raw) {
  return Math.floor(raw * 1000000 + 0.5);
}

function relu(value) {
  if (!Number.isFinite(value)) return { error: true };
  if (value < 0 || Object.is(value, -0)) return 0;
  return value;
}

function affine(inputs, weights, weightOffset, biasOffset, inputCount, outputCount) {
  const out = new Array(outputCount);
  for (let output = 0; output < outputCount; output += 1) {
    let sum = weights[biasOffset + output];
    if (Object.is(sum, -0)) sum = 0;
    for (let input = 0; input < inputCount; input += 1) {
      sum = sum + inputs[input] * weights[weightOffset + input * outputCount + output];
    }
    if (!Number.isFinite(sum)) return { error: true };
    out[output] = sum;
  }
  return out;
}

export function infer(weights, inputs) {
  const hidden1 = affine(inputs, weights, 0, 96, 6, 16);
  if (hidden1.error) return hidden1;
  const relu1 = [];
  for (let index = 0; index < 16; index += 1) {
    const value = relu(hidden1[index]);
    if (value && value.error) return value;
    relu1.push(value);
  }
  const hidden2 = affine(relu1, weights, 112, 368, 16, 16);
  if (hidden2.error) return hidden2;
  const relu2 = [];
  for (let index = 0; index < 16; index += 1) {
    const value = relu(hidden2[index]);
    if (value && value.error) return value;
    relu2.push(value);
  }
  const rawScores = affine(relu2, weights, 384, 432, 16, 3);
  if (rawScores.error) return rawScores;
  const comparisonScores = rawScores.map(quantize);
  let action = 0;
  for (let index = 1; index < 3; index += 1) {
    if (comparisonScores[index] > comparisonScores[action]) action = index;
  }
  return { inputs, rawScores, comparisonScores, action };
}

export function xorshift32(state) {
  let x = state >>> 0;
  x ^= (x << 13) >>> 0;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  return x >>> 0;
}

export function uniformInt(state, bound) {
  const limit = Math.floor(0x100000000 / bound) * bound;
  let next = state >>> 0;
  let rejections = 0;
  for (;;) {
    next = xorshift32(next);
    if (next < limit) return { state: next, value: next % bound, rejections };
    rejections += 1;
  }
}

const SPEEDS = [-2, -1, 1, 2];

export function randomServe(seed) {
  let state = seed >>> 0;
  if (state === 0) state = 1;
  const draw = (bound) => {
    const next = uniformInt(state, bound);
    state = next.state;
    return next.value;
  };
  return freshWorld({
    x: 1 + draw(30),
    y: draw(16),
    vx: SPEEDS[draw(4)],
    vy: SPEEDS[draw(4)],
    pLeft: 1 + draw(14),
    pRight: 1 + draw(14),
  });
}

function chase(target, center) {
  if (target - center > 1) return 1;
  if (target - center < -1) return 2;
  return 0;
}

export function analyticTarget(world, side) {
  const incoming = side === "left" ? world.vx < 0 : world.vx > 0;
  if (!incoming) return 8;
  let x = world.x;
  let y = world.y;
  let vx = world.vx;
  let vy = world.vy;
  for (let tick = 1; tick <= 31; tick += 1) {
    const vertical = resolveVertical(y, vy);
    const tx = x + vx;
    const crossed = side === "left" ? tx <= 0 : tx >= 31;
    if (crossed) return vertical.resolvedY;
    x = tx;
    y = vertical.resolvedY;
    vy = vertical.wallVy;
  }
  return y;
}

export function baselineAction(kind, world, side, rngState) {
  const center = side === "left" ? world.pLeft : world.pRight;
  if (kind === "stay") return { action: 0, rngState };
  if (kind === "reactive") return { action: chase(world.y, center), rngState };
  if (kind === "analytic") return { action: chase(analyticTarget(world, side), center), rngState };
  const draw = uniformInt(rngState, 3);
  return { action: draw.value, rngState: draw.state, rejections: draw.rejections };
}

export function decide(kind, weights, world, side, rngState) {
  if (world.phase === "terminal") return { error: "terminal" };
  if (kind === "network") {
    const inputs = observe(world, side);
    const decision = infer(weights, inputs);
    if (decision.error) return decision;
    return { ...decision, rngState, rejections: 0, controller: "network" };
  }
  const baseline = baselineAction(kind, world, side, rngState);
  return {
    action: baseline.action,
    rawScores: null,
    comparisonScores: null,
    inputs: observe(world, side),
    rngState: baseline.rngState,
    rejections: baseline.rejections || 0,
    controller: kind,
  };
}

export function outgoingSpan(layer, unit) {
  if (layer === "h1") {
    const start = 112 + 16 * unit;
    return { start, end: start + 16 };
  }
  if (layer === "h2") {
    const start = 384 + 3 * unit;
    return { start, end: start + 3 };
  }
  return null;
}

export function muteOutgoing(weights, layer, unit) {
  const span = outgoingSpan(layer, unit);
  if (!span) return { error: "layer" };
  const next = Float64Array.from(weights);
  const changes = [];
  let actualChangedCount = 0;
  for (let index = span.start; index < span.end; index += 1) {
    const from = weights[index];
    changes.push({ flatIndex: index, from, to: 0 });
    if (from !== 0) actualChangedCount += 1;
    next[index] = 0;
  }
  return { weights: next, changes, actualChangedCount, start: span.start, end: span.end };
}

export function isBiasIndex(index) {
  return (index >= 96 && index < 112) || (index >= 368 && index < 384) || index >= 432;
}

export function radiusOf(value) {
  return R * (0.6 + 0.4 * (value / (COMPRESS + Math.abs(value))));
}

export function direction(index) {
  const y = 1 - (2 * (index + 0.5)) / COUNT;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = Math.PI * (3 - Math.sqrt(5)) * index;
  return { x: ring * Math.cos(theta), y, z: ring * Math.sin(theta) };
}

export function parameterCounts() {
  let weights = 0;
  let biases = 0;
  for (let index = 0; index < COUNT; index += 1) {
    if (isBiasIndex(index)) biases += 1;
    else weights += 1;
  }
  return { weights, biases };
}

export function cloneWorld(world) {
  return {
    x: world.x,
    y: world.y,
    vx: world.vx,
    vy: world.vy,
    pLeft: world.pLeft,
    pRight: world.pRight,
    elapsedTicks: world.elapsedTicks,
    phase: world.phase,
    terminal: world.terminal ? { reason: world.terminal.reason, winner: world.terminal.winner } : null,
  };
}

function copyRng(rng) {
  if (!rng) return null;
  return {
    algorithm: "xorshift32-v1",
    initialSeed: rng.initialSeed >>> 0,
    state: rng.state >>> 0,
    drawCount: rng.drawCount,
    rejectionCount: rng.rejectionCount,
  };
}

function copySide(side) {
  return {
    ref: {
      kind: side.ref.kind,
      id: side.ref.id,
      version: side.ref.version,
      implementationSha256: side.ref.implementationSha256,
      artifactSha256: side.ref.artifactSha256,
    },
    state: { rng: copyRng(side.state.rng), memory: null },
  };
}

export function makeController(kind, options = {}) {
  const random = kind === "random";
  const seed = (options.seed || 1) >>> 0;
  const state = (options.state ?? seed) >>> 0;
  return {
    ref: {
      kind,
      id: options.id || kind,
      version: options.version || "pong-feedback-v1",
      implementationSha256: options.implementationSha256 ?? null,
      artifactSha256: kind === "network" ? (options.artifactSha256 || null) : null,
    },
    state: {
      rng: random ? {
        algorithm: "xorshift32-v1",
        initialSeed: seed === 0 ? 1 : seed,
        state: state === 0 ? 1 : state,
        drawCount: options.drawCount || 0,
        rejectionCount: options.rejectionCount || 0,
      } : null,
      memory: null,
    },
  };
}

export function makeCheckpoint(spec) {
  return {
    schema: "pong-checkpoint-v1",
    taskVersion: "pong-feedback-v1",
    rulesSha256: spec.rulesSha256 ?? null,
    numericVersion: "binary64-ordered-q1e6-v1",
    world: cloneWorld(spec.world),
    left: copySide(spec.left),
    right: copySide(spec.right),
    parentParameterFingerprint: spec.parentParameterFingerprint,
    episode: {
      id: spec.episode?.id || "local",
      serveId: spec.episode?.serveId || "G0",
      cohort: spec.episode?.cohort ?? null,
      round: spec.episode?.round ?? null,
      seedPairId: spec.episode?.seedPairId ?? null,
    },
    control: {
      mode: spec.control?.mode || "live-inference",
      nextActionOffset: spec.control?.nextActionOffset || 0,
    },
  };
}

export function cloneCheckpoint(checkpoint) {
  return {
    schema: checkpoint.schema,
    taskVersion: checkpoint.taskVersion,
    rulesSha256: checkpoint.rulesSha256,
    numericVersion: checkpoint.numericVersion,
    world: cloneWorld(checkpoint.world),
    left: copySide(checkpoint.left),
    right: copySide(checkpoint.right),
    parentParameterFingerprint: checkpoint.parentParameterFingerprint,
    episode: { ...checkpoint.episode },
    control: { ...checkpoint.control },
  };
}

function noteRng(side, decision) {
  if (!side.state.rng || side.ref.kind !== "random") return;
  side.state.rng.state = decision.rngState >>> 0;
  side.state.rng.drawCount += 1;
  side.state.rng.rejectionCount += decision.rejections || 0;
}

function decideSide(side, weights, world, which) {
  const rngState = side.state.rng ? side.state.rng.state : 1;
  return decide(side.ref.kind, weights, world, which, rngState);
}

export function advanceWithActions(checkpoint, leftAction, rightAction) {
  if (checkpoint.world.phase === "terminal") return { error: "terminal" };
  const world = stepWorld(checkpoint.world, leftAction, rightAction);
  if (world.error) return world;
  const next = cloneCheckpoint(checkpoint);
  next.world = world;
  next.control.mode = "replay";
  next.control.nextActionOffset += 1;
  return { checkpoint: next, inferred: false };
}

export function advanceCheckpoint(checkpoint, weightsBySide) {
  if (checkpoint.world.phase === "terminal") return { error: "terminal" };
  const before = cloneWorld(checkpoint.world);
  const leftWeights = weightsBySide.left || null;
  const rightWeights = weightsBySide.right || null;
  if (checkpoint.left.ref.kind === "network" && !leftWeights) return { error: "weights" };
  if (checkpoint.right.ref.kind === "network" && !rightWeights) return { error: "weights" };
  const left = decideSide(checkpoint.left, leftWeights, before, "left");
  if (left.error) return left;
  const right = decideSide(checkpoint.right, rightWeights, before, "right");
  if (right.error) return right;
  const world = stepWorld(before, left.action, right.action);
  if (world.error) return world;
  const next = cloneCheckpoint(checkpoint);
  next.world = world;
  next.control.mode = "live-inference";
  noteRng(next.left, left);
  noteRng(next.right, right);
  return {
    checkpoint: next,
    left: {
      inputs: left.inputs.slice(),
      rawScores: left.rawScores ? left.rawScores.slice() : null,
      comparisonScores: left.comparisonScores ? left.comparisonScores.slice() : null,
      action: left.action,
      tick: before.elapsedTicks,
    },
    right: {
      inputs: right.inputs.slice(),
      rawScores: right.rawScores ? right.rawScores.slice() : null,
      comparisonScores: right.comparisonScores ? right.comparisonScores.slice() : null,
      action: right.action,
      controller: right.controller,
      tick: before.elapsedTicks,
    },
    before,
    after: world,
  };
}

export function runEpisode(checkpoint, weightsBySide) {
  let current = cloneCheckpoint(checkpoint);
  const decisions = [];
  const worlds = [cloneWorld(current.world)];
  while (current.world.phase !== "terminal") {
    const step = advanceCheckpoint(current, weightsBySide);
    if (step.error) return step;
    decisions.push(step);
    current = step.checkpoint;
    worlds.push(cloneWorld(current.world));
  }
  const terminal = current.world.terminal;
  const playedPoints = terminal.reason === "timeout"
    ? [0.5, 0.5]
    : terminal.winner === "left" ? [1, 0] : [0, 1];
  return {
    checkpoint: current,
    decisions,
    worlds,
    playedTicks: current.world.elapsedTicks,
    termination: terminal.reason === "timeout" ? "timeout" : "point",
    winner: terminal.winner,
    playedPoints,
  };
}

export function compareBranches(checkpoint, parentWeights, forkWeights) {
  return {
    parent: runEpisode(checkpoint, { left: parentWeights, right: null }),
    fork: runEpisode(checkpoint, { left: forkWeights, right: null }),
  };
}

const ACTION_CODE = { s: 0, u: 1, d: 2 };

export function replayActions(checkpoint, leftActions, rightActions) {
  if (leftActions.length !== rightActions.length) return { error: "length" };
  let current = cloneCheckpoint(checkpoint);
  for (let index = 0; index < leftActions.length; index += 1) {
    if (current.world.phase === "terminal") return { error: "terminal" };
    const left = ACTION_CODE[leftActions[index]];
    const right = ACTION_CODE[rightActions[index]];
    if (left === undefined || right === undefined) return { error: "action" };
    const step = advanceWithActions(current, left, right);
    if (step.error) return step;
    current = step.checkpoint;
  }
  return { checkpoint: current, inferred: false, steps: leftActions.length };
}

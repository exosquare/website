import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SERVES,
  freshWorld,
  stepWorld,
  infer,
  demonstrationWeights,
  makeCheckpoint,
  makeController,
  muteOutgoing,
  compareBranches,
  xorshift32,
} from "./kernel.js";
import {
  sha256Utf8,
  sha256Bytes,
  parameterFingerprint,
  canonicalJson,
  validateContestant,
  missingResponseOutcome,
  finalizeReceipt,
  storeValidationReport,
  bindReceiptIndex,
  EMPTY_RESPONSE_SHA256,
  PAPER_WEIGHTS_SCHEMA_SHA256,
} from "./validate.js";
import {
  baselineSeed,
  hashCheckpoint,
  sealCheckpoint,
  evaluateSlot,
  collectBaselineSchedule,
} from "./evaluator.js";

const demo = demonstrationWeights();
const validatorSha = sha256Bytes(readFileSync(new URL("./validate.js", import.meta.url)));

const missingOutcome = missingResponseOutcome();
assert.equal(missingOutcome.rawResponseSha256, null);
assert.equal(missingOutcome.byteLength, null);
const missingReceipt = finalizeReceipt({
  schema: "synthetic-receipt-v1",
  role: "synthetic",
  status: "no-response",
  validationReportSha256: "pending",
});
assert.equal(missingReceipt.receipt.validationReportSha256, null);
const storedMissing = storeValidationReport(missingOutcome, {
  rawReceiptSha256: missingReceipt.rawReceiptSha256,
  rawReceiptStatus: "no-response",
  validatorSha256: validatorSha,
  weightsSchemaSha256: PAPER_WEIGHTS_SCHEMA_SHA256,
});
assert.equal(storedMissing.report.schema, "pong-single-validation-v1.1");
assert.equal(storedMissing.report.validatorSha256, null);
assert.equal(storedMissing.report.rawResponseSha256, null);
assert.equal(missingReceipt.receipt.validationReportSha256, null);
const empty = validateContestant(new Uint8Array());
assert.equal(empty.report.byteLength, 0);
assert.equal(empty.report.rawResponseSha256, EMPTY_RESPONSE_SHA256);
assert.equal(empty.report.errors[0].code, "syntax");

function envelope(tokens) {
  return `{"version":"pong-feedback-v1","weights":[${tokens.join(",")}]}`;
}
const zeros = Array.from({ length: 435 }, () => "0");
const accepted = validateContestant(envelope(zeros));
assert.equal(accepted.ok, true);
assert.equal(accepted.tokens.length, 435);
assert.notEqual(accepted.rawResponseSha256, accepted.fingerprint);
const acceptedReceipt = finalizeReceipt({
  schema: "synthetic-receipt-v1",
  role: "synthetic",
  status: "accepted",
  validationReportSha256: "pending",
});
const stored = storeValidationReport({
  status: "accepted",
  responsePresent: true,
  accepted: true,
  byteLength: accepted.report.byteLength,
  scalarCount: 435,
  rawResponseSha256: accepted.rawResponseSha256,
  parameterFingerprintSha256: accepted.fingerprint,
  errors: [],
}, {
  rawReceiptSha256: acceptedReceipt.rawReceiptSha256,
  rawReceiptStatus: "accepted",
  validatorSha256: validatorSha,
  weightsSchemaSha256: PAPER_WEIGHTS_SCHEMA_SHA256,
});
assert.equal(stored.report.schema, "pong-single-validation-v1.1");
assert.equal(stored.report.acceptedResponseSha256, accepted.rawResponseSha256);
assert.equal(Object.hasOwn(stored.report, "weights"), false);
assert.equal(acceptedReceipt.receipt.validationReportSha256, null);
const index = bindReceiptIndex(acceptedReceipt.rawReceiptSha256, stored.reportSha256, PAPER_WEIGHTS_SCHEMA_SHA256);
assert.equal(index.index.validationReportSha256, stored.reportSha256);
assert.equal(acceptedReceipt.receipt.validationReportSha256, null);

for (let unit = 0; unit < 16; unit += 1) {
  const h1 = muteOutgoing(demo, "h1", unit);
  assert.equal(h1.start, 112 + 16 * unit);
  assert.equal(h1.end, h1.start + 16);
  assert.equal(h1.changes.length, 16);
  const h2 = muteOutgoing(demo, "h2", unit);
  assert.equal(h2.start, 384 + 3 * unit);
  assert.equal(h2.end, h2.start + 3);
  assert.equal(h2.changes.length, 3);
}

const oriented = new Float64Array(435);
oriented[0] = 2;
oriented[112] = 3;
oriented[384] = 4;
const orientedScore = infer(oriented, [1, 0, 0, 0, 0, 0]);
assert.equal(orientedScore.rawScores[0], 24);
assert.equal(orientedScore.rawScores[1], 0);
assert.equal(orientedScore.action, 0);

function referenceStep(world, leftAction, rightAction) {
  if (world.phase === "terminal") return { error: "terminal" };
  const nudge = leftAction === 1 ? 1 : leftAction === 2 ? -1 : 0;
  const nudgeRight = rightAction === 1 ? 1 : rightAction === 2 ? -1 : 0;
  const clamp = (center) => (center < 1 ? 1 : center > 14 ? 14 : center);
  const pLeft = clamp(world.pLeft + nudge);
  const pRight = clamp(world.pRight + nudgeRight);
  const ty = world.y + world.vy;
  let y = ty;
  let wallVy = world.vy;
  if (ty < 0) {
    y = -ty;
    wallVy = -world.vy;
  } else if (ty > 15) {
    y = 30 - ty;
    wallVy = -world.vy;
  }
  const tx = world.x + world.vx;
  const elapsed = world.elapsedTicks + 1;
  const fin = (value) => (Object.is(value, -0) ? 0 : value);
  const finish = (next) => {
    if (next.phase === "terminal") return { ...next, elapsedTicks: elapsed };
    if (elapsed >= 192) {
      return { ...next, elapsedTicks: 192, phase: "terminal", terminal: { reason: "timeout", winner: null } };
    }
    return { ...next, elapsedTicks: elapsed, phase: "live", terminal: null };
  };
  if (tx <= 0) {
    const offset = y - pLeft;
    if (Math.abs(offset) <= 1) {
      const vy = offset === -1 ? -2 : offset === 1 ? 2 : wallVy < 0 ? -1 : 1;
      return finish({ x: fin(-tx), y: fin(y), vx: fin(-world.vx), vy: fin(vy), pLeft, pRight, phase: "live", terminal: null });
    }
    return { x: fin(tx), y: fin(y), vx: fin(world.vx), vy: fin(wallVy), pLeft, pRight, elapsedTicks: elapsed, phase: "terminal", terminal: { reason: "right-point", winner: "right" } };
  }
  if (tx >= 31) {
    const offset = y - pRight;
    if (Math.abs(offset) <= 1) {
      const vy = offset === -1 ? -2 : offset === 1 ? 2 : wallVy < 0 ? -1 : 1;
      return finish({ x: fin(62 - tx), y: fin(y), vx: fin(-world.vx), vy: fin(vy), pLeft, pRight, phase: "live", terminal: null });
    }
    return { x: fin(tx), y: fin(y), vx: fin(world.vx), vy: fin(wallVy), pLeft, pRight, elapsedTicks: elapsed, phase: "terminal", terminal: { reason: "left-point", winner: "left" } };
  }
  return finish({ x: fin(tx), y: fin(y), vx: fin(world.vx), vy: fin(wallVy), pLeft, pRight, phase: "live", terminal: null });
}

let state = 0x12345678;
function draw(bound) {
  state = xorshift32(state);
  return state % bound;
}
const speeds = [-2, -1, 1, 2];
for (let sample = 0; sample < 10000; sample += 1) {
  const prior = {
    x: draw(32),
    y: draw(16),
    vx: speeds[draw(4)],
    vy: speeds[draw(4)],
    pLeft: 1 + draw(14),
    pRight: 1 + draw(14),
    elapsedTicks: draw(192),
    phase: "live",
    terminal: null,
  };
  const leftAction = draw(3);
  const rightAction = draw(3);
  const actual = stepWorld(prior, leftAction, rightAction);
  const expected = referenceStep(prior, leftAction, rightAction);
  assert.deepEqual(actual, expected);
}

function sealedAt(elapsed, terminal) {
  const world = freshWorld(SERVES.G0);
  world.elapsedTicks = elapsed;
  if (terminal) {
    world.phase = "terminal";
    world.terminal = terminal;
  }
  const checkpoint = makeCheckpoint({
    world,
    left: makeController("network", { id: "synthetic" }),
    right: makeController("reactive", { id: "reactive" }),
    parentParameterFingerprint: parameterFingerprint(demo),
    episode: { id: `tick-${elapsed}`, serveId: "G0", seedPairId: "pair" },
  });
  return sealCheckpoint(checkpoint, {
    rulesSha256: sha256Utf8("pong-feedback-v1-rules"),
    implementationSha256: sha256Utf8("pong-kernel"),
    rawResponseSha256: sha256Utf8("synthetic-response-bytes"),
    fingerprint: parameterFingerprint(demo),
  });
}

for (const elapsed of [0, 1, 191]) {
  const sealed = sealedAt(elapsed, null);
  const text = canonicalJson(sealed);
  const parsed = JSON.parse(text);
  const stated = parsed.checkpointSha256;
  delete parsed.checkpointSha256;
  assert.equal(sha256Utf8(canonicalJson(parsed)), stated);
  assert.notEqual(sealed.left.ref.artifactSha256, sealed.parentParameterFingerprint);
  assert.equal(sealed.rulesSha256, sha256Utf8("pong-feedback-v1-rules"));
}
const terminal = sealedAt(192, { reason: "timeout", winner: null });
assert.equal(terminal.world.elapsedTicks, 192);

const late = freshWorld(SERVES.G0);
late.elapsedTicks = 191;
const rightNet = makeCheckpoint({
  world: late,
  left: makeController("reactive", { id: "reactive" }),
  right: makeController("network", { id: "synthetic", artifactSha256: sha256Utf8("raw") }),
  parentParameterFingerprint: parameterFingerprint(demo),
  episode: { id: "right-191", serveId: "G0", seedPairId: "pair-191" },
});
const beforeHash = hashCheckpoint(rightNet);
const pair = compareBranches(rightNet, demo, muteOutgoing(demo, "h1", 2).weights, "right");
assert.equal(pair.testedSide, "right");
assert.equal(pair.parent.playedTicks, 192);
assert.equal(pair.fork.playedTicks, 192);
assert.equal(pair.parent.decisions.length, 1);
assert.equal(pair.fork.decisions.length, 1);
assert.equal(pair.parent.decisions[0].left.controller, "reactive");
assert.equal(pair.fork.decisions[0].left.controller, "reactive");
assert.equal(hashCheckpoint(rightNet), beforeHash);
assert.equal(hashCheckpoint(cloneCheckpointSafe(rightNet)), beforeHash);

function cloneCheckpointSafe(checkpoint) {
  return JSON.parse(canonicalJson(checkpoint));
}

const baselines = ["stay", "random", "reactive", "analytic"];
const serves = ["G0", "G1", "G2", "G3"];
const entries = [];
for (const baselineId of baselines) {
  for (const serveId of serves) {
    const pairId = `synthetic-${baselineId}-${serveId}`;
    const derivation = `feedback-games-v1|random|${pairId}|0`;
    const seed = baselineSeed(derivation);
    for (const sideAssignment of [0, 1]) {
      entries.push({
        id: `${pairId}-s${sideAssignment}`,
        pairId,
        panel: "baseline",
        serveId,
        transform: "identity",
        sideAssignment,
        candidateSide: sideAssignment === 0 ? "left" : "right",
        baselineId,
        initialWorld: { ...SERVES[serveId] },
        randomInitialSeed: baselineId === "random" ? seed : null,
        randomSeedDerivationText: baselineId === "random" ? derivation : null,
        maxTicks: 192,
      });
    }
  }
}
assert.equal(entries.length, 32);
const synthetic = {
  ok: true,
  role: "synthetic",
  weights: new Float64Array(435),
  fingerprint: parameterFingerprint(new Float64Array(435)),
  rawResponseSha256: sha256Utf8("synthetic-zero-response"),
  rulesSha256: sha256Utf8("pong-feedback-v1-rules"),
  implementationSha256: sha256Utf8("pong-kernel"),
};
const dry = collectBaselineSchedule({ entries }, synthetic);
assert.equal(dry.labelled, "synthetic");
assert.equal(dry.scheduled, 32);
assert.equal(dry.played, 32);
const leftRandom = dry.records.find((item) => item.record.id === "synthetic-random-G0-s0");
const rightRandom = dry.records.find((item) => item.record.id === "synthetic-random-G0-s1");
assert.equal(leftRandom.record.initial.right.state.rng.initialSeed, rightRandom.record.initial.left.state.rng.initialSeed);
assert.equal(leftRandom.record.leftActions.length, leftRandom.record.playedTicks);
assert.equal(rightRandom.record.rightActions.length, rightRandom.record.playedTicks);
assert.notEqual(leftRandom.evidence.rawResponseSha256, leftRandom.evidence.parameterFingerprint);
assert.equal(Object.hasOwn(leftRandom.record, "decisions"), false);
assert.equal(leftRandom.evidence.decisions.length > 0, true);
assert.equal(leftRandom.record.initial.checkpointSha256.length, 64);
assert.ok(leftRandom.record.recordSha256.length === 64);

console.log("audit tests passed");

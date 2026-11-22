import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SERVES,
  freshWorld,
  stepWorld,
  quantize,
  infer,
  analyticTarget,
  uniformInt,
  xorshift32,
  demonstrationWeights,
  makeCheckpoint,
  makeController,
  cloneCheckpoint,
  advanceCheckpoint,
  advanceWithActions,
  compareBranches,
  replayActions,
  muteOutgoing,
} from "./kernel.js";
import {
  sha256Utf8,
  parameterFingerprint,
  validateContestant,
  acceptDemonstration,
  canonicalJson,
  DEMONSTRATION_FINGERPRINT,
} from "./validate.js";
import { baselineSeed, evaluateSlot } from "./evaluator.js";

const nodeHash = createHash("sha256").update("abc").digest("hex");
assert.equal(sha256Utf8("abc"), nodeHash);

assert.equal(quantize(-0.0000005), 0);
assert.equal(quantize(-0.0000015), -1);
assert.equal(quantize(0.0000005), 1);
assert.equal(quantize(0.0000015), 2);

const zeros = new Float64Array(435);
const stay = infer(zeros, [0, 0, 0, 0, 0, 0]);
assert.equal(stay.action, 0);
const tiedHigh = new Float64Array(435);
tiedHigh[433] = 1;
tiedHigh[434] = 1;
assert.equal(infer(tiedHigh, [0, 0, 0, 0, 0, 0]).action, 1);

function unshiftLeft(value, shift) {
  let result = value >>> 0;
  for (let step = 0; step < 32; step += shift) result = (value ^ (result << shift)) >>> 0;
  return result >>> 0;
}
function unshiftRight(value, shift) {
  let result = value >>> 0;
  for (let step = 0; step < 32; step += shift) result = (value ^ (result >>> shift)) >>> 0;
  return result >>> 0;
}
function unxorshift32(value) {
  let next = value >>> 0;
  next = unshiftLeft(next, 5);
  next = unshiftRight(next, 17);
  next = unshiftLeft(next, 13);
  return next >>> 0;
}
const rejected = 0xffffffff;
const preimage = unxorshift32(rejected);
assert.equal(xorshift32(preimage), rejected);
const draw = uniformInt(preimage, 3);
assert.equal(draw.rejections, 1);
assert.equal(draw.state, xorshift32(rejected));
assert.equal(draw.value, draw.state % 3);
assert.notEqual(draw.state, rejected);

function envelope(tokens, order = "version") {
  const list = "[" + tokens.join(",") + "]";
  if (order === "weights") return `{\n\t"weights": ${list}, "version": "pong-feedback-v1"\n}`;
  return `{"version":"pong-feedback-v1","weights":${list}}`;
}
function zeroTokens(count = 435) {
  return Array.from({ length: count }, () => "0");
}

const forward = validateContestant(envelope(zeroTokens()));
assert.equal(forward.ok, true);
assert.equal(forward.role, "candidate");
assert.equal(forward.report.scalarCount, 435);
assert.equal(forward.weights[0], 0);
const reversed = validateContestant(envelope(zeroTokens(), "weights"));
assert.equal(reversed.ok, true);
assert.equal(reversed.fingerprint, forward.fingerprint);

const endpoints = zeroTokens();
endpoints[0] = "-16";
endpoints[1] = "16";
endpoints[2] = "-0";
endpoints[3] = "0.000001";
endpoints[4] = "-16.000000";
const ends = validateContestant(envelope(endpoints));
assert.equal(ends.ok, true);
assert.equal(Object.is(ends.weights[2], -0), false);
assert.equal(ends.weights[2], 0);
assert.equal(ends.report.rawResponseSha256, sha256Utf8(envelope(endpoints)));
assert.notEqual(ends.report.rawResponseSha256, ends.report.parameterFingerprintSha256);

function rejects(text, code) {
  const result = validateContestant(text);
  assert.equal(result.ok, false, text.slice(0, 80));
  assert.equal(result.report.errors[0].code, code, JSON.stringify(result.report.errors));
  assert.equal(result.weights, undefined);
}

rejects(envelope(zeroTokens(434)), "shape");
rejects(envelope(zeroTokens(436)), "shape");
rejects(`{"version":"pong-feedback-v1","version":"pong-feedback-v1","weights":[${zeroTokens().join(",")}]}`, "duplicate");
rejects(`{"\\u0076ersion":"pong-feedback-v1","version":"pong-feedback-v1","weights":[${zeroTokens().join(",")}]}`, "duplicate");
rejects(`{"version":"pong-feedback-v1","weights":[${zeroTokens().join(",")}],"extra":1}`, "keys");
rejects(`{"version":"other","weights":[${zeroTokens().join(",")}]}`, "version");
rejects(Uint8Array.from([0xff, 0x7b]), "utf8");
rejects(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "bom");
rejects("x".repeat(16385), "size");
rejects("```json\n" + envelope(zeroTokens()), "fence");
rejects("Here is the object " + envelope(zeroTokens()), "prose");
rejects(envelope(zeroTokens()) + "{}", "trailing");

const badTypes = zeroTokens();
rejects(envelope(badTypes).replace("[", '["1",'), "type");
rejects(`{"version":"pong-feedback-v1","weights":[${zeroTokens().slice(0, 434).join(",")},[0]]}`, "nesting");
rejects(envelope(zeroTokens()).replace("[", "[1e1,"), "exponent");
rejects(envelope(zeroTokens()).replace("[", "[1.0000001,"), "precision");
rejects(envelope(zeroTokens()).replace("[", "[+1,"), "plus");
rejects(envelope(zeroTokens()).replace("[", "[01,"), "leading-zero");
rejects(envelope(zeroTokens()).replace("[", "[1.,"), "fraction");
rejects(envelope(zeroTokens()).replace("[", "[16.1,"), "magnitude");
rejects(envelope(zeroTokens()).replace("[", "[NaN,"), "token");

const demo = demonstrationWeights();
for (let index = 0; index < 435; index += 1) {
  assert.ok(Math.abs(demo[index]) <= 16);
  assert.ok(Number.isFinite(demo[index]));
}
assert.equal(parameterFingerprint(demo), DEMONSTRATION_FINGERPRINT);

const tick31 = freshWorld({ x: 0, y: 8, vx: 1, vy: 0, pLeft: 8, pRight: 8 });
assert.equal(analyticTarget(tick31, "right"), 8);

const parentPrint = parameterFingerprint(demo);
const muted = muteOutgoing(demo, "h1", 2);
const checkpoint = makeCheckpoint({
  world: freshWorld(SERVES.G0),
  left: makeController("network", { id: "demonstration", artifactSha256: parentPrint }),
  right: makeController("random", { id: "random", seed: 0x57474632 }),
  parentParameterFingerprint: parentPrint,
  episode: { id: "local", serveId: "G0", cohort: null, round: null, seedPairId: null },
});
const saved = canonicalJson(checkpoint);
const first = advanceCheckpoint(checkpoint, { left: demo, right: null });
assert.equal(first.checkpoint.right.state.rng.drawCount, 1);
assert.equal(first.checkpoint.parentParameterFingerprint, parentPrint);
assert.equal(canonicalJson(checkpoint), saved);
const otherOpponent = cloneCheckpoint(checkpoint);
otherOpponent.right.ref.kind = "stay";
const fromOriginal = advanceCheckpoint(checkpoint, { left: demo, right: null });
assert.equal(fromOriginal.right.controller, "random");
assert.notEqual(fromOriginal.checkpoint.right.state.rng.state, checkpoint.right.state.rng.state);

const terminal = cloneCheckpoint(first.checkpoint);
terminal.world.phase = "terminal";
terminal.world.terminal = { reason: "timeout", winner: null };
assert.equal(advanceCheckpoint(terminal, { left: demo, right: null }).error, "terminal");

const pair = compareBranches(checkpoint, demo, muted.weights);
assert.equal(pair.parent.checkpoint.parentParameterFingerprint, parentPrint);
assert.equal(pair.fork.checkpoint.parentParameterFingerprint, parentPrint);
assert.equal(pair.parent.decisions[0].left.inputs.join(","), pair.fork.decisions[0].left.inputs.join(","));
assert.notEqual(pair.parent.trajectory ? 0 : pair.parent.worlds.length, 0);

const replay = replayActions(checkpoint, "su", "dd");
assert.equal(replay.inferred, false);
assert.equal(replay.checkpoint.control.mode, "replay");
assert.equal(replay.checkpoint.control.nextActionOffset, 2);

const offline = evaluateSlot({
  id: "synthetic-stay-g0",
  pairId: "synthetic-stay-g0",
  serveId: "G0",
  candidateSide: "left",
  baselineId: "stay",
  initialWorld: { ...SERVES.G0, elapsedTicks: 0, phase: "live", terminal: null },
  randomInitialSeed: null,
}, zeros, parameterFingerprint(zeros));
const again = evaluateSlot({
  id: "synthetic-stay-g0",
  pairId: "synthetic-stay-g0",
  serveId: "G0",
  candidateSide: "left",
  baselineId: "stay",
  initialWorld: { ...SERVES.G0, elapsedTicks: 0, phase: "live", terminal: null },
  randomInitialSeed: null,
}, zeros, parameterFingerprint(zeros));
assert.equal(offline.status, "played");
assert.equal(offline.trajectorySha256, again.trajectorySha256);
assert.equal(offline.playedTicks > 0, true);
const missing = evaluateSlot({ id: "missing", candidateSide: "left", baselineId: "stay", initialWorld: SERVES.G0 }, null, null);
assert.equal(missing.status, "forfeit-not-played");
assert.deepEqual(missing.playedPoints, [null, null]);

assert.equal(baselineSeed("abc"), 0xba7816bf);
assert.equal(stepWorld(freshWorld({ x: 1, y: 8, vx: -1, vy: 1, pLeft: 8, pRight: 8 }), 1, 0).pLeft > 1, true);

console.log("contract tests passed");

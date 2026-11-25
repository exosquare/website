import assert from "node:assert/strict";
import {
  SERVES,
  freshWorld,
  stepWorld,
  quantize,
  infer,
  observe,
  analyticTarget,
  baselineAction,
  muteOutgoing,
  radiusOf,
  parameterCounts,
  xorshift32,
  demonstrationWeights,
} from "./kernel.js";

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);
}

const bottom = stepWorld(freshWorld({ x: 16, y: 0, vx: 1, vy: -1, pLeft: 8, pRight: 8 }), 0, 0);
assert.equal(bottom.y, 1);
assert.equal(bottom.vy, 1);
assert.equal(bottom.x, 17);
assert.equal(bottom.phase, "live");

const top = stepWorld(freshWorld({ x: 16, y: 15, vx: 1, vy: 1, pLeft: 8, pRight: 8 }), 0, 0);
assert.equal(top.y, 14);
assert.equal(top.vy, -1);

const stayDown = stepWorld(freshWorld({ x: 16, y: 1, vx: 1, vy: -1, pLeft: 8, pRight: 8 }), 0, 0);
assert.equal(stayDown.y, 0);
assert.equal(stayDown.vy, -1);

const catchFlat = stepWorld(freshWorld({ x: 2, y: 7, vx: -2, vy: 1, pLeft: 8, pRight: 8 }), 0, 0);
assert.equal(catchFlat.phase, "live");
assert.equal(catchFlat.x, 0);
assert.equal(catchFlat.vx, 2);
assert.equal(catchFlat.vy, 1);

const catchDown = stepWorld(freshWorld({ x: 2, y: 6, vx: -2, vy: 1, pLeft: 8, pRight: 8 }), 0, 0);
assert.equal(catchDown.vy, -2);
assert.equal(catchDown.vx, 2);

const catchUp = stepWorld(freshWorld({ x: 2, y: 8, vx: -2, vy: 1, pLeft: 8, pRight: 8 }), 0, 0);
assert.equal(catchUp.vy, 2);

const missLeft = stepWorld(freshWorld({ x: 1, y: 8, vx: -2, vy: 1, pLeft: 2, pRight: 8 }), 0, 0);
assert.equal(missLeft.phase, "terminal");
assert.equal(missLeft.terminal.winner, "right");
assert.equal(missLeft.x, -1);
assert.equal(missLeft.vy, 1);

const missRight = stepWorld(freshWorld({ x: 30, y: 8, vx: 2, vy: 1, pLeft: 8, pRight: 2 }), 0, 0);
assert.equal(missRight.terminal.winner, "left");
assert.equal(missRight.x, 32);

const latePoint = freshWorld({ x: 1, y: 8, vx: -2, vy: 1, pLeft: 2, pRight: 8 });
latePoint.elapsedTicks = 191;
const pointOnLast = stepWorld(latePoint, 0, 0);
assert.equal(pointOnLast.terminal.reason, "right-point");
assert.equal(pointOnLast.elapsedTicks, 192);

const lateLive = freshWorld({ x: 16, y: 8, vx: 1, vy: 1, pLeft: 8, pRight: 8 });
lateLive.elapsedTicks = 191;
const timeout = stepWorld(lateLive, 0, 0);
assert.equal(timeout.terminal.reason, "timeout");
assert.equal(timeout.terminal.winner, null);
assert.equal(stepWorld(timeout, 0, 0).error, "terminal");

assert.equal(quantize(0), 0);
assert.equal(quantize(1), 1000000);
assert.equal(quantize(-1), -1000000);
assert.equal(quantize(0.5), 500000);

const zeros = new Float64Array(435);
const tied = infer(zeros, [0, 0, 0, 0, 0, 0]);
assert.deepEqual(tied.comparisonScores, [0, 0, 0]);
assert.equal(tied.action, 0);

const upBias = new Float64Array(435);
upBias[433] = 1;
const up = infer(upBias, [0, 0, 0, 0, 0, 0]);
assert.equal(up.rawScores[1], 1);
assert.equal(up.action, 1);

const g0 = freshWorld(SERVES.G0);
assert.deepEqual(observe(g0, "left"), [16 / 31, 8 / 15, 1 / 2, 1 / 2, 8 / 15, 8 / 15]);
assert.equal(observe(g0, "right")[0], (31 - 16) / 31);
assert.equal(observe(g0, "right")[2], -1 / 2);

const incoming = freshWorld({ x: 10, y: 4, vx: -1, vy: 1, pLeft: 8, pRight: 8 });
const landing = analyticTarget(incoming, "left");
assert.equal(typeof landing, "number");
assert.ok(landing >= 0 && landing <= 15);
assert.equal(analyticTarget(freshWorld(SERVES.G0), "left"), 8);
const tick31 = freshWorld({ x: 31, y: 6, vx: -1, vy: 0, pLeft: 8, pRight: 8 });
tick31.vy = 1;
assert.equal(analyticTarget(tick31, "left") >= 0, true);

assert.equal(baselineAction("reactive", freshWorld({ x: 16, y: 14, vx: 1, vy: 1, pLeft: 8, pRight: 8 }), "left", 1).action, 1);
assert.equal(baselineAction("reactive", freshWorld({ x: 16, y: 2, vx: 1, vy: 1, pLeft: 8, pRight: 8 }), "left", 1).action, 2);
assert.equal(baselineAction("stay", freshWorld(SERVES.G0), "right", 1).action, 0);

const randomA = baselineAction("random", freshWorld(SERVES.G0), "right", 0x12345678);
const randomB = baselineAction("random", freshWorld(SERVES.G0), "right", 0x12345678);
assert.equal(randomA.action, randomB.action);
assert.equal(xorshift32(1) >>> 0, xorshift32(1) >>> 0);

const parent = demonstrationWeights();
const muted = muteOutgoing(parent, "h1", 2);
assert.equal(muted.start, 144);
assert.equal(muted.end, 160);
assert.equal(muted.changes.length, 16);
assert.equal(muted.actualChangedCount, 16);
for (let index = 144; index < 160; index += 1) assert.equal(muted.weights[index], 0);
assert.equal(muted.weights[96], parent[96]);
assert.equal(muted.weights[143], parent[143]);
const again = muteOutgoing(muted.weights, "h1", 2);
assert.equal(again.actualChangedCount, 0);
const h2 = muteOutgoing(parent, "h2", 4);
assert.equal(h2.start, 396);
assert.equal(h2.end, 399);
assert.equal(h2.changes.length, 3);

near(radiusOf(-16), 0.4);
near(radiusOf(0), 0.6);
near(radiusOf(16), 0.8);
assert.ok(radiusOf(18) < 1 && radiusOf(18) > 0.8);
assert.ok(radiusOf(-1000) > 0.2 && radiusOf(1000) < 1);

const counts = parameterCounts();
assert.equal(counts.weights, 400);
assert.equal(counts.biases, 35);

const before = infer(parent, observe(g0, "left"));
const after = infer(muted.weights, observe(g0, "left"));
assert.equal(before.rawScores.length, 3);
assert.equal(after.comparisonScores.length, 3);
assert.ok(before.comparisonScores.every((score) => Number.isInteger(score)));

console.log("kernel tests passed");

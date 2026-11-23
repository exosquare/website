import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalJson, sha256Utf8, validateContestant } from "../../public/experiments/pong/validate.js";
import { replayActions } from "../../public/experiments/pong/kernel.js";

function sha(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const freeze = JSON.parse(readFileSync(new URL("./freeze-manifest.json", import.meta.url), "utf8"));
assert.equal(sha("public/experiments/pong/kernel.js"), freeze.runtime.kernel);
assert.equal(sha("public/experiments/pong/validate.js"), freeze.runtime.validator);
assert.equal(sha("public/experiments/pong/evaluator.js"), freeze.runtime.evaluator);
assert.equal(sha("tools/pong-evaluation/evaluation-schedule.json"), freeze.scheduleIdentity.sha256);
assert.equal(sha("public/experiments/pong/data/grok-assisted-row-canonical.json"), freeze.canonicalPlayer.sha256);
assert.equal(freeze.gamesPlayedBeforeFreeze, 0);
assert.equal(freeze.scheduleIdentity.runId, "grok-initial-v1");
assert.equal(freeze.evaluationIdentity.id, "grok-assisted-row-initial");
assert.notEqual(freeze.evaluationIdentity.id, freeze.scheduleIdentity.runId);

const player = validateContestant(readFileSync("public/experiments/pong/data/grok-assisted-row-canonical.json"));
assert.equal(player.ok, true);
assert.equal(player.fingerprint, "7ef77b133f6c57768725328b849cfee70ff9dae14d434a63580bac4a5c4c54fd");

const result = JSON.parse(readFileSync(new URL("./result.json", import.meta.url), "utf8"));
assert.equal(result.reconstructionOk, true);
assert.equal(result.summary.scheduled, 32);
assert.equal(result.summary.played, 32);
assert.equal(result.summary.failed, 0);
assert.equal(result.summary.notPlayed, 0);
assert.deepEqual(result.summary.playedPointSum, [15, 17]);
assert.deepEqual(result.summary.administrativePointSum, [0, 0]);
assert.deepEqual(result.summary.candidateOutcomes, { played: 32, wins: 17, losses: 15, draws: 0 });
assert.equal(result.summary.independentSamples, false);
assert.equal(Object.keys(result.summary.pairs).length, 16);
assert.equal(result.records.length, 32);

for (const item of result.records) {
  const replay = replayActions(item.record.initial, item.record.leftActions, item.record.rightActions);
  assert.equal(replay.error, undefined, item.record.id);
  assert.equal(canonicalJson(replay.checkpoint.world), canonicalJson(item.record.final), item.record.id);
  assert.equal(sha256Utf8(canonicalJson(item.evidence.worlds)), item.record.trajectorySha256, item.record.id);
  assert.equal(item.record.playedPoints[0] + item.record.playedPoints[1], 1, item.record.id);
  assert.deepEqual(item.record.administrativePoints, [null, null], item.record.id);
}

const status = JSON.parse(readFileSync("public/experiments/pong/data/assisted-row-status.json", "utf8"));
assert.equal(status.id, "grok-assisted-row-initial");
assert.equal(status.wins, 17);
assert.equal(status.losses, 15);
assert.equal(status.draws, 0);
assert.equal(status.capabilityVerdict, false);
assert.equal(status.canonicalSha256, freeze.canonicalPlayer.sha256);
console.log("evaluation replay passed");

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJson, validateContestant, sha256Utf8 } from "../../public/experiments/pong/validate.js";
import { replayActions } from "../../public/experiments/pong/kernel.js";
import { collectBaselineSchedule } from "../../public/experiments/pong/evaluator.js";

function sha(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const freeze = JSON.parse(readFileSync(new URL("./freeze-manifest.json", import.meta.url), "utf8"));
const checks = [
  ["public/experiments/pong/kernel.js", freeze.runtime.kernel],
  ["public/experiments/pong/validate.js", freeze.runtime.validator],
  ["public/experiments/pong/evaluator.js", freeze.runtime.evaluator],
  ["public/experiments/pong/weights.schema.json", freeze.runtime.schema],
  ["public/experiments/pong/data/grok-assisted-row-canonical.json", freeze.canonicalPlayer.sha256],
  ["tools/pong-evaluation/evaluation-schedule.json", freeze.scheduleIdentity.sha256],
];
for (const [path, expected] of checks) {
  const actual = sha(path);
  if (actual !== expected) throw new Error(`freeze mismatch ${path} ${actual}`);
}
if (freeze.gamesPlayedBeforeFreeze !== 0) throw new Error("freeze");

const playerBytes = readFileSync("public/experiments/pong/data/grok-assisted-row-canonical.json");
const accepted = validateContestant(playerBytes);
if (!accepted.ok || accepted.fingerprint !== freeze.canonicalPlayer.parameterFingerprintSha256) throw new Error("player");
const schedule = JSON.parse(readFileSync("tools/pong-evaluation/evaluation-schedule.json", "utf8"));
if (schedule.runId !== "grok-initial-v1" || schedule.entries.length !== 32) throw new Error("schedule");

const identity = {
  ok: true,
  role: freeze.evaluationIdentity.id,
  weights: accepted.weights,
  fingerprint: accepted.fingerprint,
  rawResponseSha256: accepted.rawResponseSha256,
  rulesSha256: sha256Utf8("pong-feedback-v1-rules"),
  implementationSha256: sha256Utf8("pong-kernel"),
};
const result = collectBaselineSchedule(schedule, identity);
if (result.error) throw new Error(result.error);

const reconstruction = [];
for (const item of result.records) {
  const replay = replayActions(item.record.initial, item.record.leftActions, item.record.rightActions);
  const finalWorld = replay.checkpoint ? replay.checkpoint.world : null;
  const sameFinal = finalWorld && canonicalJson(finalWorld) === canonicalJson(item.record.final);
  const trajectory = sha256Utf8(canonicalJson(item.evidence.worlds));
  reconstruction.push({
    id: item.record.id,
    pairId: item.evidence.pairId,
    baselineId: item.evidence.baselineId,
    candidateSide: item.evidence.candidateSide,
    status: item.record.status,
    playedTicks: item.record.playedTicks,
    actionLength: item.record.leftActions.length,
    replaySteps: replay.steps ?? null,
    replayError: replay.error || null,
    finalMatches: sameFinal,
    trajectoryMatches: trajectory === item.record.trajectorySha256,
  });
}
const failedReconstruction = reconstruction.filter((row) => !row.finalMatches || !row.trajectoryMatches || row.replayError);
const summary = summarize(result);
const output = {
  schema: "pong-evaluation-result-v1",
  evaluationIdentity: freeze.evaluationIdentity,
  scheduleSha256: freeze.scheduleIdentity.sha256,
  canonicalPlayerSha256: freeze.canonicalPlayer.sha256,
  parameterFingerprintSha256: freeze.canonicalPlayer.parameterFingerprintSha256,
  summary,
  reconstructionOk: failedReconstruction.length === 0,
  reconstruction,
  records: result.records,
};
writeFileSync("tools/pong-evaluation/result.json", JSON.stringify(output));
writeFileSync("tools/pong-evaluation/reconstruction.json", JSON.stringify({ ok: failedReconstruction.length === 0, rows: reconstruction }));
console.log(JSON.stringify({ summary, reconstructionOk: failedReconstruction.length === 0, failures: failedReconstruction.length }));

function summarize(inventory) {
  const rows = inventory.records.map((item) => {
    const points = item.record.playedPoints;
    const side = item.evidence.candidateSide;
    const candidate = side === "right" ? points[1] : points[0];
    const opponent = side === "right" ? points[0] : points[1];
    let outcome = "not-played";
    if (item.record.status === "played" && candidate != null) {
      outcome = candidate > opponent ? "win" : candidate < opponent ? "loss" : "draw";
    }
    return {
      id: item.record.id,
      pairId: item.evidence.pairId,
      baselineId: item.evidence.baselineId,
      serveId: item.record.serveId,
      candidateSide: side,
      status: item.record.status,
      outcome,
      playedPoints: points,
      administrativePoints: item.record.administrativePoints,
      winner: item.record.winner,
      termination: item.record.termination,
    };
  });
  const played = rows.filter((row) => row.status === "played");
  function count(list) {
    return {
      played: list.length,
      wins: list.filter((row) => row.outcome === "win").length,
      losses: list.filter((row) => row.outcome === "loss").length,
      draws: list.filter((row) => row.outcome === "draw").length,
    };
  }
  const byBaseline = {};
  const bySide = {};
  for (const row of played) {
    byBaseline[row.baselineId] = byBaseline[row.baselineId] || [];
    byBaseline[row.baselineId].push(row);
    bySide[row.candidateSide] = bySide[row.candidateSide] || [];
    bySide[row.candidateSide].push(row);
  }
  const pairs = {};
  for (const row of rows) {
    pairs[row.pairId] = pairs[row.pairId] || [];
    pairs[row.pairId].push({ side: row.candidateSide, outcome: row.outcome, serveId: row.serveId, baselineId: row.baselineId, playedPoints: row.playedPoints });
  }
  return {
    scheduled: inventory.scheduled,
    played: inventory.played,
    notPlayed: inventory.notPlayed,
    failed: inventory.failed,
    playedDenominator: played.length,
    playedPointSum: inventory.playedPointSum,
    administrativePointSum: inventory.administrativePointSum,
    candidateOutcomes: count(played),
    byBaseline: Object.fromEntries(Object.entries(byBaseline).map(([key, list]) => [key, count(list)])),
    bySide: Object.fromEntries(Object.entries(bySide).map(([key, list]) => [key, count(list)])),
    pairs,
    administrativeFaultsSeparate: true,
    independentSamples: false,
  };
}

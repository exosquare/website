import {
  freshWorld,
  makeCheckpoint,
  makeController,
  cloneCheckpoint,
  runEpisode,
} from "./kernel.js";
import { canonicalJson, sha256Utf8 } from "./validate.js";

const ACTION_LETTER = ["s", "u", "d"];

export function baselineSeed(text) {
  const hash = sha256Utf8(text);
  const seed = Number.parseInt(hash.slice(0, 8), 16) >>> 0;
  return seed === 0 ? 1 : seed;
}

export function trajectoryHash(worlds) {
  return sha256Utf8(canonicalJson(worlds));
}

export function hashCheckpoint(checkpoint) {
  const copy = cloneCheckpoint(checkpoint);
  delete copy.checkpointSha256;
  return sha256Utf8(canonicalJson(copy));
}

export function sealCheckpoint(checkpoint, identity) {
  const next = cloneCheckpoint(checkpoint);
  next.rulesSha256 = identity.rulesSha256 || null;
  next.left.ref.implementationSha256 = identity.implementationSha256 || null;
  next.right.ref.implementationSha256 = identity.implementationSha256 || null;
  if (next.left.ref.kind === "network") next.left.ref.artifactSha256 = identity.rawResponseSha256 || null;
  if (next.right.ref.kind === "network") next.right.ref.artifactSha256 = identity.rawResponseSha256 || null;
  next.parentParameterFingerprint = identity.fingerprint || next.parentParameterFingerprint || null;
  delete next.checkpointSha256;
  next.checkpointSha256 = hashCheckpoint(next);
  return next;
}

function letters(decisions, side) {
  return decisions.map(function (step) {
    return ACTION_LETTER[step[side].action] || "?";
  }).join("");
}

function blankRecord(slot, status, termination) {
  return {
    id: slot.id || null,
    status,
    panel: slot.panel || "baseline",
    transform: slot.transform || "identity",
    serveId: slot.serveId || null,
    pairId: slot.pairId || null,
    candidateSide: slot.candidateSide || null,
    baselineId: slot.baselineId || null,
    initial: null,
    decisions: [],
    worlds: null,
    leftActions: "",
    rightActions: "",
    contacts: [],
    misses: [],
    failures: status === "played" ? [] : [{ code: termination || status }],
    termination,
    winner: null,
    playedPoints: [null, null],
    playedTicks: 0,
    trajectorySha256: null,
    rawResponseSha256: null,
    parameterFingerprint: null,
  };
}

function withRecordHash(record) {
  const body = { ...record };
  delete body.recordSha256;
  return { ...record, recordSha256: sha256Utf8(canonicalJson(body)) };
}

export function evaluateSlot(slot, accepted) {
  if (!accepted || accepted.ok !== true || !accepted.weights || accepted.weights.length !== 435) {
    return withRecordHash(blankRecord(slot, "forfeit-not-played", "invalid-artifact"));
  }
  const seedText = slot.randomSeedDerivationText || null;
  const packedSeed = slot.randomInitialSeed || null;
  const seed = slot.baselineId === "random" ? (packedSeed || (seedText ? baselineSeed(seedText) : 1)) : 1;
  const baseline = makeController(slot.baselineId, {
    id: slot.baselineId,
    seed,
    state: seed,
  });
  const candidate = makeController("network", {
    id: accepted.role || "synthetic",
    artifactSha256: accepted.rawResponseSha256 || null,
  });
  const left = slot.candidateSide === "left" ? candidate : baseline;
  const right = slot.candidateSide === "right" ? candidate : baseline;
  const checkpoint = sealCheckpoint(makeCheckpoint({
    world: freshWorld(slot.initialWorld),
    left,
    right,
    parentParameterFingerprint: accepted.fingerprint || null,
    rulesSha256: accepted.rulesSha256 || null,
    episode: {
      id: slot.id,
      serveId: slot.serveId,
      cohort: null,
      round: 0,
      seedPairId: slot.pairId || null,
    },
  }), accepted);
  const episode = runEpisode(checkpoint, {
    left: left.ref.kind === "network" ? accepted.weights : null,
    right: right.ref.kind === "network" ? accepted.weights : null,
  });
  if (episode.error) {
    const failed = blankRecord(slot, "failed", "runtime-fault");
    failed.failures = [{ code: episode.error }];
    failed.rawResponseSha256 = accepted.rawResponseSha256 || null;
    failed.parameterFingerprint = accepted.fingerprint || null;
    return withRecordHash(failed);
  }
  const contacts = [];
  const misses = [];
  episode.decisions.forEach(function (step) {
    if (step.event && Object.hasOwn(step.event, "vxAfter")) contacts.push(step.event);
    if (step.event && Object.hasOwn(step.event, "missDistance")) misses.push(step.event);
  });
  return withRecordHash({
    schema: "pong-episode-v1",
    id: slot.id,
    runId: accepted.role || "synthetic",
    taskVersion: "pong-feedback-v1",
    rulesSha256: accepted.rulesSha256 || null,
    scheduleId: slot.pairId || slot.id,
    status: "played",
    panel: slot.panel || "baseline",
    cohort: null,
    round: 0,
    orbitId: null,
    transform: slot.transform || "identity",
    sideAssignment: slot.sideAssignment ?? (slot.candidateSide === "right" ? 1 : 0),
    serveId: slot.serveId || null,
    pairId: slot.pairId || null,
    candidateSide: slot.candidateSide,
    baselineId: slot.baselineId,
    leftArtifactId: left.ref.kind === "network" ? (accepted.rawResponseSha256 || null) : null,
    rightArtifactId: right.ref.kind === "network" ? (accepted.rawResponseSha256 || null) : null,
    initial: checkpoint,
    decisions: episode.decisions,
    worlds: episode.worlds,
    leftActions: letters(episode.decisions, "left"),
    rightActions: letters(episode.decisions, "right"),
    contacts,
    misses,
    miss: misses[0] || null,
    administrativePoints: [null, null],
    contactCounts: [
      contacts.filter(function (event) { return event.side === "left"; }).length,
      contacts.filter(function (event) { return event.side === "right"; }).length,
    ],
    durationTicks: episode.playedTicks,
    missDistance: misses[0] ? misses[0].missDistance : null,
    duplicateOf: null,
    failures: [],
    termination: episode.termination,
    winner: episode.winner,
    playedPoints: episode.playedPoints,
    playedTicks: episode.playedTicks,
    trajectorySha256: trajectoryHash(episode.worlds),
    rawResponseSha256: accepted.rawResponseSha256 || null,
    parameterFingerprint: accepted.fingerprint || null,
    final: episode.checkpoint.world,
  });
}

export function collectBaselineSchedule(schedule, accepted) {
  if (!schedule || !Array.isArray(schedule.entries) || schedule.entries.length !== 32) {
    return { error: "schedule" };
  }
  if (!accepted || accepted.ok !== true) return { error: "unvalidated" };
  const records = schedule.entries.map(function (entry) {
    return evaluateSlot(entry, accepted);
  });
  return {
    labelled: accepted.role || "synthetic",
    scheduled: 32,
    played: records.filter(function (record) { return record.status === "played"; }).length,
    records,
  };
}

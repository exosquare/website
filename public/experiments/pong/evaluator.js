import {
  freshWorld,
  cloneWorld,
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

function failureEntry(stage, code, message) {
  return {
    stage,
    code,
    message,
    artifactId: null,
    tick: null,
    requestId: null,
    retriable: false,
  };
}

function slotCheckpoint(slot, accepted, playable) {
  const seedText = slot.randomSeedDerivationText || null;
  const packedSeed = slot.randomInitialSeed || null;
  const seed = slot.baselineId === "random" ? (packedSeed || (seedText ? baselineSeed(seedText) : 1)) : 1;
  const baseline = makeController(slot.baselineId, {
    id: slot.baselineId,
    seed,
    state: seed,
  });
  const candidate = makeController("network", {
    id: playable ? (accepted.role || "synthetic") : "unvalidated",
    artifactSha256: playable ? (accepted.rawResponseSha256 || null) : null,
  });
  const left = slot.candidateSide === "left" ? candidate : baseline;
  const right = slot.candidateSide === "right" ? candidate : baseline;
  const identity = playable ? accepted : {
    rulesSha256: null,
    implementationSha256: null,
    rawResponseSha256: null,
    fingerprint: null,
  };
  return {
    left,
    right,
    checkpoint: sealCheckpoint(makeCheckpoint({
      world: freshWorld(slot.initialWorld),
      left,
      right,
      parentParameterFingerprint: playable ? (accepted.fingerprint || null) : null,
      rulesSha256: identity.rulesSha256 || null,
      episode: {
        id: slot.id,
        serveId: slot.serveId,
        cohort: null,
        round: 0,
        seedPairId: slot.pairId || null,
      },
    }), identity),
  };
}

function recordShell(slot, accepted, checkpoint) {
  const sideAssignment = slot.sideAssignment ?? (slot.candidateSide === "right" ? 1 : 0);
  return {
    schema: "pong-episode-v1",
    id: slot.id,
    runId: accepted && accepted.role ? accepted.role : "unvalidated",
    taskVersion: "pong-feedback-v1",
    rulesSha256: accepted && accepted.rulesSha256 ? accepted.rulesSha256 : null,
    scheduleId: slot.pairId || slot.id,
    panel: slot.panel || "baseline",
    cohort: null,
    round: 0,
    serveId: slot.serveId || null,
    orbitId: null,
    transform: slot.transform || "identity",
    sideAssignment,
    initial: checkpoint,
    leftArtifactId: null,
    rightArtifactId: null,
    leftActions: "",
    rightActions: "",
    contacts: [],
    miss: null,
    final: cloneWorld(checkpoint.world),
    playedTicks: 0,
    status: "forfeit-not-played",
    winner: null,
    termination: "invalid-artifact",
    playedPoints: [null, null],
    administrativePoints: [null, null],
    contactCounts: [0, 0],
    durationTicks: 0,
    missDistance: null,
    trajectorySha256: null,
    duplicateOf: null,
    failures: [failureEntry("validation", "invalid-artifact", "The candidate was not accepted. No game was played.")],
  };
}

function evidenceShell(slot, checkpoint, accepted) {
  return {
    schema: "pong-episode-evidence-v1",
    id: slot.id,
    pairId: slot.pairId || null,
    candidateSide: slot.candidateSide || null,
    baselineId: slot.baselineId || null,
    decisions: [],
    worlds: [cloneWorld(checkpoint.world)],
    misses: [],
    rawResponseSha256: accepted && accepted.rawResponseSha256 ? accepted.rawResponseSha256 : null,
    parameterFingerprint: accepted && accepted.fingerprint ? accepted.fingerprint : null,
  };
}

function bundle(record, evidence) {
  return {
    schema: "pong-episode-bundle-v1",
    record: withRecordHash(record),
    evidence,
  };
}

function withRecordHash(record) {
  const body = { ...record };
  delete body.recordSha256;
  return { ...record, recordSha256: sha256Utf8(canonicalJson(body)) };
}

export function evaluateSlot(slot, accepted) {
  const playable = Boolean(accepted && accepted.ok === true && accepted.weights && accepted.weights.length === 435);
  const scheduled = slotCheckpoint(slot, accepted, playable);
  if (!playable) return bundle(recordShell(slot, accepted, scheduled.checkpoint), evidenceShell(slot, scheduled.checkpoint, accepted));
  const episode = runEpisode(scheduled.checkpoint, {
    left: scheduled.left.ref.kind === "network" ? accepted.weights : null,
    right: scheduled.right.ref.kind === "network" ? accepted.weights : null,
  });
  if (episode.error) {
    const failed = recordShell(slot, accepted, scheduled.checkpoint);
    failed.status = "failed";
    failed.termination = "runtime-fault";
    failed.failures = [failureEntry("inference", "runtime-fault", "Inference stopped before a tick completed.")];
    const evidence = evidenceShell(slot, scheduled.checkpoint, accepted);
    return bundle(failed, evidence);
  }
  const contacts = [];
  const misses = [];
  episode.decisions.forEach(function (step) {
    if (step.event && Object.hasOwn(step.event, "vxAfter")) contacts.push(step.event);
    if (step.event && Object.hasOwn(step.event, "missDistance")) misses.push(step.event);
  });
  const played = recordShell(slot, accepted, scheduled.checkpoint);
  played.status = "played";
  played.termination = episode.termination;
  played.winner = episode.winner;
  played.failures = [];
  played.leftArtifactId = scheduled.left.ref.kind === "network" ? (accepted.rawResponseSha256 || null) : null;
  played.rightArtifactId = scheduled.right.ref.kind === "network" ? (accepted.rawResponseSha256 || null) : null;
  played.leftActions = letters(episode.decisions, "left");
  played.rightActions = letters(episode.decisions, "right");
  played.contacts = contacts;
  played.miss = misses[0] || null;
  played.final = episode.checkpoint.world;
  played.playedTicks = episode.playedTicks;
  played.playedPoints = episode.playedPoints;
  played.contactCounts = [
    contacts.filter(function (event) { return event.side === "left"; }).length,
    contacts.filter(function (event) { return event.side === "right"; }).length,
  ];
  played.durationTicks = episode.playedTicks;
  played.missDistance = misses[0] ? misses[0].missDistance : null;
  played.trajectorySha256 = trajectoryHash(episode.worlds);
  const evidence = evidenceShell(slot, scheduled.checkpoint, accepted);
  evidence.decisions = episode.decisions;
  evidence.worlds = episode.worlds;
  evidence.misses = misses;
  return bundle(played, evidence);
}

export function collectBaselineSchedule(schedule, accepted) {
  if (!schedule || !Array.isArray(schedule.entries) || schedule.entries.length !== 32) {
    return { error: "schedule" };
  }
  const records = schedule.entries.map(function (entry) {
    return evaluateSlot(entry, accepted);
  });
  return {
    labelled: accepted && accepted.role ? accepted.role : "unvalidated",
    scheduled: 32,
    played: records.filter(function (item) { return item.record.status === "played"; }).length,
    notPlayed: records.filter(function (item) { return item.record.status === "forfeit-not-played"; }).length,
    failed: records.filter(function (item) { return item.record.status === "failed"; }).length,
    records,
  };
}

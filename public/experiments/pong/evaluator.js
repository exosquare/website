import { freshWorld, makeCheckpoint, makeController, runEpisode } from "./kernel.js";
import { canonicalJson, sha256Utf8 } from "./validate.js";

export function baselineSeed(text) {
  const hash = sha256Utf8(text);
  const seed = Number.parseInt(hash.slice(0, 8), 16) >>> 0;
  return seed === 0 ? 1 : seed;
}

export function trajectoryHash(worlds) {
  return sha256Utf8(canonicalJson(worlds));
}

export function evaluateSlot(slot, candidateWeights, candidateFingerprint) {
  if (!candidateWeights || candidateWeights.length !== 435) {
    return {
      id: slot.id,
      status: "forfeit-not-played",
      termination: "invalid-artifact",
      winner: null,
      playedPoints: [null, null],
      playedTicks: 0,
      worlds: null,
    };
  }
  const baseline = makeController(slot.baselineId, {
    id: slot.baselineId,
    seed: slot.randomInitialSeed || 1,
  });
  const candidate = makeController("network", {
    id: "candidate",
    artifactSha256: candidateFingerprint,
  });
  const left = slot.candidateSide === "left" ? candidate : baseline;
  const right = slot.candidateSide === "right" ? candidate : baseline;
  const checkpoint = makeCheckpoint({
    world: freshWorld(slot.initialWorld),
    left,
    right,
    parentParameterFingerprint: candidateFingerprint,
    episode: {
      id: slot.id,
      serveId: slot.serveId,
      cohort: null,
      round: 0,
      seedPairId: slot.pairId || null,
    },
  });
  const episode = runEpisode(checkpoint, {
    left: left.ref.kind === "network" ? candidateWeights : null,
    right: right.ref.kind === "network" ? candidateWeights : null,
  });
  if (episode.error) {
    return { id: slot.id, status: "failed", termination: "runtime-fault", error: episode.error, playedPoints: [null, null] };
  }
  return {
    id: slot.id,
    status: "played",
    panel: "baseline",
    transform: "identity",
    termination: episode.termination,
    winner: episode.winner,
    playedPoints: episode.playedPoints,
    playedTicks: episode.playedTicks,
    trajectorySha256: trajectoryHash(episode.worlds),
    parentParameterFingerprint: checkpoint.parentParameterFingerprint,
    final: episode.checkpoint.world,
  };
}

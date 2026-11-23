const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const FIELDS = [
  "schema",
  "acceptedArtifact",
  "candidateLoaded",
  "date",
  "surface",
  "visibleMode",
  "apiModel",
  "apiVersion",
  "capturedTextKind",
  "capturedTextUtf8Bytes",
  "clipboardBytesRead",
  "validatorSha256",
  "validatorCapBytes",
  "officialError",
  "scalarCount",
  "parameterFingerprint",
  "scheduled",
  "played",
  "invalidArtifactNotPlayed",
  "runtimeFaults",
  "playedPoints",
  "strengthScore",
  "administrativeForfeitsAreObservedLosses",
  "transportBytes",
  "toolsOffVerified",
  "tokenUsageKnown",
  "composerMatchedFrozenPrompt",
  "screenshotsCoverFullText",
];

function grouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function englishDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error("date");
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!month || day < 1 || day > 31) throw new Error("date");
  return day + " " + month + " " + match[1];
}

export function readAuthoringStatus(input) {
  const record = typeof input === "string" ? JSON.parse(input) : input;
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("status");
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== FIELDS.slice().sort().join(",")) throw new Error("status-fields");
  if (record.schema !== "pong-authoring-status-v1") throw new Error("status-schema");
  if (record.acceptedArtifact !== false || record.candidateLoaded !== false) throw new Error("accepted");
  if (record.date !== "2026-11-23" || record.surface !== "grok.com" || record.visibleMode !== "Expert") throw new Error("route");
  if (record.apiModel !== null || record.apiVersion !== null) throw new Error("model");
  if (record.capturedTextKind !== "ui-innerText" || record.capturedTextUtf8Bytes !== 93902) throw new Error("capture");
  if (record.clipboardBytesRead !== false || record.transportBytes !== null) throw new Error("bytes");
  if (record.validatorSha256 !== "44bc8b0170ad400c927abfda67270b300e0381bbc2dfd2d4c8be3efcbc19f414") throw new Error("validator");
  if (record.validatorCapBytes !== 16384 || record.officialError !== "size") throw new Error("size");
  if (record.scalarCount !== null || record.parameterFingerprint !== null) throw new Error("fingerprint");
  if (record.scheduled !== 32 || record.played !== 0 || record.invalidArtifactNotPlayed !== 32 || record.runtimeFaults !== 0) throw new Error("schedule");
  if (record.playedPoints !== null || record.strengthScore !== null) throw new Error("score");
  if (record.administrativeForfeitsAreObservedLosses !== false) throw new Error("forfeit");
  if (record.toolsOffVerified !== false || record.tokenUsageKnown !== false) throw new Error("limits");
  if (record.composerMatchedFrozenPrompt !== false || record.screenshotsCoverFullText !== false) throw new Error("limits");
  if (Object.hasOwn(record, "weights")) throw new Error("weights");
  return record;
}

export function authoringCopy(record) {
  const status = readAuthoringStatus(record);
  return {
    outcome: "rejected",
    demonstration: "Demonstration weights. No official score.",
    attempt: "Grok authoring attempt rejected. No accepted artifact. " + status.scheduled + " scheduled, " + status.played + " played.",
    attemptNote: "One authoring attempt on " + englishDate(status.date)
      + " used the " + status.surface + " page in the visible " + status.visibleMode
      + " mode. The exact API model and version are unknown. The preserved text is the visible response innerText, "
      + grouped(status.capturedTextUtf8Bytes)
      + " UTF-8 bytes, and clipboard bytes were not read separately. It fails the unchanged validator ("
      + status.validatorSha256
      + ") at the " + grouped(status.validatorCapBytes)
      + "-byte cap. The only official error is " + status.officialError
      + ". There is no official scalar count and no parameter fingerprint. That byte count is captured page text, not a transport byte count.",
    scheduleNote: status.scheduled + " slots were scheduled, " + status.played
      + " were played, and " + status.invalidArtifactNotPlayed
      + " were invalid-artifact-not-played. Played points are null. There is no strength score. Administrative forfeits are not observed losses. No candidate is loaded, and the court plays the demonstration weights.",
    limits: "Token use is unknown. Tools-off was not independently verified. The visible composer text was not the same bytes as the frozen prompt. Screenshots do not cover the full captured text.",
    revision: "Unavailable. Only the demonstration parent is loaded. The rejected authoring attempt is not loaded.",
    play: "Demonstration weights. No official score. The Grok authoring attempt was rejected and is not loaded.",
  };
}

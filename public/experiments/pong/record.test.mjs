import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERVES } from "./kernel.js";
import {
  sha256Utf8,
  parameterFingerprint,
  validateContestant,
  missingResponseOutcome,
  finalizeReceipt,
  storeValidationReport,
  commitValidationTrio,
  EMPTY_RESPONSE_SHA256,
  PAPER_WEIGHTS_SCHEMA_SHA256,
  CORRECTION_MANIFEST_SHA256,
  VALIDATION_RECORD_SCHEMA_SHA256,
} from "./validate.js";
import { baselineSeed, evaluateSlot, collectBaselineSchedule } from "./evaluator.js";

const RECORD_FIELDS = [
  "schema", "id", "runId", "taskVersion", "rulesSha256", "scheduleId", "panel", "cohort", "round",
  "serveId", "orbitId", "transform", "sideAssignment", "initial", "leftArtifactId", "rightArtifactId",
  "leftActions", "rightActions", "contacts", "miss", "final", "playedTicks", "status", "winner",
  "termination", "playedPoints", "administrativePoints", "contactCounts", "durationTicks",
  "missDistance", "trajectorySha256", "duplicateOf", "failures", "recordSha256",
];
const FORBIDDEN = ["pairId", "candidateSide", "baselineId", "decisions", "worlds", "misses", "rawResponseSha256", "parameterFingerprint"];

function assertRecordShape(record) {
  assert.deepEqual(Object.keys(record).sort(), RECORD_FIELDS.slice().sort());
  FORBIDDEN.forEach((key) => assert.equal(Object.hasOwn(record, key), false));
  assert.equal(record.schema, "pong-episode-v1");
  assert.equal(record.administrativePoints[0], null);
  assert.equal(record.administrativePoints[1], null);
}

function slots() {
  const entries = [];
  for (const baselineId of ["stay", "random", "reactive", "analytic"]) {
    for (const serveId of ["G0", "G1", "G2", "G3"]) {
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
        });
      }
    }
  }
  return entries;
}

const rejected = { ok: false, role: "synthetic" };
const inventory = collectBaselineSchedule({ entries: slots() }, rejected);
assert.equal(inventory.error, undefined);
assert.equal(inventory.labelled, "synthetic");
assert.equal(inventory.scheduled, 32);
assert.equal(inventory.played, 0);
assert.equal(inventory.notPlayed, 32);
assert.equal(inventory.failed, 0);
inventory.records.forEach((item) => {
  assert.equal(item.schema, "pong-episode-bundle-v1");
  assert.equal(item.evidence.schema, "pong-episode-evidence-v1");
  assertRecordShape(item.record);
  assert.equal(item.record.status, "forfeit-not-played");
  assert.equal(item.record.termination, "invalid-artifact");
  assert.deepEqual(item.record.final, item.record.initial.world);
  assert.deepEqual(item.record.playedPoints, [null, null]);
  assert.equal(item.record.leftActions, "");
  assert.equal(item.record.rightActions, "");
  assert.equal(item.record.playedTicks, 0);
  assert.equal(item.record.trajectorySha256, null);
  assert.equal(item.evidence.decisions.length, 0);
  assert.equal(item.evidence.worlds.length, 1);
  assert.deepEqual(item.evidence.worlds[0], item.record.initial.world);
  assert.equal(item.evidence.pairId, item.record.scheduleId);
});

const synthetic = {
  ok: true,
  role: "synthetic",
  weights: new Float64Array(435),
  fingerprint: parameterFingerprint(new Float64Array(435)),
  rawResponseSha256: sha256Utf8("synthetic-zero-response"),
  rulesSha256: sha256Utf8("pong-feedback-v1-rules"),
  implementationSha256: sha256Utf8("pong-kernel"),
};
const played = evaluateSlot(slots()[0], synthetic);
assertRecordShape(played.record);
assert.equal(played.record.status, "played");
assert.equal(played.evidence.decisions.length, played.record.playedTicks);
assert.equal(played.evidence.worlds.length, played.record.playedTicks + 1);
assert.equal(played.evidence.rawResponseSha256, synthetic.rawResponseSha256);
assert.notEqual(played.evidence.rawResponseSha256, played.evidence.parameterFingerprint);
assert.equal(played.record.leftArtifactId, synthetic.rawResponseSha256);

const broken = { ...synthetic, weights: Float64Array.from({ length: 435 }, () => Number.NaN) };
const failed = evaluateSlot(slots()[0], broken);
assertRecordShape(failed.record);
assert.equal(failed.record.status, "failed");
assert.equal(failed.record.termination, "runtime-fault");
assert.deepEqual(failed.record.final, failed.record.initial.world);
assert.equal(failed.record.playedTicks, 0);
assert.equal(failed.evidence.decisions.length, 0);
assert.equal(failed.evidence.rawResponseSha256, synthetic.rawResponseSha256);

const validatorSha = sha256Utf8(readFileSync(new URL("./validate.js", import.meta.url), "utf8"));
const acceptedText = `{"version":"pong-feedback-v1","weights":[${Array.from({ length: 435 }, () => "0").join(",")}]}`;
const accepted = validateContestant(acceptedText);
assert.equal(accepted.ok, true);
const acceptedReceipt = finalizeReceipt({
  schema: "synthetic-receipt-v1",
  role: "synthetic",
  status: "accepted",
  validationReportSha256: "pending",
});
const binding = {
  rawReceiptSha256: acceptedReceipt.rawReceiptSha256,
  rawReceiptStatus: "accepted",
  validatorSha256: validatorSha,
  weightsSchemaSha256: PAPER_WEIGHTS_SCHEMA_SHA256,
};
const trio = commitValidationTrio({
  status: "accepted",
  responsePresent: true,
  accepted: true,
  byteLength: accepted.report.byteLength,
  scalarCount: 435,
  rawResponseSha256: accepted.rawResponseSha256,
  parameterFingerprintSha256: accepted.fingerprint,
  errors: [],
}, acceptedReceipt.bytes, binding);
assert.equal(trio.labelled, "synthetic");
assert.equal(trio.receipt.validationReportSha256, null);
assert.equal(trio.report.schema, "pong-single-validation-v1.1");
assert.equal(trio.index.correctionManifestSha256, CORRECTION_MANIFEST_SHA256);
assert.equal(trio.index.validationRecordSchemaSha256, VALIDATION_RECORD_SCHEMA_SHA256);
assert.equal(trio.index.rawReceiptSha256, acceptedReceipt.rawReceiptSha256);
assert.equal(trio.index.validationReportSha256, trio.reportSha256);
assert.equal(acceptedReceipt.receipt.validationReportSha256, null);
assert.throws(() => storeValidationReport(accepted.report, binding), /outcome/);
const mismatched = commitValidationTrio({
  status: "accepted",
  responsePresent: true,
  accepted: true,
  byteLength: accepted.report.byteLength,
  scalarCount: 435,
  rawResponseSha256: accepted.rawResponseSha256,
  parameterFingerprintSha256: accepted.fingerprint,
  errors: [],
}, acceptedReceipt.bytes, { ...binding, rawReceiptSha256: "0".repeat(64) });
assert.equal(mismatched.error, "receipt-hash");

const missingReceipt = finalizeReceipt({
  schema: "synthetic-receipt-v1",
  role: "synthetic",
  status: "no-response",
  validationReportSha256: "pending",
});
const missingTrio = commitValidationTrio(missingResponseOutcome(), missingReceipt.bytes, {
  rawReceiptSha256: missingReceipt.rawReceiptSha256,
  rawReceiptStatus: "no-response",
  validatorSha256: validatorSha,
  weightsSchemaSha256: PAPER_WEIGHTS_SCHEMA_SHA256,
});
assert.equal(missingTrio.report.rawResponseSha256, null);
assert.equal(missingTrio.report.validatorSha256, null);
assert.equal(missingTrio.labelled, "synthetic");

const empty = validateContestant(new Uint8Array());
const emptyReceipt = finalizeReceipt({
  schema: "synthetic-receipt-v1",
  role: "synthetic",
  status: "rejected",
  validationReportSha256: "pending",
});
const emptyTrio = commitValidationTrio({
  status: "rejected",
  responsePresent: true,
  accepted: false,
  byteLength: 0,
  scalarCount: 0,
  rawResponseSha256: empty.report.rawResponseSha256,
  parameterFingerprintSha256: null,
  errors: empty.report.errors,
}, emptyReceipt.bytes, {
  rawReceiptSha256: emptyReceipt.rawReceiptSha256,
  rawReceiptStatus: "rejected",
  validatorSha256: validatorSha,
  weightsSchemaSha256: PAPER_WEIGHTS_SCHEMA_SHA256,
});
assert.equal(emptyTrio.report.rawResponseSha256, EMPTY_RESPONSE_SHA256);
assert.equal(emptyTrio.report.accepted, false);
assert.equal(emptyTrio.labelled, "synthetic");

console.log("record tests passed");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";
import { validateContestant, sha256Utf8 } from "../../public/experiments/pong/validate.js";
import {
  VALIDATOR_SHA256,
  LIMITS,
  CHECKS,
  inspectBytes,
  scanBlocks,
  concatenationText,
  validatorPath,
} from "./check-authoring.mjs";

let lastTemp = "";
let tempMtime = 0;
const root = dirname(fileURLToPath(import.meta.url));
const cli = join(root, "check-authoring.mjs");
const validatorFile = join(root, "../../public/experiments/pong/validate.js");
const validatorBytes = readFileSync(validatorFile);
assert.equal(createHash("sha256").update(validatorBytes).digest("hex"), VALIDATOR_SHA256);
assert.equal(validatorPath().endsWith("public/experiments/pong/validate.js"), true);
assert.deepEqual(LIMITS, { bytes: 16384, scalars: 435, magnitude: 16, fractionDigits: 6 });
assert.equal(CHECKS.rawInput, "reject when byte length > 16384, before any concatenation");
assert.equal(CHECKS.derivedArtifact, "reject when the concatenated UTF-8 byte length > 16384");
assert.deepEqual(CHECKS.counts, { W1: 96, b1: 16, W2: 256, b2: 16, W3: 48, b3: 3 });
assert.equal(readFileSync(cli, "utf8").includes("JSON.parse"), false);
assert.equal(readFileSync(cli, "utf8").includes("evaluator.js"), false);
assert.equal(readFileSync(cli, "utf8").includes("kernel.js"), false);

function zeros(count) {
  return Array.from({ length: count }, () => "0");
}
function canonical(tokens) {
  return `{"version":"pong-feedback-v1","weights":[${tokens.join(",")}]}`;
}
function run(args, input) {
  return spawnSync(process.execPath, [cli, ...args], {
    input,
    encoding: "utf8",
  });
}
function author(stdout) {
  return JSON.parse(stdout).forAuthor;
}

const validText = canonical(zeros(435));
const valid = run(["--canonical", writeTemp(validText)]);
assert.equal(valid.status, 0, valid.stderr);
const validBody = JSON.parse(valid.stdout);
const official = validateContestant(validText);
assert.equal(validBody.forAuthor.accepted, true);
assert.equal(validBody.forAuthor.representation, "unchanged-bytes");
assert.equal(validBody.forAuthor.scalarCount, 435);
assert.equal(validBody.forAuthor.byteLength, Buffer.byteLength(validText));
assert.deepEqual(validBody.forAuthor.limits, LIMITS);
assert.deepEqual(validBody.forAuthor.errors, []);
assert.equal(validBody.operator.rawInputSha256, official.report.rawResponseSha256);
assert.equal(validBody.operator.derivedOfficialArtifactSha256, null);
assert.equal(validBody.operator.parameterFingerprintSha256, official.fingerprint);
assert.equal(validBody.operator.validatorSha256, VALIDATOR_SHA256);
assert.equal(valid.stdout.includes('"weights"'), false);
assert.equal(statSync(lastTemp).mtimeMs, tempMtime);

const stdin = run(["--canonical"], validText);
assert.equal(stdin.status, 0, stdin.stderr);
assert.equal(JSON.parse(stdin.stdout).operator.rawInputSha256, sha256Utf8(validText));

const wrong = run(["--canonical", writeTemp(canonical(zeros(434)))]);
assert.equal(wrong.status, 1);
assert.equal(author(wrong.stdout).errors[0].code, "shape");
assert.equal(author(wrong.stdout).errors[0].index, 434);
assert.equal(author(wrong.stdout).scalarCount, null);

const oversize = run(["--canonical", writeTemp("x".repeat(16385))]);
assert.equal(oversize.status, 1);
assert.equal(author(oversize.stdout).errors[0].code, "size");
assert.equal(author(oversize.stdout).byteLength, 16385);
const boundary = run(["--canonical", writeTemp("x".repeat(16384))]);
assert.notEqual(author(boundary.stdout).errors[0].code, "size");

const malformed = run(["--canonical", writeTemp("{")]);
assert.equal(malformed.status, 1);
assert.equal(author(malformed.stdout).errors[0].code, "object");

const bounds = run(["--canonical", writeTemp(canonical(["16.1", ...zeros(434)]))]);
assert.equal(bounds.status, 1);
assert.equal(author(bounds.stdout).errors[0].code, "magnitude");

const duplicate = `{"version":"pong-feedback-v1","version":"pong-feedback-v1","weights":[${zeros(435).join(",")}]}`;
const parsed = JSON.parse(duplicate);
assert.equal(parsed.version, "pong-feedback-v1");
const duplicateRun = run(["--canonical", writeTemp(duplicate)]);
assert.equal(duplicateRun.status, 1);
assert.equal(author(duplicateRun.stdout).errors[0].code, "duplicate");
assert.equal(author(duplicateRun.stdout).accepted, false);

function blockText(parts, order = ["W1", "b1", "W2", "b2", "W3", "b3"]) {
  return `{${order.map(function (name) { return `"${name}":[${parts[name].join(",")}]`; }).join(",")}}`;
}
function partsFrom(tokens) {
  return {
    W1: tokens.slice(0, 96),
    b1: tokens.slice(96, 112),
    W2: tokens.slice(112, 368),
    b2: tokens.slice(368, 384),
    W3: tokens.slice(384, 432),
    b3: tokens.slice(432, 435),
  };
}
const sequence = Array.from({ length: 435 }, (_, index) => {
  if (index === 0) return "-16";
  if (index === 1) return "1.250000";
  if (index === 434) return "16";
  return String((index % 15) - 7);
});
const blockBytes = Buffer.from(blockText(partsFrom(sequence), ["b3", "W2", "W1", "b1", "W3", "b2"]));
const adapted = await inspectBytes(blockBytes, true);
assert.equal(adapted.exitCode, 0, JSON.stringify(adapted.body.forAuthor));
assert.equal(adapted.body.forAuthor.unchangedBytesAccepted, false);
assert.equal(adapted.body.forAuthor.unchangedBytesError, "keys");
assert.equal(adapted.body.forAuthor.concatenationAccepted, true);
assert.equal(adapted.body.forAuthor.scalarCount, 435);
assert.equal(adapted.body.operator.derivedOfficialArtifactSha256 === adapted.body.operator.rawInputSha256, false);
assert.equal(adapted.adaptedText.includes("1.250000"), true);
assert.equal(adapted.adaptedText.includes("-16"), true);
const adaptedCheck = validateContestant(adapted.adaptedText);
assert.equal(adaptedCheck.ok, true);
assert.equal(adaptedCheck.weights.length, 435);
sequence.forEach(function (token, index) {
  assert.equal(adaptedCheck.weights[index], Number(token), `${index} ${token}`);
});
assert.equal(adapted.body.operator.derivedOfficialArtifactSha256, sha256Utf8(adapted.adaptedText));
const primary = run([writeTemp(blockText(partsFrom(sequence), ["b3", "W2", "W1", "b1", "W3", "b2"]))]);
assert.equal(primary.status, 0, primary.stderr);
const primaryBody = JSON.parse(primary.stdout);
assert.equal(primaryBody.forAuthor.representation, "mechanical-concatenation");
assert.equal(primaryBody.forAuthor.concatenationAccepted, true);
assert.equal(primaryBody.forAuthor.unchangedBytesAccepted, false);
assert.equal(primaryBody.forAuthor.scalarCount, 435);
assert.deepEqual(primaryBody.checks.counts, CHECKS.counts);
assert.notEqual(primaryBody.operator.rawInputSha256, primaryBody.operator.derivedOfficialArtifactSha256);
assert.equal(statSync(lastTemp).mtimeMs, tempMtime);
const primaryStdin = run([], blockText(partsFrom(sequence)));
assert.equal(primaryStdin.status, 0, primaryStdin.stderr);
const flatOnPrimary = run([writeTemp(validText)]);
assert.equal(flatOnPrimary.status, 1);
assert.equal(author(flatOnPrimary.stdout).concatenationError, "keys");
assert.equal(JSON.parse(flatOnPrimary.stdout).operator.derivedOfficialArtifactSha256, null);
assert.deepEqual(adapted.body.forAuthor.blocks.map(function (block) { return [block.name, block.count, block.expected]; }), [
  ["W1", 96, 96], ["b1", 16, 16], ["W2", 256, 256], ["b2", 16, 16], ["W3", 48, 48], ["b3", 3, 3],
]);

const short = partsFrom(sequence);
short.W1 = short.W1.slice(0, 95);
const shortRun = await inspectBytes(Buffer.from(blockText(short)), true);
assert.equal(shortRun.exitCode, 1);
assert.equal(shortRun.body.forAuthor.concatenationError, "block-count");
assert.equal(shortRun.body.operator.derivedOfficialArtifactSha256, null);
assert.equal(shortRun.adaptedText, null);
assert.equal(shortRun.body.forAuthor.blocks[0].count, 95);

const doubled = `{"W1":[${zeros(96).join(",")}],"W1":[${zeros(96).fill("1").join(",")}],"b1":[${zeros(16).join(",")}],"W2":[${zeros(256).join(",")}],"b2":[${zeros(16).join(",")}],"W3":[${zeros(48).join(",")}],"b3":[${zeros(3).join(",")}]}`;
assert.equal(JSON.parse(doubled).W1[0], 1);
const doubledRun = await inspectBytes(Buffer.from(doubled), true);
assert.equal(doubledRun.exitCode, 1);
assert.equal(doubledRun.body.forAuthor.concatenationError, "duplicate");
assert.equal(doubledRun.body.operator.derivedOfficialArtifactSha256, null);

const high = partsFrom(sequence);
high.W1 = ["17", ...high.W1.slice(1)];
const highRun = await inspectBytes(Buffer.from(blockText(high)), true);
assert.equal(highRun.exitCode, 1);
assert.equal(highRun.body.forAuthor.concatenationError, "magnitude");
assert.equal(highRun.adaptedText.includes("17"), true);
assert.equal(highRun.adaptedText.includes("16.0"), false);
assert.equal(validateContestant(highRun.adaptedText).ok, false);

const oversizeBlocks = await inspectBytes(Buffer.from("x".repeat(16385)), true);
assert.equal(oversizeBlocks.exitCode, 1);
assert.equal(oversizeBlocks.body.forAuthor.concatenationError, "size");
assert.equal(oversizeBlocks.body.operator.derivedOfficialArtifactSha256, null);

assert.equal(scanBlocks("{").error, "object");
assert.equal(concatenationText(scanBlocks(blockText(partsFrom(sequence))).found).includes("1.250000"), true);

const missing = run(["missing-authoring-file.json"]);
assert.equal(missing.status, 2);
const help = run(["--help"]);
assert.equal(help.status, 0);
assert.match(help.stdout, /Node >= 24/);
assert.match(help.stdout, /W1 96, b1 16, W2 256, b2 16, W3 48, b3 3/);
const badFlag = run(["--repair", writeTemp(validText)]);
assert.equal(badFlag.status, 2);
const bothFlags = run(["--canonical", "--blocks", writeTemp(validText)]);
assert.equal(bothFlags.status, 2);

const packet = mkdtempSync(join(tmpdir(), "pong-authoring-"));
const readme = readFileSync(join(root, "README.md"));
const sums = [
  [validatorBytes, "validate.js"],
  [readFileSync(cli), "check-authoring.mjs"],
  [readme, "README.md"],
].map(function (entry) {
  return `${createHash("sha256").update(entry[0]).digest("hex")}  ${entry[1]}`;
}).join("\n") + "\n";
const zip = zipFiles([
  ["validate.js", validatorBytes],
  ["check-authoring.mjs", readFileSync(cli)],
  ["README.md", readme],
  ["SHA256SUMS", Buffer.from(sums)],
]);
const zipPath = join(packet, "pong-authoring-check.zip");
writeFileSync(zipPath, zip);
const extracted = join(packet, "extract");
mkdirSync(extracted);
const unpack = spawnSync("python3", ["-c", "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zipPath, extracted], { encoding: "utf8" });
assert.equal(unpack.status, 0, unpack.stderr);
assert.deepEqual(readFileSync(join(extracted, "SHA256SUMS"), "utf8"), sums);
for (const name of ["validate.js", "check-authoring.mjs", "README.md"]) {
  const disk = readFileSync(join(extracted, name));
  const listed = sums.split("\n").find(function (line) { return line.endsWith(`  ${name}`); }).slice(0, 64);
  assert.equal(createHash("sha256").update(disk).digest("hex"), listed);
}
assert.equal(readFileSync(join(extracted, "validate.js")).equals(validatorBytes), true);
const names = new Set(spawnSync("python3", ["-c", "import sys, zipfile; print('\\n'.join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))", zipPath], { encoding: "utf8" }).stdout.trim().split("\n"));
assert.deepEqual([...names].sort(), ["README.md", "SHA256SUMS", "check-authoring.mjs", "validate.js"]);
const packedFixture = join(extracted, "synthetic.json");
writeFileSync(packedFixture, blockText(partsFrom(zeros(435))));
const before = statSync(packedFixture).mtimeMs;
const packed = spawnSync(process.execPath, [join(extracted, "check-authoring.mjs"), packedFixture], { encoding: "utf8" });
assert.equal(packed.status, 0, packed.stderr);
assert.equal(JSON.parse(packed.stdout).forAuthor.concatenationAccepted, true);
assert.equal(JSON.parse(packed.stdout).forAuthor.scalarCount, 435);
assert.equal(JSON.parse(packed.stdout).operator.validatorSha256, VALIDATOR_SHA256);
assert.equal(statSync(packedFixture).mtimeMs, before);
const artifactDir = "/opt/cursor/artifacts";
mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(artifactDir, "pong-authoring-check.zip"), zip);
writeFileSync(join(artifactDir, "pong-authoring-check.sha256"), `${createHash("sha256").update(zip).digest("hex")}  pong-authoring-check.zip\n`);

const directBytes = await inspectBytes(Buffer.from(validText), false);
assert.equal(directBytes.exitCode, 0);
assert.equal(directBytes.body.forAuthor.scalarCount, 435);
rmSync(packet, { recursive: true, force: true });
console.log(`node ${process.version}`);
console.log(`validator ${VALIDATOR_SHA256}`);
console.log("minimum Node >= 24");
console.log("authoring check tests passed");

function writeTemp(text) {
  if (!writeTemp.dir) writeTemp.dir = mkdtempSync(join(tmpdir(), "pong-authoring-fixture-"));
  lastTemp = join(writeTemp.dir, `case-${writeTemp.n = (writeTemp.n || 0) + 1}.json`);
  writeFileSync(lastTemp, text);
  tempMtime = statSync(lastTemp).mtimeMs;
  return lastTemp;
}

function zipFiles(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const fileName = Buffer.from(name);
    const body = Buffer.from(data);
    const compressed = deflateRawSync(body);
    const sum = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(sum >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    parts.push(local, fileName, compressed);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(sum >>> 0, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(body.length, 24);
    header.writeUInt16LE(fileName.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, fileName);
    offset += local.length + fileName.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

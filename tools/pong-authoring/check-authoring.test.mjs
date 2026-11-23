import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
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

function grid(rows, width, edits = {}) {
  return Array.from({ length: rows }, (_, row) => Array.from({ length: width }, (_, col) => edits[`${row}:${col}`] || "0"));
}
function encodeList(value) {
  if (Array.isArray(value[0])) return `[${value.map((row) => `[${row.join(",")}]`).join(",")}]`;
  return `[${value.join(",")}]`;
}
function rowsFile(parts, order = ["b3", "W3", "b2", "W2", "b1", "W1"]) {
  return `{${order.map((name) => `"${name}":${encodeList(parts[name])}`).join(",")}}`;
}
const rowParts = {
  W1: grid(6, 16, { "0:0": "-16", "0:1": "1.250000" }),
  b1: zeros(16),
  W2: grid(16, 16, { "3:5": "-0.5" }),
  b2: zeros(16),
  W3: grid(16, 3, { "15:2": "16" }),
  b3: zeros(3),
};
const rowSource = rowsFile(rowParts);
const rowRun = await inspectBytes(Buffer.from(rowSource), "rows");
assert.equal(rowRun.exitCode, 0, JSON.stringify(rowRun.body.forAuthor));
assert.equal(rowRun.body.forAuthor.representation, "row-concatenation");
assert.equal(rowRun.body.forAuthor.scalarCount, 435);
assert.equal(rowRun.adaptedText.includes("1.250000"), true);
assert.equal(rowRun.adaptedText.includes("-0.5"), true);
assert.notEqual(rowRun.body.operator.rawInputSha256, rowRun.body.operator.derivedOfficialArtifactSha256);
const rowChecked = validateContestant(rowRun.adaptedText);
assert.equal(rowChecked.weights[0], -16);
assert.equal(rowChecked.weights[1], 1.25);
assert.equal(rowChecked.weights[96 + 16 + 3 * 16 + 5], -0.5);
assert.equal(rowChecked.weights[384 + 15 * 3 + 2], 16);
assert.equal(rowChecked.weights.length, 435);
const rowCli = run(["--rows", writeTemp(rowSource)]);
assert.equal(rowCli.status, 0, rowCli.stderr);
assert.equal(rowCli.stdout.includes("1.250000"), false);
console.log("case rows-valid exit 0 scalar 435");

const shortW2 = { ...rowParts, W2: grid(15, 16) };
const shortRows = await inspectBytes(Buffer.from(rowsFile(shortW2)), "rows");
assert.equal(shortRows.exitCode, 1);
assert.equal(shortRows.adaptedText, null);
assert.equal(shortRows.body.forAuthor.errors[0].code, "row-count");
assert.equal(shortRows.body.forAuthor.errors[0].block, "W2");
assert.equal(shortRows.body.forAuthor.errors[0].expected, 16);
assert.equal(shortRows.body.forAuthor.errors[0].actual, 15);
console.log("case rows-count exit 1 row-count W2 15");

const narrow = grid(16, 16);
narrow[4] = zeros(15);
const widthRun = await inspectBytes(Buffer.from(rowsFile({ ...rowParts, W2: narrow })), "rows");
assert.equal(widthRun.body.forAuthor.errors[0].code, "row-width");
assert.equal(widthRun.body.forAuthor.errors[0].block, "W2");
assert.equal(widthRun.body.forAuthor.errors[0].row, 4);
assert.equal(widthRun.body.forAuthor.errors[0].expected, 16);
assert.equal(widthRun.body.forAuthor.errors[0].actual, 15);
assert.equal(widthRun.adaptedText, null);
assert.equal(Object.hasOwn(widthRun.body.forAuthor.errors[0], "value"), false);
console.log("case rows-width exit 1 row-width W2 row 4 actual 15");

const ragged = grid(16, 16);
ragged[2] = zeros(10);
ragged[4] = zeros(17);
const raggedRun = await inspectBytes(Buffer.from(rowsFile({ ...rowParts, W2: ragged })), "rows");
assert.equal(raggedRun.body.forAuthor.errors[0].code, "row-width");
assert.equal(raggedRun.body.forAuthor.errors[0].row, 2);
assert.equal(raggedRun.body.forAuthor.errors[0].actual, 10);
console.log("case rows-ragged exit 1 row-width W2 row 2 actual 10");

const mixedText = rowsFile(rowParts).replace(encodeList(rowParts.W1), `[${zeros(96).join(",")}]`);
const mixedRun = await inspectBytes(Buffer.from(mixedText), "rows");
assert.equal(mixedRun.body.forAuthor.errors[0].code, "mixed");
assert.equal(mixedRun.body.forAuthor.errors[0].block, "W1");
assert.equal(mixedRun.adaptedText, null);
const mixedBias = rowsFile({ ...rowParts, b1: grid(16, 1) });
const mixedBiasRun = await inspectBytes(Buffer.from(mixedBias), "rows");
assert.equal(mixedBiasRun.body.forAuthor.errors[0].code, "mixed");
assert.equal(mixedBiasRun.body.forAuthor.errors[0].block, "b1");
console.log("case rows-mixed exit 1 mixed W1 and b1");

const nestedText = rowsFile(rowParts).replace(encodeList(rowParts.W1), `[[[${zeros(16).join(",")}]]]`);
const nestedRun = await inspectBytes(Buffer.from(nestedText), "rows");
assert.equal(nestedRun.body.forAuthor.errors[0].code, "nesting");
assert.equal(nestedRun.body.forAuthor.errors[0].block, "W1");
console.log("case rows-nested exit 1 nesting W1");

const extraText = rowsFile(rowParts).replace("{", '{"extra":[1],');
const extraRun = await inspectBytes(Buffer.from(extraText), "rows");
assert.equal(extraRun.body.forAuthor.errors[0].code, "keys");
console.log("case rows-extra exit 1 keys");

const dupRows = `{${rowsFile(rowParts).slice(1, -1)},"W2":${encodeList(grid(16, 16, { "0:0": "1" }))}}`;
assert.equal(JSON.parse(dupRows).W2[0][0], 1);
const dupRowsRun = await inspectBytes(Buffer.from(dupRows), "rows");
assert.equal(dupRowsRun.body.forAuthor.errors[0].code, "duplicate");
assert.equal(dupRowsRun.adaptedText, null);
console.log("case rows-duplicate exit 1 duplicate");

const rowMalformed = run(["--rows", writeTemp("{")]);
assert.equal(rowMalformed.status, 1);
assert.equal(author(rowMalformed.stdout).errors[0].code, "object");
console.log("case rows-malformed exit 1 object");

const highRows = { ...rowParts, W1: grid(6, 16, { "0:0": "16.1" }) };
const highRowsRun = await inspectBytes(Buffer.from(rowsFile(highRows)), "rows");
assert.equal(highRowsRun.exitCode, 1);
assert.equal(highRowsRun.body.forAuthor.errors[0].code, "magnitude");
assert.equal(highRowsRun.adaptedText.includes("16.1"), true);
assert.equal(highRowsRun.adaptedText.includes("16.0"), false);
const rejectedPath = join(writeTemp.dir, "rejected-derived.json");
const rejectedWrite = run(["--rows", writeTemp(rowsFile(highRows)), "--write-derived", rejectedPath]);
assert.equal(rejectedWrite.status, 1);
assert.equal(existsSync(rejectedPath), false);
assert.equal(rejectedWrite.stdout.includes("16.0"), false);
console.log("case rows-bounds exit 1 magnitude no-write");

const preciseRows = { ...rowParts, W3: grid(16, 3, { "1:1": "1.0000001" }) };
const preciseRun = await inspectBytes(Buffer.from(rowsFile(preciseRows)), "rows");
assert.equal(preciseRun.body.forAuthor.errors[0].code, "precision");
assert.equal(preciseRun.adaptedText.includes("1.0000001"), true);
console.log("case rows-precision exit 1 precision");

const rowOversize = await inspectBytes(Buffer.from("x".repeat(16385)), "rows");
assert.equal(rowOversize.exitCode, 1);
assert.equal(rowOversize.body.forAuthor.concatenationError, "size");
assert.equal(rowOversize.body.operator.derivedOfficialArtifactSha256, null);
console.log("case rows-size exit 1 size");

const derivedPath = join(writeTemp.dir, "rows-derived.json");
const derivedSource = writeTemp(rowSource);
const derivedWrite = run(["--rows", derivedSource, "--write-derived", derivedPath]);
assert.equal(derivedWrite.status, 0, derivedWrite.stderr);
const derivedDisk = readFileSync(derivedPath);
assert.equal(derivedDisk.equals(Buffer.from(rowRun.adaptedText, "utf8")), true);
assert.equal(derivedDisk.includes(Buffer.from("1.250000")), true);
assert.equal(validateContestant(derivedDisk.toString("utf8")).ok, true);
assert.equal(createHash("sha256").update(derivedDisk).digest("hex"), JSON.parse(derivedWrite.stdout).operator.derivedOfficialArtifactSha256);
const derivedAgain = run(["--rows", derivedSource, "--write-derived", derivedPath]);
assert.equal(derivedAgain.status, 2);
assert.equal(readFileSync(derivedPath).equals(derivedDisk), true);
console.log("case rows-write exit 0 wx no-overwrite");

const flatDerived = join(writeTemp.dir, "flat-derived.json");
const flatSource = writeTemp(blockText(partsFrom(zeros(435))));
const flatWrite = run([flatSource, "--write-derived", flatDerived]);
assert.equal(flatWrite.status, 0, flatWrite.stderr);
const flatDisk = readFileSync(flatDerived, "utf8");
assert.equal(validateContestant(flatDisk).ok, true);
assert.equal(flatDisk.includes("1.250000"), false);
const flatAgain = run([flatSource, "--write-derived", flatDerived]);
assert.equal(flatAgain.status, 2);
assert.equal(readFileSync(flatDerived, "utf8"), flatDisk);
console.log("case flat-write exit 0 wx no-overwrite");

const missing = run(["missing-authoring-file.json"]);
assert.equal(missing.status, 2);
const help = run(["--help"]);
assert.equal(help.status, 0);
assert.match(help.stdout, /Node >= 24/);
assert.match(help.stdout, /W1 96, b1 16, W2 256, b2 16, W3 48, b3 3/);
assert.match(help.stdout, /--rows/);
assert.match(help.stdout, /--write-derived/);
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
writeFileSync(join(artifactDir, "pong-authoring-check-v2.2.zip"), zip);
writeFileSync(join(artifactDir, "pong-authoring-check-v2.2.sha256"), `${createHash("sha256").update(zip).digest("hex")}  pong-authoring-check-v2.2.zip\n`);

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

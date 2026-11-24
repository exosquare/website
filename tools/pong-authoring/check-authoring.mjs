import { closeSync, existsSync, openSync, realpathSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VALIDATOR_SHA256 = "44bc8b0170ad400c927abfda67270b300e0381bbc2dfd2d4c8be3efcbc19f414";
export const LIMITS = { bytes: 16384, scalars: 435, magnitude: 16, fractionDigits: 6 };
export const PACKAGE_VERSION = "2.2";
export const CHECKS = {
  rawInput: "reject when byte length > 16384, before any concatenation",
  derivedArtifact: "reject when the concatenated UTF-8 byte length > 16384",
  counts: { W1: 96, b1: 16, W2: 256, b2: 16, W3: 48, b3: 3 },
  rows: { W1: [6, 16], W2: [16, 16], W3: [16, 3], b1: 16, b2: 16, b3: 3 },
  scalars: 435,
};
const ROW_SHAPE = { W1: [6, 16], W2: [16, 16], W3: [16, 3] };
const BLOCKS = [
  ["W1", 96],
  ["b1", 16],
  ["W2", 256],
  ["b2", 16],
  ["W3", 48],
  ["b3", 3],
];
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const here = dirname(fileURLToPath(import.meta.url));

export function validatorPath() {
  const beside = join(here, "validate.js");
  if (existsSync(beside)) return beside;
  return join(here, "../../public/experiments/pong/validate.js");
}

function fail(error) {
  return { error };
}

function skip(text, at) {
  while (at < text.length) {
    const char = text[at];
    if (char !== " " && char !== "\n" && char !== "\r" && char !== "\t") break;
    at += 1;
  }
  return at;
}

function readKey(text, at) {
  if (text[at] !== '"') return fail("key");
  at += 1;
  let key = "";
  while (at < text.length) {
    const char = text[at];
    if (char === '"') return { key, at: at + 1 };
    if (char === "\\") {
      const next = text[at + 1];
      const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (Object.prototype.hasOwnProperty.call(simple, next)) {
        key += simple[next];
        at += 2;
        continue;
      }
      if (next === "u") {
        const hex = text.slice(at + 2, at + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail("escape");
        key += String.fromCharCode(Number.parseInt(hex, 16));
        at += 6;
        continue;
      }
      return fail("escape");
    }
    if (char < " ") return fail("control");
    key += char;
    at += 1;
  }
  return fail("string");
}

function readArray(text, at) {
  if (text[at] !== "[") return fail("shape");
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = at; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") return fail("nesting");
    if (char === "[") {
      depth += 1;
      if (depth > 1) return fail("nesting");
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return { interior: text.slice(at + 1, index), at: index + 1 };
    }
  }
  return fail("array");
}

function countInterior(interior) {
  if (/[[\]{}"]/.test(interior)) return fail("nesting");
  const body = interior.trim();
  if (body === "") return { count: 0 };
  if (body.startsWith(",") || body.endsWith(",") || body.includes(",,")) return fail("array");
  return { count: body.split(",").length };
}

export function scanBlocks(text) {
  let at = skip(text, 0);
  if (text[at] === "`") return fail("fence");
  if (text[at] !== "{") return fail("prose");
  at += 1;
  const found = new Map();
  let closed = false;
  at = skip(text, at);
  if (text[at] === "}") return fail("keys");
  while (at < text.length) {
    at = skip(text, at);
    const key = readKey(text, at);
    if (key.error) return key;
    if (FORBIDDEN_KEYS.has(key.key)) return fail("keys");
    if (found.has(key.key)) return fail("duplicate");
    if (!BLOCKS.some(function (block) { return block[0] === key.key; })) return fail("keys");
    at = skip(text, key.at);
    if (text[at] !== ":") return fail("colon");
    at = skip(text, at + 1);
    const list = readArray(text, at);
    if (list.error) return list;
    const counted = countInterior(list.interior);
    if (counted.error) return counted;
    found.set(key.key, { interior: list.interior, count: counted.count });
    at = skip(text, list.at);
    if (text[at] === ",") {
      at += 1;
      continue;
    }
    if (text[at] === "}") {
      at = skip(text, at + 1);
      closed = true;
      break;
    }
    return fail("object");
  }
  if (!closed) return fail("object");
  if (at !== text.length) return fail("trailing");
  const names = BLOCKS.map(function (block) { return block[0]; });
  if (found.size !== names.length || names.some(function (name) { return !found.has(name); })) return fail("keys");
  const blocks = BLOCKS.map(function (block) {
    return { name: block[0], count: found.get(block[0]).count, expected: block[1] };
  });
  return { blocks, found };
}

function publicError(error) {
  if (!error) return null;
  const code = error.code || error.error;
  if (!code) return null;
  const out = { code, index: error.index ?? null, tokenOffset: error.tokenOffset ?? null };
  if (error.block !== undefined) out.block = error.block;
  if (error.row !== undefined) out.row = error.row;
  if (error.expected !== undefined) out.expected = error.expected;
  if (error.actual !== undefined) out.actual = error.actual;
  return out;
}

function looksLikeRows(text, at) {
  return text[skip(text, at + 1)] === "[";
}

function readRowMatrix(text, at, block, expectedRows, expectedWidth) {
  if (text[at] !== "[") return { error: "shape", block };
  const inner = skip(text, at + 1);
  if (text[inner] === "]") return { error: "row-count", block, expected: expectedRows, actual: 0, at: inner + 1 };
  if (text[inner] !== "[") return { error: "mixed", block, row: 0 };
  at += 1;
  const interiors = [];
  let closed = false;
  while (at < text.length) {
    at = skip(text, at);
    if (text[at] === "]") {
      at += 1;
      closed = true;
      break;
    }
    if (text[at] !== "[") return { error: "mixed", block, row: interiors.length };
    const row = readArray(text, at);
    if (row.error) return { error: row.error, block, row: interiors.length };
    const counted = countInterior(row.interior);
    if (counted.error) return { error: counted.error, block, row: interiors.length };
    if (counted.count !== expectedWidth) {
      return { error: "row-width", block, row: interiors.length, expected: expectedWidth, actual: counted.count };
    }
    interiors.push(row.interior);
    at = skip(text, row.at);
    if (text[at] === ",") {
      at += 1;
      const next = skip(text, at);
      if (text[next] === "]") return { error: "array", block };
      continue;
    }
    if (text[at] === "]") {
      at += 1;
      closed = true;
      break;
    }
    return { error: "array", block };
  }
  if (!closed) return { error: "array", block };
  if (interiors.length !== expectedRows) {
    return { error: "row-count", block, expected: expectedRows, actual: interiors.length, at };
  }
  return { interiors, at };
}

export function scanRows(text) {
  let at = skip(text, 0);
  if (text[at] === "`") return fail("fence");
  if (text[at] !== "{") return fail("prose");
  at += 1;
  const found = new Map();
  let closed = false;
  at = skip(text, at);
  if (text[at] === "}") return fail("keys");
  while (at < text.length) {
    at = skip(text, at);
    const key = readKey(text, at);
    if (key.error) return key;
    if (FORBIDDEN_KEYS.has(key.key)) return fail("keys");
    if (found.has(key.key)) return fail("duplicate");
    const shape = ROW_SHAPE[key.key];
    const bias = BLOCKS.find(function (block) { return block[0] === key.key; });
    if (!shape && !(bias && !ROW_SHAPE[key.key])) return fail("keys");
    at = skip(text, key.at);
    if (text[at] !== ":") return fail("colon");
    at = skip(text, at + 1);
    if (shape) {
      const matrix = readRowMatrix(text, at, key.key, shape[0], shape[1]);
      if (matrix.error) return matrix;
      found.set(key.key, { interiors: matrix.interiors });
      at = matrix.at;
    } else {
      if (looksLikeRows(text, at)) return { error: "mixed", block: key.key, row: 0 };
      const list = readArray(text, at);
      if (list.error) return { error: list.error, block: key.key };
      const counted = countInterior(list.interior);
      if (counted.error) return { error: counted.error, block: key.key };
      found.set(key.key, { interior: list.interior, count: counted.count, expected: bias[1] });
      at = list.at;
    }
    at = skip(text, at);
    if (text[at] === ",") {
      at += 1;
      continue;
    }
    if (text[at] === "}") {
      at = skip(text, at + 1);
      closed = true;
      break;
    }
    return fail("object");
  }
  if (!closed) return fail("object");
  if (at !== text.length) return fail("trailing");
  if (found.size !== BLOCKS.length || BLOCKS.some(function (block) { return !found.has(block[0]); })) return fail("keys");
  for (const block of BLOCKS) {
    if (ROW_SHAPE[block[0]]) continue;
    const item = found.get(block[0]);
    if (item.count !== block[1]) return { error: "block-count", block: block[0], expected: block[1], actual: item.count };
  }
  const blocks = BLOCKS.map(function (block) {
    if (ROW_SHAPE[block[0]]) {
      const shape = ROW_SHAPE[block[0]];
      return { name: block[0], rows: shape[0], width: shape[1], count: shape[0] * shape[1] };
    }
    return { name: block[0], count: found.get(block[0]).count, expected: block[1] };
  });
  return { found, blocks };
}

export function rowConcatenationText(found) {
  const pieces = BLOCKS.map(function (block) {
    const item = found.get(block[0]);
    return item.interiors ? item.interiors.join(",") : item.interior;
  });
  return `{"version":"pong-feedback-v1","weights":[${pieces.join(",")}]}`;
}

function directView(bytes, result) {
  const error = result.report.errors[0];
  return {
    forAuthor: {
      representation: "unchanged-bytes",
      accepted: result.ok === true,
      byteLength: bytes.length,
      scalarCount: result.ok === true ? result.report.scalarCount : null,
      limits: LIMITS,
      errors: result.ok === true ? [] : [publicError(error)],
    },
    operator: {
      validatorSha256: VALIDATOR_SHA256,
      node: process.version,
      rawInputSha256: result.report.rawResponseSha256,
      derivedOfficialArtifactSha256: null,
      parameterFingerprintSha256: result.ok === true ? result.report.parameterFingerprintSha256 : null,
    },
  };
}

export function concatenationText(found) {
  const interiors = BLOCKS.map(function (block) { return found.get(block[0]).interior; });
  return `{"version":"pong-feedback-v1","weights":[${interiors.join(",")}]}`;
}

export async function loadValidator() {
  const path = validatorPath();
  const bytes = readFileSync(path);
  const { sha256Bytes, validateContestant } = await import(pathToFileURL(path).href);
  const hash = sha256Bytes(bytes);
  if (hash !== VALIDATOR_SHA256) {
    return { error: "validator-hash", hash, path };
  }
  return { validateContestant, sha256Bytes, hash, path };
}

export function blocksReport(bytes, text, validator) {
  const direct = validator.validateContestant(bytes);
  const unchangedBytesSha256 = direct.report.rawResponseSha256;
  const base = {
    representation: "mechanical-concatenation",
    byteLength: bytes.length,
    limits: LIMITS,
    unchangedBytesAccepted: direct.ok === true,
    unchangedBytesError: direct.ok === true ? null : direct.report.errors[0].code,
  };
  const blocked = new Set(["size", "bom", "utf8", "type"]);
  if (!direct.ok && blocked.has(direct.report.errors[0].code)) {
    return {
      exitCode: 1,
      body: {
        tool: "pong-authoring-check",
        checks: CHECKS,
        forAuthor: { ...base, concatenationAccepted: false, concatenationError: direct.report.errors[0].code, scalarCount: null, blocks: null, errors: [publicError(direct.report.errors[0])] },
        operator: {
          validatorSha256: VALIDATOR_SHA256,
          node: process.version,
          rawInputSha256: unchangedBytesSha256,
          derivedOfficialArtifactSha256: null,
          parameterFingerprintSha256: null,
          directError: direct.report.errors[0].code,
        },
      },
    };
  }
  const scanned = scanBlocks(text);
  if (scanned.error) {
    return {
      exitCode: 1,
      body: {
        tool: "pong-authoring-check",
        checks: CHECKS,
        forAuthor: { ...base, concatenationAccepted: false, concatenationError: scanned.error, scalarCount: null, blocks: null, errors: [{ code: scanned.error, index: null, tokenOffset: null }] },
        operator: {
          validatorSha256: VALIDATOR_SHA256,
          node: process.version,
          rawInputSha256: unchangedBytesSha256,
          derivedOfficialArtifactSha256: null,
          parameterFingerprintSha256: null,
          directError: direct.ok === true ? null : direct.report.errors[0].code,
        },
      },
    };
  }
  const mismatch = scanned.blocks.filter(function (block) { return block.count !== block.expected; });
  if (mismatch.length) {
    return {
      exitCode: 1,
      body: {
        tool: "pong-authoring-check",
        checks: CHECKS,
        forAuthor: { ...base, concatenationAccepted: false, concatenationError: "block-count", scalarCount: null, blocks: scanned.blocks, errors: [{ code: "block-count", index: null, tokenOffset: null }] },
        operator: {
          validatorSha256: VALIDATOR_SHA256,
          node: process.version,
          rawInputSha256: unchangedBytesSha256,
          derivedOfficialArtifactSha256: null,
          parameterFingerprintSha256: null,
          directError: direct.ok === true ? null : direct.report.errors[0].code,
        },
      },
      adaptedText: null,
    };
  }
  const adaptedText = concatenationText(scanned.found);
  const adapted = validator.validateContestant(adaptedText);
  const adaptedBytes = new TextEncoder().encode(adaptedText);
  const adaptedCanonicalSha256 = validator.sha256Bytes(adaptedBytes);
  return {
    exitCode: adapted.ok === true ? 0 : 1,
    adaptedText,
    body: {
      tool: "pong-authoring-check",
      checks: CHECKS,
      forAuthor: {
        ...base,
        concatenationAccepted: adapted.ok === true,
        concatenationError: adapted.ok === true ? null : adapted.report.errors[0].code,
        scalarCount: adapted.ok === true ? adapted.report.scalarCount : null,
        blocks: scanned.blocks,
        errors: adapted.ok === true ? [] : [publicError(adapted.report.errors[0])],
      },
      operator: {
        validatorSha256: VALIDATOR_SHA256,
        node: process.version,
        rawInputSha256: unchangedBytesSha256,
        derivedOfficialArtifactSha256: adaptedCanonicalSha256,
        parameterFingerprintSha256: adapted.ok === true ? adapted.report.parameterFingerprintSha256 : null,
        directError: direct.ok === true ? null : direct.report.errors[0].code,
      },
    },
  };
}

function structuralReport(bytes, text, validator, representation, scanned, adaptedText) {
  const direct = validator.validateContestant(bytes);
  const unchangedBytesSha256 = direct.report.rawResponseSha256;
  if (scanned.error) {
    return {
      exitCode: 1,
      adaptedText: null,
      body: {
        tool: "pong-authoring-check",
        package: PACKAGE_VERSION,
        checks: CHECKS,
        forAuthor: {
          representation,
          byteLength: bytes.length,
          limits: LIMITS,
          unchangedBytesAccepted: direct.ok === true,
          unchangedBytesError: direct.ok === true ? null : direct.report.errors[0].code,
          concatenationAccepted: false,
          concatenationError: scanned.error,
          scalarCount: null,
          blocks: null,
          errors: [publicError(scanned)],
        },
        operator: {
          validatorSha256: VALIDATOR_SHA256,
          node: process.version,
          rawInputSha256: unchangedBytesSha256,
          derivedOfficialArtifactSha256: null,
          parameterFingerprintSha256: null,
          directError: direct.ok === true ? null : direct.report.errors[0].code,
        },
      },
    };
  }
  const adapted = validator.validateContestant(adaptedText);
  const adaptedBytes = new TextEncoder().encode(adaptedText);
  return {
    exitCode: adapted.ok === true ? 0 : 1,
    adaptedText,
    body: {
      tool: "pong-authoring-check",
      package: PACKAGE_VERSION,
      checks: CHECKS,
      forAuthor: {
        representation,
        byteLength: bytes.length,
        limits: LIMITS,
        unchangedBytesAccepted: direct.ok === true,
        unchangedBytesError: direct.ok === true ? null : direct.report.errors[0].code,
        concatenationAccepted: adapted.ok === true,
        concatenationError: adapted.ok === true ? null : adapted.report.errors[0].code,
        scalarCount: adapted.ok === true ? adapted.report.scalarCount : null,
        blocks: scanned.blocks || null,
        errors: adapted.ok === true ? [] : [publicError(adapted.report.errors[0])],
      },
      operator: {
        validatorSha256: VALIDATOR_SHA256,
        node: process.version,
        rawInputSha256: unchangedBytesSha256,
        derivedOfficialArtifactSha256: validator.sha256Bytes(adaptedBytes),
        parameterFingerprintSha256: adapted.ok === true ? adapted.report.parameterFingerprintSha256 : null,
        directError: direct.ok === true ? null : direct.report.errors[0].code,
      },
    },
  };
}

export function rowsReport(bytes, text, validator) {
  const direct = validator.validateContestant(bytes);
  const blocked = new Set(["size", "bom", "utf8", "type"]);
  if (!direct.ok && blocked.has(direct.report.errors[0].code)) {
    return structuralReport(bytes, text, validator, "row-concatenation", { error: direct.report.errors[0].code, code: direct.report.errors[0].code, index: direct.report.errors[0].index, tokenOffset: direct.report.errors[0].tokenOffset }, null);
  }
  const scanned = scanRows(text);
  if (scanned.error) return structuralReport(bytes, text, validator, "row-concatenation", scanned, null);
  return structuralReport(bytes, text, validator, "row-concatenation", scanned, rowConcatenationText(scanned.found));
}

export async function inspectBytes(bytes, mode) {
  const validator = await loadValidator();
  if (validator.error) return { exitCode: 2, error: validator.error, hash: validator.hash };
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const selected = mode === "rows" ? "rows" : mode === false || mode === "canonical" ? "canonical" : "blocks";
  if (selected === "canonical") {
    const result = validator.validateContestant(view);
    return {
      exitCode: result.ok === true ? 0 : 1,
      body: { tool: "pong-authoring-check", package: PACKAGE_VERSION, checks: CHECKS, ...directView(view, result) },
    };
  }
  let text = null;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    text = null;
  }
  if (text === null) {
    const direct = validator.validateContestant(view);
    return structuralReport(view, "", validator, selected === "rows" ? "row-concatenation" : "mechanical-concatenation", direct.report.errors[0], null);
  }
  if (selected === "rows") return rowsReport(view, text, validator);
  return blocksReport(view, text, validator);
}

export function writeDerivedFile(path, adaptedText) {
  const bytes = Buffer.from(adaptedText, "utf8");
  let fd;
  try {
    fd = openSync(path, "wx");
  } catch {
    return { error: "exists" };
  }
  try {
    writeSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
  const readBack = readFileSync(path);
  if (!readBack.equals(bytes)) {
    unlinkSync(path);
    return { error: "bytes" };
  }
  return { bytes: readBack };
}

function usage() {
  return [
    "usage: node check-authoring.mjs [--rows | --canonical] [--write-derived out.json] [file.json]",
    "The default input is six flat lists: W1 96, b1 16, W2 256, b2 16, W3 48, b3 3.",
    "--rows reads W1 as 6 rows of 16, W2 as 16 rows of 16, W3 as 16 rows of 3, and the biases as flat lists.",
    "--canonical checks an unchanged flat {version, weights} document.",
    "--write-derived writes the derived UTF-8 text only after acceptance, and only if the path does not exist.",
    "Read a file, or stdin when no file is given.",
    "Exit 0 when the selected check accepts the bytes.",
    "Exit 1 when the validator or the structure rejects them.",
    "Exit 2 when the command or the pinned validator file cannot be used.",
    "Requires Node >= 24 on the operator machine. A website session is not assumed to have Node.",
  ].join("\n");
}

export function parseArgs(argv) {
  const positional = [];
  let writePath = null;
  let mode = "blocks";
  let modes = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--canonical" || arg === "--rows" || arg === "--blocks") {
      modes += 1;
      mode = arg === "--canonical" ? "canonical" : arg === "--rows" ? "rows" : "blocks";
      continue;
    }
    if (arg === "--write-derived") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) return { error: true };
      writePath = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) return { error: true };
    positional.push(arg);
  }
  if (modes > 1 || positional.length > 1) return { error: true };
  return { mode, writePath, file: positional[0] || null };
}

export async function main(argv, stdinBytes) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(usage() + "\n");
    return 0;
  }
  if (parsed.error) {
    process.stderr.write(usage() + "\n");
    return 2;
  }
  let bytes = stdinBytes;
  if (parsed.file) {
    const path = isAbsolute(parsed.file) ? parsed.file : resolve(parsed.file);
    if (!existsSync(path)) {
      process.stderr.write("file not found\n");
      return 2;
    }
    bytes = readFileSync(path);
  }
  if (!bytes) {
    process.stderr.write(usage() + "\n");
    return 2;
  }
  const inspected = await inspectBytes(bytes, parsed.mode);
  if (inspected.exitCode === 2) {
    process.stderr.write("validator file does not match the pinned hash\n");
    return 2;
  }
  if (parsed.writePath) {
    if (inspected.exitCode !== 0 || !inspected.adaptedText) {
      process.stdout.write(JSON.stringify(inspected.body) + "\n");
      return inspected.exitCode === 0 ? 2 : inspected.exitCode;
    }
    const target = isAbsolute(parsed.writePath) ? parsed.writePath : resolve(parsed.writePath);
    const written = writeDerivedFile(target, inspected.adaptedText);
    if (written.error) {
      process.stderr.write("derived file was not written\n");
      process.stdout.write(JSON.stringify(inspected.body) + "\n");
      return 2;
    }
    const validator = await loadValidator();
    const check = validator.validateContestant(new Uint8Array(written.bytes));
    const hash = validator.sha256Bytes(new Uint8Array(written.bytes));
    if (!check.ok || hash !== inspected.body.operator.derivedOfficialArtifactSha256) {
      unlinkSync(target);
      process.stderr.write("derived file failed the canonical recheck\n");
      return 2;
    }
  }
  process.stdout.write(JSON.stringify(inspected.body) + "\n");
  return inspected.exitCode;
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);
  const wantsStdin = !parsed.help && !parsed.error && !parsed.file;
  const stdinBytes = wantsStdin && !process.stdin.isTTY ? readFileSync(0) : null;
  process.exitCode = await main(argv, stdinBytes);
}

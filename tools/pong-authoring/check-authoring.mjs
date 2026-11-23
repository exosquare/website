import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VALIDATOR_SHA256 = "44bc8b0170ad400c927abfda67270b300e0381bbc2dfd2d4c8be3efcbc19f414";
export const LIMITS = { bytes: 16384, scalars: 435, magnitude: 16, fractionDigits: 6 };
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
  return { code: error.code, index: error.index ?? null, tokenOffset: error.tokenOffset ?? null };
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
      unchangedBytesSha256: result.report.rawResponseSha256,
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
        forAuthor: { ...base, concatenationAccepted: false, concatenationError: direct.report.errors[0].code, scalarCount: null, blocks: null, errors: [publicError(direct.report.errors[0])] },
        operator: {
          validatorSha256: VALIDATOR_SHA256,
          node: process.version,
          unchangedBytesSha256,
          adaptedCanonicalSha256: null,
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
        forAuthor: { ...base, concatenationAccepted: false, concatenationError: scanned.error, scalarCount: null, blocks: null, errors: [{ code: scanned.error, index: null, tokenOffset: null }] },
        operator: {
          validatorSha256: VALIDATOR_SHA256,
          node: process.version,
          unchangedBytesSha256,
          adaptedCanonicalSha256: null,
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
        forAuthor: { ...base, concatenationAccepted: false, concatenationError: "block-count", scalarCount: null, blocks: scanned.blocks, errors: [{ code: "block-count", index: null, tokenOffset: null }] },
        operator: {
          validatorSha256: VALIDATOR_SHA256,
          node: process.version,
          unchangedBytesSha256,
          adaptedCanonicalSha256: null,
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
        unchangedBytesSha256,
        adaptedCanonicalSha256,
        parameterFingerprintSha256: adapted.ok === true ? adapted.report.parameterFingerprintSha256 : null,
        directError: direct.ok === true ? null : direct.report.errors[0].code,
      },
    },
  };
}

export async function inspectBytes(bytes, blocks) {
  const validator = await loadValidator();
  if (validator.error) return { exitCode: 2, error: validator.error, hash: validator.hash };
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!blocks) {
    const result = validator.validateContestant(view);
    return {
      exitCode: result.ok === true ? 0 : 1,
      body: { tool: "pong-authoring-check", ...directView(view, result) },
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
    return {
      exitCode: 1,
      body: {
        tool: "pong-authoring-check",
        forAuthor: {
          representation: "mechanical-concatenation",
          accepted: false,
          byteLength: view.length,
          scalarCount: null,
          limits: LIMITS,
          errors: [publicError(direct.report.errors[0])],
        },
        operator: {
          validatorSha256: VALIDATOR_SHA256,
          node: process.version,
          unchangedBytesSha256: direct.report.rawResponseSha256,
          adaptedCanonicalSha256: null,
          parameterFingerprintSha256: null,
        },
      },
    };
  }
  return blocksReport(view, text, validator);
}

function usage() {
  return [
    "usage: node check-authoring.mjs [--blocks] [file.json]",
    "Read a file, or stdin when no file is given.",
    "Exit 0 when the selected check accepts the bytes.",
    "Exit 1 when the validator or the block counts reject them.",
    "Exit 2 when the command or the pinned validator file cannot be used.",
    "Requires Node >= 24 on the operator machine. A website session is not assumed to have Node.",
  ].join("\n");
}

export async function main(argv, stdinBytes) {
  const args = argv.filter(function (arg) { return arg !== "--blocks"; });
  const blocks = argv.includes("--blocks");
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage() + "\n");
    return 0;
  }
  if (args.some(function (arg) { return arg.startsWith("--"); }) || args.length > 1) {
    process.stderr.write(usage() + "\n");
    return 2;
  }
  let bytes = stdinBytes;
  if (args.length === 1) {
    const path = isAbsolute(args[0]) ? args[0] : resolve(args[0]);
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
  const inspected = await inspectBytes(bytes, blocks);
  if (inspected.exitCode === 2) {
    process.stderr.write("validator file does not match the pinned hash\n");
    return 2;
  }
  process.stdout.write(JSON.stringify(inspected.body) + "\n");
  return inspected.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const wantsStdin = argv.filter(function (arg) { return arg !== "--blocks" && arg !== "--help" && arg !== "-h"; }).length === 0
    && !argv.includes("--help")
    && !argv.includes("-h");
  const stdinBytes = wantsStdin && !process.stdin.isTTY ? readFileSync(0) : null;
  process.exitCode = await main(argv, stdinBytes);
}

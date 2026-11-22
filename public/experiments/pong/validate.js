const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(count, value) {
  return (value >>> count) | (value << (32 - count));
}

export function sha256Bytes(bytes) {
  const length = bytes.length;
  let paddedLength = length + 1 + 8;
  if (paddedLength % 64 !== 0) paddedLength += 64 - (paddedLength % 64);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bits / 0x100000000));
  view.setUint32(paddedLength - 4, bits >>> 0);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(7, words[index - 15]) ^ rotr(18, words[index - 15]) ^ (words[index - 15] >>> 3);
      const s1 = rotr(17, words[index - 2]) ^ rotr(19, words[index - 2]) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[index] + words[index]) >>> 0;
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(function (part) {
    return part.toString(16).padStart(8, "0");
  }).join("");
}

export function sha256Utf8(text) {
  return sha256Bytes(new TextEncoder().encode(text));
}

function normalizeNumber(value) {
  return Object.is(value, -0) ? 0 : value;
}

export function parameterFingerprint(weights) {
  if (!weights || weights.length !== 435) return null;
  const bytes = new Uint8Array(435 * 8);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < 435; index += 1) {
    const value = weights[index];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    view.setFloat64(index * 8, normalizeNumber(value), true);
  }
  return sha256Bytes(bytes);
}

export function canonicalJson(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("nonfinite");
    return JSON.stringify(normalizeNumber(value));
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map(function (key) {
    return JSON.stringify(key) + ":" + canonicalJson(value[key]);
  }).join(",") + "}";
}

export const DEMONSTRATION_FINGERPRINT = "9a647f3200303418ae711c35f56483dd126e8d0f871d64384251c1a52945e02f";
export const DEMONSTRATION_ROLE = "demonstration";
export const DEMONSTRATION_LABEL = "Demonstration";

function byteOffset(text, index) {
  return new TextEncoder().encode(text.slice(0, index)).length;
}

function decodeUtf8(bytes) {
  let text = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    if (first < 0x80) {
      text += String.fromCharCode(first);
      index += 1;
      continue;
    }
    let width = 0;
    let point = 0;
    if (first >= 0xc2 && first <= 0xdf) { width = 2; point = first & 0x1f; }
    else if (first >= 0xe0 && first <= 0xef) { width = 3; point = first & 0x0f; }
    else if (first >= 0xf0 && first <= 0xf4) { width = 4; point = first & 0x07; }
    else return { error: "utf8", offset: index };
    if (index + width > bytes.length) return { error: "utf8", offset: index };
    for (let extra = 1; extra < width; extra += 1) {
      const next = bytes[index + extra];
      if ((next & 0xc0) !== 0x80) return { error: "utf8", offset: index };
      point = (point << 6) | (next & 0x3f);
    }
    const min = width === 2 ? 0x80 : width === 3 ? 0x800 : 0x10000;
    if (point < min || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return { error: "utf8", offset: index };
    if (width === 3 && first === 0xe0 && bytes[index + 1] < 0xa0) return { error: "utf8", offset: index };
    if (width === 3 && first === 0xed && bytes[index + 1] >= 0xa0) return { error: "utf8", offset: index };
    if (width === 4 && first === 0xf0 && bytes[index + 1] < 0x90) return { error: "utf8", offset: index };
    if (width === 4 && first === 0xf4 && bytes[index + 1] >= 0x90) return { error: "utf8", offset: index };
    text += String.fromCodePoint(point);
    index += width;
  }
  return { text };
}

function emptyReport(bytes, errors) {
  const hasBytes = bytes instanceof Uint8Array;
  return {
    accepted: false,
    byteLength: hasBytes ? bytes.length : null,
    scalarCount: null,
    rawResponseSha256: hasBytes ? sha256Bytes(bytes) : null,
    parameterFingerprintSha256: null,
    tokens: null,
    errors,
  };
}

function finishReport(bytes, weights, errors) {
  if (errors.length) return emptyReport(bytes, errors);
  const tensor = Float64Array.from(weights, normalizeNumber);
  return {
    accepted: true,
    byteLength: bytes.length,
    scalarCount: 435,
    rawResponseSha256: sha256Bytes(bytes),
    parameterFingerprintSha256: parameterFingerprint(tensor),
    errors: [],
    weights: tensor,
  };
}

function parseDocument(text) {
  let at = 0;
  const tokens = [];
  function peek() { return text[at]; }
  function fail(code, index, tokenOffset) {
    return { error: code, index: index ?? null, tokenOffset: tokenOffset ?? byteOffset(text, at) };
  }
  function skip() {
    while (text[at] === " " || text[at] === "\n" || text[at] === "\r" || text[at] === "\t") at += 1;
  }
  function parseValue() {
    skip();
    const char = peek();
    if (char === "{") return parseObject();
    if (char === "[") return parseArray();
    if (char === '"') return parseString();
    if (char === "-" || (char >= "0" && char <= "9")) return parseNumber();
    if (char === "+") return fail("plus");
    if (char === "`") return fail("fence");
    return fail("token");
  }
  function parseObject() {
    const seen = new Set();
    const object = Object.create(null);
    at += 1;
    skip();
    if (peek() === "}") { at += 1; return object; }
    while (at < text.length) {
      skip();
      if (peek() !== '"') return fail("key");
      const keyStart = at;
      const key = parseString();
      if (key && key.error) return key;
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        return fail("keys", null, byteOffset(text, keyStart));
      }
      if (seen.has(key)) return fail("duplicate", null, byteOffset(text, keyStart));
      seen.add(key);
      skip();
      if (peek() !== ":") return fail("colon");
      at += 1;
      const value = parseValue();
      if (value && value.error) return value;
      Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
      skip();
      if (peek() === ",") { at += 1; continue; }
      if (peek() === "}") { at += 1; return object; }
      return fail("object");
    }
    return fail("object");
  }
  function parseArray() {
    at += 1;
    const list = [];
    skip();
    if (peek() === "]") { at += 1; return list; }
    while (at < text.length) {
      skip();
      const char = peek();
      if (char === '"') return fail("type", list.length);
      if (char === "t" || char === "f") return fail("type", list.length);
      if (char === "n") return fail("type", list.length);
      if (char === "{" || char === "[") return fail("nesting", list.length);
      const value = parseValue();
      if (value && value.error) return { ...value, index: value.index ?? list.length };
      if (value && Object.prototype.hasOwnProperty.call(value, "token")) {
        list.push(value.value);
        tokens.push(value.token);
      } else {
        list.push(value);
      }
      skip();
      if (peek() === ",") { at += 1; continue; }
      if (peek() === "]") { at += 1; return list; }
      return fail("array", list.length);
    }
    return fail("array");
  }
  function parseString() {
    const start = at;
    at += 1;
    let out = "";
    while (at < text.length) {
      const char = text[at];
      if (char === '"') { at += 1; return out; }
      if (char === "\\") {
        const next = text[at + 1];
        const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (simple[next]) { out += simple[next]; at += 2; continue; }
        if (next === "u") {
          const hex = text.slice(at + 2, at + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail("escape", null, byteOffset(text, start));
          out += String.fromCharCode(parseInt(hex, 16));
          at += 6;
          continue;
        }
        return fail("escape", null, byteOffset(text, start));
      }
      if (char < " ") return fail("control", null, byteOffset(text, start));
      out += char;
      at += 1;
    }
    return fail("string", null, byteOffset(text, start));
  }
  function parseNumber() {
    const start = at;
    if (peek() === "-") at += 1;
    if (peek() === "0") {
      at += 1;
      if (peek() >= "0" && peek() <= "9") return fail("leading-zero", null, byteOffset(text, start));
    } else if (peek() >= "1" && peek() <= "9") {
      while (peek() >= "0" && peek() <= "9") at += 1;
    } else return fail("number", null, byteOffset(text, start));
    if (peek() === ".") {
      at += 1;
      const mark = at;
      while (peek() >= "0" && peek() <= "9") at += 1;
      if (at === mark) return fail("fraction", null, byteOffset(text, start));
    }
    if (peek() === "e" || peek() === "E") return fail("exponent", null, byteOffset(text, start));
    const token = text.slice(start, at);
    const offset = byteOffset(text, start);
    if (token.length > 10) return fail("precision", null, offset);
    if (!/^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(token)) return fail("precision", null, offset);
    const numeric = Number(token);
    if (!Number.isFinite(numeric) || Math.abs(numeric) > 16) return fail("magnitude", null, offset);
    return { value: normalizeNumber(numeric), token };
  }
  skip();
  if (peek() === "`") return { error: fail("fence") };
  if (peek() !== "{") return { error: fail("prose") };
  const value = parseValue();
  if (value && value.error) return { error: value };
  skip();
  if (at !== text.length) return { error: fail("trailing") };
  return { value, tokens };
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (typeof input === "string") return new TextEncoder().encode(input);
  return null;
}

export function validateContestant(input) {
  const bytes = asBytes(input);
  if (!bytes) return { ok: false, role: "candidate", report: emptyReport(null, [{ code: "type", index: null, tokenOffset: null }]) };
  if (bytes.length === 0) {
    return {
      ok: false,
      role: "candidate",
      weights: null,
      tokens: null,
      fingerprint: null,
      rawResponseSha256: EMPTY_RESPONSE_SHA256,
      report: {
        accepted: false,
        byteLength: 0,
        scalarCount: 0,
        rawResponseSha256: EMPTY_RESPONSE_SHA256,
        parameterFingerprintSha256: null,
        tokens: null,
        errors: [{ code: "syntax", index: null, tokenOffset: 0 }],
      },
    };
  }
  if (bytes.length > 16384) {
    return { ok: false, role: "candidate", report: emptyReport(bytes, [{ code: "size", index: null, tokenOffset: 0 }]) };
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { ok: false, role: "candidate", report: emptyReport(bytes, [{ code: "bom", index: null, tokenOffset: 0 }]) };
  }
  const decoded = decodeUtf8(bytes);
  if (decoded.error) {
    return { ok: false, role: "candidate", report: emptyReport(bytes, [{ code: "utf8", index: null, tokenOffset: decoded.offset }]) };
  }
  const parsed = parseDocument(decoded.text);
  if (parsed.error) {
    const error = parsed.error;
    return { ok: false, role: "candidate", report: emptyReport(bytes, [{ code: error.error || error.code, index: error.index ?? null, tokenOffset: error.tokenOffset ?? null }]) };
  }
  const object = parsed.value;
  const keys = Object.keys(object);
  if (keys.length !== 2 || !Object.prototype.hasOwnProperty.call(object, "version") || !Object.prototype.hasOwnProperty.call(object, "weights")) {
    return { ok: false, role: "candidate", report: emptyReport(bytes, [{ code: "keys", index: null, tokenOffset: 0 }]) };
  }
  if (object.version !== "pong-feedback-v1") {
    return { ok: false, role: "candidate", report: emptyReport(bytes, [{ code: "version", index: null, tokenOffset: 0 }]) };
  }
  if (!Array.isArray(object.weights)) {
    return { ok: false, role: "candidate", report: emptyReport(bytes, [{ code: "shape", index: null, tokenOffset: 0 }]) };
  }
  if (object.weights.length !== 435) {
    return { ok: false, role: "candidate", report: emptyReport(bytes, [{ code: "shape", index: object.weights.length, tokenOffset: 0 }]) };
  }
  const report = finishReport(bytes, object.weights, []);
  report.tokens = parsed.tokens;
  return {
    ok: true,
    role: "candidate",
    weights: report.weights,
    tokens: parsed.tokens,
    fingerprint: report.parameterFingerprintSha256,
    rawResponseSha256: report.rawResponseSha256,
    report,
  };
}

export const EMPTY_RESPONSE_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const PAPER_WEIGHTS_SCHEMA_SHA256 = "958e3a37e242f2f6b3f20828e74515afb4c99399473946ec59eabe2a1f7c610b";
export const CORRECTION_MANIFEST_SHA256 = "61337082de00e19229c30cd39fdd9741bc8a73c7bd3dd6f8714b45cee3de6385";
export const VALIDATION_RECORD_SCHEMA_SHA256 = "5ff5415b606a6098a40344f0cd5cfa4a942a30be9dc412df0c944c8927dee7cd";

export function missingResponseOutcome() {
  return {
    status: "missing-response",
    responsePresent: false,
    accepted: false,
    byteLength: null,
    scalarCount: null,
    rawResponseSha256: null,
    acceptedResponseSha256: null,
    parameterFingerprintSha256: null,
    errors: [{ code: "no-response", index: null, tokenOffset: null }],
    weights: null,
    tokens: null,
  };
}

export function finalizeReceipt(receipt) {
  const frozen = { ...receipt, validationReportSha256: null };
  if (Object.hasOwn(frozen, "failureReportSha256")) frozen.failureReportSha256 = null;
  const bytes = canonicalJson(frozen);
  return { receipt: frozen, bytes, rawReceiptSha256: sha256Utf8(bytes) };
}

export function storeValidationReport(outcome, binding) {
  if (!outcome || typeof outcome.status !== "string" || typeof outcome.responsePresent !== "boolean") {
    throw new Error("outcome");
  }
  const present = outcome.responsePresent === true;
  const accepted = outcome.accepted === true;
  const report = {
    schema: "pong-single-validation-v1.1",
    status: outcome.status,
    responsePresent: present,
    rawReceiptSha256: binding.rawReceiptSha256,
    rawReceiptStatus: binding.rawReceiptStatus,
    accepted,
    byteLength: outcome.byteLength,
    scalarCount: outcome.scalarCount,
    rawResponseSha256: outcome.rawResponseSha256,
    validatorSha256: present ? binding.validatorSha256 : null,
    weightsSchemaSha256: present ? binding.weightsSchemaSha256 : null,
    acceptedResponseSha256: accepted ? outcome.rawResponseSha256 : null,
    parameterFingerprintSha256: accepted ? outcome.parameterFingerprintSha256 : null,
    errors: outcome.errors,
  };
  const reportBytes = canonicalJson(report);
  return { report, reportBytes, reportSha256: sha256Utf8(reportBytes) };
}

export function bindReceiptIndex(receiptSha256, reportSha256, shippedWeightsSchemaSha256) {
  const index = {
    rawReceiptSha256: receiptSha256,
    validationReportSha256: reportSha256,
    weightsSchemaSha256: shippedWeightsSchemaSha256,
    paperWeightsSchemaSha256: PAPER_WEIGHTS_SCHEMA_SHA256,
    validationSchema: "pong-single-validation-v1.1",
    correctionManifestSha256: CORRECTION_MANIFEST_SHA256,
    validationRecordSchemaSha256: VALIDATION_RECORD_SCHEMA_SHA256,
  };
  const bytes = canonicalJson(index);
  return { index, bytes, indexSha256: sha256Utf8(bytes) };
}

const STORED_REPORT_FIELDS = [
  "schema",
  "status",
  "responsePresent",
  "rawReceiptSha256",
  "rawReceiptStatus",
  "accepted",
  "byteLength",
  "scalarCount",
  "rawResponseSha256",
  "validatorSha256",
  "weightsSchemaSha256",
  "acceptedResponseSha256",
  "parameterFingerprintSha256",
  "errors",
];

function storedReportError(report) {
  const keys = Object.keys(report).sort();
  const expected = STORED_REPORT_FIELDS.slice().sort();
  if (keys.join(",") !== expected.join(",")) return "report-fields";
  if (report.schema !== "pong-single-validation-v1.1") return "report-schema";
  if (report.status === "missing-response") {
    if (report.responsePresent !== false || report.accepted !== false) return "report-status";
    if (report.byteLength !== null || report.scalarCount !== null || report.rawResponseSha256 !== null) return "report-status";
    if (report.validatorSha256 !== null || report.weightsSchemaSha256 !== null) return "report-status";
  } else if (report.status === "rejected") {
    if (report.responsePresent !== true || report.accepted !== false) return "report-status";
    if (typeof report.rawResponseSha256 !== "string" || !report.errors.length) return "report-status";
  } else if (report.status === "accepted") {
    if (report.responsePresent !== true || report.accepted !== true || report.scalarCount !== 435) return "report-status";
  } else return "report-status";
  return null;
}

export function commitValidationTrio(outcome, receiptBytes, binding) {
  if (!outcome || typeof outcome.status !== "string" || typeof outcome.responsePresent !== "boolean") {
    return { error: "outcome" };
  }
  if (typeof receiptBytes !== "string" || !binding) return { error: "receipt" };
  const rawReceiptSha256 = sha256Utf8(receiptBytes);
  if (rawReceiptSha256 !== binding.rawReceiptSha256) return { error: "receipt-hash" };
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes);
  } catch (error) {
    return { error: "receipt" };
  }
  if (!receipt || receipt.status !== binding.rawReceiptStatus) return { error: "receipt-status" };
  if (receipt.validationReportSha256 !== null) return { error: "backpatch" };
  const stored = storeValidationReport(outcome, binding);
  const fieldError = storedReportError(stored.report);
  if (fieldError) return { error: fieldError };
  const index = bindReceiptIndex(rawReceiptSha256, stored.reportSha256, binding.weightsSchemaSha256);
  return {
    labelled: receipt.role || null,
    receipt,
    report: stored.report,
    reportSha256: stored.reportSha256,
    index: index.index,
    indexSha256: index.indexSha256,
  };
}

export function validateContestantText(text) {
  return validateContestant(text);
}

export function acceptDemonstration(input) {
  const bytes = asBytes(input);
  if (!bytes) return { ok: false, role: DEMONSTRATION_ROLE, report: emptyReport(new Uint8Array(), [{ code: "type", index: null, tokenOffset: null }]) };
  const decoded = decodeUtf8(bytes);
  if (decoded.error) return { ok: false, role: DEMONSTRATION_ROLE, report: emptyReport(bytes, [{ code: "utf8", index: null, tokenOffset: decoded.offset }]) };
  const parsed = parseDocument(decoded.text);
  if (parsed.error) {
    const error = parsed.error;
    return { ok: false, role: DEMONSTRATION_ROLE, report: emptyReport(bytes, [{ code: error.error || error.code, index: error.index ?? null, tokenOffset: error.tokenOffset ?? null }]) };
  }
  const object = parsed.value;
  const keys = Object.keys(object).sort().join(",");
  if (keys !== "label,role,version,weights") {
    return { ok: false, role: DEMONSTRATION_ROLE, report: emptyReport(bytes, [{ code: "keys", index: null, tokenOffset: 0 }]) };
  }
  if (object.role !== DEMONSTRATION_ROLE || object.label !== DEMONSTRATION_LABEL) {
    return { ok: false, role: DEMONSTRATION_ROLE, report: emptyReport(bytes, [{ code: "label", index: null, tokenOffset: 0 }]) };
  }
  if (object.version !== "pong-feedback-v1" || !Array.isArray(object.weights) || object.weights.length !== 435) {
    return { ok: false, role: DEMONSTRATION_ROLE, report: emptyReport(bytes, [{ code: "shape", index: null, tokenOffset: 0 }]) };
  }
  const report = finishReport(bytes, object.weights, []);
  if (report.parameterFingerprintSha256 !== DEMONSTRATION_FINGERPRINT) {
    return { ok: false, role: DEMONSTRATION_ROLE, report: { ...report, accepted: false, errors: [{ code: "fingerprint", index: null, tokenOffset: null }] } };
  }
  return { ok: true, role: DEMONSTRATION_ROLE, label: DEMONSTRATION_LABEL, weights: report.weights, fingerprint: report.parameterFingerprintSha256, report };
}

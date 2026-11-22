import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const cssPath = fileURLToPath(new URL("./preview.css", import.meta.url));
const jsPath = fileURLToPath(new URL("./preview.js", import.meta.url));

function check() {
  return spawnSync(process.execPath, ["scripts/bundle-pong-preview.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
}

const clean = check();
assert.equal(clean.status, 0, clean.stderr || clean.stdout);

function expectStale(path, needle) {
  const original = readFileSync(path);
  try {
    const text = original.toString("utf8");
    const next = text.replace(needle, `${needle}X`);
    assert.notEqual(next, text);
    writeFileSync(path, next);
    const stale = check();
    assert.notEqual(stale.status, 0, path);
    assert.match(`${stale.stdout}\n${stale.stderr}`, /stale/);
  } finally {
    writeFileSync(path, original);
  }
  const restored = check();
  assert.equal(restored.status, 0, restored.stderr || restored.stdout);
}

expectStale(cssPath, "Helvetica");
expectStale(jsPath, "drawCloud");
console.log("bundle check tests passed");

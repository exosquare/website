import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { acceptDemonstration, validateContestant } from "./validate.js";
import { authoringCopy, readAuthoringStatus } from "./authoring-status.js";

const text = readFileSync(new URL("./data/authoring-status.json", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const page = html.slice(0, html.indexOf('<script id="pong-preview-script">'));
const preview = readFileSync(new URL("./preview.js", import.meta.url), "utf8");
const helper = readFileSync(fileURLToPath(new URL("./authoring-status.js", import.meta.url)), "utf8");
const play = readFileSync(new URL("../../../src/pages/experiments/play/pong.astro", import.meta.url), "utf8");
const artifact = readFileSync(new URL("../../../src/components/pong/PongArtifact.astro", import.meta.url), "utf8");
const record = readAuthoringStatus(text);
const copy = authoringCopy(record);
const validator = readFileSync(new URL("./validate.js", import.meta.url));

assert.equal(createHash("sha256").update(validator).digest("hex"), record.validatorSha256);
assert.notEqual(Buffer.byteLength(text), record.capturedTextUtf8Bytes);
assert.equal(record.acceptedArtifact, false);
assert.equal(record.candidateLoaded, false);
assert.equal(record.playedPoints, null);
assert.equal(record.strengthScore, null);
assert.equal(record.scalarCount, null);
assert.equal(record.parameterFingerprint, null);
assert.equal(copy.outcome, "rejected");
assert.match(copy.demonstration, /^Demonstration weights/);
assert.doesNotMatch(copy.demonstration, /rejected|not run|pending/i);
assert.match(copy.attempt, /Grok authoring attempt rejected/);
assert.match(copy.attempt, /No accepted artifact/);
assert.match(copy.attempt, /32 scheduled, 0 played/);
assert.doesNotMatch(copy.attempt, /not run|pending|loss|won/i);
assert.match(copy.scheduleNote, /Administrative forfeits are not observed losses/);
assert.match(copy.scheduleNote, /invalid-artifact-not-played/);
assert.match(copy.attemptNote, /93,902 UTF-8 bytes/);
assert.match(copy.attemptNote, /16,384-byte cap/);
assert.match(copy.attemptNote, /captured page text, not a transport byte count/);
assert.match(copy.limits, /Tools-off was not independently verified/);
assert.equal(Object.hasOwn(record, "weights"), false);

for (const line of [copy.demonstration, copy.attempt, copy.attemptNote, copy.scheduleNote, copy.limits, copy.revision]) {
  assert.equal(page.includes(line), true, line.slice(0, 48));
}
assert.equal(page.includes('id="demonstration-status"'), true);
assert.equal(page.includes('id="attempt-status"'), true);
assert.equal(page.includes('data-attempt-outcome="rejected"'), true);
assert.equal(page.includes('data-candidate-loaded="false"'), true);
assert.doesNotMatch(page, /Evaluation not run/);
assert.doesNotMatch(html, /Evaluation not run/);
assert.equal(page.includes('rel="stylesheet"'), false);
assert.equal(page.includes('type="module"'), false);
assert.match(preview, /readAuthoringStatus\(authoringStatusText\)/);
assert.doesNotMatch(helper, /validateContestant|acceptDemonstration|fetch\(/);
assert.doesNotMatch(text, /\/home\/|\/opt\/cursor|uploads\/|PUBLIC-SAFE|Co-authored-by|receipt|prompt file/i);

assert.equal(validateContestant(text).ok, false);
assert.equal(acceptDemonstration(text).ok, false);
assert.match(play, /Demonstration weights\. No official score\. First attempt rejected\. Assisted row canonical is a separate accepted list\./);
assert.match(page, /Grok authoring attempt rejected\. No accepted artifact\. 32 scheduled, 0 played\./);
assert.doesNotMatch(play, /Evaluation not run/);
assert.match(play, /sandbox="allow-scripts"/);
assert.doesNotMatch(play, /allow-same-origin/);
assert.match(artifact, /sandbox="allow-scripts"/);
assert.doesNotMatch(artifact, /allow-same-origin/);
assert.match(artifact, /No contestant artifact is loaded/);

const article = readFileSync(new URL("../../../src/content/articles/weight-space-pong.mdx", import.meta.url), "utf8");
assert.match(article, /kind: 'Experiment note'/);
assert.match(article, /draft: true/);
assert.equal(article.includes("publishedAt"), false);
assert.match(article, /standfirst: 'We are building an inspectable Pong player from 435 static numbers that run in the browser\. The captured reply from the first attempt to have Grok write those numbers was rejected for size before any game was played\.'/);
assert.match(article, /## How the player is put together/);
assert.match(article, /## How similar might authored players be\?/);
assert.match(article, /import PongArtifact from '\.\.\/\.\.\/components\/pong\/PongArtifact\.astro'/);
assert.match(article, /<PongArtifact \/>/);
assert.match(article, /## The first attempt stopped before play/);
assert.match(article, /There is no playable model-written player\./);
assert.match(article, /this is not a record of wins or losses/);
assert.equal(article.includes("## What is in place, and what is still open"), false);
assert.equal(article.includes("No model-written player has been requested or evaluated yet."), false);
assert.doesNotMatch(article, /\/home\/|\/opt\/cursor|uploads\//);

console.log("authoring status tests passed");

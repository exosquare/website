import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = path.join(root, "public/experiments/pong/index.html");
const entry = path.join(root, "public/experiments/pong/preview.js");
const cssPath = path.join(root, "public/experiments/pong/preview.css");

const built = await esbuild.build({
  absWorkingDir: root,
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
  legalComments: "none",
  loader: { ".json": "text" },
});
const script = built.outputFiles[0].text.replaceAll("</script", "<\\/script");
const css = fs.readFileSync(cssPath, "utf8").replaceAll("</style", "<\\/style");
const html = fs.readFileSync(page, "utf8");
const next = html
  .replace(/<style id="pong-preview-css">[\s\S]*?<\/style>/, `<style id="pong-preview-css">\n${css}\n</style>`)
  .replace(/<script id="pong-preview-script">[\s\S]*?<\/script>/, `<script id="pong-preview-script">\n${script}\n</script>`);
if (!html.includes('id="pong-preview-css"') || !html.includes('id="pong-preview-script"')) {
  console.error("index.html is missing the preview style or script markers");
  process.exit(1);
}
if (process.argv.includes("--check")) {
  if (next !== html) {
    console.error("inline preview is stale; run node scripts/bundle-pong-preview.mjs");
    process.exit(1);
  }
  console.log("inline preview matches sources");
} else if (next !== html) {
  fs.writeFileSync(page, next);
  console.log("inlined preview css and script");
} else {
  console.log("inline preview already current");
}

import assert from "node:assert/strict";
import { COUNT, direction, radiusOf, demonstrationValue } from "./kernel.js";
import {
  projectPoint,
  frameScale,
  markerOuter,
  insideDrawable,
  YAW,
  PITCH,
} from "./cloud-frame.js";

const canvases = [
  { name: "320", width: 320, height: 260 },
  { name: "390", width: 390, height: 280 },
  { name: "1440", width: 660, height: 480 },
];
const views = [
  { yaw: YAW, pitch: PITCH, simple: false },
  { yaw: 0, pitch: PITCH, simple: false },
  { yaw: 2.4, pitch: 0.2, simple: false },
  { yaw: 4.1, pitch: -0.9, simple: false },
  { yaw: YAW, pitch: PITCH, simple: true },
];

function weightsFor(preset, index) {
  if (preset === "zero") return 0;
  if (preset === "pos") return 16;
  if (preset === "neg") return -16;
  if (preset === "fork") return index >= 144 && index < 160 ? 0 : demonstrationValue(index);
  return demonstrationValue(index);
}

for (let index = 0; index < COUNT; index += 7) {
  const ray = direction(index);
  const y = 1 - (2 * (index + 0.5)) / COUNT;
  assert.ok(Math.abs(ray.y - y) < 1e-12, "index " + index);
}

for (const canvas of canvases) {
  for (const view of views) {
    const scale = frameScale(canvas.width, canvas.height, view);
    assert.ok(scale > 0, canvas.name);
    const again = frameScale(canvas.width, canvas.height, view);
    assert.equal(scale, again);
    if (!view.simple) {
      const turned = frameScale(canvas.width, canvas.height, { ...view, yaw: view.yaw + 1.7 });
      assert.ok(Math.abs(scale - turned) < 1e-6, canvas.name + " rotation scale");
    }
    for (const preset of ["demo", "zero", "pos", "neg", "fork"]) {
      const origin = projectPoint({ x: 0, y: 0, z: 0 }, view);
      for (let index = 0; index < COUNT; index += 1) {
        const ray = direction(index);
        const radius = radiusOf(weightsFor(preset, index));
        const placed = projectPoint({
          x: ray.x * radius,
          y: ray.y * radius,
          z: ray.z * radius,
        }, view);
        const sx = canvas.width / 2 + (placed.x - origin.x) * scale;
        const sy = canvas.height / 2 - (placed.y - origin.y) * scale;
        const selected = index >= 144 && index < 160;
        const outer = markerOuter(scale, placed.z, selected, index >= 432 || (index >= 96 && index < 112) || (index >= 368 && index < 384) ? "bias" : "weight");
        assert.equal(insideDrawable(sx, sy, outer, canvas.width, canvas.height), true, canvas.name + " " + preset + " " + index);
      }
    }
  }
}

console.log("cloud frame tests passed");

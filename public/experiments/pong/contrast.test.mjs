import assert from "node:assert/strict";

function channel(hex) {
  const value = Number.parseInt(hex, 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const red = channel(hex.slice(1, 3));
  const green = channel(hex.slice(3, 5));
  const blue = channel(hex.slice(5, 7));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function ratio(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const stage = "#101315";
const control = "#64686c";
const hairline = "#2b3439";
assert.ok(ratio(control, stage) >= 3, ratio(control, stage).toFixed(2));
assert.ok(ratio(hairline, stage) < 3, ratio(hairline, stage).toFixed(2));
console.log("contrast tests passed", ratio(control, stage).toFixed(2));

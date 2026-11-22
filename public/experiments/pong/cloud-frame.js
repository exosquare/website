import { R } from "./kernel.js";

export const CLOUD_PAD = 8;
export const GLYPH = 0.04;
export const AMBIENT_MIN = 1.45;
export const SELECTED_MIN = 2.35;
export const AMBIENT_GAIN = 0.5;
export const SELECTED_GAIN = 0.78;
export const RING_OUTSET = 1.1;
export const RING_WIDTH = 0.7;
export const BIAS_STRETCH = 1.35;
export const STROKE = 1.1;
export const YAW = 1.02;
export const PITCH = -0.58;
export const DISTANCE = 3.05;
export const FOCAL = 2.15;

export function projectPoint(point, view) {
  if (view.simple) return { x: point.x * 0.85, y: point.y * 0.85, z: DISTANCE };
  const yaw = view.yaw;
  const pitch = view.pitch;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const eye = { x: DISTANCE * cp * sy, y: DISTANCE * sp, z: DISTANCE * cp * cy };
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  let fx = -eye.x;
  let fy = -eye.y;
  let fz = -eye.z;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = -fz;
  let ry = 0;
  let rz = fx;
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  const x = dx * rx + dy * ry + dz * rz;
  const y = dx * ux + dy * uy + dz * uz;
  const z = dx * fx + dy * fy + dz * fz;
  return { x: (FOCAL * x) / z, y: (FOCAL * y) / z, z };
}

export function markerBody(scale, depth, selected) {
  const gain = selected ? SELECTED_GAIN : AMBIENT_GAIN;
  const floor = selected ? SELECTED_MIN : AMBIENT_MIN;
  return Math.max(floor, gain * GLYPH * (FOCAL / depth) * scale);
}

export function markerOuter(scale, depth, selected, kind) {
  const body = markerBody(scale, depth, selected);
  if (kind === "bias") return body * BIAS_STRETCH + STROKE / 2;
  return body + (selected ? RING_OUTSET + RING_WIDTH / 2 : 0);
}

function boundSamples() {
  const samples = [
    { x: R, y: 0, z: 0 },
    { x: -R, y: 0, z: 0 },
    { x: 0, y: R, z: 0 },
    { x: 0, y: -R, z: 0 },
    { x: 0, y: 0, z: R },
    { x: 0, y: 0, z: -R },
  ];
  for (let index = 0; index < 96; index += 1) {
    const y = 1 - (2 * (index + 0.5)) / 96;
    const ring = Math.sqrt(Math.max(0, 1 - y * y)) * R;
    const theta = Math.PI * (3 - Math.sqrt(5)) * index;
    samples.push({ x: ring * Math.cos(theta), y: y * R, z: ring * Math.sin(theta) });
  }
  return samples;
}

function worstOuter(scale, depth) {
  return Math.max(
    markerOuter(scale, depth, true, "weight"),
    markerOuter(scale, depth, true, "bias"),
  );
}

export function sphereFits(scale, width, height, view) {
  const origin = projectPoint({ x: 0, y: 0, z: 0 }, view);
  const samples = boundSamples();
  for (let index = 0; index < samples.length; index += 1) {
    const placed = projectPoint(samples[index], view);
    const sx = width / 2 + (placed.x - origin.x) * scale;
    const sy = height / 2 - (placed.y - origin.y) * scale;
    const outer = worstOuter(scale, placed.z);
    if (sx - outer < CLOUD_PAD || sx + outer > width - CLOUD_PAD) return false;
    if (sy - outer < CLOUD_PAD || sy + outer > height - CLOUD_PAD) return false;
  }
  return true;
}

function searchedScale(width, height, view) {
  let low = 0;
  let high = Math.max(width, height);
  for (let step = 0; step < 28; step += 1) {
    const mid = (low + high) / 2;
    if (sphereFits(mid, width, height, view)) low = mid;
    else high = mid;
  }
  return low;
}

export function frameScale(width, height, view) {
  if (view.simple) return searchedScale(width, height, view);
  const half = Math.min(width, height) / 2 - CLOUD_PAD;
  const reach = (FOCAL * R) / Math.sqrt(DISTANCE * DISTANCE - R * R);
  const nearZ = DISTANCE - R;
  const linear = (SELECTED_GAIN * GLYPH * FOCAL) / nearZ;
  const biasPad = SELECTED_MIN * BIAS_STRETCH + STROKE / 2;
  const ringPad = SELECTED_MIN + RING_OUTSET + RING_WIDTH / 2;
  return Math.min(
    (half - STROKE / 2) / (reach + linear * BIAS_STRETCH),
    (half - RING_OUTSET - RING_WIDTH / 2) / (reach + linear),
    (half - biasPad) / reach,
    (half - ringPad) / reach,
  );
}

export function insideDrawable(x, y, outer, width, height) {
  return x - outer >= CLOUD_PAD
    && x + outer <= width - CLOUD_PAD
    && y - outer >= CLOUD_PAD
    && y + outer <= height - CLOUD_PAD;
}

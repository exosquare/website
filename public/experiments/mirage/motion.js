/** Timings shared by the stage. Durations are milliseconds. Curves are cubic-bezier control points. */
export const mirageMotion = {
  fast: 120,
  base: 200,
  slow: 320,
  fade: 120,
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  hover: [0.25, 0.1, 0.25, 1],
  scanPass: 1200,
  scanHoldAt: 0.9,
  boxStagger: 30,
  boxStaggerWindow: 240,
  boxStaggerCap: 24,
  dimOpacity: 0.4,
  linkStroke: 2,
  instantThreshold: 200,
};

function bezierComponent(t, a, b) {
  const c = 3 * a;
  const d = 3 * (b - a) - c;
  const e = 1 - c - d;
  return ((e * t + d) * t + c) * t;
}

function bezierSlope(t, a, b) {
  const c = 3 * a;
  const d = 3 * (b - a) - c;
  const e = 1 - c - d;
  return (3 * e * t + 2 * d) * t + c;
}

/** Ease a 0..1 time value through a cubic-bezier curve. */
export function ease(curve, time) {
  const t = Math.max(0, Math.min(1, time));
  if (t === 0 || t === 1) return t;
  const [x1, y1, x2, y2] = curve;
  let s = t;
  for (let i = 0; i < 8; i += 1) {
    const x = bezierComponent(s, x1, x2) - t;
    const slope = bezierSlope(s, x1, x2);
    if (Math.abs(slope) < 1e-6) break;
    s = Math.max(0, Math.min(1, s - x / slope));
  }
  return bezierComponent(s, y1, y2);
}

/** Move `from` toward `to` without passing it. `time` is 0..1 of the tween. */
export function approach(from, to, time) {
  const next = from + (to - from) * ease(mirageMotion.out, time);
  if (to >= from) return Math.min(to, next);
  return Math.max(to, next);
}

export function linesDue(shown, total) {
  if (!Number.isFinite(shown) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.floor(Math.max(0, Math.min(1, shown)) * total);
}

/** Gap between box-draw starts. No stagger once there are more than 24 boxes. */
export function boxStagger(count) {
  if (count <= 1 || count > mirageMotion.boxStaggerCap) return 0;
  return Math.min(mirageMotion.boxStagger, mirageMotion.boxStaggerWindow / (count - 1));
}

/**
 * Scan line for one stage.
 * Returns null when no line should be drawn, otherwise y (0 top, 1 bottom) and opacity.
 * Without progress the line travels to 0.9 and holds. It never starts a second pass.
 * @param {{
 *   elapsed?: number,
 *   reduced?: boolean,
 *   stageMs?: number | null,
 *   sinceEnd?: number | null,
 *   hasProgress?: boolean,
 *   progress?: number,
 *   shown?: number | null,
 * }} input
 * @returns {{ y: number, opacity: number } | null}
 */
export function scanState({
  elapsed = 0,
  reduced = false,
  stageMs = null,
  sinceEnd = null,
  hasProgress = false,
  progress = 0,
  shown = null,
}) {
  if (reduced) return null;
  if (stageMs != null && stageMs < mirageMotion.instantThreshold) return null;
  if (sinceEnd == null && elapsed < mirageMotion.instantThreshold) return null;

  const appearAt = mirageMotion.instantThreshold;
  const cappedProgress = Math.max(0, Math.min(1, progress));
  const displayed = shown == null ? cappedProgress : Math.max(0, Math.min(cappedProgress, shown));

  function heldY(at) {
    if (hasProgress) return displayed;
    const travel = Math.max(0, at - appearAt);
    const t = Math.min(1, travel / mirageMotion.scanPass);
    return ease(mirageMotion.out, t) * mirageMotion.scanHoldAt;
  }

  const endAt = stageMs == null ? elapsed : stageMs;
  let y = heldY(Math.min(elapsed, endAt));
  let opacity = ease(
    mirageMotion.out,
    Math.max(0, Math.min(1, (Math.min(elapsed, endAt) - appearAt) / mirageMotion.fade)),
  );

  if (sinceEnd != null && stageMs != null) {
    const yAtEnd = hasProgress ? displayed : heldY(stageMs);
    const finish = Math.max(0, Math.min(1, sinceEnd / mirageMotion.fast));
    y = yAtEnd + (1 - yAtEnd) * ease(mirageMotion.out, finish);
    opacity = 1;
    if (sinceEnd > mirageMotion.fast) {
      const fade = Math.min(1, (sinceEnd - mirageMotion.fast) / mirageMotion.fade);
      opacity = 1 - ease(mirageMotion.out, fade);
    }
  }

  return { y, opacity };
}

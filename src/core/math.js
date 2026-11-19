export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

/** Moves `a` towards `b` so that the gap closes at `rate` per second whatever the frame rate. */
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

/** The shortest signed turn from angle a to angle b, in -PI..PI. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

/** Turns angle `a` towards `b` by at most `step`. */
export function turnTowards(a, b, step) {
  const d = angleDelta(a, b);
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}

/**
 * The yaw that faces from (x0, z0) towards (x1, z1).
 * Yaw 0 looks down -Z and grows anticlockwise seen from above: forward = (-sin yaw, 0, -cos yaw).
 */
export const yawTo = (x0, z0, x1, z1) => Math.atan2(-(x1 - x0), -(z1 - z0));

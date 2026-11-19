// The casings of the cascade turn. No drawing in here — world/build.js and gfx/materials.js do that — so it runs
// under `node --test` (test/unit/spin.test.mjs).
//
// Decision of 16 November 2026 — the owner: "make the centrifuge spin". What turns is the SKIN of a casing: the
// straight side of it, between a foot and a head that stand still, as a drum turns in its bearings. Five hundred
// of them are one mesh drawn in one go, so the turning is done where the corners are placed on the screen (the
// vertex shader: gfx/materials.js LODE_SPIN) and costs the processor one number a frame. A plain metal cylinder
// that turns looks exactly like one that does not; so the skin carries MARKS — three streaks down it, as a drum
// that has been handled has — and in the second look the grain of its metal goes round with it too.
// When the charges are fired the turning runs down, and what lies in the wreck lies still.

const TURN = Math.PI * 2;

export const SPIN = {
  /** turns a second, for a casing of middling haste: quick enough to see at a glance, slow enough to follow */
  rate: 1.1,
  /** every casing turns at one of this many speeds: `from`, and `step` more for each one up (of the middling) */
  speeds: 5,
  from: 0.75,
  step: 0.125,
  /** seconds for the turning to run down once the charges are fired */
  runDown: 2.5,
  /** the marks on the skin: [where round it, in turns; how much darker (under 1) or lighter (over 1) it is there] */
  marks: [
    [0, 0.5],
    [0.37, 1.32],
    [0.68, 0.7],
  ],
  /**
   * The angle the shader is given comes round at this — a number that only grew would lose its small change in
   * an hour — which is eight turns: where every one of the speeds above has made a whole number of its own.
   */
  wrap: TURN * 8,
};

/** How fast a casing turns, of the middling speed, by the lot it drew (0 … 1): what the shader works out too. */
export const rateOf = (lot) => SPIN.from + SPIN.step * Math.min(SPIN.speeds - 1, Math.floor(lot * SPIN.speeds));

/**
 * Which corners of a casing are its skin: 1 for those, 0 for the rest. The skin is the straight side — at the
 * radius it is given, between the heights it is given, facing squarely outwards. (The foot meets it at the same
 * radius and height: but a foot's sides lean.)
 * @param {ArrayLike<number>} position x, y, z of each corner
 * @param {ArrayLike<number>} normal which way each faces
 */
export function skinOf(position, normal, { radius = 0.21, bottom = 0.14, top = 2.78 } = {}) {
  const n = position.length / 3;
  const skin = new Float32Array(n);
  const NEAR = 2e-3;
  for (let i = 0; i < n; i++) {
    const y = position[i * 3 + 1];
    const out = Math.hypot(position[i * 3], position[i * 3 + 2]);
    if (Math.abs(out - radius) < NEAR && y > bottom - NEAR && y < top + NEAR && Math.abs(normal[i * 3 + 1]) < 0.02)
      skin[i] = 1;
  }
  return skin;
}

const round = (x, z) => (Math.atan2(z, x) / TURN + 1) % 1;
/** how far apart two places round the skin are, in turns: never more than a half */
const apart = (a, b) => Math.abs(((a - b + 1.5) % 1) - 0.5);

/**
 * Puts the marks on the skin: each on the line of corners nearest to where it is meant to be, from the bottom of
 * the skin to the top — so a casing of eight sides and one of twenty-two both have three, and between that line
 * and its neighbours the colour runs back to the metal's own.
 * @param {Float32Array} color r, g, b of each corner: changed in place
 * @param {ArrayLike<number>} skin what skinOf() said
 */
export function markSkin(position, color, skin, marks = SPIN.marks) {
  const n = skin.length;
  for (const [where, shade] of marks) {
    let line = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!skin[i]) continue;
      const d = apart(round(position[i * 3], position[i * 3 + 2]), where);
      if (d < best) {
        best = d;
        line = round(position[i * 3], position[i * 3 + 2]);
      }
    }
    if (line < 0) continue;
    for (let i = 0; i < n; i++) {
      if (!skin[i] || apart(round(position[i * 3], position[i * 3 + 2]), line) > 1e-3) continue;
      for (let c = 0; c < 3; c++) color[i * 3 + c] *= shade;
    }
  }
  return color;
}

/**
 * A frame of the turning. `state.angle` is what the shader is given; `state.speed` is 1 while the cascade
 * stands, and runs down to nothing over SPIN.runDown once it does not.
 * @param {{ angle: number, speed: number }} state
 * @param {boolean} standing the charges have not been fired
 */
export function turn(state, dt, standing) {
  state.speed = standing ? 1 : Math.max(0, state.speed - dt / SPIN.runDown);
  state.angle = (state.angle + dt * SPIN.rate * TURN * state.speed) % SPIN.wrap;
  return state;
}

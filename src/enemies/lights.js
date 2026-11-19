// A drone can be found far off: how far a machine is drawn, and a drone's running lights.
//
// Decision of 16 November 2026 — the owner: "the drones sometimes get lost in the distance". A machine further
// than ninety metres from the eye was not drawn at all (the cavern is longer than that), and from forty metres a
// drone is a line a pixel or two high that the night haze takes. So a machine is drawn as far off as anybody can
// stand from it, and a drone carries lights: its eye, in the colour of what it is thinking, and a white strobe
// on its back. They are flat pictures that face the eye (gfx/billboards.js), drawn by enemies/index.js; what is
// here is the numbers, and nothing else. Pinned by test/unit/lights.test.mjs. No three.js and no browser.

/** how far from the eye a machine is still drawn (metres): further than any two places on the site are apart */
export const FAR = 150;

export const LIGHT = {
  /** metres across, close to */
  size: 0.3,
  /** …and further off never less than this share of the distance: a few pixels, whatever the window */
  grows: 0.02,
  /** nearer than `near` metres the lights add nothing — the drone itself is seen; from `full` they are whole */
  near: 8,
  full: 25,
  /** the night haze never takes more of a light than leaves this much: a lamp is seen through haze as a glare */
  fogFloor: 0.5,
  /** the strobe on its back: a flash of `on` seconds every `period` */
  strobe: { period: 1.3, on: 0.09 },
};

/** How many metres across a drone's light is drawn, `d` metres from the eye. */
export const lightSize = (d) => Math.max(LIGHT.size, d * LIGHT.grows);

/**
 * …and how many pixels that is, in a window `height` pixels high whose field of view, top to bottom, is `fov`
 * degrees.
 */
export const lightPixels = (d, height, fov) => ((lightSize(d) / d) * (height / 2)) / Math.tan((fov * Math.PI) / 360);

/** How much of its lights a drone `d` metres off shows: none close to, all of them from LIGHT.full. */
export function lightShare(d) {
  const t = Math.min(1, Math.max(0, (d - LIGHT.near) / (LIGHT.full - LIGHT.near)));
  return t * t * (3 - 2 * t);
}

/**
 * Whether drone `id`'s strobe is lit at time `t` (seconds): 1 or 0. Each drone flashes at its own moment: two of
 * them never flash together.
 */
export function strobe(t, id) {
  const { period, on } = LIGHT.strobe;
  const phase = (t + id * period * 0.381966) % period;
  return phase < on ? 1 : 0;
}

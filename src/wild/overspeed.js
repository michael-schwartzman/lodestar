// The overspeed: bringing the cascades down from the control room without a charge on them. Rules only — no
// drawing and no browser in here; src/wild/overspeed-live.js joins them to the game — so it runs under
// `node --test` (test/unit/wild-overspeed.test.mjs).
//
// The wild branch's experiment (docs/WILD.md, "The overspeed"). A centrifuge is a rotor turning at the edge of
// what its metal will bear; the drives that turn it are told how fast by the control room. The uplink can tell
// them something else. From the firing point, with charges still unset, the player pushes every drive in the
// hall past its limit — from 1 064 turns a second to 1 410, which is what was once done to such machines — and
// holds the control room while the rotors find out. WARDEN feels it at once, and sends everything.
//
// Fiction, like everything in the game: nothing here is how any real facility is worked or broken.
import { clamp01, lerp } from '../core/math.js';

export const OVERSPEED = {
  /** seconds the room must be held with no charge set; so many fewer for each charge that is; and never fewer than */
  seconds: 32,
  perCharge: 6,
  least: 10,
  /** how near the firing point the player must stay, in metres: the control room */
  reach: 7,
  /** out of the room, it runs back down — at this many times the rate it builds */
  slip: 0.5,
  /** how far along a wave of machines is sent for it, and how far along the hall's lamps give out */
  waves: [0.12, 0.45, 0.78],
  dark: 0.5,
  /** the drives: turns a second as they are, and at the end */
  hz: [1064, 1410],
  /** how many times as fast the skins are SEEN to turn at the end (they are seen: nothing real turns so fast) */
  spin: 6,
  /** how far along the casings begin to shake in their seats */
  shakeFrom: 0.25,
};

/** what happens on the way, in the order of how far along it happens */
const MARKS = [...OVERSPEED.waves.map((at) => [at, 'wave']), [OVERSPEED.dark, 'dark']].sort((a, b) => a[0] - b[0]);

/** How many seconds the room must be held, with so many charges already set. */
export const needFor = (chargesSet) => Math.max(OVERSPEED.least, OVERSPEED.seconds - OVERSPEED.perCharge * chargesSet);

/**
 * @returns {{ running: boolean, done: boolean, progress: number, need: number, at: number }}
 *   progress 0 … 1; need: seconds from nought to the end; at: how many of the things on the way have happened
 */
export function createOverspeed() {
  return { running: false, done: false, progress: 0, need: OVERSPEED.seconds, at: 0 };
}

/** It is begun, from nothing. Not twice at once, and not once it has been done. */
export function begin(o, chargesSet) {
  if (o.running || o.done) return;
  o.running = true;
  o.progress = 0;
  o.need = needFor(chargesSet);
  o.at = 0;
}

/**
 * A step of it.
 *
 * Loop contract: progress stays in 0 … 1. It runs while it has been begun, and ends in exactly one of two ways:
 * at 1 it is DONE (once, for the mission), or — the room left for long enough — it runs back down to 0 and is
 * ABANDONED, after which it can be begun again from nothing. What happens on the way happens once a run.
 *
 * @param {ReturnType<typeof createOverspeed>} o changed in place
 * @param {{ dt: number, near: boolean }} now  near: the player is in the room, and on their feet
 * @returns {string[]} 'wave' | 'dark' | 'done' | 'abandoned'
 */
export function stepOverspeed(o, { dt, near }) {
  const said = [];
  if (!o.running) return said;
  o.progress = clamp01(o.progress + ((near ? 1 : -OVERSPEED.slip) * dt) / o.need);
  for (; o.at < MARKS.length && o.progress >= MARKS[o.at][0]; o.at++) said.push(MARKS[o.at][1]);
  if (o.progress >= 1) {
    o.running = false;
    o.done = true;
    said.push('done');
  } else if (o.progress <= 0 && !near) {
    o.running = false;
    said.push('abandoned');
  }
  return said;
}

/** The drives, in turns a second, so far along. */
export const hzAt = (p) => lerp(OVERSPEED.hz[0], OVERSPEED.hz[1], clamp01(p));

/** How many times as fast the skins are seen to turn: slowly at first, then all at once. */
export const spinAt = (p) => lerp(1, OVERSPEED.spin, clamp01(p) ** 2);

/** How hard the casings shake in their seats, 0 … 1: not at all until `shakeFrom`. */
export const strainAt = (p) => clamp01((p - OVERSPEED.shakeFrom) / (1 - OVERSPEED.shakeFrom));

// Bent time: FOCUS and the REFLEX, as rules. No drawing and no browser in here — src/wild/focus-live.js joins
// them to the game — so it runs under `node --test` (test/unit/wild-focus.test.mjs).
//
// The wild branch's experiment (docs/WILD.md, "Bent time"). The game has two clocks while this is at work: the
// world's — machines, rounds in the air, doors, the mission's own time — and the player's own: feet, hands, the
// gun. Bent, the world's runs much slower than the player's; the eye, which is turned by the hand on the mouse
// and not by any clock, is not slowed at all. That is the whole of it, and the whole of its use: for a moment
// you are faster than they are.
//
//   FOCUS    asked for (a key): three uses a mission, each paid for out of a meter that a full five seconds
//            empties — 17 November 2026, the owner: "also limit the number of focus and uplinks a use can do"
//   REFLEX   not asked for: when a machine makes you out while the site is quiet, the world all but stops for a
//            little over two seconds — time to do something about it — and then that must rest. Not a use: it
//            is free, exactly as it always was
import { clamp01, damp } from '../core/math.js';

export const FOCUS = {
  /** how fast the world runs while time is bent, and the player's own hands and feet (of real time) */
  world: 0.3,
  own: 0.55,
  /** seconds a full meter holds: what one use is worth */
  seconds: 5,
  /** uses a mission; a checkpoint keeps how many are left (focus-live.js save/load) */
  uses: 3,
  /** …and at once, for what the player does well while it is on: most for what is hardest */
  gain: { takedown: 0.3, head: 0.25, kill: 0.1 },
  /** how quickly the bend comes on and goes off: the rate each clock is eased at, a second of real time */
  ease: 9,
  /** what the field of view is multiplied by while time is bent */
  fov: 0.95,
  reflex: {
    world: 0.22,
    own: 0.6,
    /** real seconds it lasts, and real seconds from its start until there can be another */
    seconds: 2.4,
    cooldown: 25,
  },
};

/**
 * @returns {{ meter: number, on: boolean, usesLeft: number, reflexT: number, coolT: number, world: number,
 *   own: number }}
 *   meter 0 … 1 of the use now running (0 while off: it is not kept between uses); on: FOCUS is; usesLeft: uses
 *   left this mission; reflexT: real seconds of a reflex left; coolT: until the next may come; world, own: how
 *   fast each clock runs just now
 */
export function createFocus() {
  return { meter: 0, on: false, usesLeft: FOCUS.uses, reflexT: 0, coolT: 0, world: 1, own: 1 };
}

/**
 * A frame of it.
 *
 * Loop contract: the meter stays in 0 … 1 and belongs to one use — a fresh one begins it at 1, it never fills by
 * itself, and nothing is kept of it once that use ends, early or spent; FOCUS cannot be asked for again once
 * usesLeft is 0. Both clocks stay between the hardest bend and 1 and are eased, never jumped — except that when
 * the mission is not being played everything is let go of at once.
 *
 * @param {ReturnType<typeof createFocus>} f changed in place
 * @param {object} now
 * @param {number} now.dt       real seconds
 * @param {boolean} now.toggle  FOCUS was asked for (or asked to stop) this frame
 * @param {boolean} [now.can]   the mission is being played and the player is on their feet
 * @returns {string[]} what happened: 'on' | 'off' | 'spent' | 'refused' | 'reflex-over'
 */
export function stepFocus(f, { dt, toggle, can = true }) {
  const said = [];
  if (!can) {
    if (f.on || f.reflexT > 0) said.push('off');
    f.on = false;
    f.reflexT = 0;
    f.world = f.own = 1;
    return said;
  }
  if (toggle) {
    if (f.on) {
      // what is left of this use is lost: the next press spends a fresh one
      f.on = false;
      f.meter = 0;
      said.push('off');
    } else if (f.usesLeft > 0) {
      f.usesLeft--;
      f.on = true;
      f.meter = 1;
      said.push('on');
    } else said.push('refused');
  }
  f.coolT = Math.max(0, f.coolT - dt);
  if (f.reflexT > 0) {
    f.reflexT = Math.max(0, f.reflexT - dt);
    if (f.reflexT === 0) said.push('reflex-over');
  }
  if (f.on) {
    f.meter = Math.max(0, f.meter - dt / FOCUS.seconds);
    if (f.meter === 0) {
      f.on = false;
      said.push('spent');
    }
  }
  // the harder of the two bends: a reflex over FOCUS, FOCUS over nothing
  const bend = f.reflexT > 0 ? FOCUS.reflex : f.on ? FOCUS : null;
  f.world = damp(f.world, bend ? bend.world : 1, FOCUS.ease, dt);
  f.own = damp(f.own, bend ? bend.own : 1, FOCUS.ease, dt);
  return said;
}

/**
 * A machine has made the player out: the reflex, if there can be one — not while FOCUS is on (time is bent
 * already), and not until the last one has been rested from. Says whether it began.
 */
export function reflex(f) {
  if (f.on || f.reflexT > 0 || f.coolT > 0) return false;
  f.reflexT = FOCUS.reflex.seconds;
  f.coolT = FOCUS.reflex.cooldown;
  return true;
}

/**
 * Something done well puts some of the meter back on the use now running — never above a full one — and does
 * nothing while FOCUS is off: 'takedown' | 'head' | 'kill'.
 */
export function earn(f, what) {
  if (!f.on) return;
  f.meter = clamp01(f.meter + (FOCUS.gain[what] || 0));
}

/** How far time is bent just now, 0 (not at all) … 1 (as hard as it ever is): for what is shown and heard. */
export const bent = (f) => clamp01((1 - f.world) / (1 - FOCUS.reflex.world));

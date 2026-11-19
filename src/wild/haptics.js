// Haptics: what is felt, and the rules for when. No drawing, no `navigator` and no browser in here — so it runs
// under `node --test` (test/unit/wild-haptics.test.mjs); src/wild/haptics-live.js joins it to the game.
//
// The owner, 18 November 2026: "i want sounds and when availible heptic feedback like on the iphone if
// possible". A phone's motor is one crude actuator, not a speaker: it cannot play two feelings at once, and it
// cannot be driven harder than `navigator.vibrate` allows (a pattern in milliseconds, nothing of loudness). So a
// `kind` is a short pattern and a PRIORITY, and the state machine below (`ask`) is the one door every feeling
// comes through — whether the game's own hand hands it a kind directly (a shot, a hurt) or another feature calls
// `ctx.buzz(kind, strength)` (haptics-live.js) not knowing or caring whether a phone is listening.
import { clamp, lerp } from '../core/math.js';

/**
 * Every kind this build knows, and the one pattern it is felt as at full strength (`scale` below turns that
 * down when a kind is softer than its worst) — a number of milliseconds (one buzz) or `[on, off, on, …]` exactly
 * as `navigator.vibrate` takes it — and a PRIORITY: higher wins while another kind's pattern is still playing
 * (see `ask`). `aftershock` has no fixed pattern of its own: its own feel is how pressed the mountain is, so it
 * is given a `range` instead and `ask` lerps across it by `strength` directly, not through `scale`.
 */
export const PATTERNS = {
  // the player's own gun, firing — one tick a round, so the auto carbine is felt as what it is: a stream
  carbine: { pattern: 10, priority: 15 },
  pistol: { pattern: 14, priority: 25 },
  shotgun: { pattern: [35], priority: 35 },
  // the player's own hands, not a gun
  knife: { pattern: 25, priority: 50 },
  charge: { pattern: [30, 40, 30], priority: 55 },
  // struck, not striking
  hurt: { pattern: [70], priority: 70 },
  kill: { pattern: 18, priority: 45 },
  // the site, at large
  alarm: { pattern: [40, 70, 40, 70, 40], priority: 95 },
  emp: { pattern: [60, 30, 30], priority: 90 },
  blast: { pattern: [200, 60, 200, 60, 300], priority: 100 },
  // the mountain and the ground — kinds other features reach by `ctx.buzz` (the aftershocks, the lodestone, the
  // slide), and a landing, which haptics-live.js reads off the player's own feet
  aftershock: { range: [60, 220], priority: 75 },
  crush: { pattern: [90], priority: 85 },
  slide: { pattern: 20, priority: 10 },
  land: { pattern: 15, priority: 12 },
  // what the round's other features ask to be felt: a wave of machines on its way and one shut down to its last
  // (src/wild/response-live.js), a visor cracked (src/wild/visor-live.js)
  wave: { pattern: [30, 50, 30], priority: 60 },
  salvage: { pattern: [15, 40, 15], priority: 30 },
  visor: { pattern: 22, priority: 40 },
};

/** nothing is felt more often than this, even a kind of the highest priority there is (see `ask`) */
export const RATE_MS = 45;

/** @param {number|number[]} pattern @returns {number} its whole length, milliseconds, on and off together */
function duration(pattern) {
  return Array.isArray(pattern) ? pattern.reduce((sum, ms) => sum + ms, 0) : pattern;
}

/**
 * A pattern scaled by strength: 0…1 of a kind's feeling turned into 0.4…1 of its milliseconds — a phone's motor
 * takes a moment to start, so nothing is scaled under 5 ms; the gaps between buzzes (the odd places in an
 * array) are a silence, and a silence does not get shorter for being a weaker feeling.
 * @param {number|number[]} pattern @param {number} strength 0…1
 */
export function scale(pattern, strength) {
  const k = 0.4 + 0.6 * clamp(strength, 0, 1);
  const on = (ms) => Math.max(5, Math.round(ms * k));
  return Array.isArray(pattern) ? pattern.map((ms, i) => (i % 2 === 0 ? on(ms) : ms)) : on(pattern);
}

/** the pattern this kind is felt as, at this strength — `null` for a kind nothing here knows */
function patternFor(kind, strength) {
  const def = PATTERNS[kind];
  if (!def) return null;
  const s = clamp(strength, 0, 1);
  return def.range ? Math.round(lerp(def.range[0], def.range[1], s)) : scale(def.pattern, s);
}

/** @returns {{ off: boolean, last: { kind: string, pattern: number|number[], at: number } | null, count: number }} */
export function createHaptics() {
  return { off: false, last: null, count: 0 };
}

/**
 * Whether this kind, now, is felt — and if it is, the pattern to hand `navigator.vibrate`. `null` for: `h.off`;
 * a kind nothing here knows; a strength of 0 (an explosion past its reach, `near` below — there is truly
 * nothing to feel, not a floor of 5 ms); a kind of lower PRIORITY than the one still playing (its whole
 * `duration`, counted from when it began: a carbine's tick must not cut a blast short); or, once that one has
 * finished, a kind arriving under `RATE_MS` after it began (the motor's own rest). A kind of equal or higher
 * priority than the one still playing is not held to that rest at all — it replaces it outright, exactly as a
 * fresh `navigator.vibrate` call cancels whatever the last one asked for. The carbine on AUTO fires every
 * 94 ms, well past its own 10 ms: nothing here holds it back, and every round ticks, which is the point of it.
 * @param {ReturnType<typeof createHaptics>} h @param {string} kind @param {number} strength 0…1
 * @param {number} now milliseconds, the same clock as `h.last.at`
 */
export function ask(h, kind, strength = 1, now) {
  if (h.off) return null;
  const def = PATTERNS[kind];
  if (!def || strength <= 0) return null;
  const pattern = patternFor(kind, strength);
  if (h.last) {
    const elapsed = now - h.last.at;
    if (elapsed < duration(h.last.pattern)) {
      if (def.priority < PATTERNS[h.last.kind].priority) return null;
    } else if (elapsed < RATE_MS) return null;
  }
  h.last = { kind, pattern, at: now };
  h.count++;
  return pattern;
}

/**
 * An explosion's strength by distance: `strength` at 0 m, falling in a straight line to 0 at `reach` and beyond.
 * @param {number} strength 0…1 at the explosion itself @param {number} metres @param {number} reach metres
 */
export function near(strength, metres, reach) {
  return strength * clamp(1 - metres / reach, 0, 1);
}

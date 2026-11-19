// The room in the sound: which space a place is, what that space does to a sound heard in it, which sounds have a
// room at all, and how far away a sound dulls. Rules and arithmetic only — no Web Audio and no browser in here;
// src/wild/mix-live.js joins them to the game's engine — so it runs under `node --test`
// (test/unit/wild-mix.test.mjs).
//
// The wild build (docs/WILD.md, "The room in the sound"). Until 17 November 2026 a shot fired in the cavern and
// a shot fired in a corridor were the same buffer played at the same level: every sound carried its own short
// tail and was nowhere. Now what is heard is sent round the space the listener stands in — one of five — and what
// is far off is duller, as well as quieter.

/**
 * The five spaces. `decay`: seconds for what was sent in to fall by 60 dB. `pre`: seconds before its first
 * reflection comes back (the nearest wall is that far). `bright`: Hz the answer is cut at as it begins — it darkens
 * from there as it dies. `early`: how many single reflections stand out of it before it is a wash, and over how
 * long. `flutter`: seconds between the echoes of two facing walls (a tunnel), or 0. `wet`: how much of a sound is
 * sent in.
 */
export const SPACES = {
  open: { decay: 0.95, pre: 0.045, bright: 5200, early: [3, 0.28], flutter: 0, wet: 0.16 },
  cave: { decay: 3.2, pre: 0.032, bright: 4200, early: [9, 0.16], flutter: 0, wet: 0.5 },
  tunnel: { decay: 1.7, pre: 0.012, bright: 5600, early: [4, 0.05], flutter: 0.046, wet: 0.46 },
  hall: { decay: 2.3, pre: 0.02, bright: 7000, early: [10, 0.11], flutter: 0, wet: 0.42 },
  room: { decay: 0.55, pre: 0.006, bright: 7600, early: [7, 0.035], flutter: 0, wet: 0.3 },
};

/** the places of the site (world/map.js ZONE_NAMES) that are not a room: everything else is */
const PLACES = {
  Forecourt: 'open',
  'Main cavern': 'cave',
  'Shaft cavern': 'cave',
  'Drainage adit': 'tunnel',
  'Road tunnel': 'tunnel',
  'Cascade hall': 'hall',
  'Loading dock': 'hall',
  'Drone bay': 'hall',
};

/**
 * Which space a place is. Under the open sky it is the open air whatever the ground is called; a place with no
 * name is the rock it was cut from.
 * @param {string | undefined} zone the place's name
 * @param {boolean} sky is there sky overhead
 */
export function spaceOf(zone, sky) {
  if (sky) return 'open';
  if (!zone) return 'cave';
  return PLACES[zone] || 'room';
}

/** a small generator of numbers that is the same every time (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What a space does to a sound: its answer to one click, for each ear — a sound played into the space is that
 * sound laid end to end with this (a convolution: the engine does it). Noise that dies away and darkens as it
 * dies, with a few single reflections standing out of its beginning, and in a tunnel the flutter of its walls.
 * It holds exactly the energy of the click, so that `wet` alone says how loud a space is.
 * @param {keyof typeof SPACES} space
 * @param {number} rate samples a second
 * @returns {[Float32Array, Float32Array]} left, right
 */
export function impulse(space, rate) {
  const spec = SPACES[space];
  const start = Math.round(spec.pre * rate);
  const n = start + Math.round(spec.decay * 1.25 * rate);
  const ears = [new Float32Array(n), new Float32Array(n)];
  const seed = 9001 + Object.keys(SPACES).indexOf(space) * 101;
  // (the darkening takes some of the wash's level with it: the fall is set a little slower to make that up)
  const fall = 6.908 / (spec.decay * 1.12);
  ears.forEach((ear, c) => {
    const random = rng(seed + c * 7919);
    // the wash: noise through a filter that closes as it dies
    let held = 0;
    for (let i = start; i < n; i++) {
      const t = (i - start) / rate;
      const cut = 500 + (spec.bright - 500) * Math.exp((-2.2 * t) / spec.decay);
      const a = 1 - Math.exp((-2 * Math.PI * cut) / rate);
      held += a * (random() * 2 - 1 - held);
      // it comes up over its first hundredth of a second: a wash has no edge
      ear[i] = held * Math.exp(-fall * t) * Math.min(1, t / 0.01);
    }
    // single reflections: each a click a third of a millisecond long, later ones weaker, at their own moments for each ear
    const [count, over] = spec.early;
    for (let k = 0; k < count; k++) {
      const at = start + Math.round((0.15 + 0.85 * random()) * over * rate * ((k + 1) / count));
      const level = (0.9 - 0.6 * (k / count)) * (random() < 0.5 ? -1 : 1);
      for (let j = 0; j < Math.round(rate * 0.00035) && at + j < n; j++) ear[at + j] += level * 0.5;
    }
    // a tunnel's two walls: the same echo again and again, a little weaker each time — both ears at once
    if (spec.flutter)
      for (let k = 0, level = 0.8; level > 0.02; k++, level *= 0.72) {
        const at = start + Math.round(k * spec.flutter * rate) + Math.round(spec.flutter * rate * 0.5);
        for (let j = 0; j < Math.round(rate * 0.0006) && at + j < n; j++) ear[at + j] += level * (k % 2 ? -1 : 1);
      }
    // its end is brought down to nothing over its last tenth, so that it stops without a step
    const tail = Math.round(n * 0.1);
    for (let i = 0; i < tail; i++) ear[n - 1 - i] *= i / tail;
  });
  // one click in, one click's energy out (the louder ear sets it: both keep their own balance)
  const energy = Math.max(...ears.map((ear) => ear.reduce((sum, v) => sum + v * v, 0)));
  const k = 1 / Math.sqrt(energy);
  for (const ear of ears) for (let i = 0; i < n; i++) ear[i] *= k;
  // (the first ear is the one held to exactly 1; the other is within a hair of it)
  const first = Math.sqrt(ears[0].reduce((sum, v) => sum + v * v, 0));
  for (let i = 0; i < n; i++) ears[0][i] /= first;
  return ears;
}

/**
 * How long an answer rings: seconds for it to fall by 60 dB, read from how its energy runs out (from 5 dB down
 * to 35 dB down, doubled — the usual way of measuring a room).
 * @param {[Float32Array, Float32Array]} ears
 */
export function decayOf(ears, rate) {
  const n = ears[0].length;
  const left = new Float64Array(n + 1);
  for (let i = n - 1; i >= 0; i--) left[i] = left[i + 1] + ears[0][i] ** 2 + ears[1][i] ** 2;
  const at = (db) => {
    const level = left[0] * 10 ** (-db / 10);
    let i = 0;
    while (i < n && left[i] > level) i++;
    return i / rate;
  };
  return (at(35) - at(5)) * 2;
}

/** what has no room: the menus, the radio in the ear, what is only in the operator's head — and the beds, which are the room already */
const DRY = new Set([
  ...['uiMove', 'uiSelect', 'uiBack', 'hitMarker', 'killConfirm', 'objective', 'radio', 'tick', 'chargeBeep'],
  ...['heartbeat', 'hurt', 'nvOn', 'nvOff', 'focusIn', 'focusOut', 'breath', 'cloth', 'kitRustle'],
  ...['wind', 'hum', 'cascade', 'overspeedWhine'],
]);
/** what fills a space more than most, and what fills it less */
const BIG = /explosion|Blast|Burst|strike|incoming|shotgun|shotSentry|shotDrone|alarm|lodestoneBlow|whiz/;
const SMALL = /^step|casing|reload|mag|bolt|selector|weaponSwap|shellIn|dry|drip|servo|sparkTick/;

/** How much of a sound is sent round the space, 0 … 1 — to be multiplied by the space's own `wet`. */
export function sendOf(name) {
  if (DRY.has(name)) return 0;
  if (BIG.test(name)) return 1;
  if (SMALL.test(name)) return 0.45;
  return 0.7;
}

/**
 * The frequency a sound is cut at, so far off — `far` is how far, as a part of how far the sound carries (0 … 1).
 * Nothing is cut within a sixth of its reach; at the edge only what is under about 2.4 kHz is left.
 */
export function cutAt(far) {
  if (far <= 0.16) return 20000;
  const k = Math.min(1, (far - 0.16) / 0.84);
  return Math.round(20000 * (2400 / 20000) ** k);
}

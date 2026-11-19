// What a reload looks like, written down: the gun, the support hand, the magazine (or the shell) and the bolt at
// each moment of it, and when each sound comes.
//
// Decision of 16 November 2026 — the owner: "make the reload animation more realistic and make a sound". Until
// then a reload sank the gun out of the picture for two seconds; the magazine moved, below the frame, and no
// hand did anything. Now the gun is brought up and canted, so that what is done to it can be seen; the hand
// leaves the fore-end, takes the magazine out, goes away for a fresh one and seats it; and a gun that had run
// DRY — whose bolt stands open — has its bolt let go at the end, which one with a round still chambered has not.
// How long a reload takes and when its rounds are counted is src/arms.js's business and has not changed.
//
// Everything is in the gun's own space (metres and radians; −z is forward, +y up, +x right), as a difference
// from where the part rests. A TRACK is a list of keys `[t, x, y, z, rx, ry, rz, ease]` on a clock that runs from
// 0 to 1 over the reload (over one shell, for the shotgun); between two keys a part goes from one to the other
// by the ease of the later: smooth (0, or left out), IN — slowly at first, as a thing falls (1), OUT — fast at
// first, as a hand arrives (2). src/weapon.js moves the parts; this file knows nothing of three.js.
// Pinned by test/unit/reload.test.mjs.
const IN = 1;
const OUT = 2;

/** a key: a moment, six numbers, and how it is come to */
const key = (t, v, ease = 0) => [t, v[0], v[1], v[2], v[3] || 0, v[4] || 0, v[5] || 0, ease];
const REST = [0, 0, 0];
const add = (a, b) => a.map((v, k) => v + (b[k] || 0));

/** With a machine held on the other arm there is no hand to show: down and away, as a reload always was. */
const SUNK = [0, -0.09, 0.04, -0.35, 0.3, 0.5];
const sunk = [key(0, REST), key(0.15, SUNK), key(0.85, SUNK), key(1, REST)];

// ---------- the carbine: a magazine in front of the trigger, a bolt catch on the left of its well ----------
/** where it is held while it is worked on: up, and rolled over so that its underside is towards the eye */
const C_UP = [-0.07, 0.13, 0, 0.5, 0.25, -0.65];
/** the hand under the magazine's floor plate, from where it rests on the fore-end; and away, where the next one is */
const C_MAG = [0.01, -0.235, 0.18, 0.1];
const C_AWAY = [-0.11, -0.78, 0.3, 0.3];
/** …and with its thumb on the bolt catch */
const C_CATCH = [-0.004, -0.105, 0.2, 0.05];
const carbineHand = [
  key(0, REST),
  key(0.08, REST),
  key(0.2, C_MAG),
  // out of the well, and away with it
  key(0.27, add(C_MAG, [0, -0.13, 0.012, 0.1])),
  key(0.4, C_AWAY, IN),
  key(0.5, C_AWAY),
  // back with the next: up under the well, and pushed home
  key(0.62, add(C_MAG, [0, -0.12, 0.01, 0.05])),
  key(0.655, C_MAG, IN),
];

// ---------- the sidearm: a magazine in the grip, which drops free; a slide ----------
const P_UP = [-0.05, 0.15, 0.02, 0.5, 0.15, -0.8];
/** the hand with its heel under the butt, from where it is wrapped round the grip; and away */
const P_MAG = [0, -0.085, 0.004];
const P_AWAY = [-0.1, -0.6, 0.22, 0.25];
const pistolHand = [
  key(0, REST),
  key(0.06, REST),
  // off the grip as the magazine is let go
  key(0.16, [-0.03, -0.07, 0.03]),
  key(0.34, P_AWAY, IN),
  key(0.4, P_AWAY),
  key(0.58, add(P_MAG, [0, -0.1, 0.006])),
  key(0.62, P_MAG, IN),
];

// ---------- the shotgun: a shell at a time, through the port under the receiver ----------
const S_UP = [-0.05, 0.05, 0.03, 0.4, 0.2, -0.85];
/** the hand at the port with a shell, from where it rests on the pump; and away, where the shells are */
const S_PORT = [0.01, -0.06, 0.27, 0.1];
const S_AWAY = [-0.06, -0.42, 0.28, 0.3];

export const RELOAD = {
  carbine: {
    up: [key(0, REST), key(0.13, C_UP), key(0.63, C_UP), key(0.655, add(C_UP, [0, 0.012, 0, 0.03])), key(0.71, C_UP)],
    // a round still chambered: a tug on the magazine, and back to the fore-end
    wet: {
      up: [key(0.84, C_UP), key(1, REST)],
      hand: [key(0.71, add(C_MAG, [0, -0.012])), key(0.75, C_MAG), key(0.92, REST), key(1, REST)],
    },
    // dry: up the side of the well to the catch, and the bolt goes home
    dry: {
      up: [
        key(0.785, C_UP),
        key(0.8, add(C_UP, [0, 0, -0.008, -0.02, 0, 0.03])),
        key(0.85, C_UP),
        key(0.88, C_UP),
        key(1, REST),
      ],
      hand: [
        key(0.7, C_MAG),
        key(0.775, C_CATCH),
        key(0.79, add(C_CATCH, [0.012])),
        key(0.83, C_CATCH),
        key(0.95, REST),
        key(1, REST),
      ],
    },
    hand: carbineHand,
    held: C_MAG,
    /** from when to when the magazine is in the hand, and so moves with it */
    carried: [0.2, 0.655],
    /** how far down, in the gun's own space, is out of the picture */
    away: 0.3,
    rack: 0.79,
    cues: [
      [0.2, 'reloadOut', 1],
      [0.43, 'kitRustle', 0.9],
      [0.62, 'magSlide', 0.9],
      [0.655, 'reloadIn', 1],
    ],
  },
  pistol: {
    up: [key(0, REST), key(0.12, P_UP), key(0.6, P_UP), key(0.62, add(P_UP, [0, 0.01, 0, 0.04])), key(0.68, P_UP)],
    wet: {
      up: [key(0.82, P_UP), key(1, REST)],
      hand: [key(0.68, P_MAG), key(0.86, REST), key(1, REST)],
    },
    dry: {
      up: [
        key(0.755, P_UP),
        key(0.775, add(P_UP, [0, 0, -0.008, -0.04])),
        key(0.83, P_UP),
        key(0.86, P_UP),
        key(1, REST),
      ],
      hand: [key(0.7, P_MAG), key(0.9, REST), key(1, REST)],
    },
    hand: pistolHand,
    held: P_MAG,
    carried: [0.4, 0.62],
    /** the magazine that is in it drops free: from when it is let go to when it is out of the picture */
    drop: [0.16, 0.36],
    away: 0.3,
    rack: 0.76,
    cues: [
      [0.16, 'reloadOut', 0.9, 1.3],
      [0.4, 'kitRustle', 0.8, 1.15],
      [0.58, 'magSlide', 0.85, 1.3],
      [0.62, 'reloadIn', 0.95, 1.3],
    ],
    rate: 1.35,
  },
  shotgun: {
    up: S_UP,
    // One shell: from the port, where the last one went in, away for the next; up to the port with it; and
    // pushed forward into the tube — at the END of its half second, which is when it is counted (src/arms.js): a
    // pull of the trigger that stops the loading never leaves a shell heard and not had. A cycle begins and ends
    // at the port; whenever the loading stops, what is left of the pose is let go of by src/weapon.js.
    hand: [
      key(0, S_PORT),
      key(0.24, S_AWAY),
      key(0.3, S_AWAY),
      key(0.74, S_PORT, OUT),
      key(0.9, add(S_PORT, [0, 0.004, -0.05])),
      key(1, S_PORT),
    ],
    held: S_PORT,
    carried: [0.3, 0.9],
    /** from when to when the shell is to be seen */
    shown: [0.4, 0.92],
    /** the shell as it is carried: lying along the tube, not as it lies loose at the port */
    lie: [-0.3, 0, -0.2],
    away: 0.25,
    cues: [
      [0.27, 'kitRustle', 0.5, 1.3],
      [0.82, 'shellIn', 1],
    ],
  },
};

const smooth = (u) => u * u * (3 - 2 * u);
const clamp01 = (u) => Math.min(1, Math.max(0, u));

/** Where a track is at `t`: six numbers into `out`. */
function along(track, t, out) {
  let i = 1;
  while (i < track.length - 1 && track[i][0] < t) i++;
  const a = track[i - 1];
  const b = track[i];
  let u = b[0] > a[0] ? clamp01((t - a[0]) / (b[0] - a[0])) : 1;
  u = b[7] === IN ? u * u : b[7] === OUT ? 1 - (1 - u) * (1 - u) : smooth(u);
  for (let k = 0; k < 6; k++) out[k] = a[k + 1] + (b[k + 1] - a[k + 1]) * u;
  return out;
}

const joined = new Map();
/** A track and its ending — dry or not — as one: made once. */
function whole(R, part, dry) {
  const name = part + (dry ? 1 : 0);
  if (!joined.has(R)) joined.set(R, {});
  const made = joined.get(R);
  if (!made[name]) made[name] = [...R[part], ...(dry ? R.dry : R.wet)[part]];
  return made[name];
}

/** A pose with nothing in it: every part where it rests, the bolt shut, nothing to show. */
export const blankPose = () => ({
  gun: [0, 0, 0, 0, 0, 0],
  hand: [0, 0, 0, 0, 0, 0],
  mag: [0, 0, 0, 0, 0, 0],
  bolt: 0,
  shown: false,
});

const HELD = [0, 0, 0, 0, 0, 0];
/**
 * What a reload has done by `t` of the way through it (through one shell, for the shotgun).
 * @param {string} kind carbine | pistol | shotgun
 * @param {number} t 0 to 1
 * @param {object} how `dry`: the gun had run dry, and its bolt stands open. `held`: a machine is held on the other
 *   arm. The shotgun — `first`: this is the first shell, and the hand comes off the pump for it.
 * @param {object} out blankPose(): `gun`, `hand`, `mag` — x, y, z and three turns, from where each rests (`mag`
 *   is the shell, for the shotgun); `bolt` — 0 shut, 1 open; `shown` — the shell is to be seen
 */
export function reloadPose(kind, t, how, out) {
  const R = RELOAD[kind];
  out.gun.fill(0);
  out.hand.fill(0);
  out.mag.fill(0);
  out.bolt = 0;
  out.shown = false;
  if (!R) return out;
  t = clamp01(t);
  const held = !!how.held;

  if (kind === 'shotgun') {
    // canted for as long as shells go in; for the first of them the hand comes off the pump
    const k = how.first ? smooth(clamp01(t / 0.36)) : 1;
    const up = held ? SUNK : R.up;
    for (let n = 0; n < 6; n++) out.gun[n] = up[n] * k;
    if (held) return out;
    // the hand, as far as it has come off the pump — and the shell in it, until it is in the tube
    along(R.hand, t, out.hand);
    for (let n = 0; n < 6; n++) out.hand[n] *= k;
    out.shown = t >= R.shown[0] && t <= R.shown[1];
    if (out.shown) {
      if (t <= R.carried[1]) for (let n = 0; n < 3; n++) out.mag[n] = out.hand[n] - R.held[n];
      else out.mag[2] = -0.05;
      // lying along the tube, not as it lies loose at the port
      for (let n = 0; n < 3; n++) out.mag[n + 3] = R.lie[n];
    }
    return out;
  }

  const dry = !!how.dry;
  along(held ? sunk : whole(R, 'up', dry), t, out.gun);
  // the bolt of a gun that ran dry stands open until it is let go
  if (dry) out.bolt = 1 - clamp01((t - R.rack) / 0.025);
  const [from, to] = R.carried;
  if (held) {
    // nobody's hand: the magazine goes down out of the gun and another comes up, below the picture
    const down = smooth(clamp01((t - R.cues[0][0]) / 0.1)) * (1 - smooth(clamp01((t - to + 0.1) / 0.1)));
    out.mag[1] = -0.24 * down;
    out.mag[3] = -0.5 * down;
    return out;
  }
  along(whole(R, 'hand', dry), t, out.hand);
  if (t >= from && t <= to) {
    // in the hand: where the hand is, less where the hand is when the magazine is home
    for (let n = 0; n < 3; n++) out.mag[n] = out.hand[n] - R.held[n];
    out.mag[3] = out.hand[3] - (R.held[3] || 0);
  } else if (R.drop && t > R.drop[0] && t < from) {
    // let go, it falls — to where the hand will be holding the next one, out of the picture
    along(whole(R, 'hand', dry), from, HELD);
    const u = clamp01((t - R.drop[0]) / (R.drop[1] - R.drop[0]));
    for (let n = 0; n < 3; n++) out.mag[n] = (HELD[n] - R.held[n]) * u * u;
    out.mag[3] = (HELD[3] - (R.held[3] || 0)) * u * u;
  }
  return out;
}

/**
 * The sounds of a reload, in order: `[when (0 to 1), name, how loud, how fast it is played]`.
 * @param {object} how as for reloadPose: only `dry` matters — the bolt is let go, and is heard
 */
export function reloadCues(kind, how) {
  const R = RELOAD[kind];
  if (!R) return [];
  return how.dry && R.rack ? [...R.cues, [R.rack, 'boltRack', 1, R.rate]] : R.cues;
}

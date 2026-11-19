// What you carry — three guns, a grenade and a knife — as rules with no drawing and no browser in them.
//
// Ammunition is two numbers to a gun — what is in it and what is in reserve for it — on whatever object carries
// them (the weapon does; a test can pass a plain object). It is finite: the mission starts with what the table
// below says, each cache on the site gives a little of everything, once, and when no gun has a round left there
// is the knife. Pinned by test/unit/arms.test.mjs.
//
// Each gun is for something (decision of 12 November 2026, the owner: "make the weponds more versatile"):
//   the carbine keeps firing — AUTO or SEMI, on B;
//   the sidearm is the quiet one, and the one that can be fired with a machine held on the other arm;
//   the shotgun is the loud one: at arm's length nothing stands up to it, across a room it takes two;
//   the EMP grenade harms nothing and stops everything near it for a few seconds.

export const GUNS = {
  carbine: {
    key: 'carbine',
    /** the key that takes it in hand */
    slot: 1,
    name: 'K9 CARBINE',
    short: 'CARBINE',
    /** rounds in it when it is full, rounds carried besides when the mission starts, rounds a cache gives */
    mag: 30,
    reserve: 90,
    cache: 30,
    /** against a machine's body; its head counts three times (enemies/index.js), times `head` */
    damage: 34,
    head: 1,
    pellets: 1,
    /** seconds between rounds */
    interval: 60 / 640,
    /** the ways it can be fired: 'auto' goes on firing while the trigger is held, 'semi' fires once a pull */
    modes: ['auto', 'semi'],
    /** seconds to change the magazine (or, for the shotgun, to push in one shell) */
    reload: 2.1,
    shells: false,
    /** how far a shot carries to a machine's ears, in metres */
    noise: 12,
    range: 130,
    /** the cone of fire in radians, from the hip and with the sight at the eye */
    hip: 0.026,
    aimed: 0.003,
    /** how much the view narrows with the sight at the eye */
    zoom: 0.62,
    twoHands: false,
  },
  pistol: {
    key: 'pistol',
    slot: 2,
    name: 'P5 SIDEARM',
    short: 'SIDEARM',
    /** what the screen says after its name, where the carbine says AUTO or SEMI */
    note: 'SUPPRESSED',
    mag: 12,
    reserve: 36,
    cache: 12,
    damage: 30,
    /** a round in the head does what the carbine's does — it is not a better gun, it is a quieter one */
    head: 1.15,
    pellets: 1,
    interval: 0.18,
    modes: ['semi'],
    reload: 1.5,
    shells: false,
    noise: 6,
    range: 60,
    hip: 0.02,
    aimed: 0.004,
    zoom: 0.8,
    twoHands: false,
  },
  shotgun: {
    key: 'shotgun',
    slot: 3,
    name: 'M7 BREACHER',
    short: 'SHOTGUN',
    note: 'PUMP',
    mag: 6,
    reserve: 18,
    cache: 6,
    /** each pellet, close; see pelletDamage() */
    damage: 16,
    head: 1,
    pellets: 8,
    interval: 0.85,
    modes: ['semi'],
    reload: 0.5,
    shells: true,
    noise: 34,
    range: 28,
    /** the pattern: it does not tighten much at the eye */
    hip: 0.055,
    aimed: 0.04,
    zoom: 0.85,
    /** it has to be pumped: it cannot be used with a machine on your arm */
    twoHands: true,
    /** a pellet does all its damage up to `near` metres, and `least` of it at `range` */
    near: 8,
    least: 0.35,
  },
};

/** The order they are cycled in, and the order they are turned to when one runs dry. */
export const GUN_ORDER = ['carbine', 'pistol', 'shotgun'];

export const ARMS = {
  /** the carbine's, under the names they have always had */
  mag: GUNS.carbine.mag,
  reserve: GUNS.carbine.reserve,
  grenades: {
    /** carried when the mission starts, the most that can be carried, and what a cache gives */
    start: 2,
    carry: 4,
    cache: 1,
    /** seconds from leaving the hand to going off */
    fuse: 1.6,
    /** every machine within this many metres is stopped for `stun` seconds; none is harmed */
    radius: 7,
    stun: 4,
    damage: 0,
    /** nearer than this it needs no line of sight: it goes through a crate, not through a wall */
    close: 3,
    /** how far it is heard */
    noise: 10,
    /** how far it is thrown, metres a second */
    speed: 13,
    /**
     * the lamps it puts out (world/lamps.js `reach`): those of the room it goes off in — in the open cavern,
     * those within `radius` metres — for `seconds`, after which they come back by themselves
     */
    dark: { seconds: 20, radius: 14 },
  },
  /**
   * A lamp that a round breaks is heard `noise` metres off (a round on a wall: five). `proud`: how far past the
   * wall a round would have stopped at a fitting on that wall is still looked for — the fitting stands out from
   * it, and the box a round must enter is grown round the lens (world/build.js LENS_GROW).
   */
  lamp: { noise: 7, proud: 0.15 },
  knife: {
    /** against a machine's body; its head counts three times, as it does for a round */
    damage: 65,
    /** metres from the eye */
    reach: 2.0,
    /** how much wider a machine's hit volumes count for the blade: a knife is not a needle */
    grow: 1.6,
    /** seconds a swing takes, and how far into it the blow lands */
    swing: 0.5,
    strikeAt: 0.14,
    /** how far a blow on a machine carries to other machines' ears, in metres */
    noise: 4,
  },
};

// ---------- one gun's ammunition: { mag, reserve } ----------

/** Every round there is for it: what is in it and the reserve together. */
export const totalRounds = (a) => a.mag + a.reserve;

/** Nothing in it and nothing to refill it with. */
export const isDry = (a) => a.mag <= 0 && a.reserve <= 0;

/** Fires one round. Returns false, and changes nothing, if it is empty. */
export function spendRound(a) {
  if (a.mag <= 0) return false;
  a.mag--;
  return true;
}

/** @param {number} [size] how many it holds when full (the carbine's magazine unless said) */
export const canReload = (a, size = ARMS.mag) => a.mag < size && a.reserve > 0;

/** Fills it from the reserve. Returns how many rounds moved. */
export function reloadMag(a, size = ARMS.mag) {
  if (!canReload(a, size)) return 0;
  const take = Math.min(size - a.mag, a.reserve);
  a.mag += take;
  a.reserve -= take;
  return take;
}

/** Pushes one shell in from the reserve (the shotgun). Returns false if it is full or there is none. */
export function loadShell(a, size) {
  if (!canReload(a, size)) return false;
  a.mag++;
  a.reserve--;
  return true;
}

/** Adds whole rounds to a reserve (a cache). The reserve never goes below nothing. */
export function addRounds(a, n) {
  a.reserve = Math.max(0, a.reserve + Math.trunc(n));
  return a.reserve;
}

// ---------- everything carried ----------

/** What a mission starts with: the carbine in hand, set to AUTO — and `rounds` times the table's reserve. */
export function createArms(rounds = 1) {
  return {
    current: 'carbine',
    /** how the carbine fires: 'auto' or 'semi'. The other guns have no selector. */
    mode: 'auto',
    guns: Object.fromEntries(
      GUN_ORDER.map((key) => [key, { mag: GUNS[key].mag, reserve: GUNS[key].reserve * rounds }]),
    ),
    grenades: ARMS.grenades.start,
  };
}

/** The table's row for the gun in hand. */
export const gunOf = (arms) => GUNS[arms.current];

/** Not a round left for any gun: the trigger now swings the knife. */
export const allDry = (arms) => GUN_ORDER.every((key) => isDry(arms.guns[key]));

/** How the gun in hand fires right now: the carbine as its selector is set, the others the one way they can. */
export const modeOf = (arms) => (GUNS[arms.current].modes.length > 1 ? arms.mode : GUNS[arms.current].modes[0]);

/** B: the carbine's selector. Returns the new setting, or null if the gun in hand has none to change. */
export function toggleMode(arms) {
  const modes = GUNS[arms.current].modes;
  if (modes.length < 2) return null;
  arms.mode = modes[(modes.indexOf(arms.mode) + 1) % modes.length];
  return arms.mode;
}

/** May this gun be in hand at all right now? The shotgun needs both of them. */
const usable = (key, holding) => !(holding && GUNS[key].twoHands);

/**
 * Takes a gun in hand by name. Returns true if that changed anything: not if it is in hand already, not if
 * there is no such gun, and not the shotgun while a machine is held. A dry gun CAN be taken: that is how you
 * find that it is dry.
 */
export function selectGun(arms, key, { holding = false } = {}) {
  if (!GUNS[key] || key === arms.current || !usable(key, holding)) return false;
  arms.current = key;
  return true;
}

/**
 * The gun to turn to from the one in hand: the next round the order (`step` −1 goes the other way) that has a
 * round to fire and may be used. Null if there is no other — and then, if the one in hand is dry too, the knife.
 */
export function nextGun(arms, { holding = false, step = 1 } = {}) {
  const from = GUN_ORDER.indexOf(arms.current);
  for (let n = 1; n < GUN_ORDER.length; n++) {
    const key = GUN_ORDER[(from + step * n + GUN_ORDER.length * n) % GUN_ORDER.length];
    if (usable(key, holding) && !isDry(arms.guns[key])) return key;
  }
  return null;
}

/**
 * A cache: a little for every gun — `rounds` times the table's — and a grenade if there is room for one.
 * Returns what was taken.
 */
export function takeCache(arms, rounds = 1) {
  const got = {};
  for (const key of GUN_ORDER) {
    got[key] = GUNS[key].cache * rounds;
    addRounds(arms.guns[key], got[key]);
  }
  got.grenades = Math.min(ARMS.grenades.cache, ARMS.grenades.carry - arms.grenades);
  arms.grenades += got.grenades;
  return got;
}

/** What one shotgun pellet does at `distance` metres: all of it close, less with every metre, never nothing. */
export function pelletDamage(distance) {
  const { damage, near, range, least } = GUNS.shotgun;
  const k = Math.min(1, Math.max(0, (distance - near) / (range - near)));
  return damage * (1 - (1 - least) * k);
}

// ---------- the knife ----------

/**
 * The knife's clock: at rest, or somewhere in a swing. A swing lands exactly one blow, ARMS.knife.strikeAt
 * seconds in, however long the frames are.
 */
export function createKnife() {
  let t = 0;
  let swinging = false;
  let struck = false;
  return {
    get busy() {
      return swinging;
    },
    /** 0 at rest; 0 → 1 across a swing */
    get progress() {
      return swinging ? Math.min(1, t / ARMS.knife.swing) : 0;
    },
    /** Begins a swing. Returns false if one is already under way. */
    start() {
      if (swinging) return false;
      swinging = true;
      struck = false;
      t = 0;
      return true;
    },
    /** Puts the knife away at once; a swing that had not struck yet never does. */
    stop() {
      swinging = false;
      struck = false;
      t = 0;
    },
    /** Advances the swing. Returns true on the one step in which the blow lands. */
    step(dt) {
      if (!swinging) return false;
      t += dt;
      let blow = false;
      if (!struck && t >= ARMS.knife.strikeAt) {
        struck = true;
        blow = true;
      }
      if (t >= ARMS.knife.swing) {
        swinging = false;
        t = 0;
      }
      return blow;
    },
  };
}

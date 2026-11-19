// The uplink: taking a machine. Rules only — no drawing and no browser in here; src/wild/uplink-live.js joins
// them to the game — so it runs under `node --test` (test/unit/wild-uplink.test.mjs).
//
// The wild branch's experiment (docs/WILD.md, "The uplink"). The player carries a link into WARDEN's own net.
// Held on a machine in the sights for a little over a second, it takes that machine:
//   a sentry is TURNED — for forty seconds it is the player's: it comes to heel, and it fires on its own kind;
//   a drone is FLOWN  — the player sees through it and works it by hand (src/wild/pilot.js).
// Then the link must recharge. Machines do not fire on their own until one of their own has fired on them; and
// when one that has been fighting a turned machine calls the alarm, the place it names is the turned machine's —
// it never saw the player.

export const UPLINK = {
  /** how far off a machine can be taken (metres), and how forgiving the aim is: its hit volumes, so many times */
  reach: 24,
  grow: 2.2,
  /** seconds the key must be held with the machine in the sights; seconds before the link can be used again */
  hold: 1.1,
  recharge: 28,
  /** uses a mission, spent when a link completes; a checkpoint keeps how many are left (uplink-live.js save/load)
   *  — 17 November 2026, the owner: "also limit the number of focus and uplinks a use can do" */
  uses: 3,
  /** with the key let go, or the eye off the machine, what was built up runs down this many times as fast */
  slip: 2,
  turned: {
    /** seconds it is the player's; then it burns out */
    seconds: 40,
    /** how far it looks for one of its own kind to fire on (metres), and how near the player it keeps otherwise */
    range: 30,
    heel: 3.5,
    /** a round of its on one of its own kind, and how often one lands */
    damage: 30,
    chance: 0.75,
    /** a burst, the seconds between its rounds and between bursts, and how long it aims before the first */
    burst: 3,
    gap: 0.12,
    rest: [0.7, 1.1],
    windup: 0.5,
    /** what a loyal machine's round does to it, and how often one lands */
    back: { damage: 14, chance: 0.6 },
  },
};

/**
 * Loyal machines that watch one of their own being fired on by the player's own (a turned sentry, a flown drone)
 * — 17 November 2026, the owner: "once other robots see that their friends are being fired at" the alarm must
 * still go up, not only once something of theirs has itself been hit.
 */
export const WITNESS = {
  /** a witness's own spec.view, this many times over: how far it still counts from the shot */
  range: 1.3,
  /** G.enemies.noise() radius a burst is heard at, so machines with no line come to look */
  noise: 22,
  /** seconds (the machines' clock) the alarm is guaranteed by, after the first shot a witness saw, provided one
   *  of them is still running when that time is up */
  alarmDelay: 2.5,
};

/**
 * Every machine that has seen the player's own fire at one of its own kind — hit or miss: loyal, running, not
 * stunned, and within its own spec.view × WITNESS.range of the victim or of the shooter, with a clear line
 * (`sees`) to one of them. The one fired at always counts, having felt it even where it saw nothing.
 * @param {{ x: number, z: number }} shooter the player's own that fired
 * @param {{ x: number, z: number, dead?: boolean, turned?: number, stunT?: number, spec: { view: number } }} victim
 *   the one it fired at
 * @param {object[]} units every machine, the two above among them
 * @param {(a: object, b: object) => boolean} sees a clear line from the one to the other, from its eye
 * @returns {object[]} the witnesses — the victim always first
 */
export function witnessesOf(shooter, victim, units, sees) {
  const out = [victim];
  for (const unit of units) {
    if (unit === victim || unit.dead || unit.turned || unit.stunT > 0) continue;
    const range = unit.spec.view * WITNESS.range;
    if (Math.hypot(unit.x - victim.x, unit.z - victim.z) <= range && sees(unit, victim)) out.push(unit);
    else if (Math.hypot(unit.x - shooter.x, unit.z - shooter.z) <= range && sees(unit, shooter)) out.push(unit);
  }
  return out;
}

/**
 * Fix (the lead, after review, 17 November 2026): "the first such shot starts the clock" — with two of the
 * player's machines firing by turns, a later shot must not throw away the clock a witness of the first one
 * already started, or the alarm never comes while they alternate faster than WITNESS.alarmDelay. The pending
 * record is made once, by the first shot seen; it keeps that shot's shooter (what the alarm is named at) and its
 * own running `t` throughout, however many further shots arrive from however many other machines — every one of
 * their witnesses is still added to it.
 * @param {{ shooter: object, t: number, witnesses: Set<object> } | null} pending what a shot was seen by already,
 *   or null before any shot has been
 * @param {object} shooter the one that just fired (named at, only if `pending` is still null)
 * @param {object[]} seen witnessesOf's own return for this shot
 * @returns {{ shooter: object, t: number, witnesses: Set<object> }} the record to keep
 */
export function witnessed(pending, shooter, seen) {
  const p = pending || { shooter, t: 0, witnesses: new Set() };
  for (const w of seen) p.witnesses.add(w);
  return p;
}

/**
 * @returns {{ target: number | null, progress: number, cool: number, taken: number | null, told: boolean,
 *   usesLeft: number }}
 *   target: the machine being taken (its id); progress 0 … 1; cool: seconds until it can be used again;
 *   taken: the last machine it took; usesLeft: uses left this mission
 */
export function createUplink() {
  return { target: null, progress: 0, cool: 0, taken: null, told: false, usesLeft: UPLINK.uses };
}

/**
 * A step of the link.
 *
 * Loop contract: progress stays in 0 … 1 and belongs to one machine — it reaches 1 (the machine is taken, the
 * recharge begins, and a use is spent) or runs back down to 0; while recharging nothing is built up; once
 * usesLeft is 0 nothing is ever built up again, whatever cool is.
 *
 * @param {ReturnType<typeof createUplink>} u changed in place
 * @param {object} now
 * @param {number} now.dt
 * @param {boolean} now.held            the key is down
 * @param {number | null} now.target    the machine in the sights (its id), if there is one that can be taken
 * @returns {string[]} 'begin' (on a machine) | 'done' (u.taken is the machine) | 'lost' | 'cold' (asked for
 *   while recharging) | 'none' (asked for with no uses left): the last two said once each time the key goes down
 */
export function stepUplink(u, { dt, held, target }) {
  const said = [];
  u.cool = Math.max(0, u.cool - dt);
  if (!held) u.told = false;
  if (u.usesLeft <= 0) {
    if (held && target != null && !u.told) {
      u.told = true;
      said.push('none');
    }
    return said;
  }
  if (u.cool > 0) {
    if (held && target != null && !u.told) {
      u.told = true;
      said.push('cold');
    }
    return said;
  }
  if (held && target != null) {
    if (u.target !== target) {
      u.target = target;
      u.progress = 0;
      said.push('begin');
    }
    u.progress = Math.min(1, u.progress + dt / UPLINK.hold);
    if (u.progress >= 1) {
      u.taken = target;
      u.target = null;
      u.progress = 0;
      u.cool = UPLINK.recharge;
      u.usesLeft--;
      // the key is still down from the taking: that is not asking again
      u.told = true;
      said.push('done');
    }
  } else if (u.progress > 0) {
    u.progress = Math.max(0, u.progress - (UPLINK.slip * dt) / UPLINK.hold);
    if (u.progress === 0) {
      u.target = null;
      said.push('lost');
    }
  }
  return said;
}

/**
 * Whom a machine fires on, across the line the uplink has drawn through its kind: a turned machine looks for a
 * loyal one, a loyal one for a turned one. The nearest that is running, within range, with a clear line — or null.
 * @param {{ x: number, z: number, turned?: number }} me
 * @param {{ x: number, z: number, dead: boolean, turned?: number }[]} units
 * @param {(a: object, b: object) => boolean} sees a clear line from the one to the other
 * @param {{ range?: number }} [o]
 */
export function pickFoe(me, units, sees, { range = UPLINK.turned.range } = {}) {
  let best = null;
  let bestD = range;
  for (const unit of units) {
    if (unit === me || unit.dead || !unit.turned === !me.turned) continue;
    const d = Math.hypot(unit.x - me.x, unit.z - me.z);
    if (d > bestD || !sees(me, unit)) continue;
    best = unit;
    bestD = d;
  }
  return best;
}

// The site answers: what comes for the player when a thread of light is broken, when the alarm goes up, and
// when a task is done. Rules only — no drawing and no browser in here; src/wild/response-live.js joins them to
// the game — so it runs under `node --test` (test/unit/wild-response.test.mjs).
//
// Decision of 18 November 2026 — the owner: "i want the game to be more causal every trip wire and every site
// alarm and completion of a task needs to bring a significant amount of enemies". Read as cause and effect: the
// three things named each bring a wave of machines that are not on the mission's roll, sized by the setting.
// Before this a wire and an alarm brought nobody, and a task brought one to three.
//
// THE LOOP, and what it is held to (the test beside this file holds every line of it):
//   entry       a cause is called (`call`): what it brings, less what the game itself has already sent for it,
//               goes into the queue
//   each turn   `step` hands out at most ONE machine, no sooner than `gap` seconds after the last, and only
//               while fewer than the cap are running
//   exit        the queue is empty
//   bounds      a wire brings its wave once in a mission; the queue never holds more than one cap's worth (what
//               does not fit is shed, and counted); so there are never more than the cap running and as many
//               again waiting, whatever the player sets off
//   exhaustion  soft: what is shed does not come, and nothing else changes
//
// AND WHAT PAYS FOR IT. More machines want more rounds, and the site has three caches. So a wave that is shut
// down to its last machine gives a cache's worth (`fallen` says when; the live half hands it over). The test
// holds, against the game's own tables, that a wave's rounds are enough for the wave at a hit rate the setting
// may fairly ask — so the mission can be finished however many causes there are.
import { angleDelta, clamp } from '../core/math.js';

/** the settings, in the order every table below is in; anything unknown plays as Operator, as it does in the game */
export const TIERS = ['recruit', 'operator', 'ghost'];
export const tierOf = (name) => {
  const tier = TIERS.indexOf(name);
  return tier < 0 ? 1 : tier;
};

export const RESPONSE = Object.freeze({
  /**
   * How many machines each cause brings IN ALL, by setting — what the game itself sends for it counts towards
   * the figure (a charge's own wave, the blast's drones, the lodestar's).
   */
  size: Object.freeze({
    tripwire: Object.freeze([2, 3, 4]),
    alarm: Object.freeze([3, 4, 5]),
    task: Object.freeze([3, 4, 6]),
  }),
  /** the most machines from waves that may be running at once, by setting … */
  alive: Object.freeze([6, 9, 12]),
  /** … and how much of that a phone is asked to draw */
  phone: 0.7,
  /** seconds between one machine walking in and the next: a wave arrives, it does not appear */
  gap: 0.8,
  /** a machine on foot comes in by a door at least this far from the player, in metres (as a charge's wave does) */
  far: 14,
  /** a fallen machine of a wave is cleared away after this many seconds, once it is out of sight or this far off */
  wreck: Object.freeze({ after: 40, off: 30 }),
});

export const sizeOf = (cause, tier) => RESPONSE.size[cause]?.[tier] ?? 0;

/** Of a wave of `n`, how many walk and how many fly: one in three comes by air. */
export function mixOf(n) {
  const drones = Math.floor(n / 3);
  return { sentries: n - drones, drones };
}

/**
 * What must still be sent so that the cause brings its figure, given what is already on its way for it.
 * @param {{ sentries: number, drones: number }} [already]
 */
export function topUp(cause, tier, already = { sentries: 0, drones: 0 }) {
  const size = sizeOf(cause, tier);
  const extra = Math.max(0, size - already.sentries - already.drones);
  const drones = clamp(mixOf(size).drones - already.drones, 0, extra);
  return { sentries: extra - drones, drones };
}

/** The most machines of waves that may be running at once. */
export const capOf = (tier, phone = false) =>
  Math.max(2, Math.round(RESPONSE.alive[tier] * (phone ? RESPONSE.phone : 1)));

export function createResponse() {
  return {
    /** the wires that have brought their wave */
    wires: [],
    /** the waves that are not yet shut down: { id, cause, left } — `left` counts those still to walk in, too */
    waves: [],
    /** the machines still to walk in: { type, wave, to } */
    queue: [],
    nextId: 1,
    gapT: 0,
    /** how many waves have been called, how many machines handed out, and how many shed for want of room */
    called: 0,
    sent: 0,
    shed: 0,
  };
}

/**
 * A cause. Returns the wave it brings — { id, cause, sentries, drones, shed, total } where sentries and drones
 * are what THIS adds — or null when it brings none (a wire that has brought its wave already).
 * @param {object} o
 * @param {number} o.tier
 * @param {number} o.cap the most that may run at once (`capOf`)
 * @param {{ x: number, z: number }} o.to where they are sent
 * @param {{ sentries: number, drones: number }} [o.already] what the game has itself sent for this cause
 * @param {string} [o.key] a wire's name: each brings a wave once
 */
export function call(r, cause, { tier, cap, to, already = { sentries: 0, drones: 0 }, key }) {
  if (cause === 'tripwire') {
    if (r.wires.includes(key)) return null;
    r.wires.push(key);
  }
  const add = topUp(cause, tier, already);
  // on foot and by air turn about, so that neither kind waits for all of the other
  const orders = [];
  let s = add.sentries;
  let d = add.drones;
  while (s > 0 || d > 0) {
    if (s-- > 0) orders.push('sentry');
    if (d-- > 0) orders.push('drone');
  }
  const room = Math.max(0, cap - r.queue.length);
  const taken = orders.slice(0, room);
  const id = r.nextId++;
  for (const type of taken) r.queue.push({ type, wave: id, to: { x: to.x, z: to.z } });
  const shed = orders.length - taken.length;
  r.shed += shed;
  r.called++;
  const wave = {
    id,
    cause,
    sentries: taken.filter((type) => type === 'sentry').length,
    drones: taken.filter((type) => type === 'drone').length,
    shed,
    total: already.sentries + already.drones + taken.length,
  };
  if (wave.total > 0) r.waves.push({ id, cause, left: wave.total });
  return wave;
}

/**
 * One tick: the machines to bring in now — one at most.
 * @param {{ alive: number, cap: number }} now how many machines of waves are running, and the most that may
 */
export function step(r, dt, { alive, cap }) {
  r.gapT = Math.max(0, r.gapT - dt);
  if (!r.queue.length || r.gapT > 0 || alive >= cap) return [];
  r.gapT = RESPONSE.gap;
  r.sent++;
  return [r.queue.shift()];
}

/**
 * A machine of the wave `id` is down (or could not be brought in). Returns that wave if it was its last — the
 * wave is shut down, and its rounds are the player's — or null.
 */
export function fallen(r, id) {
  const wave = r.waves.find((w) => w.id === id);
  if (!wave) return null;
  wave.left--;
  if (wave.left > 0) return null;
  r.waves.splice(r.waves.indexOf(wave), 1);
  return wave;
}

/** What a checkpoint keeps: the wires that have brought their wave. The machines themselves it does not keep. */
export const keep = (r) => ({ wires: [...r.wires], called: r.called });

/** A retry: as at the start, but for what the checkpoint kept. */
export function restore(r, kept) {
  Object.assign(r, createResponse(), { wires: [...(kept?.wires || [])], called: kept?.called || 0 });
}

/**
 * The door the next machine on foot walks in by.
 *   first    out of the player's sight and at least `far` from him; then in sight but that far; last, nearer
 *   then     as far round from the doors this wave has already used as the place they are sent to sees them —
 *            they come from more than one side — and, of equals, the nearer to that place
 * When every door has been used the wave begins again with the first of them.
 * @param {number[][]} entries [x, z] of each door's cell
 * @param {{ x: number, z: number }} player
 * @param {{ x: number, z: number }} target where the wave is sent
 * @param {number[][]} used the doors this wave has been given so far
 * @param {(x: number, z: number) => boolean} sees can the player see the cell (x, z)?
 * @returns {number[] | null} a cell, or null if there is no door at all
 */
export function nextDoor(entries, player, target, used, sees, far = RESPONSE.far) {
  if (!entries.length) return null;
  const bearing = ([x, z]) => Math.atan2(x + 0.5 - target.x, z + 0.5 - target.z);
  // the doors given since every door was last used: when all have been, the wave begins again
  const taken = used.slice(Math.floor(used.length / entries.length) * entries.length);
  let best = null;
  let bestScore = -Infinity;
  for (const cell of entries) {
    if (taken.some((u) => u[0] === cell[0] && u[1] === cell[1])) continue;
    const off = Math.hypot(cell[0] + 0.5 - player.x, cell[1] + 0.5 - player.z);
    const rank = off < far ? 2 : sees(cell[0], cell[1]) ? 1 : 0;
    const spread = taken.length
      ? Math.min(...taken.map((u) => Math.abs(angleDelta(bearing(u), bearing(cell)))))
      : Math.PI;
    const reach = Math.hypot(cell[0] + 0.5 - target.x, cell[1] + 0.5 - target.z);
    const score = -rank * 100 + spread * 4 - reach * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  return best;
}

const POINT_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/**
 * Which of the eight points of the compass (dx, dz) lies towards. North is −Z and east is +X, as everywhere
 * (src/bearing.js, which this file may not import: the test holds the two to the same answer).
 */
export function pointWord(dx, dz) {
  const degrees = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  return POINT_WORDS[Math.round(degrees / 45) % 8];
}

const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const count = (n) => COUNT[n] ?? String(n);

/** How a wave comes: 'two on foot from the east, one by air'. */
export function how(wave, from) {
  return [
    wave.sentries && `${count(wave.sentries).toLowerCase()} on foot${from ? ` from the ${from}` : ''}`,
    wave.drones && `${count(wave.drones).toLowerCase()} by air`,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * What Overwatch says of a wave: how many, what for, and how they come.
 * @param {{ sentries: number, drones: number }} wave what this brings
 * @param {string} why 'the wire', 'the alarm', 'the charge' …
 * @param {string | null} from the compass point the ones on foot come from, if any walk
 * @param {boolean} [more] the game has already said that some are coming for this: these are besides
 */
export function words(wave, why, from, more = false) {
  const n = wave.sentries + wave.drones;
  if (!n) return '';
  return `${count(n)}${more ? ' more' : ''} coming for ${why} — ${how(wave, from)}.`;
}

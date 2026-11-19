// Armour: what a round of the player's counts against a machine's plating, how many times the rounds there are
// to make up for it, and how a drone that is struck gets out of the way. Rules only — no drawing and no browser
// in here; src/wild/armour-live.js joins them to the game — so it runs under `node --test`
// (test/unit/wild-armour.test.mjs).
//
// Decision of 18 November 2026 — the owner: "the game is still too easy to shoot down drones and robots make it
// more difficult and require more shoots to take them down". Until then a sentry was three or four rounds of the
// carbine to the body and two to the head, a drone two; a burst did it. Now the machines are plated, and a round
// counts half: a sentry is five to seven to the body and three to the head, a drone three or four; the shotgun,
// which shut a sentry down with one shell at arm's length, takes two.
//
// What is as it was, on purpose — these are not rounds, and with the rounds worth half they are worth more:
// the knife and a takedown from behind, an EMP, a lodestone, a drone flown into them or its gun turned on them,
// a machine turned against its own, the cascades going up. And the classic game (`?wild=0`).
//
// There are twice the rounds, because rounds are finite (the owner, 12 November 2026) and the arithmetic that
// says a mission can be shot through (test/unit/wild-response.test.mjs) is not to be let go: twice the reserve
// at the start, twice in a cache, twice from a wave shut down. What is harder is the time a machine stands under
// fire and fires back — not whether there are rounds to finish it.

export const ARMOUR = Object.freeze({
  /** what a round of the player's counts against a machine of each kind, of what it did */
  rounds: Object.freeze({ sentry: 0.5, drone: 0.5 }),
  /** how many times the rounds: in reserve when a mission starts, in a cache, from a wave shut down */
  plenty: 2,
  /**
   * A drone that is struck and still flying: how far round the circle it flies about the player it jumps
   * (radians — of eight metres, about seven) as it turns back the other way, and the seconds before it may do so
   * again: the time that stride takes at its best pace, so that a burst sends it one way and not to and fro
   */
  jink: 0.9,
  jinkEvery: 1.6,
});

/**
 * What a place on a machine counts once its plating has been asked: `multiplier` is what it counted before (the
 * machine's own figure, or the visor's), and a thing that is not plated is left what it was.
 * @param {string} type  'sentry' | 'drone'
 * @param {number} multiplier
 */
export const plated = (type, multiplier) => multiplier * (ARMOUR.rounds[type] ?? 1);

/**
 * A drone has been struck and is still flying. Returns where on its circle it now makes for and which way round
 * it goes — or null: it jinked a moment ago and holds its line.
 * @param {{ orbit: number, orbitDir: number }} drone
 * @param {number} now   the mission's clock, seconds
 * @param {number} [last] when it last jinked
 * @returns {{ orbit: number, orbitDir: number } | null}
 */
export function jink(drone, now, last) {
  if (last !== undefined && now - last < ARMOUR.jinkEvery) return null;
  const orbitDir = drone.orbitDir > 0 ? -1 : 1;
  return { orbit: drone.orbit + orbitDir * ARMOUR.jink, orbitDir };
}

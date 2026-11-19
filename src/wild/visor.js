// A sentry's visor: what the first round to its head does, and what the second does. Rules only — no drawing
// and no browser in here; src/wild/visor-live.js joins them to the game — so it runs under `node --test`
// (test/unit/wild-visor.test.mjs).
//
// Decision of 18 November 2026 — the owner: "don't make it so easy to just remove robots will headshots i want
// to feel i'm working for it". Until then one round of the carbine or the pistol to a sentry's head shut it
// down, on every setting but Ghost. Now the head is behind a visor: the first round to it cracks the visor and
// counts as a round to the body; from the second on the head counts as it always did. So a sentry is two rounds
// to the head or three to four to the body — the head is still the place to aim for, and it is never one round.
//
// What is as it was: a drone (it has no head), the knife and a takedown from behind (neither is a round), and
// the classic game (`?wild=0`).
//
// A shotgun's shell is one shot (decided later the same day — the owner: "the game is still too easy to shoot
// down drones and robots … require more shoots to take them down"): the shell that cracks the visor is stopped
// by it, every pellet. Until then its first pellet cracked the visor and the other seven went through. With the
// visor alone a shell to the head at arm's length still shuts a sentry down — eight pellets to the body do; with
// the plating of src/wild/armour.js in front of it, it is two.

export const VISOR = Object.freeze({
  /** what the round that cracks the visor counts: as one to the body */
  first: 1,
  /** which machines have a visor */
  types: Object.freeze(['sentry']),
});

/**
 * A round has struck `unit` in `zone`. Returns { by, cracked }: `by` is how much the place is to count — or
 * undefined, to leave it what the machine says — and `cracked` is true if this is the round that cracked the visor.
 * @param {{ has(unit: object): boolean, get(unit: object): unknown, set(unit: object, shot: unknown): unknown }} gone
 *   the machines whose visor is gone, and the shot that cracked each
 * @param {number} [shot] which pull of the trigger this round is of: the pellets of one shell are one shot, and
 *   the visor stops all of the shell that cracks it. Not said, every round is its own.
 */
export function plate(gone, unit, zone, shot) {
  if (zone !== 'head' || !VISOR.types.includes(unit.type)) return { by: undefined, cracked: false };
  if (!gone.has(unit)) {
    gone.set(unit, shot);
    return { by: VISOR.first, cracked: true };
  }
  if (shot !== undefined && gone.get(unit) === shot) return { by: VISOR.first, cracked: false };
  return { by: undefined, cracked: false };
}

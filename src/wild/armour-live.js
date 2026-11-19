// Armour, joined to the game: every round of the player's that strikes a machine is asked about here, after the
// visor (src/wild/index.js `plate`), and counts for less; a drone that is struck gets out of the way; and the
// rounds there are, are twice as many. The rules are src/wild/armour.js; the design is docs/WILD.md, "Armour".
import { ARMOUR, jink, plated } from './armour.js';

/**
 * @param {object} ctx G, params, tally (see src/wild/index.js)
 */
export function createArmourLive(ctx) {
  // (a switch for comparing with and without: the machines as they were, and the rounds as they were)
  if (ctx.params.get('armour') === '0') return null;
  const { G } = ctx;
  /** when each drone last jinked, by the mission's clock; a new mission builds new machines */
  let jinked = new WeakMap();
  // what main.js gives at the start of a mission and from a cache, and response-live.js from a wave shut down
  ctx.plenty = () => ARMOUR.plenty;

  return {
    name: 'armour',
    brief: [['', 'ARMOUR', 'a round counts half, and you carry twice as many']],
    controls: [
      [
        'Armour: the machines are plated, and a round counts half',
        'A sentry is five to seven rounds to the body or three to the head, a drone three or four. You carry twice the rounds. The knife, a takedown and an EMP are as they were',
        'More rounds to shut a machine down, and twice the rounds carried. The knife, a takedown and an EMP are as they were',
      ],
    ],
    tallies: { plated: 'Rounds their plating took' },

    reset() {
      jinked = new WeakMap();
    },

    plate(struck) {
      const { unit } = struck;
      const by = plated(unit.type, struck.multiplier);
      if (by === struck.multiplier) return undefined;
      ctx.tally.plated = (ctx.tally.plated || 0) + 1;
      // a drone that is struck does not wait for the next: it turns back round its circle and is somewhere else
      // (it is asked here, where the machine is known — the game says only that a round landed; one that this
      // round shuts down has nowhere to go)
      if (unit.type === 'drone' && !unit.dead) {
        const now = G.mission.time;
        const to = jink(unit, now, jinked.get(unit));
        if (to) {
          unit.orbit = to.orbit;
          unit.orbitDir = to.orbitDir;
          jinked.set(unit, now);
        }
      }
      return by;
    },
  };
}

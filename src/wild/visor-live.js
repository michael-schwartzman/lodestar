// A sentry's visor, joined to the game: what the player sees and hears when the first round to a head only cracks
// it. The rule is src/wild/visor.js; the design is docs/WILD.md, "Visors". The game asks through `plate`
// (weapon.js `hooks.plate`), for every round of the player's that strikes a machine.
import { plate } from './visor.js';
import { VISOR_SOUNDS } from './visor-sounds.js';

/** how high a sentry's head is (the middle of what a round to the head strikes: src/enemies/index.js) */
const HEAD_Y = 1.74;
/** what is left of the bar of light in the visor once it is cracked, and how far to one side it sits */
const EYE_LEFT = 0.42;
const EYE_ASIDE = 0.05;

/**
 * @param {object} ctx G, params, tally, note, say (see src/wild/index.js)
 */
export function createVisorLive(ctx) {
  // (a switch for comparing with and without)
  if (ctx.params.get('visor') === '0') return null;
  const { G } = ctx;
  /** the machines whose visor is gone, and the shot that cracked each; a new mission builds new machines */
  let gone = new WeakMap();

  return {
    name: 'visor',
    brief: [['', 'VISORS', 'the first round to a head only cracks its visor']],
    controls: [
      [
        "Visors: the first round to a sentry's head only cracks its visor",
        'The next go through. A shell is one shot: the visor stops all of the one that cracks it. The knife and a takedown are as they were',
        'The next go through. The knife and a takedown are as they were',
      ],
    ],
    tallies: { visors: 'Visors cracked' },
    sounds: { sounds: VISOR_SOUNDS },
    /** for tests and the curious: is this machine's visor gone? */
    cracked: (unit) => gone.has(unit),

    reset() {
      gone = new WeakMap();
    },

    plate(struck) {
      // (which pull of the trigger this is: the pellets of one shell are one shot — weapon.js counts a shot
      // before any of its rounds flies)
      const { by, cracked } = plate(gone, struck.unit, struck.zone, G.weapon.shots);
      if (cracked) {
        const unit = struck.unit;
        // half the bar of light is dead, and what is left sits to one side: a cracked one is told at a glance
        const eye = unit.parts?.eye;
        if (eye) {
          eye.scale.x = EYE_LEFT;
          eye.position.x = unit.id % 2 ? EYE_ASIDE : -EYE_ASIDE;
        }
        G.fx.sparks(unit.x, HEAD_Y, unit.z, 0, 1, 0, 10, 0.75, 0.9, 1, 4);
        G.audio.play('visorCrack', { x: unit.x, y: HEAD_Y, z: unit.z });
        ctx.note('VISOR CRACKED', 'warn');
        ctx.tally.visors = (ctx.tally.visors || 0) + 1;
        ctx.say('visor');
        ctx.buzz('visor', 1);
      }
      return by;
    },
  };
}

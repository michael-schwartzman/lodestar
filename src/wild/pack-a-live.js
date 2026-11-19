// Sounds made again, pack A — the player's guns and what they hit: the recipes of src/wild/pack/guns.js and
// impacts.js put in place of the game's own of the same names (audio.js `extend`). The design, and every
// verdict, is docs/WILD-sound-a.md; what was kept and why is docs/WILD.md, "Sounds made again".
//
// Not everything that was made is in it. Each sound was listened to blind by two models, the old and the new
// (17 November 2026), and the rule was written down before the second model's verdicts were in: a new sound is
// kept if the dearer model finds it no less convincing than the one it replaces, or hears it as the right thing
// where the old was not — otherwise the game's own stays. By that rule four that were made are NOT here
// (`pistolShot`, `shotSentry`, `shotDrone`, `knifeHit`: their recipes are still in those files, for whoever
// takes them further), and the three sounds the game never had — a casing landing, a round going by, a
// ricochet — were heard as "a bleep", "a user interface click" and "gun handling", and are not in the game.
import { GUNS } from './pack/guns.js';
import { IMPACTS } from './pack/impacts.js';

/** what of pack A is in the game */
export const PACK_A = [
  'shot',
  'shotgunShot',
  'dry',
  'reloadIn',
  'boltRack',
  'shotgunPump',
  'weaponSwap',
  'hitMetal',
  'lampBreak',
];

const MADE = { ...GUNS, ...IMPACTS };

export function createPackALive() {
  return {
    name: 'packA',
    sounds: { sounds: Object.fromEntries(PACK_A.map((name) => [name, MADE[name]])) },
  };
}

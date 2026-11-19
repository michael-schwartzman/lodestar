// What the sound-effect pack has: samples cut from a video model's audio track (tools/sound/sfx.mjs), each judged
// blind by a listening model before it was let near the game (docs/WILD-sfx.md, "The gate"). Rules and words
// only — no Web Audio and no browser in here; src/wild/sfx-live.js fetches the samples and plays them — so this
// runs under `node --test` (test/unit/wild-sfx.test.mjs).
//
// The wild build (docs/WILD-sfx.md). The owner, 18 November 2026: "add firing and explosion sounds drons and
// robots firing at me cenrifuges spinning and blowing up i want sounds". Every sound in this game had been
// synthesised by code; a listening model found most of them unrecognisable, and the game's own `explosion` put
// 90% of its weight under 60 Hz — where a laptop or a phone's speaker says nothing at all. What is listed below
// either took the place of one of the game's own sounds (`replaces`) — only once it was heard, blind, as no less
// convincing than what it replaced, or right where the old one was wrong — or is new: the game had no sound for
// it before. A name this file does not list is not fetched; a sound that failed the gate keeps the game's own.

/** the cascade hall, where the centrifuges stand and where they are heard spinning (main.js, aftershock-live.js
 *  have the same point) */
export const HALL = { x: 51, y: 2.5, z: 29 };

/** every sample the pack can hold. `takes` is how many files there are (`<name>-0.mp3` … ); `reach` is metres,
 *  kept the same as the sound it replaces (src/audio/sounds.js `REACH`) wherever it replaces one; `loop` sounds
 *  are played with `G.audio.loop`, not `G.audio.play` */
export const PACK = {
  shotSentry: { takes: 3, reach: 90, replaces: 'shotSentry' },
  explosion: { takes: 2, reach: 250, replaces: 'explosion' },
  // (one take: of the two let in, the other was heard again by the lead as gunfire — docs/WILD-sfx.md. The
  // blasts that follow one another are told apart by how fast each is played: BLAST_SCHEDULE's `rate`.)
  cascadeBlast: { takes: 1, reach: 300, replaces: 'cascadeBlast' },
  cascadeSpin: { takes: 1, reach: 45, loop: true },
  // the player's own: a second batch the same night, judged against the sounds the game has now (the shotgun's
  // is pack A's, src/wild/pack-a-live.js — sfx-live.js waits for that pack so that the sample is what is left)
  shotgunShot: { takes: 3, reach: 110, replaces: 'shotgunShot' },
  pistolShot: { takes: 3, reach: 22, replaces: 'pistolShot' },
};

/** the order files are fetched in: nearer the top of the owner's list first, so the first seconds of play
 *  already have the sounds that matter most. Tried and not here, each because it failed THE GATE
 *  (docs/WILD-sfx.md): `shotDrone` (six generations, never heard as a gunshot — the game's own stays);
 *  `rotorBreak`; the player's carbine, `shot` (heard as a gunshot, and as no better than the one the game has);
 *  and `whiz`, a round going past — in the pack for an hour, until the lead listened again: no take of six was
 *  heard, blind, as a round going past. */
export const PRIORITY = ['shotSentry', 'explosion', 'cascadeBlast', 'cascadeSpin', 'shotgunShot', 'pistolShot'];

/**
 * The cascades blowing: the game's own first `cascadeBlast` is the signal to start this — three more, at the
 * places of the charges, so that four go off in all — every one scheduled against the mission's own clock
 * (seconds after the first blast), not `setTimeout`, so a paused or a retried mission does not let one off late.
 * `charge` is an index into `G.site.charges`; `y` is where each is heard from (not the charge's own mounting
 * height). (`rotorBreak` — the rotors tearing loose once they had all gone — is not here: three generations of
 * it failed THE GATE, docs/WILD-sfx.md, and it was not made to stand in for anything the game already had.)
 */
export const BLAST_SCHEDULE = [
  { at: 0.5, sound: 'cascadeBlast', charge: 0, y: 1.5, rate: 0.92 },
  { at: 1.0, sound: 'cascadeBlast', charge: 1, y: 1.5, rate: 1.07 },
  { at: 1.7, sound: 'cascadeBlast', charge: 2, y: 1.5, rate: 0.85 },
];

/** the cascade loop's run-down once the charges fire: `rate` slides to this, `gain` to 0, over `seconds` */
export const SPIN_DOWN = { seconds: 1.5, rate: 0.5 };

/**
 * The extra blasts and the rotor breaking, due by `time` (the mission's own clock, seconds — the same base the
 * schedule's `at` is measured from): what BLAST_SCHEDULE has not yet given out, in order.
 * @param {{ from: number, given: number }} state `from`: the mission-time BLAST_SCHEDULE's `at` is relative to;
 *   `given`: how many of BLAST_SCHEDULE, in order, have already been returned
 * @param {number} time the mission's current clock
 * @returns {object[]} entries of BLAST_SCHEDULE now due, in schedule order
 */
export function dueBlasts(state, time) {
  const due = [];
  while (state.given < BLAST_SCHEDULE.length && time - state.from >= BLAST_SCHEDULE[state.given].at) {
    due.push(BLAST_SCHEDULE[state.given]);
    state.given++;
  }
  return due;
}

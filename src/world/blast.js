// The cascade hall going up, as numbers. The picture (world/build.js), the sound (audio/sounds.js) and the game
// (main.js) all read these, so that what is heard is what is seen.
export const BLAST = {
  /** seconds from the firing of the charges to the first of them going off */
  first: 0.05,
  /** seconds between one charge and the next */
  gap: 0.37,
  /** how fast the wave runs down a row of casings, metres a second */
  speed: 34,
  /** how high a row's wreckage stands afterwards, in metres: what is left to stop a body, an eye and a round */
  rubble: 0.7,
};

// Music a scene: which cue a moment calls for, and how one gives way to the next. Rules only — no Web Audio and
// no browser in here; src/wild/music-live.js fetches the cues and plays them — so it runs under `node --test`
// (test/unit/wild-music.test.mjs).
//
// The wild build (docs/WILD.md, "Music a scene"). The owner, 17 November 2026: "music more appropriate and wild per
// scene". The game's own score is one tune written out in notes and played by oscillators, louder or thinner by
// mood. These are eight pieces of music — made by a music model, chosen by measurement and by a model that listens
// (tools/sound/music.mjs, cut.mjs; tools/sound/manifest.json keeps what each was asked for) — one a scene, fetched
// when its scene first comes.

/** the eight cues: each is src/wild/music/<name>.mp3 */
export const CUES = ['title', 'infil', 'hall', 'tense', 'combat', 'overspeed', 'exfil', 'end'];

export const MUSIC = {
  /** seconds a cue's own end is laid over its beginning when it comes round */
  loop: 2.5,
  /** seconds a fight's music holds after the fight is over, and wariness's after the wariness */
  hold: { combat: 7, tense: 5 },
  /** how many decoded cues are kept besides the one that is playing (a decoded cue is some twenty megabytes) */
  keep: 2,
  /** how loud a cue is under a pause, as a part of itself */
  paused: 0.45,
};

/** how high a cue stands over the others: one may only come DOWN to a lower one when its hold is over */
const RANK = { infil: 0, hall: 0, tense: 1, combat: 2 };

/**
 * Which cue a moment calls for — or null: leave what is playing as it is.
 * @param {object} now
 * @param {string} now.state    the game's: title | playing | paused | dying | ending | over
 * @param {string | null} now.screen  the menu screen that is up, if one is: title, briefing, failed, debrief …
 * @param {string} [now.phase]  the mission's: infil | mark | exfil | …
 * @param {string} [now.mood]   what the machines know: calm | tense | combat
 * @param {boolean} [now.hall]  the player is in the cascade hall
 * @param {boolean} [now.overspeed] the drives are being pushed
 */
export function cueFor({ state, screen, phase, mood, hall, overspeed }) {
  if (state === 'playing') {
    if (phase === 'exfil') return 'exfil';
    if (overspeed) return 'overspeed';
    if (mood === 'combat') return 'combat';
    if (mood === 'tense') return 'tense';
    return hall ? 'hall' : 'infil';
  }
  if (state === 'title') return 'title';
  if (state === 'ending') return 'end';
  if (state === 'over') return screen === 'debrief' ? 'end' : 'title';
  return null;
}

/** @returns {{ cue: string | null, held: number }} the cue that is on, and seconds its hold has still to run */
export function createScene() {
  return { cue: null, held: 0 };
}

/**
 * A step of which cue is on: `want` is what the moment calls for (cueFor). Up is at once; down from a fight or
 * from wariness waits for its hold; anything that is neither (the run out, the title, the ending) is at once.
 * @returns {string | null} the cue that is on now
 */
export function stepScene(scene, want, dt) {
  if (want === null) return scene.cue;
  const from = RANK[scene.cue];
  const to = RANK[want];
  if (want === scene.cue) {
    // it is still called for: its hold is wound up again
    scene.held = MUSIC.hold[want] || 0;
    return scene.cue;
  }
  if (from !== undefined && to !== undefined && to < from && scene.held > 0) {
    scene.held -= dt;
    if (scene.held > 0) return scene.cue;
  }
  scene.cue = want;
  scene.held = MUSIC.hold[want] || 0;
  return scene.cue;
}

/** Seconds a cue comes in over, as the one before it goes out: a fight comes in fast, quiet slowly. */
export function crossInto(cue) {
  if (cue === 'combat') return 0.6;
  if (cue === 'overspeed' || cue === 'exfil') return 0.9;
  if (cue === 'tense') return 1.4;
  return 2.4;
}

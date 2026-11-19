// The sound of a visor going (src/wild/visor-live.js), as a recipe of the shape src/audio/sounds.js has: rendered
// once when the wild build is fetched (audio.js `extend`), measured and checked like every other sound of the
// game. Nobody has heard it: it was made, as the game's own sounds were, by what a program can measure.
import { fmPing, makeRng, noiseBurst, sweep } from '../audio/synth.js';

export const VISOR_SOUNDS = {
  // a round on armoured glass: the knock of it, the crack — bright and very short — the grit of it letting go,
  // and what is left ringing: five partials that are no chord. (The knock begins under 250 Hz: begun at 420 it
  // was, by the game's own rule for a thing struck, a note — the sound measured 0.47 and then 0.3 as a bleep
  // whatever was done to the ring, and 0.03 once the knock was lowered.)
  visorCrack: {
    seconds: 0.55,
    takes: 2,
    reach: 30,
    build(ctx, dest, take) {
      const rng = makeRng(5119 + take * 13);
      sweep(ctx, dest, 0, {
        from: 235,
        to: 110,
        duration: 0.07,
        type: 'triangle',
        attack: 0.002,
        release: 0.05,
        peak: 0.5,
      });
      noiseBurst(ctx, dest, 0, {
        duration: 0.035,
        filterType: 'highpass',
        freq: 3800,
        Q: 0.7,
        peak: 0.7,
        attack: 0.001,
        rng,
      });
      noiseBurst(ctx, dest, 0.02, {
        duration: 0.2,
        filterType: 'bandpass',
        freq: 5200 + take * 500,
        Q: 1.1,
        peak: 0.34,
        attack: 0.004,
        rng,
      });
      noiseBurst(ctx, dest, 0.03, {
        duration: 0.2,
        filterType: 'highpass',
        freq: 7000,
        Q: 0.7,
        peak: 0.26,
        attack: 0.004,
        rng,
      });
      for (const [k, carrier] of [2310, 3170, 4420, 5630, 6890].entries())
        fmPing(ctx, dest, 0.004 + k * 0.006, {
          carrier: carrier * (1 + take * 0.03),
          modRatio: 1.37 + k * 0.21,
          modIndex: 260,
          duration: 0.16 - k * 0.015,
          attack: 0.001,
          release: 0.1,
          peak: 0.11,
        });
    },
  },
};

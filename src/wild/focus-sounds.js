// The sounds of bent time (src/wild/focus-live.js), as recipes of the shape src/audio/sounds.js has: rendered once
// when the experiment is fetched (audio.js `extend`), measured and checked like every other sound of the game.
// Nobody has heard them: they were made, as all the game's sounds were, by what a program can measure.
import { makeRng, noiseBurst, sweep } from '../audio/synth.js';

export const FOCUS_SOUNDS = {
  // time bends: the air is let out of the room — a rush that falls away under itself, and a weight coming down
  focusIn: {
    seconds: 1.1,
    takes: 1,
    reach: 20,
    build(ctx, dest) {
      const rng = makeRng(2301);
      noiseBurst(ctx, dest, 0, {
        duration: 0.16,
        filterType: 'bandpass',
        freq: 2600,
        Q: 0.7,
        peak: 0.22,
        attack: 0.004,
        rng,
      });
      noiseBurst(ctx, dest, 0.02, {
        duration: 0.7,
        filterType: 'lowpass',
        freq: 520,
        Q: 0.6,
        peak: 0.5,
        attack: 0.03,
        rng,
      });
      sweep(ctx, dest, 0, { from: 170, to: 42, duration: 0.75, type: 'sine', attack: 0.012, release: 0.2, peak: 0.6 });
    },
  },

  // …and comes back: the same weight lifted, and the air let in again
  focusOut: {
    seconds: 0.8,
    takes: 1,
    reach: 20,
    build(ctx, dest) {
      const rng = makeRng(2311);
      sweep(ctx, dest, 0, { from: 46, to: 150, duration: 0.4, type: 'sine', attack: 0.05, release: 0.18, peak: 0.45 });
      noiseBurst(ctx, dest, 0.12, {
        duration: 0.42,
        filterType: 'bandpass',
        freq: 1500,
        Q: 0.6,
        peak: 0.3,
        attack: 0.16,
        rng,
      });
    },
  },
};

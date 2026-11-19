// The sound of the slide (src/wild/slide-live.js), as a recipe of the shape src/audio/sounds.js has: rendered once
// when the experiment is fetched (audio.js `extend`), measured and checked like every other sound of the game.
// Nobody has heard it: it was made, as all the game's sounds were, by what a program can measure.
import { makeRng, noiseBurst, sweep } from '../audio/synth.js';

export const SLIDE_SOUNDS = {
  // the body goes down and along: a knee and a hip on concrete, then cloth and grit scraping off what speed there was
  slideGo: {
    seconds: 0.9,
    takes: 2,
    reach: 14,
    build(ctx, dest, take) {
      const rng = makeRng(2401 + take * 17);
      // down
      sweep(ctx, dest, 0, {
        from: 120,
        to: 48,
        duration: 0.16,
        type: 'sine',
        attack: 0.004,
        release: 0.08,
        peak: 0.55,
      });
      noiseBurst(ctx, dest, 0, {
        duration: 0.07,
        filterType: 'lowpass',
        freq: 700,
        Q: 0.7,
        peak: 0.4,
        attack: 0.002,
        rng,
      });
      // along: the grit, bright at first and duller as it slows
      noiseBurst(ctx, dest, 0.03, {
        duration: 0.62,
        filterType: 'bandpass',
        freq: 2300 + take * 260,
        filterType2: 'highpass',
        freq2: 700,
        Q: 0.6,
        peak: 0.34,
        attack: 0.05,
        rng,
      });
      noiseBurst(ctx, dest, 0.1, {
        duration: 0.7,
        filterType: 'lowpass',
        freq: 480,
        Q: 0.6,
        peak: 0.3,
        attack: 0.08,
        rng,
      });
    },
  },
};

// The sounds of a thrown magnet (src/wild/lodestone-live.js), as recipes of the shape src/audio/sounds.js and
// src/audio/loops.js have: rendered once when the experiment is fetched (audio.js `extend`), then measured and
// checked exactly like every other sound of the game (`G.audio.selfTest()`). The throw and the bounce reuse the
// game's own `grenadeThrow`/`grenadeBounce` by name — a lodestone leaves the hand and lands the same way an EMP
// grenade does, so it sounds the same doing it. Nobody has heard any of these three: they were made, as all of
// the game's sounds are, by what a program can measure, not by an ear.
import { fmPing, makeRng, noiseBuffer, noiseBurst, rand, sweep, tone } from '../audio/synth.js';

const FADE = 0.3; // must match synth.js's stitchLoop default (src/audio/loops.js keeps the same convention)

export const LODESTONE_SOUNDS = {
  // a relay going over, then a low surge filling the stone: two dry clicks — over, and back — under a short
  // rising weight of power, as the field takes hold
  lodestoneWake: {
    seconds: 0.9,
    takes: 2,
    reach: 35,
    build(ctx, dest, take) {
      const rng = makeRng(7410 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.014,
        filterType: 'bandpass',
        freq: rand(rng, 2800, 3400),
        Q: 2.4,
        peak: rand(rng, 0.45, 0.55),
        attack: 0.001,
        decay: 0.02,
        rng,
      });
      noiseBurst(ctx, dest, 0.045, {
        duration: 0.017,
        filterType: 'bandpass',
        freq: rand(rng, 2200, 2700),
        Q: 2,
        peak: rand(rng, 0.36, 0.44),
        attack: 0.001,
        decay: 0.03,
        rng,
      });
      sweep(ctx, dest, 0.02, {
        from: 52,
        to: 150,
        duration: 0.5,
        type: 'sine',
        attack: 0.05,
        release: 0.25,
        peak: 0.55,
      });
      noiseBurst(ctx, dest, 0.03, {
        duration: 0.45,
        filterType: 'lowpass',
        freq: 220,
        Q: 0.6,
        peak: 0.32,
        attack: 0.08,
        rng,
      });
    },
  },

  // the heavy thud of the blow, with a short ring of metal struck inside it — not a clean note: a strike
  lodestoneBlow: {
    seconds: 0.85,
    takes: 2,
    reach: 60,
    build(ctx, dest, take) {
      const rng = makeRng(7420 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.09,
        filterType: 'lowpass',
        freq: rand(rng, 120, 160),
        Q: 0.7,
        peak: rand(rng, 0.7, 0.8),
        attack: 0.002,
        decay: 0.14,
        rng,
      });
      tone(ctx, dest, 0, {
        freq: rand(rng, 55, 65),
        type: 'sine',
        attack: 0.002,
        decay: 0.3,
        release: 0.12,
        peak: 0.55,
      });
      fmPing(ctx, dest, 0.01, {
        carrier: rand(rng, 1600, 2000),
        modRatio: 2.1,
        modIndex: 500,
        duration: 0.25,
        attack: 0.002,
        release: 0.3,
        peak: rand(rng, 0.3, 0.38),
      });
    },
  },
};

export const LODESTONE_LOOPS = {
  // the field itself, while it is awake: a low uneven growl, not a hum — this game's owner disliked those.
  // Two filtered noise beds, their cutoffs pushed around by two LFOs at a deliberately uneven, non-harmonic
  // rate (so the roughness itself keeps shifting instead of settling into a second steady beat), the way
  // src/audio/loops.js's own hush loops (droneFly) move a cutoff rather than ever putting a raw tone to
  // output. Kept to the short side (under four seconds) as asked.
  lodestoneField: {
    seconds: 3.3,
    reach: 16,
    hush: true,
    build(ctx, dest) {
      const len = 3.3 - FADE; // 3.0 s once stitched — the loop's real, looped length
      const rng = makeRng(7430);
      const out = ctx.createGain();
      out.gain.value = 0.55;
      out.connect(dest);

      // the low body of the growl
      const bedA = ctx.createBufferSource();
      bedA.buffer = noiseBuffer(ctx, 3.3, rng);
      const bandA = ctx.createBiquadFilter();
      bandA.type = 'bandpass';
      bandA.frequency.value = 220;
      bandA.Q.value = 1.1;
      const gainA = ctx.createGain();
      gainA.gain.value = 0.6;
      bedA.connect(bandA).connect(gainA).connect(out);

      // a second, higher-pitched bed, unevenly out of step with the first — the "roughness"
      const bedB = ctx.createBufferSource();
      bedB.buffer = noiseBuffer(ctx, 3.3, rng);
      const bandB = ctx.createBiquadFilter();
      bandB.type = 'bandpass';
      bandB.frequency.value = 540;
      bandB.Q.value = 1.3;
      const gainB = ctx.createGain();
      gainB.gain.value = 0.3;
      bedB.connect(bandB).connect(gainB).connect(out);

      // two LFOs, each a whole number of cycles over the loop (so the stitch has as little to hide as
      // possible) but at rates with no common small ratio between them, so together they never repeat a
      // beat within the loop — this is the unevenness, not a filter sweeping smoothly back and forth
      const lfo1 = ctx.createOscillator();
      lfo1.frequency.value = Math.round(0.9 * len) / len;
      const depth1 = ctx.createGain();
      depth1.gain.value = 160;
      lfo1.connect(depth1).connect(bandA.frequency);
      lfo1.start(0);

      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = Math.round(1.37 * len) / len;
      const depth2 = ctx.createGain();
      depth2.gain.value = 220;
      lfo2.connect(depth2).connect(bandB.frequency);
      lfo2.start(0);

      // the same two LFOs also nudge the gain of what they are not filtering — the two beds trade weight
      // back and forth rather than just sweeping in pitch, which is what keeps it from settling into a hum
      const crossA = ctx.createGain();
      crossA.gain.value = 0.18;
      lfo2.connect(crossA).connect(gainA.gain);
      const crossB = ctx.createGain();
      crossB.gain.value = 0.1;
      lfo1.connect(crossB).connect(gainB.gain);

      bedA.start(0);
      bedB.start(0);
    },
  },
};

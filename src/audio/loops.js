// Recipes for the game's seven ambient/mechanical loops. Each `build` renders a plain `seconds`-long buffer;
// audio.js then stitches it into a seamless loop (see synth.js's `stitchLoop`, 0.3 s default crossfade) before
// storing it. `len` below is always that final, looped length — tonal parts are tuned to complete a whole
// number of cycles across it, so there is as little phase mismatch as possible left for the stitch to hide.
import { noiseBuffer, noiseBurst, filterNode, makeRng, rand } from './synth.js';

const FADE = 0.3; // must match synth.js's stitchLoop default

/** A steady, un-enveloped gain stage — loops hold a level; they don't fade within their own render. */
function bus(ctx, dest, value = 1) {
  const g = ctx.createGain();
  g.gain.value = value;
  g.connect(dest);
  return g;
}

export const LOOPS = {
  // `bed: true` marks a background sound: it plays through the Ambience volume, and it is held to having no
  // steady note in it (audio.js selfTest, src/audio/tone.js) — a hush can go on for an hour; a hum cannot.
  // `hush: true` holds a loop to the same limit without making it a bed: a drone is a thing in the world, to be
  // heard as loudly as it is near, but it must not whine. The alarm and the heartbeat are notes on purpose.

  // outdoor night wind: a slowly moving filtered noise bed, two gusts per loop
  wind: {
    seconds: 6.3,
    reach: 150,
    bed: true,
    build(ctx, dest) {
      const len = 6.3 - FADE;
      const out = bus(ctx, dest, 0.45);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 6.3, makeRng(1));
      const lp = filterNode(ctx, 'lowpass', 480, 0.7);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 2 / len;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(lp.frequency);
      lfo.start(0);
      src.connect(lp).connect(out);
      src.start(0);
    },
  },

  // indoors: the air of a closed room — a low breath from the ventilation and a thread of it through a grille.
  // (It was a mains hum: a 120 Hz sawtooth. That is the sound this was changed to get rid of.)
  hum: {
    seconds: 7.3,
    reach: 40,
    bed: true,
    build(ctx, dest) {
      const len = 7.3 - FADE;
      const out = bus(ctx, dest, 1);
      const low = ctx.createBufferSource();
      low.buffer = noiseBuffer(ctx, 7.3, makeRng(2));
      const lowGain = ctx.createGain();
      lowGain.gain.value = 0.8;
      // it breathes: one slow swell a loop
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 1 / len;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.16;
      lfo.connect(lfoGain).connect(lowGain.gain);
      lfo.start(0);
      low
        .connect(filterNode(ctx, 'lowpass', 210, 0.5))
        .connect(filterNode(ctx, 'lowpass', 330, 0.5))
        .connect(lowGain)
        .connect(out);
      low.start(0);
      const air = ctx.createBufferSource();
      air.buffer = noiseBuffer(ctx, 7.3, makeRng(12));
      const airGain = ctx.createGain();
      airGain.gain.value = 0.03;
      air
        .connect(filterNode(ctx, 'bandpass', 1900, 0.4))
        .connect(airGain)
        .connect(out);
      air.start(0);
    },
  },

  // the cascade hall: thousands of rotors turning, heard as a rush of air with a slow surge in it and a weight
  // under it. (It was five sine waves at 2200 Hz over a 42 Hz throb: a whine.)
  cascade: {
    seconds: 8.3,
    reach: 45,
    bed: true,
    build(ctx, dest) {
      const len = 8.3 - FADE;
      const out = bus(ctx, dest, 1);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 8.3, makeRng(3));
      const rush = ctx.createGain();
      rush.gain.value = 0.5;
      // two slow surges, two and three to the loop, drifting against each other
      for (const [cycles, depth] of [
        [2, 0.15],
        [3, 0.09],
      ]) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = cycles / len;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = depth;
        lfo.connect(lfoGain).connect(rush.gain);
        lfo.start(0);
      }
      src
        .connect(filterNode(ctx, 'bandpass', 620, 0.45))
        .connect(rush)
        .connect(out);
      const weight = ctx.createGain();
      weight.gain.value = 0.75;
      src
        .connect(filterNode(ctx, 'lowpass', 110, 0.6))
        .connect(weight)
        .connect(out);
      const edge = ctx.createGain();
      edge.gain.value = 0.025;
      src
        .connect(filterNode(ctx, 'bandpass', 3400, 0.6))
        .connect(edge)
        .connect(out);
      src.start(0);
    },
  },

  // a drone's rotors: air chopped by the blades — a flutter you can hear coming and tell the direction of.
  // (It was a 110 Hz sawtooth and a 220 Hz square wave: a buzz.) Playback rate is varied per drone.
  droneFly: {
    seconds: 2.3,
    reach: 35,
    hush: true,
    build(ctx, dest) {
      const len = 2.3 - FADE;
      const out = bus(ctx, dest, 1);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 2.3, makeRng(4));
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      // the blades let the air through ninety-odd times a second: a whole number of times to the loop
      const blade = ctx.createOscillator();
      blade.frequency.value = Math.round(96 * len) / len;
      const bladeGain = ctx.createGain();
      bladeGain.gain.value = 0.44;
      blade.connect(bladeGain).connect(chop.gain);
      blade.start(0);
      src
        .connect(filterNode(ctx, 'bandpass', 520, 0.8))
        .connect(chop)
        .connect(out);
      const wash = ctx.createGain();
      wash.gain.value = 0.12;
      src
        .connect(filterNode(ctx, 'highpass', 2400, 0.5))
        .connect(wash)
        .connect(out);
      src.start(0);
    },
  },

  // The site klaxon. Decision of 16 November 2026 — the owner: "make the sounds more serious". It was a two-tone
  // siren, 480 Hz and 620 Hz turn about: a police car in a cartoon. Now it is a horn under a mountain: one low
  // blast every two seconds — two reeds a semitone apart grinding on each other, an octave over them, driven
  // hard — sagging a little as it ends, and silence between blasts for it to come back out of.
  alarm: {
    seconds: 4.3,
    reach: 150,
    build(ctx, dest) {
      const len = 4.3 - FADE;
      const out = bus(ctx, dest, 1);
      const cycles = 2;
      const cycleLen = len / cycles;
      // (clear of the first 0.3 s, which the stitch fades in: a blast keeps its front)
      const lead = 0.35;
      const blast = 0.9;
      const horn = ctx.createGain();
      horn.gain.value = 0;
      const drive = ctx.createWaveShaper();
      const curve = new Float32Array(512);
      for (let i = 0; i < 512; i++) curve[i] = Math.tanh(((i / 511) * 2 - 1) * 3) / Math.tanh(3);
      drive.curve = curve;
      const mix = ctx.createGain();
      mix.gain.value = 0.55;
      const reeds = [
        [207.65, 1],
        [220, 1],
        [415.3, 0.35],
      ].map(([freq, share]) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = share;
        osc.connect(g).connect(mix);
        osc.start(0);
        return { osc, freq };
      });
      mix
        .connect(drive)
        .connect(filterNode(ctx, 'lowpass', 1500, 0.7))
        .connect(filterNode(ctx, 'highpass', 150, 0.7))
        .connect(horn)
        .connect(out);
      for (let c = 0; c < cycles; c++) {
        const t0 = lead + c * cycleLen;
        horn.gain.setValueAtTime(0, t0);
        horn.gain.linearRampToValueAtTime(0.2, t0 + 0.03);
        horn.gain.setValueAtTime(0.2, t0 + blast - 0.16);
        horn.gain.linearRampToValueAtTime(0, t0 + blast);
        for (const { osc, freq } of reeds) {
          osc.frequency.setValueAtTime(freq, t0);
          osc.frequency.setValueAtTime(freq, t0 + blast - 0.3);
          osc.frequency.linearRampToValueAtTime(freq * 0.955, t0 + blast);
        }
      }
    },
  },

  // burning and crackling: a warm, slowly shifting noise bed with scattered crackle ticks
  fire: {
    seconds: 6.3,
    reach: 30,
    hush: true,
    build(ctx, dest) {
      const len = 6.3 - FADE;
      const rng = makeRng(42);
      const out = bus(ctx, dest, 1);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 6.3, rng);
      const lp = filterNode(ctx, 'lowpass', 700, 0.8);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3 / len;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain).connect(lp.frequency);
      lfo.start(0);
      const bedGain = ctx.createGain();
      bedGain.gain.value = 0.32;
      src.connect(lp).connect(bedGain).connect(out);
      src.start(0);
      // kept clear of the last 0.6 s so no tick's tail is still ringing where the stitch crossfades
      for (let i = 0; i < 18; i++) {
        noiseBurst(ctx, out, rand(rng, 0.1, len - 0.6), {
          duration: rand(rng, 0.01, 0.03),
          filterType: 'highpass',
          freq: rand(rng, 1500, 4000),
          peak: rand(rng, 0.2, 0.55),
          attack: 0.001,
          rng,
        });
      }
    },
  },

  // low health: a resting lub-dub, both beats finished well before the loop point
  heartbeat: {
    seconds: 1.3,
    reach: 20,
    build(ctx, dest) {
      const out = bus(ctx, dest, 1);
      const lub = ctx.createOscillator();
      lub.type = 'sine';
      lub.frequency.value = 55;
      const g1 = ctx.createGain();
      g1.gain.value = 0;
      lub.connect(g1).connect(out);
      lub.start(0);
      lub.stop(0.3);
      g1.gain.setValueAtTime(0, 0);
      g1.gain.linearRampToValueAtTime(0.8, 0.012);
      g1.gain.exponentialRampToValueAtTime(0.001, 0.2);
      g1.gain.linearRampToValueAtTime(0, 0.22);
      const dub = ctx.createOscillator();
      dub.type = 'sine';
      dub.frequency.value = 48;
      const g2 = ctx.createGain();
      g2.gain.value = 0;
      dub.connect(g2).connect(out);
      dub.start(0.32);
      dub.stop(0.6);
      g2.gain.setValueAtTime(0, 0.32);
      g2.gain.linearRampToValueAtTime(0.55, 0.332);
      g2.gain.exponentialRampToValueAtTime(0.001, 0.5);
      g2.gain.linearRampToValueAtTime(0, 0.52);
    },
  },
};

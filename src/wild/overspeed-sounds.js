// The sound of the overspeed (src/wild/overspeed-live.js), as a recipe of the shape src/audio/loops.js has:
// rendered once when the experiment is fetched (audio.js `extend`), measured and checked like every other loop.
// Nobody has heard it.
//
// It is a NOTE, on purpose — the one thing in the game that whines, and it whines because it is being killed:
// every drive in the hall pushed past its limit. It is not a bed and it does not play all the time (the lock on
// what plays all the time, test/smoke.test.mjs, is not about it): it sounds for the half minute the overspeed
// runs, and the game turns it up in pitch as it goes (the rate it is played at: overspeed-live.js).
import { filterNode, makeRng, noiseBuffer } from '../audio/synth.js';

const FADE = 0.3; // synth.js's stitchLoop joins the end to the beginning over this long

export const OVERSPEED_SOUNDS = {
  loops: {
    // three reeds a little off one another and grinding, an octave over them, and the bearings' hiss chopped
    // by the turning
    overspeedWhine: {
      seconds: 3.3,
      reach: 80,
      build(ctx, dest) {
        const len = 3.3 - FADE;
        // a whole number of cycles to the loop, so that the join has nothing to hide
        const whole = (hz) => Math.round(hz * len) / len;
        const out = ctx.createGain();
        out.gain.value = 0.5;
        out.connect(dest);
        const band = filterNode(ctx, 'bandpass', 880, 0.5);
        band.connect(out);
        for (const [hz, type, level] of [
          [310, 'sawtooth', 0.17],
          [313.7, 'sawtooth', 0.13],
          [306.1, 'triangle', 0.1],
          [622, 'triangle', 0.08],
          [935, 'sine', 0.04],
        ]) {
          const osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.value = whole(hz);
          const g = ctx.createGain();
          g.gain.value = level;
          osc.connect(g).connect(band);
          osc.start(0);
        }
        const hiss = ctx.createBufferSource();
        hiss.buffer = noiseBuffer(ctx, 3.3, makeRng(2401));
        const chop = ctx.createGain();
        chop.gain.value = 0.09;
        const turn = ctx.createOscillator();
        turn.frequency.value = whole(23);
        const depth = ctx.createGain();
        depth.gain.value = 0.07;
        turn.connect(depth).connect(chop.gain);
        turn.start(0);
        hiss
          .connect(filterNode(ctx, 'bandpass', 5200, 1.1))
          .connect(chop)
          .connect(out);
        hiss.start(0);
      },
    },
  },
};

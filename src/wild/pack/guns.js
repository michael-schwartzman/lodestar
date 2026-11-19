// Pack A — guns: every shot the player, a sentry and a drone fire, and the handling sounds of reload/selector/
// weapon-swap. Reach numbers are copied as plain constants from audio/sounds.js's REACH table (cited per
// sound) — the pack's import rule allows only audio/synth.js, so the table itself cannot be imported.
import { makeRng, rand, noiseBurst } from '../../audio/synth.js';
import { crack, punch, action, rub, roomTail } from './helpers.js';

export const GUNS = {
  // the player's suppressed carbine: the baffle's cough, a low-mid gas punch (noise, not a sliding tone), the
  // bolt cycling ~30-45 ms later, and a short indoor room
  shot: {
    seconds: 0.9,
    takes: 3,
    reach: 30, // audio/sounds.js REACH.suppressedShot
    build(ctx, dest, take) {
      const rng = makeRng(2100 + take);
      // the sharp top of the crack: brightness comes from a narrow high band, not from raw amplitude —
      // pushing this layer's own peak near 1 would blow the whole mix's peak budget and force a
      // renormalisation that quietens everything after it, so it stays moderate and lets the filter do the work
      crack(ctx, dest, 0, { peak: rand(rng, 0.5, 0.6), freq: rand(rng, 3600, 4400), duration: 0.009, rng });
      // the crack's own body: a wider mid band, close to what a muzzle's noise measures
      noiseBurst(ctx, dest, 0, {
        duration: 0.045,
        filterType: 'bandpass',
        freq: rand(rng, 1200, 1800),
        Q: 1,
        peak: rand(rng, 0.5, 0.58),
        attack: 0.0008,
        decay: 0.041,
        rng,
      });
      // the gas punch: low-mid noise, driven a little for density — never a tone, so never a "laser"
      punch(ctx, dest, 0, {
        peak: rand(rng, 0.62, 0.72),
        freq: rand(rng, 180, 240),
        duration: rand(rng, 0.08, 0.1),
        drive: 0.32,
        rng,
      });
      // the suppressor's own baffled cough: a breathy mid-band burst, well behind the crack
      noiseBurst(ctx, dest, 0.001, {
        duration: 0.035,
        filterType: 'bandpass',
        freq: rand(rng, 750, 1000),
        Q: 0.9,
        peak: rand(rng, 0.13, 0.17),
        attack: 0.002,
        decay: 0.032,
        rng,
      });
      // the bolt cycling, 55-75 ms later — clear of the shot's own decay, so it reads as its own event —
      // a firm clack-thunk, not a bell
      action(ctx, dest, rand(rng, 0.055, 0.075), {
        bright: rand(rng, 2000, 2500),
        body: rand(rng, 150, 180),
        metallic: rand(rng, 1400, 1700),
        peak: 0.46,
        rng,
      });
      // a short, tight indoor room: two close early slaps, high-passed so the tail never reads as a bass boom
      roomTail(ctx, dest, 0, {
        seconds: 0.28,
        freq: rand(rng, 1300, 1700),
        peak: 0.1,
        slap: 0.01,
        early: [
          [0.022, 0.35],
          [0.042, 0.2],
        ],
        rng,
      });
    },
  },

  // the player's suppressed 9 mm pistol: shorter and drier — less gas, a lighter slide snap sooner, less room
  pistolShot: {
    seconds: 0.6,
    takes: 3,
    reach: 22, // audio/sounds.js REACH.suppressedPistol
    build(ctx, dest, take) {
      const rng = makeRng(2200 + take);
      // best of 4 tries (kept per cap-out: realism 5 vs the game's own 2 on this listener, +3; label stayed
      // "bullet passing close by" rather than "gunshot, suppressed" across all 4 tries — see docs table)
      crack(ctx, dest, 0, { peak: rand(rng, 0.55, 0.65), freq: rand(rng, 3600, 4400), duration: 0.0045, rng });
      noiseBurst(ctx, dest, 0, {
        duration: 0.035,
        filterType: 'bandpass',
        freq: rand(rng, 1300, 1800),
        Q: 1,
        peak: rand(rng, 0.45, 0.52),
        attack: 0.0008,
        decay: 0.032,
        rng,
      });
      punch(ctx, dest, 0, {
        peak: rand(rng, 0.62, 0.72),
        freq: rand(rng, 200, 260),
        duration: rand(rng, 0.065, 0.08),
        drive: 0.26,
        rng,
      });
      noiseBurst(ctx, dest, 0.001, {
        duration: 0.03,
        filterType: 'bandpass',
        freq: rand(rng, 900, 1100),
        Q: 0.9,
        peak: rand(rng, 0.12, 0.16),
        attack: 0.002,
        decay: 0.027,
        rng,
      });
      action(ctx, dest, rand(rng, 0.045, 0.06), {
        bright: rand(rng, 3200, 3800),
        body: rand(rng, 170, 200),
        metallic: rand(rng, 2200, 2600),
        peak: 0.4,
        rng,
      });
      roomTail(ctx, dest, 0, {
        seconds: 0.22,
        freq: rand(rng, 1300, 1600),
        peak: 0.14,
        slap: 0.012,
        early: [
          [0.02, 0.3],
          [0.038, 0.18],
        ],
        rng,
      });
    },
  },

  // an unsuppressed 12-gauge indoors: the loudest, driest crack in the game, a heavy chest punch and no
  // suppressor cough — its own pump is a separate sound, so no mechanical action layer here
  shotgunShot: {
    seconds: 1.5,
    takes: 3,
    reach: 110, // audio/sounds.js REACH.shotgun
    build(ctx, dest, take) {
      const rng = makeRng(2300 + take);
      // final pick after 4 tries: this is the only balance of the four the listener actually called a
      // gunshot (vs. "ricochet on metal", "machine footstep" and "object falling" from attempts that pushed
      // the mid-range brighter or the room reflections earlier) — see docs/WILD-sound-a.md
      crack(ctx, dest, 0, { peak: rand(rng, 0.8, 0.9), freq: rand(rng, 2800, 3800), duration: 0.0026, rng });
      punch(ctx, dest, 0, {
        peak: rand(rng, 0.88, 0.96),
        freq: rand(rng, 170, 230),
        duration: rand(rng, 0.16, 0.19),
        drive: 0.6,
        rng,
      });
      // the mid-range bite a pump gun has up close
      noiseBurst(ctx, dest, 0, {
        duration: 0.022,
        filterType: 'bandpass',
        freq: rand(rng, 1400, 2000),
        Q: 0.8,
        peak: rand(rng, 0.58, 0.68),
        attack: 0.0008,
        decay: 0.02,
        rng,
      });
      // the chest: a second, slower low punch so the body does not simply end with the first
      punch(ctx, dest, 0.03, {
        peak: rand(rng, 0.58, 0.68),
        freq: rand(rng, 120, 160),
        duration: 0.26,
        drive: 0.25,
        rng,
      });
      roomTail(ctx, dest, 0, {
        seconds: 1.0,
        freq: rand(rng, 420, 560),
        peak: 0.4,
        slap: 0.05,
        early: [
          [0.07, 0.5],
          [0.13, 0.3],
        ],
        rng,
      });
    },
  },

  // a sentry's heavy unsuppressed rifle, 15 m away in a rock cavern: hard crack, long room with distinct early
  // reflections off close rock before the tail blurs into one
  shotSentry: {
    seconds: 1.58,
    takes: 3,
    reach: 90, // audio/sounds.js REACH.sentryShot
    build(ctx, dest, take) {
      const rng = makeRng(2400 + take);
      // back to the second try's crack and punch — the one change this final try makes is only the
      // action's timing below, isolating that one variable after the third try's wider changes regressed
      crack(ctx, dest, 0, { peak: rand(rng, 0.85, 0.95), freq: rand(rng, 3000, 4000), duration: 0.0024, rng });
      punch(ctx, dest, 0, {
        peak: rand(rng, 0.82, 0.92),
        freq: rand(rng, 140, 190),
        duration: rand(rng, 0.11, 0.14),
        drive: 0.5,
        rng,
      });
      noiseBurst(ctx, dest, 0, {
        duration: 0.035,
        filterType: 'bandpass',
        freq: rand(rng, 1500, 2200),
        Q: 0.8,
        peak: rand(rng, 0.55, 0.68),
        attack: 0.001,
        decay: 0.032,
        rng,
      });
      // final pick after 4 tries: this (second try's) balance was the one the listener called "gunshot,
      // unsuppressed" — moving only the action's timing later (third/fourth try) traded that label away for
      // no clear realism gain, so it is reverted here too; see docs/WILD-sound-a.md
      action(ctx, dest, rand(rng, 0.085, 0.105), {
        bright: rand(rng, 2200, 2800),
        body: rand(rng, 110, 140),
        metallic: rand(rng, 1600, 2000),
        peak: 0.44,
        rng,
      });
      // the cavern: longer and a little louder than the first try, which read as a slammed door, not a cave
      roomTail(ctx, dest, 0, {
        seconds: 1.15,
        freq: rand(rng, 350, 480),
        peak: 0.4,
        slap: 0.045,
        early: [
          [0.055, 0.6],
          [0.1, 0.42],
          [0.16, 0.26],
        ],
        rng,
      });
    },
  },

  // a drone's light machine gun, 15 m away: small-bore and fast — a dry crack with less weight, its own quick
  // mechanism, and a shorter room
  shotDrone: {
    seconds: 0.55,
    takes: 3,
    reach: 60, // audio/sounds.js REACH.droneGun
    build(ctx, dest, take) {
      const rng = makeRng(2500 + take);
      // try 3 (final, capped early for time): try 2's early room tap + metallic action together read as a
      // "mech footstep" — dropped the discrete tap, dulled the action further, kept the body layer for weight
      crack(ctx, dest, 0, { peak: rand(rng, 0.56, 0.64), freq: rand(rng, 3400, 4400), duration: 0.0016, rng });
      noiseBurst(ctx, dest, 0, {
        duration: 0.04,
        filterType: 'bandpass',
        freq: rand(rng, 1200, 1700),
        Q: 1,
        peak: rand(rng, 0.46, 0.54),
        attack: 0.001,
        decay: 0.036,
        rng,
      });
      punch(ctx, dest, 0, {
        peak: rand(rng, 0.52, 0.6),
        freq: rand(rng, 200, 260),
        duration: rand(rng, 0.055, 0.07),
        drive: 0.2,
        rng,
      });
      action(ctx, dest, rand(rng, 0.05, 0.065), {
        bright: rand(rng, 2800, 3400),
        body: rand(rng, 220, 260),
        metallic: rand(rng, 2200, 2600),
        peak: 0.3,
        rng,
      });
      roomTail(ctx, dest, 0, {
        seconds: 0.26,
        freq: rand(rng, 1200, 1600),
        peak: 0.1,
        slap: 0.035,
        rng,
      });
    },
  },

  // hammer on an empty chamber: a small dry metal click, with a trace of the receiver behind it
  dry: {
    seconds: 0.14,
    takes: 2,
    reach: 20, // audio/sounds.js REACH.default
    build(ctx, dest, take) {
      const rng = makeRng(2600 + take);
      crack(ctx, dest, 0, { peak: rand(rng, 0.3, 0.36), freq: rand(rng, 4000, 5000), duration: 0.001, rng });
      noiseBurst(ctx, dest, 0.001, {
        duration: 0.018,
        filterType: 'bandpass',
        freq: rand(rng, 1600, 2000),
        Q: 1.2,
        peak: rand(rng, 0.12, 0.16),
        attack: 0.0006,
        decay: 0.016,
        rng,
      });
    },
  },

  // …and home: its catch over the notch, the whole gun knocked by it, and a second, smaller click behind it
  reloadIn: {
    seconds: 0.34,
    takes: 3,
    reach: 20, // audio/sounds.js REACH.default
    build(ctx, dest, take) {
      const rng = makeRng(2900 + take);
      action(ctx, dest, 0, {
        bright: rand(rng, 2600, 3000),
        body: rand(rng, 130, 150),
        metallic: rand(rng, 1800, 2000),
        peak: 0.46,
        rng,
      });
      action(ctx, dest, 0.048, { bright: 3800, body: 0, metallic: 0, peak: 0.18, rng });
    },
  },

  // the bolt let go: its catch, the spring throwing it forward, and it slamming home on the round
  boltRack: {
    seconds: 0.4,
    takes: 3,
    reach: 20, // audio/sounds.js REACH.default
    build(ctx, dest, take) {
      const rng = makeRng(3000 + take);
      action(ctx, dest, 0, { bright: 4200, body: 0, metallic: 0, peak: 0.36, rng });
      rub(ctx, dest, 0.004, { seconds: 0.042, freq: rand(rng, 2200, 2600), peak: 0.34, rng });
      action(ctx, dest, 0.048, {
        bright: rand(rng, 2300, 2600),
        body: rand(rng, 105, 120),
        metallic: rand(rng, 2200, 2450),
        peak: 0.62,
        rng,
      });
    },
  },

  // the pump: back — a clack — the slide's own length of friction, and forward and shut — a harder one
  shotgunPump: {
    seconds: 0.46,
    takes: 3,
    reach: 20, // audio/sounds.js REACH.default
    build(ctx, dest, take) {
      const rng = makeRng(3100 + take);
      rub(ctx, dest, 0, { seconds: 0.04, freq: rand(rng, 900, 1100), peak: 0.2, rng });
      action(ctx, dest, 0.04, {
        bright: rand(rng, 1900, 2200),
        body: rand(rng, 115, 130),
        metallic: rand(rng, 1400, 1600),
        peak: 0.46,
        rng,
      });
      rub(ctx, dest, 0.07, { seconds: 0.12, freq: rand(rng, 800, 1000), peak: 0.24, rng });
      action(ctx, dest, 0.2, {
        bright: rand(rng, 2200, 2500),
        body: rand(rng, 125, 140),
        metallic: rand(rng, 1600, 1800),
        peak: 0.54,
        rng,
      });
    },
  },

  // changing weapon: a soft cloth-and-webbing rustle ending in a light metal settle
  weaponSwap: {
    seconds: 0.4,
    takes: 3,
    reach: 20, // audio/sounds.js REACH.default
    build(ctx, dest, take) {
      const rng = makeRng(3400 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.22,
        filterType: 'bandpass',
        freq: rand(rng, 2000, 3200),
        Q: 0.4,
        peak: rand(rng, 0.14, 0.2),
        attack: 0.02,
        decay: 0.2,
        rng,
      });
      action(ctx, dest, 0.3, { bright: rand(rng, 1800, 2400), body: 0, metallic: 0, peak: 0.2, rng });
    },
  },
};

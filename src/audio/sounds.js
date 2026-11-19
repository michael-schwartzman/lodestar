// The recipes for every one-shot sound: a name maps to { seconds, takes, reach, build(ctx, dest, take) }.
// `build` wires synth.js helpers into `dest` (an OfflineAudioContext's destination, or a sub-mix feeding it);
// `take` (0-based) seeds each recipe's randomness so alternate takes vary without being a different sound.
// This file is long only because there are dozens of distinct sounds to describe — each recipe itself is a handful
// of calls. audio.js renders every (name, take) pair once at startup and keeps the resulting AudioBuffers.
import {
  noiseBurst,
  tone,
  sweep,
  fmPing,
  noiseBuffer,
  filterNode,
  panner,
  perc,
  env,
  distortion,
  makeRng,
  rand,
} from './synth.js';
import { BLAST } from '../world/blast.js';

/** Positional falloff distances (metres), grouped by sound category; see docs/DESIGN.md "Sound". */
export const REACH = {
  footstep: 12,
  suppressedShot: 30,
  sentryShot: 90,
  droneGun: 60,
  machineVoice: 40,
  door: 25,
  impact: 30,
  explosion: 250,
  beacon: 60,
  suppressedPistol: 22,
  shotgun: 110,
  emp: 90,
  // a room's breaker dropping out, or being thrown in again
  breaker: 45,
  cascadeBlast: 300,
  default: 20, // sounds that are always played centred; only consulted if a caller ever adds a position
};

// ---------- what a gun's working parts are made of, as sound ----------
// Decision of 16 November 2026 — the owner: "make the reload animation more realistic and make a sound". The
// sounds of a reload were two blips of low-passed noise each, a fiftieth of a second long: measured, a third of
// the suppressed shot's peak and a quarter of its loudness, with nothing in them above a kilohertz — a soft
// "pff" that a phone's speaker does not carry at all. A part of a gun that meets another is three things at
// once, and the recipes below are made of them:

/**
 * Metal home on metal. The CRACK of it — bright noise, a hundredth of a second; the BODY of the thing struck — a
 * low thump; and what it RINGS with — two partials that are not in tune with each other, gone in a twentieth.
 * @param {object} o `bright`: where the crack is (Hz); `thump`: the body (Hz, 0 for none); `ring`: the lower
 *   partial (Hz, 0 for none); `peak`: how hard
 */
function clack(ctx, dest, at, { bright = 3000, thump = 150, ring = 2100, peak = 0.6, rng }) {
  noiseBurst(ctx, dest, at, {
    duration: 0.012,
    filterType: 'highpass',
    freq: bright,
    peak,
    attack: 0.0005,
    decay: 0.011,
    rng,
  });
  noiseBurst(ctx, dest, at, {
    duration: 0.032,
    filterType: 'bandpass',
    freq: bright * 0.45,
    Q: 0.9,
    peak: peak * 0.9,
    attack: 0.001,
    decay: 0.03,
    rng,
  });
  if (thump)
    tone(ctx, dest, at, { freq: thump, type: 'sine', attack: 0.002, decay: 0.05, release: 0.04, peak: peak * 0.7 });
  if (ring)
    for (const [times, share] of [
      [1, 0.2],
      [1.57, 0.11],
    ])
      tone(ctx, dest, at + 0.002, {
        freq: ring * times,
        type: 'triangle',
        attack: 0.001,
        decay: 0.045,
        release: 0.05,
        peak: peak * share,
      });
}

/** One part sliding in or over another: a breath of band-passed noise that swells and dies, `seconds` long. */
function rub(ctx, dest, at, { seconds = 0.08, freq = 1400, peak = 0.25, rng }) {
  noiseBurst(ctx, dest, at, {
    duration: seconds,
    filterType: 'bandpass',
    freq,
    Q: 0.6,
    peak,
    attack: seconds * 0.35,
    decay: seconds * 0.65,
    rng,
  });
}

// ---------- weight ----------
// Decision of 16 November 2026 — the owner: "make the sounds more serious". Measured (src/audio/tone.js), what
// the game said to the player and what its machines said to each other were bleeps — a bare square or sine at
// one pitch, or sliding between two: the hit marker, the kill chime, the menus, the radio, the objective, every
// machine's voice, its "power down", even its footstep — and its guns were a thirtieth of a second long with no
// room after them. Now nothing of that kind is a bare tone (`bareTone` under 0.3, where they measured 0.5 to
// 1.0: test/smoke.test.mjs), and a gun has a body, an action and a room. A device that beeps may still beep: the
// charge's keypad, the lodestar's ping, the goggles.

/**
 * The room a shot is fired in, coming back: a slap off the nearest wall, then dull noise that swells for a
 * moment and dies away — 20 dB down after `seconds`, and gone by 1.6 times that (a recipe must be that long, and
 * a twentieth of a second more). `peak` is about how high the tail stands.
 */
function room(ctx, dest, at, { seconds = 0.3, freq = 900, peak = 0.12, slap = 0.05, rng }) {
  noiseBurst(ctx, dest, at + slap, {
    duration: 0.03,
    filterType: 'bandpass',
    freq: freq * 1.5,
    Q: 0.7,
    peak: peak * 1.5,
    attack: 0.003,
    decay: 0.027,
    rng,
  });
  // (synth.js `perc` is for a thing struck: it is 80 dB down by the end of its decay. A room dies more slowly.)
  const long = seconds * 1.6;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, long + 0.1, rng);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  // low-passed noise is a good deal quieter than what went in: made up for here, so that `peak` means what it says
  g.gain.linearRampToValueAtTime(peak * 0.33 * Math.sqrt(22050 / freq), at + 0.03);
  g.gain.setTargetAtTime(0, at + 0.03, seconds / 2.3);
  g.gain.setTargetAtTime(0, at + long, 0.006);
  src
    .connect(filterNode(ctx, 'lowpass', freq, 0.5))
    .connect(g)
    .connect(dest);
  src.start(at);
  src.stop(at + long + 0.04);
}

/**
 * A machine's voice. Not a note: two saws far down (`from` → `to` Hz — under anything heard as a pitch), driven
 * hard, shaken `rough` times a second, through a throat (`throat` Hz), with breath on it.
 */
function growl(ctx, dest, at, { from = 110, to = 90, seconds = 0.3, throat = 850, rough = 43, peak = 0.5, rng }) {
  const out = ctx.createGain();
  out.gain.value = 0;
  const shake = ctx.createGain();
  shake.gain.value = 0.6;
  const lfo = ctx.createOscillator();
  lfo.type = 'triangle';
  lfo.frequency.value = rough;
  const depth = ctx.createGain();
  depth.gain.value = 0.4;
  lfo.connect(depth).connect(shake.gain);
  const stop = at + seconds + 0.08;
  for (const off of [1, 1.013]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(from * off, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to * off), at + seconds);
    osc.connect(shake);
    osc.start(at);
    osc.stop(stop);
  }
  // the throat, and the chest under it: without the second the voice is all edge
  const driven = shake.connect(distortion(ctx, 5));
  driven.connect(filterNode(ctx, 'bandpass', throat, 0.8)).connect(out);
  const chest = ctx.createGain();
  chest.gain.value = 0.9;
  driven
    .connect(filterNode(ctx, 'bandpass', throat * 0.42, 0.9))
    .connect(chest)
    .connect(out);
  out.connect(dest);
  lfo.start(at);
  lfo.stop(stop);
  // (what comes out of the throat stands two or three times as high as what went in: `peak` is brought down to
  // mean, roughly, how high the voice stands)
  env(out.gain, at, {
    attack: 0.012,
    decay: seconds * 0.45,
    sustain: 0.6,
    hold: seconds * 0.3,
    release: seconds * 0.25,
    peak: peak * 0.36,
  });
  noiseBurst(ctx, dest, at, {
    duration: seconds,
    filterType: 'bandpass',
    freq: throat * 1.7,
    Q: 0.6,
    peak: peak * 0.13,
    attack: seconds * 0.15,
    decay: seconds * 0.85,
    rng,
  });
}

/**
 * Something that turns, running down: a band of noise falling from `from` to `to` Hz over `seconds`, fluttering
 * `flutter` times a second at first and ever slower.
 */
function runDown(ctx, dest, at, { from = 2400, to = 300, seconds = 0.7, flutter = 80, peak = 0.4, rng }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds + 0.1, rng);
  const band = filterNode(ctx, 'bandpass', from, 1);
  band.frequency.setValueAtTime(from, at);
  band.frequency.exponentialRampToValueAtTime(to, at + seconds);
  const shake = ctx.createGain();
  shake.gain.value = 0.6;
  const lfo = ctx.createOscillator();
  lfo.frequency.setValueAtTime(flutter, at);
  lfo.frequency.exponentialRampToValueAtTime(Math.max(4, flutter * 0.12), at + seconds);
  const depth = ctx.createGain();
  depth.gain.value = 0.4;
  lfo.connect(depth).connect(shake.gain);
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(band).connect(shake).connect(g).connect(dest);
  env(g.gain, at, { attack: 0.01, decay: seconds * 0.55, sustain: 0.45, hold: 0, release: seconds * 0.45, peak });
  const stop = at + seconds + 0.08;
  src.start(at);
  src.stop(stop);
  lfo.start(at);
  lfo.stop(stop);
}

/** A low thud that falls in pitch as a struck thing does: the body of a knock, a fall, a drum. */
function thud(ctx, dest, at, { from = 110, to = 55, seconds = 0.12, peak = 0.5 }) {
  sweep(ctx, dest, at, { from, to, duration: seconds, type: 'sine', attack: 0.003, release: seconds * 0.5, peak });
}

export const SOUNDS = {
  // the player's suppressed carbine: the cough of gas through the can, the thump of it in the shoulder, the
  // bolt going back and home, and the room answering
  shot: {
    seconds: 0.6,
    takes: 3,
    reach: REACH.suppressedShot,
    build(ctx, dest, take) {
      const rng = makeRng(100 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.05,
        filterType: 'bandpass',
        freq: rand(rng, 1100, 1700),
        Q: 1,
        peak: 0.5,
        attack: 0.001,
        decay: 0.045,
        rng,
      });
      noiseBurst(ctx, dest, 0.002, {
        duration: 0.09,
        filterType: 'lowpass',
        freq: rand(rng, 420, 560),
        Q: 0.7,
        peak: 0.42,
        attack: 0.003,
        decay: 0.085,
        rng,
      });
      thud(ctx, dest, 0, { from: rand(rng, 125, 145), to: 62, seconds: 0.08, peak: 0.45 });
      clack(ctx, dest, 0.02, { bright: rand(rng, 3300, 4200), thump: 0, ring: rand(rng, 2100, 2500), peak: 0.17, rng });
      room(ctx, dest, 0, { seconds: 0.32, freq: rand(rng, 700, 900), peak: 0.1, slap: 0.05, rng });
    },
  },

  // a sentry's unsuppressed rifle: a hard crack, a low boom, and the hall throwing it back
  shotSentry: {
    seconds: 1.2,
    takes: 2,
    reach: REACH.sentryShot,
    build(ctx, dest, take) {
      const rng = makeRng(200 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.012,
        filterType: 'highpass',
        freq: rand(rng, 2800, 3600),
        peak: 0.55,
        attack: 0.0005,
        decay: 0.011,
        rng,
      });
      noiseBurst(ctx, dest, 0, {
        duration: 0.07,
        filterType: 'bandpass',
        freq: rand(rng, 1300, 2000),
        Q: 0.8,
        peak: 0.85,
        attack: 0.001,
        decay: 0.065,
        rng,
      });
      thud(ctx, dest, 0, { from: rand(rng, 105, 125), to: 46, seconds: 0.2, peak: 0.75 });
      room(ctx, dest, 0, { seconds: 0.7, freq: rand(rng, 1000, 1300), peak: 0.24, slap: 0.07, rng });
      noiseBurst(ctx, dest, 0.14, {
        duration: 0.5,
        filterType: 'lowpass',
        freq: 320,
        Q: 0.6,
        peak: 0.2,
        attack: 0.03,
        decay: 0.47,
        rng,
      });
    },
  },

  // a drone's light gun: small-bore and fast — a dry crack with no weight under it, and its own short ring
  shotDrone: {
    seconds: 0.4,
    takes: 2,
    reach: REACH.droneGun,
    build(ctx, dest, take) {
      const rng = makeRng(300 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.01,
        filterType: 'highpass',
        freq: rand(rng, 3200, 4000),
        peak: 0.5,
        attack: 0.0005,
        decay: 0.009,
        rng,
      });
      noiseBurst(ctx, dest, 0, {
        duration: 0.035,
        filterType: 'bandpass',
        freq: rand(rng, 1900, 2600),
        Q: 0.8,
        peak: 0.5,
        attack: 0.001,
        decay: 0.032,
        rng,
      });
      thud(ctx, dest, 0, { from: 210, to: 120, seconds: 0.04, peak: 0.22 });
      room(ctx, dest, 0, { seconds: 0.2, freq: 1500, peak: 0.09, slap: 0.04, rng });
    },
  },

  // the player's suppressed 9 mm pistol: shorter, lighter and drier than the carbine — the slide's snap, a soft
  // cough of gas, a small thump in the hand, and less of the room
  pistolShot: {
    seconds: 0.45,
    takes: 3,
    reach: REACH.suppressedPistol,
    build(ctx, dest, take) {
      const rng = makeRng(1100 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.03,
        filterType: 'bandpass',
        freq: rand(rng, 1500, 2100),
        Q: 1.1,
        peak: rand(rng, 0.42, 0.5),
        attack: 0.0008,
        decay: 0.027,
        rng,
      });
      noiseBurst(ctx, dest, 0.004, {
        duration: 0.06,
        filterType: 'lowpass',
        freq: rand(rng, 650, 900),
        Q: 0.7,
        peak: rand(rng, 0.26, 0.32),
        attack: 0.003,
        decay: 0.055,
        rng,
      });
      thud(ctx, dest, 0, { from: rand(rng, 150, 170), to: 85, seconds: 0.05, peak: 0.3 });
      clack(ctx, dest, 0.012, {
        bright: rand(rng, 4000, 5000),
        thump: 0,
        ring: rand(rng, 2900, 3300),
        peak: 0.15,
        rng,
      });
      room(ctx, dest, 0, { seconds: 0.22, freq: rand(rng, 800, 1000), peak: 0.07, slap: 0.045, rng });
    },
  },

  // an unsuppressed 12-gauge in a concrete room: a hard crack on a heavy low thump, and a second or so of
  // dark tail off the walls — clearly the loudest gun in the game
  shotgunShot: {
    seconds: 1.35,
    takes: 3,
    reach: REACH.shotgun,
    build(ctx, dest, take) {
      const rng = makeRng(1110 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.012,
        filterType: 'highpass',
        freq: rand(rng, 3200, 4200),
        peak: rand(rng, 0.45, 0.55),
        attack: 0.0005,
        decay: 0.011,
        rng,
      });
      noiseBurst(ctx, dest, 0, {
        duration: 0.045,
        filterType: 'bandpass',
        freq: rand(rng, 900, 1500),
        Q: 0.85,
        peak: rand(rng, 0.8, 0.9),
        attack: 0.001,
        decay: 0.042,
        rng,
      });
      tone(ctx, dest, 0, {
        freq: rand(rng, 48, 62),
        type: 'sine',
        attack: 0.004,
        decay: 0.3,
        release: 0.35,
        peak: rand(rng, 0.75, 0.85),
      });
      noiseBurst(ctx, dest, 0.01, {
        duration: 0.5,
        filterType: 'lowpass',
        freq: rand(rng, 150, 220),
        Q: 0.6,
        peak: rand(rng, 0.45, 0.55),
        attack: 0.01,
        decay: 0.45,
        rng,
      });
      noiseBurst(ctx, dest, 0.05, {
        duration: 0.95,
        filterType: 'lowpass',
        freq: rand(rng, 220, 320),
        Q: 0.6,
        peak: rand(rng, 0.26, 0.34),
        attack: 0.02,
        decay: 0.85,
        rng,
      });
    },
  },

  // hammer on an empty chamber: a small dry click
  dry: {
    seconds: 0.12,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      noiseBurst(ctx, dest, 0, {
        duration: 0.012,
        filterType: 'highpass',
        freq: 4200,
        peak: 0.3,
        attack: 0.0005,
        decay: 0.01,
      });
    },
  },

  // a magazine let go: the click of its catch, the length of it sliding down out of the well, and the well left
  // hollow behind it
  reloadOut: {
    seconds: 0.36,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(260 + take);
      clack(ctx, dest, 0, { bright: rand(rng, 3600, 4200), thump: 0, ring: rand(rng, 2500, 2900), peak: 0.42, rng });
      rub(ctx, dest, 0.02, { seconds: 0.09, freq: rand(rng, 1400, 1700), peak: 0.3, rng });
      rub(ctx, dest, 0.09, { seconds: 0.09, freq: rand(rng, 850, 1050), peak: 0.26, rng });
      tone(ctx, dest, 0.17, {
        freq: rand(rng, 220, 260),
        type: 'sine',
        attack: 0.002,
        decay: 0.035,
        release: 0.03,
        peak: 0.3,
      });
      noiseBurst(ctx, dest, 0.17, {
        duration: 0.02,
        filterType: 'lowpass',
        freq: 1100,
        peak: 0.3,
        attack: 0.001,
        decay: 0.02,
        rng,
      });
    },
  },

  // a magazine going up into the well, in the fraction of a second before it is home
  magSlide: {
    seconds: 0.16,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(270 + take);
      clack(ctx, dest, 0, { bright: 2600, thump: 0, ring: 0, peak: 0.16, rng });
      rub(ctx, dest, 0.005, { seconds: 0.075, freq: rand(rng, 1200, 1500), peak: 0.3, rng });
    },
  },

  // …and home: its catch over the notch, the whole gun knocked by it, and the catch's own second, smaller click
  reloadIn: {
    seconds: 0.3,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(280 + take);
      clack(ctx, dest, 0, {
        bright: rand(rng, 2600, 3000),
        thump: rand(rng, 130, 150),
        ring: rand(rng, 1800, 2000),
        peak: 0.44,
        rng,
      });
      clack(ctx, dest, 0.045, { bright: 3800, thump: 0, ring: 0, peak: 0.16, rng });
    },
  },

  // the bolt let go: the click of its catch, the spring throwing it forward, and it slamming home on the round
  boltRack: {
    seconds: 0.36,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(290 + take);
      clack(ctx, dest, 0, { bright: 4200, thump: 0, ring: 0, peak: 0.26, rng });
      rub(ctx, dest, 0.004, { seconds: 0.042, freq: rand(rng, 2200, 2600), peak: 0.28, rng });
      clack(ctx, dest, 0.045, {
        bright: rand(rng, 2300, 2600),
        thump: rand(rng, 105, 120),
        ring: rand(rng, 2200, 2450),
        peak: 0.5,
        rng,
      });
    },
  },

  // the pump: back — a clack — the slide's own length of friction, and forward and shut — a harder one
  shotgunPump: {
    seconds: 0.42,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(1120 + take);
      rub(ctx, dest, 0, { seconds: 0.04, freq: rand(rng, 900, 1100), peak: 0.2, rng });
      clack(ctx, dest, 0.04, {
        bright: rand(rng, 1900, 2200),
        thump: rand(rng, 115, 130),
        ring: rand(rng, 1400, 1600),
        peak: 0.44,
        rng,
      });
      rub(ctx, dest, 0.07, { seconds: 0.12, freq: rand(rng, 800, 1000), peak: 0.24, rng });
      clack(ctx, dest, 0.2, {
        bright: rand(rng, 2200, 2500),
        thump: rand(rng, 125, 140),
        ring: rand(rng, 1600, 1800),
        peak: 0.52,
        rng,
      });
    },
  },

  // one shell into the tube: its rim on the lifter, the length of it past the lips, and the latch behind it
  shellIn: {
    seconds: 0.24,
    takes: 3,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(1130 + take);
      clack(ctx, dest, 0, { bright: rand(rng, 2800, 3200), thump: 0, ring: rand(rng, 2600, 3000), peak: 0.3, rng });
      rub(ctx, dest, 0.012, { seconds: 0.05, freq: rand(rng, 1600, 2000), peak: 0.24, rng });
      clack(ctx, dest, 0.065, {
        bright: rand(rng, 3300, 3800),
        thump: rand(rng, 150, 175),
        ring: rand(rng, 2300, 2600),
        peak: 0.38,
        rng,
      });
    },
  },

  // a hand going for what is carried on the belt: webbing and cloth, twice over
  kitRustle: {
    seconds: 0.34,
    takes: 3,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(1140 + take);
      rub(ctx, dest, 0, { seconds: rand(rng, 0.11, 0.14), freq: rand(rng, 700, 950), peak: 0.3, rng });
      rub(ctx, dest, 0.1, { seconds: rand(rng, 0.12, 0.16), freq: rand(rng, 1500, 1900), peak: 0.2, rng });
      clack(ctx, dest, rand(rng, 0.19, 0.22), { bright: 3000, thump: 0, ring: 0, peak: 0.1, rng });
    },
  },

  // the fire-selector lever: one small crisp metal click
  selector: {
    seconds: 0.06,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(1140 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.008,
        filterType: 'highpass',
        freq: rand(rng, 4500, 5500),
        peak: rand(rng, 0.22, 0.28),
        attack: 0.0004,
        decay: 0.007,
        rng,
      });
    },
  },

  // changing weapon: a soft cloth-and-webbing rustle ending in a light metal settle
  weaponSwap: {
    seconds: 0.37,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(1150 + take);
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
      noiseBurst(ctx, dest, 0.3, {
        duration: 0.02,
        filterType: 'bandpass',
        freq: rand(rng, 1800, 2400),
        Q: 1.2,
        peak: rand(rng, 0.14, 0.2),
        attack: 0.001,
        decay: 0.018,
        rng,
      });
    },
  },

  // the player's soft footsteps on concrete
  stepConcrete: {
    seconds: 0.14,
    takes: 3,
    reach: REACH.footstep,
    build(ctx, dest, take) {
      const rng = makeRng(500 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.05,
        filterType: 'lowpass',
        freq: rand(rng, 650, 950),
        Q: 0.7,
        peak: rand(rng, 0.22, 0.32),
        attack: 0.003,
        decay: 0.045,
        rng,
      });
    },
  },

  // footsteps on a metal catwalk: a soft thud plus a faint ring
  stepMetal: {
    seconds: 0.16,
    takes: 3,
    reach: REACH.footstep,
    build(ctx, dest, take) {
      const rng = makeRng(510 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.03,
        filterType: 'bandpass',
        freq: rand(rng, 500, 800),
        Q: 0.8,
        peak: rand(rng, 0.2, 0.3),
        attack: 0.002,
        decay: 0.03,
      });
      tone(ctx, dest, 0.005, {
        freq: rand(rng, 1800, 2600),
        type: 'triangle',
        attack: 0.001,
        decay: 0.05,
        release: 0.03,
        peak: 0.12,
      });
    },
  },

  // footsteps on open ground: softer, duller, no ring
  stepDirt: {
    seconds: 0.14,
    takes: 3,
    reach: REACH.footstep,
    build(ctx, dest, take) {
      const rng = makeRng(520 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.07,
        filterType: 'lowpass',
        freq: rand(rng, 350, 550),
        Q: 0.6,
        peak: rand(rng, 0.18, 0.26),
        attack: 0.006,
        decay: 0.065,
        rng,
      });
    },
  },

  // a sentry robot's heavy foot: the weight of it coming down, the plate of its sole on the floor, and a breath
  // from the ram in its leg
  stepSentry: {
    seconds: 0.32,
    takes: 2,
    reach: REACH.footstep,
    build(ctx, dest, take) {
      const rng = makeRng(530 + take);
      rub(ctx, dest, 0, { seconds: 0.09, freq: rand(rng, 2200, 2800), peak: 0.1, rng });
      const down = rand(rng, 0.09, 0.11);
      thud(ctx, dest, down, { from: rand(rng, 95, 110), to: 52, seconds: 0.11, peak: 0.3 });
      clack(ctx, dest, down, {
        bright: rand(rng, 1500, 1900),
        thump: 0,
        ring: rand(rng, 760, 900),
        peak: 0.3,
        rng,
      });
    },
  },

  // a bullet into bare concrete: a dusty tick then a dull thud
  hitWall: {
    seconds: 0.2,
    takes: 2,
    reach: REACH.impact,
    build(ctx, dest, take) {
      const rng = makeRng(600 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.015,
        filterType: 'highpass',
        freq: rand(rng, 2500, 3500),
        peak: 0.3,
        attack: 0.001,
        decay: 0.014,
      });
      noiseBurst(ctx, dest, 0.01, {
        duration: 0.06,
        filterType: 'lowpass',
        freq: rand(rng, 400, 600),
        Q: 0.6,
        peak: 0.35,
        attack: 0.004,
        decay: 0.055,
      });
    },
  },

  // a bullet on bare steel: a bright ping with a short ricochet whine falling away
  hitMetal: {
    seconds: 0.35,
    takes: 2,
    reach: REACH.impact,
    build(ctx, dest, take) {
      const rng = makeRng(610 + take);
      tone(ctx, dest, 0, {
        freq: rand(rng, 2200, 3200),
        type: 'triangle',
        attack: 0.001,
        decay: 0.08,
        release: 0.1,
        peak: 0.45,
      });
      sweep(ctx, dest, 0.015, {
        from: rand(rng, 3000, 3800),
        to: rand(rng, 1200, 1600),
        duration: 0.2,
        type: 'sine',
        curve: 'exp',
        attack: 0.004,
        release: 0.08,
        peak: 0.25,
      });
    },
  },

  // a bullet into a robot's shell: plate struck hard — it rings, but as struck plate does, not as a note — and
  // a crackle of sparks off it
  hitMachine: {
    seconds: 0.3,
    takes: 2,
    reach: REACH.impact,
    build(ctx, dest, take) {
      const rng = makeRng(620 + take);
      clack(ctx, dest, 0, {
        bright: rand(rng, 2400, 3000),
        thump: rand(rng, 170, 210),
        ring: rand(rng, 1250, 1500),
        peak: 0.36,
        rng,
      });
      for (let i = 0; i < 4; i++)
        noiseBurst(ctx, dest, 0.02 + rand(rng, 0, 0.09), {
          duration: 0.012,
          filterType: 'highpass',
          freq: rand(rng, 3000, 5000),
          peak: rand(rng, 0.12, 0.26),
          attack: 0.0006,
          decay: 0.011,
          rng,
        });
    },
  },

  // a hit registered (told to the player, not a sound of the world): one small dull knock
  hitMarker: {
    seconds: 0.08,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(631);
      noiseBurst(ctx, dest, 0, {
        duration: 0.014,
        filterType: 'bandpass',
        freq: 1300,
        Q: 0.6,
        peak: 0.34,
        attack: 0.0006,
        decay: 0.013,
        rng,
      });
      thud(ctx, dest, 0, { from: 230, to: 150, seconds: 0.025, peak: 0.22 });
    },
  },

  // a kill landed: a knock and, under it, something heavy set down
  killConfirm: {
    seconds: 0.36,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(641);
      clack(ctx, dest, 0, { bright: 1900, thump: 0, ring: 0, peak: 0.24, rng });
      thud(ctx, dest, 0.07, { from: 105, to: 48, seconds: 0.16, peak: 0.38 });
      noiseBurst(ctx, dest, 0.07, {
        duration: 0.06,
        filterType: 'lowpass',
        freq: 380,
        Q: 0.6,
        peak: 0.22,
        attack: 0.004,
        decay: 0.055,
        rng,
      });
    },
  },

  // the player is hit: a blow to the body, and the breath it knocks out
  hurt: {
    seconds: 0.4,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(651);
      thud(ctx, dest, 0, { from: 120, to: 58, seconds: 0.14, peak: 0.6 });
      noiseBurst(ctx, dest, 0, {
        duration: 0.05,
        filterType: 'bandpass',
        freq: 700,
        Q: 0.6,
        peak: 0.38,
        attack: 0.001,
        decay: 0.048,
        rng,
      });
      noiseBurst(ctx, dest, 0.03, {
        duration: 0.2,
        filterType: 'bandpass',
        freq: 1700,
        Q: 0.5,
        peak: 0.1,
        attack: 0.04,
        decay: 0.16,
        rng,
      });
    },
  },

  // a sentry that has noticed something and is not yet sure: two short low growls, the second asking
  sentrySuspicious: {
    seconds: 0.36,
    takes: 1,
    reach: REACH.machineVoice,
    build(ctx, dest) {
      const rng = makeRng(661);
      growl(ctx, dest, 0, { from: 92, to: 98, seconds: 0.08, throat: 760, rough: 47, peak: 0.8, rng });
      growl(ctx, dest, 0.13, { from: 100, to: 124, seconds: 0.13, throat: 900, rough: 47, peak: 0.9, rng });
    },
  },

  // "target acquired": its gun comes up, and one hard low blare
  sentryAlert: {
    seconds: 0.55,
    takes: 1,
    reach: REACH.machineVoice,
    build(ctx, dest) {
      const rng = makeRng(671);
      clack(ctx, dest, 0, { bright: 2600, thump: 110, ring: 1700, peak: 0.3, rng });
      growl(ctx, dest, 0.05, { from: 150, to: 104, seconds: 0.36, throat: 980, rough: 58, peak: 0.95, rng });
    },
  },

  // a sentry giving up the search: one growl, going down and out
  sentryLost: {
    seconds: 0.5,
    takes: 1,
    reach: REACH.machineVoice,
    build(ctx, dest) {
      const rng = makeRng(681);
      growl(ctx, dest, 0, { from: 104, to: 62, seconds: 0.36, throat: 640, rough: 31, peak: 0.75, rng });
    },
  },

  // a sentry shut down: what turns in it runs down, its voice goes with it, and it falls
  sentryDown: {
    seconds: 1.05,
    takes: 1,
    reach: REACH.machineVoice,
    build(ctx, dest) {
      const rng = makeRng(691);
      runDown(ctx, dest, 0, { from: 1900, to: 240, seconds: 0.62, flutter: 70, peak: 0.36, rng });
      growl(ctx, dest, 0.02, { from: 120, to: 38, seconds: 0.55, throat: 700, rough: 36, peak: 0.8, rng });
      thud(ctx, dest, 0.68, { from: 88, to: 40, seconds: 0.2, peak: 0.48 });
      clack(ctx, dest, 0.68, { bright: 1400, thump: 0, ring: 620, peak: 0.42, rng });
      noiseBurst(ctx, dest, 0.7, {
        duration: 0.16,
        filterType: 'lowpass',
        freq: 520,
        Q: 0.6,
        peak: 0.3,
        attack: 0.004,
        decay: 0.15,
        rng,
      });
    },
  },

  // a drone shut down: its rotors run down, a scatter of crackle, then it hits the ground
  droneDown: {
    seconds: 1.2,
    takes: 1,
    reach: REACH.machineVoice,
    build(ctx, dest) {
      const rng = makeRng(741);
      runDown(ctx, dest, 0, { from: 3000, to: 320, seconds: 0.72, flutter: 110, peak: 0.6, rng });
      runDown(ctx, dest, 0.03, { from: 900, to: 150, seconds: 0.66, flutter: 110, peak: 0.4, rng });
      for (let i = 0; i < 6; i++) {
        noiseBurst(ctx, dest, rand(rng, 0.2, 0.75), {
          duration: 0.015,
          filterType: 'highpass',
          freq: rand(rng, 3000, 5000),
          peak: rand(rng, 0.15, 0.3),
          attack: 0.001,
          decay: 0.012,
          rng,
        });
      }
      thud(ctx, dest, 0.85, { from: 96, to: 46, seconds: 0.16, peak: 0.5 });
      noiseBurst(ctx, dest, 0.85, {
        duration: 0.18,
        filterType: 'lowpass',
        freq: 480,
        Q: 0.6,
        peak: 0.5,
        attack: 0.004,
        decay: 0.17,
        rng,
      });
    },
  },

  // close-quarters shutdown of a robot from behind: a thud, an electric discharge, and it runs down
  takedown: {
    seconds: 0.8,
    takes: 1,
    reach: REACH.machineVoice,
    build(ctx, dest) {
      const rng = makeRng(751);
      thud(ctx, dest, 0, { from: 130, to: 60, seconds: 0.09, peak: 0.5 });
      noiseBurst(ctx, dest, 0, {
        duration: 0.05,
        filterType: 'lowpass',
        freq: 500,
        Q: 0.6,
        peak: 0.5,
        attack: 0.002,
        decay: 0.045,
        rng,
      });
      for (let i = 0; i < 5; i++) {
        noiseBurst(ctx, dest, 0.05 + i * 0.02, {
          duration: 0.012,
          filterType: 'bandpass',
          freq: rand(rng, 2000, 5000),
          Q: 1,
          peak: rand(rng, 0.2, 0.4),
          attack: 0.0005,
          decay: 0.01,
          rng,
        });
      }
      runDown(ctx, dest, 0.2, { from: 1500, to: 220, seconds: 0.45, flutter: 60, peak: 0.36, rng });
      growl(ctx, dest, 0.2, { from: 110, to: 40, seconds: 0.42, throat: 640, rough: 33, peak: 0.6, rng });
    },
  },

  // a guard machine's systems dropping out under the pulse: its voice stuttering down, then a relay clack
  machineStun: {
    seconds: 0.55,
    takes: 2,
    reach: REACH.machineVoice,
    build(ctx, dest, take) {
      const rng = makeRng(1210 + take);
      const start = rand(rng, 150, 175);
      for (let i = 0; i < 6; i++) {
        const from = start * Math.pow(0.86, i);
        growl(ctx, dest, i * 0.058, {
          from,
          to: from * 0.9,
          seconds: 0.034,
          throat: 1100 * Math.pow(0.9, i),
          rough: 70,
          peak: rand(rng, 0.42, 0.6),
          rng,
        });
      }
      clack(ctx, dest, 0.42, { bright: rand(rng, 2000, 2600), thump: 120, ring: 0, peak: rand(rng, 0.3, 0.36), rng });
    },
  },

  // the knife cutting air: a short breath of noise that rises and is gone
  knifeSwing: {
    seconds: 0.3,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(770 + take);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.3, rng);
      const band = filterNode(ctx, 'bandpass', 700, 1.4);
      band.frequency.setValueAtTime(rand(rng, 600, 800), 0);
      band.frequency.exponentialRampToValueAtTime(rand(rng, 2600, 3400), 0.13);
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(band).connect(g).connect(dest);
      const end = perc(g.gain, 0, { attack: 0.05, decay: 0.12, peak: 0.5 });
      src.start(0);
      src.stop(end + 0.02);
    },
  },

  // the knife into a machine: steel scraping steel, a dull knock, a small ring
  knifeHit: {
    seconds: 0.32,
    takes: 2,
    reach: REACH.impact,
    build(ctx, dest, take) {
      const rng = makeRng(780 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.06,
        filterType: 'bandpass',
        freq: rand(rng, 2600, 3600),
        Q: 3,
        peak: 0.5,
        attack: 0.001,
        decay: 0.055,
        rng,
      });
      tone(ctx, dest, 0, {
        freq: rand(rng, 150, 190),
        type: 'sine',
        attack: 0.002,
        decay: 0.07,
        release: 0.05,
        peak: 0.5,
      });
      fmPing(ctx, dest, 0.01, {
        carrier: rand(rng, 1700, 2300),
        modRatio: 2.7,
        modIndex: 500,
        duration: 0.12,
        attack: 0.001,
        release: 0.1,
        peak: 0.25,
      });
    },
  },

  // water falling from the cavern's roof: a plip, and the cavern giving it back twice, each time fainter
  drip: {
    seconds: 0.95,
    takes: 3,
    reach: 24,
    build(ctx, dest, take) {
      const rng = makeRng(790 + take);
      const from = rand(rng, 1300, 1900);
      for (const [at, level, pitch] of [
        [0, 0.5, 1],
        [0.21, 0.16, 0.93],
        [0.47, 0.07, 0.88],
      ]) {
        sweep(ctx, dest, at, {
          from: from * pitch,
          to: from * pitch * 0.5,
          duration: 0.045,
          attack: 0.002,
          release: 0.06,
          peak: level,
        });
        noiseBurst(ctx, dest, at, {
          duration: 0.012,
          filterType: 'bandpass',
          freq: 3200,
          Q: 2,
          peak: level * 0.35,
          attack: 0.001,
          decay: 0.01,
          rng,
        });
      }
    },
  },

  // a pneumatic door sliding open: a hiss that swells, then a thunk as it reaches its stop
  doorOpen: {
    seconds: 0.9,
    takes: 1,
    reach: REACH.door,
    build(ctx, dest) {
      noiseBurst(ctx, dest, 0, {
        duration: 0.5,
        filterType: 'bandpass',
        freq: 2200,
        Q: 0.5,
        peak: 0.3,
        attack: 0.05,
        decay: 0.45,
      });
      noiseBurst(ctx, dest, 0.55, {
        duration: 0.08,
        filterType: 'lowpass',
        freq: 400,
        Q: 0.6,
        peak: 0.45,
        attack: 0.004,
        decay: 0.07,
      });
    },
  },

  // the same door sliding shut: a shorter hiss, a heavier thunk sealing it
  doorClose: {
    seconds: 0.8,
    takes: 1,
    reach: REACH.door,
    build(ctx, dest) {
      noiseBurst(ctx, dest, 0, {
        duration: 0.35,
        filterType: 'bandpass',
        freq: 2000,
        Q: 0.5,
        peak: 0.28,
        attack: 0.03,
        decay: 0.32,
      });
      noiseBurst(ctx, dest, 0.38, {
        duration: 0.09,
        filterType: 'lowpass',
        freq: 350,
        Q: 0.6,
        peak: 0.55,
        attack: 0.003,
        decay: 0.08,
      });
    },
  },

  // the charge's keypad, while a charge is being set: a key going down, and the small dull tone a device answers
  // with (it is a device, and devices beep: but quietly, and not as a toy does)
  chargeBeep: {
    seconds: 0.12,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(1061);
      clack(ctx, dest, 0, { bright: 2800, thump: 0, ring: 0, peak: 0.14, rng });
      tone(ctx, dest, 0.006, { freq: 1240, type: 'sine', attack: 0.003, decay: 0.04, release: 0.03, peak: 0.13 });
    },
  },

  // the charge is armed: its latch goes over, and one level tone says so
  chargeArmed: {
    seconds: 0.55,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(1071);
      clack(ctx, dest, 0, { bright: 2500, thump: 135, ring: 1850, peak: 0.36, rng });
      tone(ctx, dest, 0.15, {
        freq: 620,
        type: 'sine',
        attack: 0.006,
        decay: 0.05,
        sustain: 0.8,
        hold: 0.16,
        release: 0.08,
        peak: 0.17,
      });
    },
  },

  // pulling the pin: a bright metallic ping as the spring lever lets go, then a lighter tink as it flips free
  grenadePin: {
    seconds: 0.3,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(1160 + take);
      fmPing(ctx, dest, 0, {
        carrier: rand(rng, 1800, 2200),
        modRatio: 2.0,
        modIndex: 350,
        duration: 0.08,
        attack: 0.001,
        release: 0.07,
        peak: rand(rng, 0.35, 0.42),
      });
      noiseBurst(ctx, dest, 0.09, {
        duration: 0.015,
        filterType: 'bandpass',
        freq: rand(rng, 2800, 3400),
        Q: 2,
        peak: rand(rng, 0.18, 0.24),
        attack: 0.0008,
        decay: 0.013,
        rng,
      });
      tone(ctx, dest, 0.09, {
        freq: rand(rng, 2600, 3000),
        type: 'triangle',
        attack: 0.001,
        decay: 0.05,
        release: 0.09,
        peak: rand(rng, 0.22, 0.28),
      });
    },
  },

  // a quick cloth whoosh of the arm
  grenadeThrow: {
    seconds: 0.22,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(1170 + take);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.2, rng);
      const band = filterNode(ctx, 'bandpass', 500, 1.2);
      band.frequency.setValueAtTime(rand(rng, 400, 600), 0);
      band.frequency.exponentialRampToValueAtTime(rand(rng, 1800, 2400), 0.11);
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(band).connect(g).connect(dest);
      const end = perc(g.gain, 0, { attack: 0.04, decay: 0.1, peak: rand(rng, 0.3, 0.38) });
      src.start(0);
      src.stop(end + 0.02);
    },
  },

  // a small heavy canister hitting concrete: a dull knock with a short ring of metal
  grenadeBounce: {
    seconds: 0.3,
    takes: 3,
    reach: REACH.impact,
    build(ctx, dest, take) {
      const rng = makeRng(1180 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.04,
        filterType: 'lowpass',
        freq: rand(rng, 350, 500),
        Q: 0.6,
        peak: rand(rng, 0.45, 0.55),
        attack: 0.002,
        decay: 0.035,
        rng,
      });
      tone(ctx, dest, 0, {
        freq: rand(rng, 900, 1300),
        type: 'triangle',
        attack: 0.002,
        decay: 0.09,
        release: 0.08,
        peak: rand(rng, 0.18, 0.24),
      });
    },
  },

  // an EMP burst: a very fast rising whine that snaps into a wide crackling electrical burst over a low thud,
  // then fizzes away into dying static — electrical, not an explosion of fire
  empBurst: {
    seconds: 1.2,
    takes: 2,
    reach: REACH.emp,
    build(ctx, dest, take) {
      const rng = makeRng(1190 + take);
      sweep(ctx, dest, 0, {
        from: rand(rng, 300, 500),
        to: rand(rng, 2600, 3400),
        duration: 0.12,
        type: 'sawtooth',
        curve: 'exp',
        attack: 0.01,
        release: 0.02,
        peak: rand(rng, 0.35, 0.42),
      });
      for (let i = 0; i < 14; i++) {
        noiseBurst(ctx, dest, rand(rng, 0.11, 0.5), {
          duration: rand(rng, 0.008, 0.02),
          filterType: 'highpass',
          freq: rand(rng, 3000, 6000),
          peak: rand(rng, 0.15, 0.35),
          attack: 0.001,
          decay: rand(rng, 0.007, 0.018),
          rng,
        });
      }
      tone(ctx, dest, 0.12, {
        freq: rand(rng, 55, 75),
        type: 'sine',
        attack: 0.005,
        decay: 0.18,
        release: 0.15,
        peak: rand(rng, 0.35, 0.42),
      });
      noiseBurst(ctx, dest, 0.15, {
        duration: 0.9,
        filterType: 'highpass',
        freq: rand(rng, 2200, 3000),
        Q: 0.5,
        peak: rand(rng, 0.25, 0.32),
        attack: 0.02,
        decay: 0.85,
        rng,
      });
    },
  },

  // a hand-held firing device squeezed: two quick firm plastic-and-steel clacks
  detonator: {
    seconds: 0.22,
    takes: 2,
    reach: REACH.default,
    build(ctx, dest, take) {
      const rng = makeRng(1200 + take);
      for (const at of [0, 0.09]) {
        noiseBurst(ctx, dest, at, {
          duration: 0.016,
          filterType: 'bandpass',
          freq: rand(rng, 1700, 2200),
          Q: 1.3,
          peak: rand(rng, 0.4, 0.48),
          attack: 0.0007,
          decay: 0.014,
          rng,
        });
        noiseBurst(ctx, dest, at, {
          duration: 0.02,
          filterType: 'lowpass',
          freq: rand(rng, 500, 700),
          Q: 0.6,
          peak: rand(rng, 0.14, 0.2),
          attack: 0.001,
          decay: 0.018,
          rng,
        });
      }
    },
  },

  // the homing beacon unfolding: a few mechanical clicks, then a power-up sweep
  beaconDeploy: {
    seconds: 1.6,
    takes: 1,
    reach: REACH.beacon,
    build(ctx, dest) {
      const rng = makeRng(841);
      for (let i = 0; i < 4; i++) {
        noiseBurst(ctx, dest, i * 0.11, {
          duration: 0.015,
          filterType: 'bandpass',
          freq: rand(rng, 1800, 2600),
          Q: 1.5,
          peak: 0.35,
          attack: 0.001,
          decay: 0.013,
        });
      }
      sweep(ctx, dest, 0.5, {
        from: 150,
        to: 900,
        duration: 0.85,
        type: 'sine',
        curve: 'exp',
        attack: 0.05,
        release: 0.15,
        peak: 0.5,
      });
    },
  },

  // the beacon's steady sonar-like ping, once it is standing (repeated every 2 s by the caller)
  beaconPing: {
    seconds: 2.0,
    takes: 1,
    reach: REACH.beacon,
    build(ctx, dest) {
      fmPing(ctx, dest, 0, {
        carrier: 1200,
        modRatio: 2.01,
        modIndex: 400,
        duration: 0.3,
        attack: 0.002,
        release: 1.4,
        peak: 0.5,
      });
    },
  },

  // an objective completed: one low struck note and the fifth over it, left to die away
  objective: {
    seconds: 1.3,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(1301);
      noiseBurst(ctx, dest, 0, {
        duration: 0.03,
        filterType: 'lowpass',
        freq: 700,
        Q: 0.6,
        peak: 0.16,
        attack: 0.002,
        decay: 0.028,
        rng,
      });
      tone(ctx, dest, 0, {
        freq: 146.83,
        type: 'sine',
        attack: 0.004,
        decay: 0.2,
        sustain: 0.35,
        release: 1.0,
        peak: 0.32,
      });
      tone(ctx, dest, 0, {
        freq: 220,
        type: 'sine',
        attack: 0.004,
        decay: 0.2,
        sustain: 0.3,
        release: 0.8,
        peak: 0.15,
      });
      tone(ctx, dest, 0, { freq: 293.66, type: 'triangle', attack: 0.004, decay: 0.2, release: 0.2, peak: 0.05 });
    },
  },

  // the squelch that opens a line of radio chatter: the carrier coming up, and the key's click
  radio: {
    seconds: 0.25,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(1311);
      noiseBurst(ctx, dest, 0, {
        duration: 0.07,
        filterType: 'bandpass',
        freq: 1800,
        Q: 0.6,
        peak: 0.3,
        attack: 0.002,
        decay: 0.065,
        rng,
      });
      clack(ctx, dest, 0.085, { bright: 2400, thump: 0, ring: 0, peak: 0.16, rng });
    },
  },

  // menu navigation: a small dry tick
  uiMove: {
    seconds: 0.08,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(1321);
      clack(ctx, dest, 0, { bright: 2200, thump: 0, ring: 0, peak: 0.2, rng });
    },
  },

  // a menu choice confirmed: a switch thrown — a click with a body under it
  uiSelect: {
    seconds: 0.14,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(1331);
      clack(ctx, dest, 0, { bright: 2000, thump: 150, ring: 0, peak: 0.22, rng });
      clack(ctx, dest, 0.04, { bright: 3000, thump: 0, ring: 0, peak: 0.1, rng });
    },
  },

  // leaving a menu: the same switch, back — lower and softer
  uiBack: {
    seconds: 0.12,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(1341);
      clack(ctx, dest, 0, { bright: 1400, thump: 110, ring: 0, peak: 0.26, rng });
    },
  },

  // night-vision goggles powering up: a rising whine, then a click as they engage
  nvOn: {
    seconds: 0.35,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      sweep(ctx, dest, 0, {
        from: 300,
        to: 1400,
        duration: 0.22,
        type: 'sine',
        curve: 'exp',
        attack: 0.01,
        release: 0.05,
        peak: 0.3,
      });
      noiseBurst(ctx, dest, 0.24, {
        duration: 0.012,
        filterType: 'highpass',
        freq: 4000,
        peak: 0.25,
        attack: 0.001,
        decay: 0.01,
      });
    },
  },

  // night-vision goggles powering down: a click, then a falling whine
  nvOff: {
    seconds: 0.3,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      noiseBurst(ctx, dest, 0, {
        duration: 0.01,
        filterType: 'highpass',
        freq: 4000,
        peak: 0.2,
        attack: 0.001,
        decay: 0.009,
      });
      sweep(ctx, dest, 0.015, {
        from: 1400,
        to: 250,
        duration: 0.2,
        type: 'sine',
        curve: 'exp',
        attack: 0.005,
        release: 0.06,
        peak: 0.28,
      });
    },
  },

  // a round through a lamp: the glass goes with a crack, the tube with a small flat pop, and the bits come down
  lampBreak: {
    seconds: 0.7,
    takes: 3,
    reach: REACH.impact,
    build(ctx, dest, take) {
      const rng = makeRng(1420 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.035,
        filterType: 'highpass',
        freq: rand(rng, 3800, 5200),
        peak: 0.7,
        attack: 0.0005,
        decay: 0.03,
        rng,
      });
      tone(ctx, dest, 0.004, {
        freq: rand(rng, 120, 160),
        type: 'sine',
        attack: 0.001,
        decay: 0.05,
        release: 0.03,
        peak: 0.4,
      });
      // the pieces: six or seven thin, short, high notes, each quieter than the last
      for (let k = 0, at = 0.03; k < 7; k++, at += rand(rng, 0.03, 0.085))
        tone(ctx, dest, at, {
          freq: rand(rng, 3400, 7200),
          type: 'sine',
          attack: 0.001,
          decay: rand(rng, 0.02, 0.05),
          release: 0.03,
          peak: 0.2 * (1 - k / 9),
        });
    },
  },

  // the lamps of a room going out together: the breaker drops — a heavy clack — and what was running runs down
  lightsOut: {
    seconds: 0.9,
    takes: 1,
    reach: REACH.breaker,
    build(ctx, dest) {
      noiseBurst(ctx, dest, 0, {
        duration: 0.03,
        filterType: 'bandpass',
        freq: 1700,
        Q: 1.4,
        peak: 0.7,
        attack: 0.0005,
        decay: 0.028,
      });
      tone(ctx, dest, 0, { freq: 74, type: 'sine', attack: 0.002, decay: 0.12, release: 0.08, peak: 0.6 });
      sweep(ctx, dest, 0.03, {
        from: 420,
        to: 46,
        duration: 0.6,
        type: 'triangle',
        curve: 'exp',
        attack: 0.02,
        release: 0.12,
        peak: 0.2,
      });
    },
  },

  // …and coming back: the breaker thrown in again, and the tubes catching one after another
  lightsOn: {
    seconds: 0.8,
    takes: 1,
    reach: REACH.breaker,
    build(ctx, dest) {
      const rng = makeRng(1440);
      noiseBurst(ctx, dest, 0, {
        duration: 0.03,
        filterType: 'bandpass',
        freq: 1500,
        Q: 1.4,
        peak: 0.65,
        attack: 0.0005,
        decay: 0.028,
      });
      tone(ctx, dest, 0, { freq: 92, type: 'sine', attack: 0.002, decay: 0.09, release: 0.06, peak: 0.5 });
      for (let k = 0, at = 0.09; k < 5; k++, at += rand(rng, 0.05, 0.13)) {
        noiseBurst(ctx, dest, at, {
          duration: 0.012,
          filterType: 'highpass',
          freq: rand(rng, 4200, 6000),
          peak: 0.22,
          attack: 0.0005,
          decay: 0.011,
          rng,
        });
        tone(ctx, dest, at, {
          freq: rand(rng, 1900, 2600),
          type: 'sine',
          attack: 0.001,
          decay: 0.03,
          release: 0.03,
          peak: 0.1,
        });
      }
    },
  },

  // one tick of the countdown clock
  tick: {
    seconds: 0.06,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      noiseBurst(ctx, dest, 0, {
        duration: 0.008,
        filterType: 'highpass',
        freq: 3500,
        peak: 0.25,
        attack: 0.0005,
        decay: 0.007,
      });
    },
  },

  // the instant the site alarm trips: a door slammed somewhere under the mountain, and a low blare with a second
  // one a semitone off it grinding against it
  alarmHit: {
    seconds: 1.1,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(1541);
      clack(ctx, dest, 0, { bright: 1500, thump: 0, ring: 0, peak: 0.5, rng });
      thud(ctx, dest, 0, { from: 96, to: 38, seconds: 0.4, peak: 0.6 });
      const blare = ctx.createGain();
      blare.gain.value = 0;
      const low = filterNode(ctx, 'lowpass', 900, 0.7);
      for (const freq of [110, 116.54]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.connect(low);
        osc.start(0);
        osc.stop(1.05);
      }
      low.connect(blare).connect(dest);
      env(blare.gain, 0.01, { attack: 0.03, decay: 0.25, sustain: 0.5, hold: 0.2, release: 0.45, peak: 0.2 });
      room(ctx, dest, 0, { seconds: 0.6, freq: 600, peak: 0.16, slap: 0.09, rng });
    },
  },

  // a demolition charge going off: a sharp crack, a deep boom, then debris rattling down
  explosion: {
    seconds: 2.6,
    takes: 2,
    reach: REACH.explosion,
    build(ctx, dest, take) {
      const rng = makeRng(1000 + take);
      noiseBurst(ctx, dest, 0, {
        duration: 0.03,
        filterType: 'highpass',
        freq: rand(rng, 1800, 2600),
        peak: 0.9,
        attack: 0.001,
        decay: 0.028,
      });
      noiseBurst(ctx, dest, 0, {
        duration: 1.1,
        filterType: 'lowpass',
        freq: rand(rng, 120, 200),
        Q: 0.7,
        peak: 0.95,
        attack: 0.01,
        decay: 1.0,
      });
      tone(ctx, dest, 0, { freq: rand(rng, 40, 55), type: 'sine', attack: 0.005, decay: 0.8, release: 0.6, peak: 0.8 });
      // debris rattle: a scatter of small, randomly pitched ticks settling over the next couple of seconds
      for (let i = 0; i < 24; i++) {
        noiseBurst(ctx, dest, rand(rng, 0.15, 2.1), {
          duration: rand(rng, 0.01, 0.05),
          filterType: 'bandpass',
          freq: rand(rng, 400, 2500),
          Q: rand(rng, 0.6, 1.4),
          peak: rand(rng, 0.08, 0.3),
          attack: 0.001,
          decay: rand(rng, 0.01, 0.045),
          rng,
        });
      }
    },
  },

  // demolition charges along the cascade hall's rows, heard from its doorway: a chain of heavy blasts, then
  // metal tearing and hundreds of light centrifuges failing — shrieks falling in pitch, clatter, ringing
  // debris — under a long dark hall tail. The biggest sound in the game.
  cascadeBlast: {
    seconds: 5.6,
    takes: 2,
    channels: 2,
    reach: REACH.cascadeBlast,
    build(ctx, dest, take) {
      const rng = makeRng(1300 + take);
      // four charges, one to a cascade, each at the moment the picture fires it (world/blast.js)
      const blasts = 4;
      let t = BLAST.first;
      for (let i = 0; i < blasts; i++) {
        const pan = panner(ctx, rand(rng, -0.4, 0.4));
        const bus = pan || dest;
        if (pan) pan.connect(dest);
        noiseBurst(ctx, bus, t, {
          duration: 0.025,
          filterType: 'highpass',
          freq: rand(rng, 1800, 2600),
          peak: rand(rng, 0.62, 0.76),
          attack: 0.0006,
          decay: 0.022,
          rng,
        });
        noiseBurst(ctx, bus, t, {
          duration: 0.05,
          filterType: 'bandpass',
          freq: rand(rng, 900, 1500),
          Q: 0.85,
          peak: rand(rng, 0.95, 1.08),
          attack: 0.001,
          decay: 0.045,
          rng,
        });
        noiseBurst(ctx, bus, t, {
          duration: 0.3,
          filterType: 'lowpass',
          freq: rand(rng, 120, 180),
          Q: 0.7,
          peak: rand(rng, 0.58, 0.72),
          attack: 0.008,
          decay: 0.26,
          rng,
        });
        tone(ctx, bus, t, {
          freq: rand(rng, 38, 52),
          type: 'sine',
          attack: 0.004,
          decay: 0.22,
          release: 0.15,
          peak: rand(rng, 0.85, 1.0),
        });
        t += BLAST.gap;
      }
      // metal tearing: a harsh band sweeping downward through the first couple of seconds
      for (let i = 0; i < 3; i++) {
        const at = rand(rng, 0.3, 2.0);
        const pan = panner(ctx, rand(rng, -0.5, 0.5));
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx, 0.3, rng);
        const band = filterNode(ctx, 'bandpass', 2600, 2.2);
        band.frequency.setValueAtTime(rand(rng, 2400, 3200), at);
        band.frequency.exponentialRampToValueAtTime(rand(rng, 600, 1000), at + 0.22);
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(band).connect(g);
        if (pan) g.connect(pan).connect(dest);
        else g.connect(dest);
        const end = perc(g.gain, at, { attack: 0.02, decay: 0.2, peak: rand(rng, 0.2, 0.3) });
        src.start(at);
        src.stop(end + 0.02);
      }
      // many light metal cylinders failing: shrieks falling in pitch, clatter, and ringing debris, scattered
      // through the hall over the next few seconds
      for (let i = 0; i < 12; i++) {
        const at = rand(rng, 0.4, 4.2);
        const pan = panner(ctx, rand(rng, -0.6, 0.6));
        const bus = pan || dest;
        if (pan) pan.connect(dest);
        sweep(ctx, bus, at, {
          from: rand(rng, 1800, 3200),
          to: rand(rng, 400, 900),
          duration: rand(rng, 0.15, 0.4),
          type: 'sawtooth',
          curve: 'exp',
          attack: rand(rng, 0.005, 0.02),
          release: rand(rng, 0.08, 0.2),
          peak: rand(rng, 0.18, 0.36),
        });
        if (rng() > 0.4) {
          noiseBurst(ctx, bus, at + rand(rng, 0, 0.05), {
            duration: rand(rng, 0.01, 0.03),
            filterType: 'bandpass',
            freq: rand(rng, 1500, 3000),
            Q: 1.2,
            peak: rand(rng, 0.16, 0.3),
            attack: 0.001,
            decay: rand(rng, 0.01, 0.025),
            rng,
          });
        }
        if (rng() > 0.5) {
          tone(ctx, bus, at + rand(rng, 0.02, 0.08), {
            freq: rand(rng, 1800, 3000),
            type: 'triangle',
            attack: 0.001,
            decay: 0.1,
            release: 0.12,
            peak: rand(rng, 0.12, 0.22),
          });
        }
      }
      // the long dark hall tail
      noiseBurst(ctx, dest, 0.1, {
        duration: 4.9,
        filterType: 'lowpass',
        freq: rand(rng, 160, 240),
        Q: 0.6,
        peak: 0.82,
        attack: 0.03,
        decay: 4.75,
        rng,
      });
    },
  },

  // the strike weapon falling: a descending roar and whistle, a rumble building beneath it, cut off abruptly
  incoming: {
    seconds: 3.0,
    takes: 1,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(1010);
      sweep(ctx, dest, 0, {
        from: 2200,
        to: 300,
        duration: 2.6,
        type: 'sawtooth',
        curve: 'exp',
        attack: 0.3,
        release: 0.05,
        peak: 0.5,
      });
      // a rumble that grows underneath as the weapon nears, stopping sharply rather than fading out
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 2.75, rng);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(0.7, 2.55);
      g.gain.linearRampToValueAtTime(0, 2.6);
      src
        .connect(filterNode(ctx, 'lowpass', 220, 0.7))
        .connect(g)
        .connect(dest);
      src.start(0);
      src.stop(2.62);
    },
  },

  // the Hammerfall impact: a sub-bass drop, a long rolling rumble, tearing air — the biggest sound in the game
  strike: {
    seconds: 7.2,
    takes: 1,
    channels: 2,
    reach: REACH.default,
    build(ctx, dest) {
      const rng = makeRng(1020);
      sweep(ctx, dest, 0, {
        from: 200,
        to: 32,
        duration: 0.5,
        type: 'sine',
        curve: 'exp',
        attack: 0.002,
        release: 0.3,
        peak: 0.95,
      });
      tone(ctx, dest, 0.4, {
        freq: 34,
        type: 'sine',
        attack: 0.05,
        decay: 3.5,
        sustain: 0.25,
        hold: 1.0,
        release: 2.0,
        peak: 0.9,
      });
      // the long rolling rumble, spread across both channels with independent noise for width
      const chain = (seed, pan, peak1, peak2) => {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx, 7.0, makeRng(seed));
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, 0);
        g.gain.exponentialRampToValueAtTime(peak1, 0.6);
        g.gain.setTargetAtTime(peak2, 1.2, 1.4);
        g.gain.linearRampToValueAtTime(0, 6.9);
        const p = panner(ctx, pan);
        src.connect(filterNode(ctx, 'lowpass', 180, 0.8)).connect(g);
        if (p) g.connect(p).connect(dest);
        else g.connect(dest);
        src.start(0);
        src.stop(7.0);
      };
      chain(1021, -0.3, 0.75, 0.4);
      chain(1022, 0.3, 0.7, 0.38);
      // tearing air: bright crackle riding over the first couple of seconds as the weapon passes overhead
      for (let i = 0; i < 10; i++) {
        noiseBurst(ctx, dest, rand(rng, 0.3, 2.2), {
          duration: rand(rng, 0.05, 0.2),
          filterType: 'highpass',
          freq: rand(rng, 2500, 5000),
          peak: rand(rng, 0.2, 0.5),
          attack: 0.005,
          decay: rand(rng, 0.04, 0.18),
          rng,
        });
      }
    },
  },
};

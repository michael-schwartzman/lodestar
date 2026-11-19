// The score, played: src/audio/score.js says what starts on each sixteenth of each scene; this turns each of
// those into a few short-lived Web Audio nodes against the real AudioContext, a little ahead of time (a
// look-ahead step sequencer). audio.js owns one instance and drives it from update(dt) every frame.
//
// Nothing here is held. `air` is the only thing that sounds all the time, and it is a breath of noise, not a
// note. Every note of the score is struck — a felted piano, a plucked bass, short bowed strings, drums — and is
// gone inside score.js's MAX_NOTE; the room it is played in (a second and a half of generated echo) is what
// makes them sit behind the game instead of on top of it. See test/smoke.test.mjs: "a hush, a beat and a tune:
// never a hum".
import { sweep, noiseBurst, fmPing, noiseBuffer, rand, makeRng } from './synth.js';
import { scoreAt, stepSeconds } from './score.js';

const PARTS = ['keys', 'bass', 'strings', 'drums', 'pulse'];
/**
 * How loud each part of the score is against the others — and against the game: it is BACKGROUND. Measured, a
 * quiet site's tune is about a fifth as loud as one round from the carbine, and a fight's about a quarter.
 */
const MIX = { keys: 0.12, bass: 0.16, strings: 0.08, drums: 0.26, pulse: 0.34 };
/** how much of each part goes into the room as well */
const WET = { keys: 0.5, bass: 0, strings: 0.35, drums: 0.12, pulse: 0 };
/** the breath of noise under a scene, and the rare far-off ring of metal: how loud in each scene */
const AIR = { none: 0, calm: 0, tense: 0.5, combat: 0.2, exfil: 0.15 };
const METAL = { none: 0, calm: 0.5, tense: 0.4, combat: 0, exfil: 0 };

const LOOKAHEAD = 0.15; // how far ahead update(dt) schedules step-sequencer hits
const RAMP = 0.3; // setTargetAtTime time constant; ~5x this is a full crossfade, matching the ~1.5 s brief
const hertz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** Builds the generative music engine. Call `start` once a real AudioContext exists, then drive it per frame. */
export function createMusic() {
  let ctx = null;
  let air = null;
  let metal = null;
  /** everything the score plays goes through this: silent in the scene `none` */
  let band = null;
  let buses = null;
  let sends = null;
  let name = 'none';
  let metalTimer = 8;
  let nextStep = 0;
  let step = 0;
  let disposed = false;

  function buildAir() {
    // noise with the top taken off, the cut-off drifting up and down over twenty seconds: tension as a held breath
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 5.7);
    src.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 300;
    low.Q.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 130;
    lfo.connect(lfoGain).connect(low.frequency);
    lfo.start();
    const level = ctx.createGain();
    level.gain.value = 0.5;
    src.connect(low).connect(level).connect(air);
    src.start();
  }

  /** The room the score is played in: noise dying away over a second and a half, its top going first. */
  function buildRoom(destination) {
    const seconds = 1.5;
    const n = Math.round(ctx.sampleRate * seconds);
    const echo = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = echo.getChannelData(0);
    const rng = makeRng(77);
    let dull = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      dull += (rng() * 2 - 1 - dull) * (0.35 - 0.25 * (t / seconds));
      data[i] = dull * Math.exp(-t / 0.33) * Math.min(1, t / 0.01);
    }
    const room = ctx.createConvolver();
    room.normalize = true;
    room.buffer = echo;
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    room.connect(wet).connect(destination);
    return room;
  }

  /** A gain that comes up at once to `peak` and dies away, gone by `seconds`: what every note is shaped by. */
  function struck(at, seconds, peak, attack, fall) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setTargetAtTime(0, at + attack, fall);
    // whatever is left of it is let go just before its time is up
    g.gain.setTargetAtTime(0, at + seconds - 0.07, 0.015);
    return g;
  }
  /** Oscillators `[times the note, how much, shape]` through one filter into one envelope, into a part. */
  function sound(part, at, seconds, partials, freq, cutoff, env) {
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = cutoff;
    soft.Q.value = 0.6;
    for (const [times, share, type] of partials) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * times;
      const g = ctx.createGain();
      g.gain.value = share;
      osc.connect(g).connect(soft);
      osc.start(at);
      osc.stop(at + seconds + 0.02);
    }
    soft.connect(env);
    env.connect(buses[part]);
  }

  const PLAY = {
    // a piano with felt on its hammers: the note, a little of the octave and the twelfth over it, and the hammer
    keys(at, e) {
      const freq = hertz(e.midi);
      sound(
        'keys',
        at,
        e.seconds,
        [
          [1, 1, 'sine'],
          [2.001, 0.28, 'sine'],
          [3.003, 0.09, 'triangle'],
        ],
        freq,
        Math.min(4200, freq * 6),
        struck(at, e.seconds, e.gain, 0.007, e.seconds / 4.6),
      );
      noiseBurst(ctx, buses.keys, at, {
        duration: 0.02,
        filterType: 'lowpass',
        freq: 1400,
        peak: e.gain * 0.14,
        attack: 0.001,
        decay: 0.018,
      });
    },
    // a bass plucked with the finger: round, with enough over the note itself to be heard on a small speaker
    bass(at, e) {
      const freq = hertz(e.midi);
      sound(
        'bass',
        at,
        e.seconds,
        [
          [1, 1, 'triangle'],
          [1, 0.6, 'sine'],
          [2, 0.16, 'sawtooth'],
        ],
        freq,
        Math.max(320, freq * 5),
        struck(at, e.seconds, e.gain, 0.009, e.seconds / 4),
      );
    },
    // strings, bowed short and off the string: two players, not quite in tune with each other
    strings(at, e) {
      const freq = hertz(e.midi);
      sound(
        'strings',
        at,
        e.seconds,
        [
          [1, 0.6, 'sawtooth'],
          [1.007, 0.6, 'sawtooth'],
        ],
        freq,
        Math.min(3200, freq * 7),
        struck(at, e.seconds, e.gain, 0.014, e.seconds / 3),
      );
    },
    // a big low drum, struck with a soft beater: it falls in pitch, as a skin does
    low(at, e) {
      sweep(ctx, buses.drums, at, {
        from: 104,
        to: 42,
        duration: 0.2,
        attack: 0.003,
        release: 0.1,
        peak: e.gain * 0.9,
      });
      noiseBurst(ctx, buses.drums, at, {
        duration: 0.09,
        filterType: 'lowpass',
        freq: 260,
        peak: e.gain * 0.4,
        attack: 0.002,
        decay: 0.085,
      });
    },
    // a smaller one, higher and drier, with its snares off
    hit(at, e) {
      sweep(ctx, buses.drums, at, {
        from: 196,
        to: 118,
        duration: 0.07,
        attack: 0.002,
        release: 0.04,
        peak: e.gain * 0.45,
      });
      noiseBurst(ctx, buses.drums, at, {
        duration: 0.1,
        filterType: 'bandpass',
        freq: 1100,
        Q: 0.6,
        peak: e.gain * 0.4,
        attack: 0.001,
        decay: 0.095,
      });
    },
    // the clock
    tick(at, e) {
      noiseBurst(ctx, buses.drums, at, {
        duration: 0.008,
        filterType: 'highpass',
        freq: 5600,
        peak: e.gain,
        attack: 0.0005,
        decay: 0.007,
      });
    },
    // a slow heartbeat under the breath: a soft thud, falling in pitch, with a little dull noise on its front
    pulse(at, e) {
      sweep(ctx, buses.pulse, at, {
        from: 84,
        to: 36,
        duration: 0.12,
        attack: 0.004,
        release: 0.05,
        peak: e.gain * 0.85,
      });
      noiseBurst(ctx, buses.pulse, at, {
        duration: 0.07,
        filterType: 'lowpass',
        freq: 150,
        peak: e.gain * 0.4,
        attack: 0.003,
        decay: 0.06,
      });
    },
  };

  /** Begins running against a real AudioContext, mixing into `destination` (usually the music gain stage). */
  function start(audioCtx, destination) {
    if (ctx) return;
    ctx = audioCtx;
    const level = (value, to) => {
      const g = ctx.createGain();
      g.gain.value = value; // whatever scene was selected before start() ran applies at once, with no fade
      g.connect(to);
      return g;
    };
    air = level(AIR[name], destination);
    metal = level(METAL[name], destination);
    band = level(name === 'none' ? 0 : 1, destination);
    const room = buildRoom(band);
    buses = {};
    sends = {};
    for (const part of PARTS) {
      buses[part] = level(MIX[part], band);
      if (WET[part] > 0) {
        sends[part] = level(WET[part], room);
        buses[part].connect(sends[part]);
      }
    }
    buildAir();
    nextStep = ctx.currentTime + 0.2;
  }

  /** Crossfades to a named scene: 'none' | 'calm' | 'tense' | 'combat' | 'exfil'. */
  function setState(stateName) {
    if (AIR[stateName] === undefined) return;
    // The round is not begun again: the scenes share its harmony, and the next sixteenth is simply the new
    // scene's. What was struck in the old one dies away as it would have.
    name = stateName;
    if (!ctx) return; // recorded for when start() runs
    const now = ctx.currentTime;
    air.gain.setTargetAtTime(AIR[name], now, RAMP);
    metal.gain.setTargetAtTime(METAL[name], now, RAMP);
    band.gain.setTargetAtTime(name === 'none' ? 0 : 1, now, RAMP);
  }

  /** Advances the rare-tone timer and the look-ahead step sequencer. Call once per frame. */
  function update(dt) {
    if (!ctx || disposed) return;
    metalTimer -= dt;
    if (metalTimer <= 0) {
      // a ring of metal somewhere far off: rare, and never loud
      metalTimer = rand(Math.random, 14, 30);
      if (METAL[name] > 0) {
        fmPing(ctx, metal, ctx.currentTime + 0.05, {
          carrier: rand(Math.random, 600, 1400),
          modRatio: rand(Math.random, 1.5, 3),
          modIndex: 200,
          duration: 1.2,
          attack: 0.02,
          release: 1.0,
          peak: 0.5,
        });
      }
    }
    // The page was out of sight for a while and nobody called this: what should have been played then is not
    // played now, all at once.
    if (nextStep < ctx.currentTime - 0.3) nextStep = ctx.currentTime + 0.05;
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (nextStep < horizon) {
      for (const e of scoreAt(name, step)) PLAY[e.voice]?.(nextStep, e);
      nextStep += stepSeconds(name);
      step++;
    }
  }

  function dispose() {
    disposed = true; // the real AudioContext being closed tears down every node; nothing else to free here
  }

  return { start, setState, update, dispose };
}

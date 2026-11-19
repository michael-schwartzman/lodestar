// Shared DSP building blocks for pack A's recipes (guns, impacts, blasts, foley). Built only from
// ../../audio/synth.js, per the wild pack's import rule: nothing of the game's own sounds.js is reused, even
// where an idea below echoes it (`clack`, `rub`, `room` there) — every node graph here is wired fresh so the
// pack stays self-contained.
//
// The owner's ear, 17 November 2026, on the game's own gunshots and metal hits: a sine that slides (`sweep`
// on an oscillator, or `tone` dropping in pitch) is what reads back as a sci-fi laser or a synthesised kick
// drum — never a transient. A real shot is a broadband noise impulse under 3 ms, a low-mid body that is noise
// filtered down (not a note), the gun's own metal 15-60 ms later, and a room tail; a real ricochet is a struck
// plate's inharmonic ring plus a whine that is a resonant band of noise sliding, not a tone. Every helper below
// keeps to that: nothing here is a bare oscillator held or swept without noise under or around it.
import { noiseBurst, tone, noiseBuffer, filterNode, rand } from '../../audio/synth.js';

// `perc` and `distortion` are plain audio/synth.js primitives too, but no sound of the game's own (nor any
// other wild experiment) had ever imported them before this pack — importing them here would be the first
// edge between the lazily-fetched wild bundle and those two names, which forces the main script to start
// exporting them and so grow by a few bytes, breaking the "must not grow" fence. A percussive gain ramp and a
// tanh waveshaper curve are a few lines each, so pack A keeps its own tiny copies instead.
const FLOOR = 0.0001;

/** The shape of synth.js's `perc`: attack up, exponential decay, a short release, down to true silence. */
function perc(param, at, { attack = 0.003, decay = 0.1, peak = 1 } = {}) {
  param.cancelScheduledValues(at);
  param.setValueAtTime(FLOOR, at);
  param.linearRampToValueAtTime(Math.max(peak, FLOOR), at + Math.max(attack, 0.001));
  const afterDecay = at + Math.max(attack, 0.001) + Math.max(decay, 0.001);
  param.exponentialRampToValueAtTime(FLOOR, afterDecay);
  const releaseEnd = afterDecay + 0.01;
  param.exponentialRampToValueAtTime(FLOOR, releaseEnd);
  const end = releaseEnd + 0.004;
  param.linearRampToValueAtTime(0, end);
  return end;
}

/** The shape of synth.js's `distortion`: a normalised tanh curve on a WaveShaperNode, for grit without pitch. */
function distortion(ctx, amount = 8) {
  const shaper = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(amount) || 1;
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * amount) / norm;
  shaper.curve = curve;
  shaper.oversample = '2x';
  return shaper;
}

/** The muzzle/impact crack: an almost-instant broadband spike under 3 ms — a needle, never a note. */
export function crack(ctx, dest, at, { peak = 0.6, freq = 3000, duration = 0.0022, rng } = {}) {
  return noiseBurst(ctx, dest, at, {
    duration,
    filterType: 'highpass',
    freq,
    peak,
    attack: 0.0003,
    decay: Math.max(0.0012, duration - 0.0004),
    rng,
  });
}

/**
 * The gas punch: the low-mid body of a shot or blast — broadband noise low-passed, never a sliding tone.
 * `drive` (0-1) runs it through a soft tanh clip first, for grit without turning it into a pitch.
 */
export function punch(ctx, dest, at, { peak = 0.6, freq = 180, duration = 0.09, drive = 0, Q = 0.7, rng } = {}) {
  if (!drive) {
    return noiseBurst(ctx, dest, at, {
      duration,
      filterType: 'lowpass',
      freq,
      Q,
      peak,
      attack: 0.0015,
      decay: Math.max(0.01, duration - 0.0015),
      rng,
    });
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, duration + 0.06, rng);
  const g = ctx.createGain();
  g.gain.value = 0;
  src
    .connect(filterNode(ctx, 'lowpass', freq, Q))
    .connect(distortion(ctx, 4 + drive * 10))
    .connect(g)
    .connect(dest);
  const end = perc(g.gain, at, { attack: 0.0015, decay: Math.max(0.01, duration - 0.0015), peak });
  src.start(at);
  src.stop(end + 0.02);
  return end;
}

/** One part sliding against another: a breath of band-passed noise that swells and dies, `seconds` long. */
export function rub(ctx, dest, at, { seconds = 0.08, freq = 1400, Q = 0.6, peak = 0.25, rng } = {}) {
  return noiseBurst(ctx, dest, at, {
    duration: seconds,
    filterType: 'bandpass',
    freq,
    Q,
    peak,
    attack: seconds * 0.35,
    decay: seconds * 0.65,
    rng,
  });
}

/**
 * Metal meeting metal: the CRACK of it, the THUNK of the body behind it, and a short inharmonic RING — a gun's
 * working part, a casing's first touch, a knife on a plate. `metallic` adds the ring; set 0 to leave it off.
 */
export function action(ctx, dest, at, { bright = 2600, body = 160, metallic = 1400, peak = 0.5, rng } = {}) {
  crack(ctx, dest, at, { peak: peak * 0.75, freq: bright, duration: 0.0018, rng });
  noiseBurst(ctx, dest, at, {
    duration: 0.03,
    filterType: 'bandpass',
    freq: bright * 0.42,
    Q: 1,
    peak: peak * 0.85,
    attack: 0.001,
    decay: 0.027,
    rng,
  });
  if (body)
    tone(ctx, dest, at, { freq: body, type: 'sine', attack: 0.001, decay: 0.03, release: 0.03, peak: peak * 0.5 });
  if (metallic)
    ring(ctx, dest, at + 0.001, { base: metallic, partials: [1, 1.6, 2.3], decay: 0.032, peak: peak * 0.28 });
}

/**
 * An inharmonic multi-partial ring — what struck metal (or glass) sounds like, not a chord: each partial a
 * short `tone`, its own decay (higher partials die faster, as a real plate does), ratios that are not a
 * harmonic series so the ear never resolves it to one pitch.
 */
export function ring(
  ctx,
  dest,
  at,
  { base = 1800, partials = [1, 1.83, 2.76, 4.07], decay = 0.05, peak = 0.4, type = 'triangle', spread = 0, rng } = {},
) {
  partials.forEach((mult, i) => {
    const detune = spread ? 1 + rand(rng, -spread, spread) : 1;
    tone(ctx, dest, at, {
      freq: base * mult * detune,
      type,
      attack: 0.0008,
      decay: decay / (1 + i * 0.35),
      release: decay * 0.6,
      peak: peak / (1 + i * 0.9),
    });
  });
  // the tone partials alone are a held, pitched ring — exactly the bare note the owner heard as a synth bell;
  // a struck plate's resonance is always excited and damped by noise too, so a bandpass layer spanning the
  // partials (same envelope) keeps the metallic pitch audible while breaking it up into a real-reading clang
  noiseBurst(ctx, dest, at, {
    duration: decay * 1.3,
    filterType: 'bandpass',
    freq: base * 1.6 * (spread ? 1 + rand(rng, -spread, spread) : 1),
    Q: 0.6,
    peak: peak * 0.7,
    attack: 0.001,
    decay: decay * 1.2,
    rng,
  });
}

/**
 * A whine or whistle made of noise, not a tone: a resonant band slides from `from` to `to` Hz over `duration`
 * — a ricochet glancing away, a round passing close. Never a pure oscillator, so it cannot read as a bleep.
 */
export function whine(ctx, dest, at, { from = 3200, to = 900, duration = 0.22, peak = 0.3, Q = 3, rng } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, duration + 0.06, rng);
  const band = filterNode(ctx, 'bandpass', from, Q);
  band.frequency.setValueAtTime(Math.max(40, from), at);
  band.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + duration);
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(band).connect(g).connect(dest);
  const end = perc(g.gain, at, { attack: Math.min(0.012, duration * 0.12), decay: duration * 0.88, peak });
  src.start(at);
  src.stop(end + 0.02);
  return end;
}

/**
 * The room a shot or blast is fired in, coming back: a slap off the nearest wall, optional distinct `early`
 * reflections (a cavern's close walls, heard apart from the slap before the tail blurs them together), then
 * dull noise that swells for a moment and dies away.
 * @param {Array<[number,number]>} [early] extra (secondsAfter, gainShare) slaps before the diffuse tail
 */
export function roomTail(
  ctx,
  dest,
  at,
  { seconds = 0.3, freq = 900, peak = 0.12, slap = 0.05, early = null, rng } = {},
) {
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
  if (early)
    for (const [dt, share] of early)
      noiseBurst(ctx, dest, at + dt, {
        duration: 0.018,
        filterType: 'bandpass',
        freq: freq * rand(rng, 1.1, 2.1),
        Q: 1.1,
        peak: peak * share,
        attack: 0.0015,
        decay: 0.016,
        rng,
      });
  const long = seconds * 1.6;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, long + 0.1, rng);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak * 0.33 * Math.sqrt(22050 / freq), at + 0.03);
  g.gain.setTargetAtTime(0, at + 0.03, seconds / 2.3);
  g.gain.setTargetAtTime(0, at + long, 0.006);
  src
    .connect(filterNode(ctx, 'lowpass', freq, 0.5))
    .connect(g)
    .connect(dest);
  src.start(at);
  src.stop(at + long + 0.04);
  return at + long + 0.04;
}

/** A scatter of short, randomly pitched bandpass ticks over a window — debris, falling glass, clatter. */
export function scatter(ctx, dest, { count, window, freq, Q = [0.6, 1.4], peak, rng }) {
  for (let i = 0; i < count; i++)
    noiseBurst(ctx, dest, rand(rng, window[0], window[1]), {
      duration: rand(rng, 0.01, 0.045),
      filterType: 'bandpass',
      freq: rand(rng, freq[0], freq[1]),
      Q: rand(rng, Q[0], Q[1]),
      peak: rand(rng, peak[0], peak[1]),
      attack: 0.001,
      decay: rand(rng, 0.009, 0.04),
      rng,
    });
}

/** A brass casing's first touch down, a few bounces, and a short irregular skitter across concrete. */
export function brassLand(ctx, dest, at, { peak = 0.3, rng } = {}) {
  ring(ctx, dest, at, { base: rand(rng, 2600, 3400), partials: [1, 1.7, 2.6], decay: 0.008, peak: peak * 0.7, rng });
  crack(ctx, dest, at, { peak: peak * 0.7, freq: rand(rng, 3500, 4500), duration: 0.0012, rng });
  let t = at + rand(rng, 0.028, 0.05);
  const bounces = 3 + Math.floor(rand(rng, 0, 2.6));
  for (let i = 0; i < bounces; i++) {
    const g = peak * (0.5 - i * 0.11);
    if (g <= 0.025) break;
    noiseBurst(ctx, dest, t, {
      duration: 0.006,
      filterType: 'bandpass',
      freq: rand(rng, 2200, 4200),
      Q: 2,
      peak: g,
      attack: 0.0003,
      decay: 0.005,
      rng,
    });
    t += rand(rng, 0.035, 0.085) * (1 + i * 0.3);
  }
  noiseBurst(ctx, dest, t, {
    duration: rand(rng, 0.05, 0.09),
    filterType: 'bandpass',
    freq: rand(rng, 2500, 4000),
    Q: 1.4,
    peak: peak * 0.22,
    attack: 0.002,
    decay: 0.05,
    rng,
  });
  return t + 0.1;
}

/** A supersonic round's crack right at the ear: two overlapping needle transients, louder than a muzzle crack. */
export function sonicCrack(ctx, dest, at, { peak = 0.7, rng } = {}) {
  noiseBurst(ctx, dest, at, {
    duration: 0.0016,
    filterType: 'bandpass',
    freq: rand(rng, 2200, 3600),
    Q: 0.5,
    peak,
    attack: 0.0002,
    decay: 0.0012,
    rng,
  });
  noiseBurst(ctx, dest, at, {
    duration: 0.003,
    filterType: 'highpass',
    freq: rand(rng, 1700, 2600),
    peak: peak * 0.82,
    attack: 0.0003,
    decay: 0.0026,
    rng,
  });
}

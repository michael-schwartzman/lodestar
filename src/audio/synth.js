// Small DSP building blocks used while a sound is rendered into a buffer with an OfflineAudioContext (or
// scheduled live by the music scheduler, which uses the same calls against the real context). Nothing here
// keeps a reference to what it builds: every helper wires up a little graph, schedules it, and hands back
// only the time it finishes — a recipe in sounds.js/loops.js/music.js is just a handful of these calls.

const FLOOR = 0.0001;

/** A tiny, seedable PRNG (mulberry32) so a "random" take can be rebuilt the same way from an integer seed. */
export function makeRng(seed) {
  let a = seed >>> 0 || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random number in [a, b) from the given rng (defaults to Math.random). */
export const rand = (rng, a, b) => a + (rng ? rng() : Math.random()) * (b - a);

/** A mono buffer of white noise `seconds` long — the raw material every burst/hiss/crackle filters down from. */
export function noiseBuffer(ctx, seconds, rng = Math.random) {
  const n = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = rng() * 2 - 1;
  return buffer;
}

/**
 * Schedules a gain envelope on an AudioParam (usually a GainNode's `.gain`): a linear attack up to `peak`,
 * an exponential decay to `sustain * peak`, an optional hold, then an exponential release down to true zero.
 * Returns the time the envelope reaches silence, so the caller knows when it is safe to stop a source.
 */
export function env(param, at, { attack = 0.01, decay = 0.1, sustain = 0, hold = 0, release = 0.08, peak = 1 } = {}) {
  param.cancelScheduledValues(at);
  param.setValueAtTime(FLOOR, at);
  param.linearRampToValueAtTime(Math.max(peak, FLOOR), at + Math.max(attack, 0.001));
  const sustainLevel = Math.max(sustain * peak, FLOOR);
  const afterDecay = at + Math.max(attack, 0.001) + Math.max(decay, 0.001);
  param.exponentialRampToValueAtTime(sustainLevel, afterDecay);
  const releaseStart = afterDecay + Math.max(hold, 0);
  if (hold > 0) param.setValueAtTime(sustainLevel, releaseStart);
  const releaseEnd = releaseStart + Math.max(release, 0.005);
  param.exponentialRampToValueAtTime(FLOOR, releaseEnd);
  // the exponential ramp can only approach zero, never reach it — finish with a short linear ramp to true silence
  const end = releaseEnd + 0.004;
  param.linearRampToValueAtTime(0, end);
  return end;
}

/** The common case of `env`: a short percussive hit with no sustain, straight into release. */
export function perc(param, at, { attack = 0.003, decay = 0.1, peak = 1 } = {}) {
  return env(param, at, { attack, decay, sustain: 0, hold: 0, release: 0.01, peak });
}

/** A one-off BiquadFilterNode, to cut down on repetitive setup in every recipe. */
export function filterNode(ctx, type, freq, Q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}

/** A StereoPannerNode if the context has one, or null — callers fall back to connecting straight through. */
export function panner(ctx, pan = 0) {
  if (typeof ctx.createStereoPanner !== 'function') return null;
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

/** A burst of filtered noise: the material of cracks, thuds, hisses, clicks and crackle. Returns the end time. */
export function noiseBurst(ctx, dest, at, opts = {}) {
  const {
    duration = 0.15,
    filterType = 'lowpass',
    freq = 1200,
    filterType2 = null,
    freq2 = null,
    Q = 0.8,
    peak = 0.8,
    attack = 0.002,
    decay = null,
    buffer = null,
    rng = Math.random,
  } = opts;
  const src = ctx.createBufferSource();
  src.buffer = buffer || noiseBuffer(ctx, duration + 0.08, rng);
  let node = src.connect(filterNode(ctx, filterType, freq, Q));
  if (freq2 != null) node = node.connect(filterNode(ctx, filterType2 || filterType, freq2, Q));
  const g = ctx.createGain();
  g.gain.value = 0;
  node.connect(g).connect(dest);
  const end = perc(g.gain, at, { attack, decay: decay ?? Math.max(0.01, duration - attack), peak });
  src.start(at);
  src.stop(end + 0.02);
  return end;
}

/** A plain oscillator through an envelope — the material of beeps, chimes, thumps and drones. */
export function tone(ctx, dest, at, opts = {}) {
  const {
    freq = 440,
    type = 'sine',
    detune = 0,
    attack = 0.01,
    decay = 0.12,
    sustain = 0,
    hold = 0,
    release = 0.1,
    peak = 0.5,
  } = opts;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, freq), at);
  osc.detune.value = detune;
  const g = ctx.createGain();
  g.gain.value = 0;
  osc.connect(g).connect(dest);
  const end = env(g.gain, at, { attack, decay, sustain, hold, release, peak });
  osc.start(at);
  osc.stop(end + 0.02);
  return end;
}

/** An oscillator whose frequency ramps from one value to another — sirens, whines, sweeps, whistles. */
export function sweep(ctx, dest, at, opts = {}) {
  const {
    from = 800,
    to = 200,
    duration = 0.3,
    type = 'sine',
    curve = 'exp',
    attack = 0.01,
    release = 0.1,
    peak = 0.6,
  } = opts;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, from), at);
  if (curve === 'lin') osc.frequency.linearRampToValueAtTime(Math.max(1, to), at + duration);
  else osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + duration);
  const g = ctx.createGain();
  g.gain.value = 0;
  osc.connect(g).connect(dest);
  const end = env(g.gain, at, { attack, decay: Math.max(0.01, duration - attack), sustain: 0, hold: 0, release, peak });
  osc.start(at);
  osc.stop(end + 0.02);
  return end;
}

/**
 * A carrier tone frequency-modulated by a second oscillator — the material of pings, bells and electronic
 * chirps. The modulation depth decays through the note so a bright attack settles into a cleaner tone.
 */
export function fmPing(ctx, dest, at, opts = {}) {
  const {
    carrier = 900,
    modRatio = 1.4,
    modIndex = 300,
    duration = 0.3,
    attack = 0.002,
    release = 0.2,
    peak = 0.6,
  } = opts;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(Math.max(1, carrier), at);
  const mod = ctx.createOscillator();
  mod.type = 'sine';
  mod.frequency.setValueAtTime(Math.max(1, carrier * modRatio), at);
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(modIndex, at);
  modGain.gain.exponentialRampToValueAtTime(Math.max(1, modIndex * 0.04), at + Math.max(0.02, duration));
  mod.connect(modGain).connect(osc.frequency);
  const g = ctx.createGain();
  g.gain.value = 0;
  osc.connect(g).connect(dest);
  const end = env(g.gain, at, { attack, decay: Math.max(0.01, duration - attack), sustain: 0, hold: 0, release, peak });
  osc.start(at);
  mod.start(at);
  osc.stop(end + 0.02);
  mod.stop(end + 0.02);
  return end;
}

/** A gentle tanh soft-clip waveshaper — used sparingly, where a sound should feel driven rather than clean. */
export function distortion(ctx, amount = 8) {
  const shaper = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(amount) || 1;
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * amount) / norm;
  shaper.curve = curve;
  shaper.oversample = '2x';
  return shaper;
}

/** Peak, RMS and DC offset across every channel of a rendered buffer, plus whether every sample is finite. */
export function analyzeBuffer(buffer) {
  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  let n = 0;
  let finite = true;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (!Number.isFinite(v)) {
        finite = false;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sumSq += v * v;
      sum += v;
      n++;
    }
  }
  return { peak, rms: n ? Math.sqrt(sumSq / n) : 0, dc: n ? sum / n : 0, finite };
}

/** The loudest sample in the last `ms` milliseconds of a buffer — a one-shot should end in near-silence. */
export function tailPeak(buffer, ms = 10) {
  const n = Math.max(1, Math.round((ms / 1000) * buffer.sampleRate));
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = Math.max(0, data.length - n); i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  return peak;
}

/** How far the last sample is from the first — how big a jump a loop would make at its own seam. */
export function seamDiff(buffer) {
  let worst = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    worst = Math.max(worst, Math.abs(data[data.length - 1] - data[0]));
  }
  return worst;
}

/**
 * Scales a buffer in place so its peak sits inside [min, max] — a safety net so a recipe that renders a touch
 * too hot or too quiet still passes the game's loudness checks, without flattening the intended differences
 * between sounds (nothing is retargeted to a common level, only clamped back into range).
 */
export function fitPeak(buffer, { min = 0.06, max = 0.95 } = {}) {
  const { peak } = analyzeBuffer(buffer);
  if (peak <= 0) return buffer;
  const factor = peak > max ? max / peak : peak < min ? min / peak : 1;
  if (factor === 1) return buffer;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] *= factor;
  }
  return buffer;
}

/**
 * Turns a plain render into a seamless loop: the last `crossfadeSeconds` are blended (equal-power) into the
 * first `crossfadeSeconds` and then dropped, so what plays right before the wrap and right after it are the
 * same blend family instead of two unrelated instants. See docs/DESIGN.md §"Loops" for why this works.
 */
export function stitchLoop(buffer, crossfadeSeconds = 0.3) {
  const sr = buffer.sampleRate;
  const fadeLen = Math.max(1, Math.round(crossfadeSeconds * sr));
  const outLen = buffer.length - fadeLen;
  if (outLen <= fadeLen) return buffer; // too short to stitch safely — hand back the plain render
  const out = new AudioBuffer({ length: outLen, numberOfChannels: buffer.numberOfChannels, sampleRate: sr });
  // The crossfade above only smooths the blend *within* the fade window; the one sample pair that actually
  // wraps (last -> first) is whatever the raw render happened to land on. Tonal partials tuned to whole
  // cycles all share one phase, so they can all hit their steepest slope at exactly that pair. Spread any
  // remaining jump as a tiny taper into a few milliseconds at each edge so the wrap itself is always smooth.
  const trimLen = Math.min(Math.round(0.004 * sr), Math.floor(outLen / 4));
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < outLen; i++) dst[i] = src[i];
    for (let i = 0; i < fadeLen; i++) {
      const k = i / fadeLen;
      const fadeIn = Math.sin((k * Math.PI) / 2);
      const fadeOut = Math.cos((k * Math.PI) / 2);
      dst[i] = src[i] * fadeIn + src[outLen + i] * fadeOut;
    }
    if (trimLen > 0) {
      const jump = dst[0] - dst[outLen - 1];
      for (let i = 0; i < trimLen; i++) {
        const taper = 0.5 * (1 + Math.cos((Math.PI * i) / trimLen)); // 1 at the edge, 0 by trimLen samples in
        dst[i] -= (jump / 2) * taper;
        dst[outLen - 1 - i] += (jump / 2) * taper;
      }
    }
  }
  return out;
}

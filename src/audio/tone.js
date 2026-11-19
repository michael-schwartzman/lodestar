// How much of a sound is a steady note. The game's background sounds are held to a limit of it (audio.js
// selfTest, test/smoke.test.mjs): a hush of air is fine for an hour; a hum is not.
// No Web Audio in here — it takes plain samples — so it runs under `node --test` (test/unit/tone.test.mjs).

/** An in-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size)
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
  }
}

/**
 * How far the strongest steady note in a sound stands above the sound around it, in decibels.
 *
 * The sound is cut into overlapping pieces and their spectra are averaged, which smooths noise out and leaves
 * notes standing. Each frequency is then compared with the middle value of its own neighbourhood (a third of an
 * octave either side), so that a sound which is merely dull, or bright, is not mistaken for one with a pitch.
 * Noise of any colour measures a few decibels; a hum, a whine or a buzz measures thirty or more.
 * @param {Float32Array} samples one channel
 * @param {number} sampleRate
 * @param {{ from?: number, to?: number }} [band] the frequencies looked at, in hertz
 * @returns {number} 0 for silence or for a sound too short to measure
 */
export function tonalProminence(samples, sampleRate, { from = 40, to = 8000 } = {}) {
  const N = 8192;
  if (samples.length < N * 2) return 0;
  const hop = N / 2;
  const window = new Float32Array(N);
  for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const power = new Float64Array(N / 2);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let pieces = 0;
  for (let start = 0; start + N <= samples.length; start += hop) {
    for (let i = 0; i < N; i++) {
      re[i] = samples[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    pieces++;
  }
  let total = 0;
  for (let k = 0; k < N / 2; k++) {
    power[k] /= pieces;
    total += power[k];
  }
  if (total < 1e-9) return 0;

  const hertz = sampleRate / N;
  const first = Math.max(3, Math.ceil(from / hertz));
  const last = Math.min(N / 2 - 1, Math.floor(to / hertz));
  const SPAN = Math.pow(2, 1 / 3);
  // a note smears over a few neighbouring bins: they are left out of what it is compared with
  const GUARD = 3;
  // low down, a third of an octave is only a handful of bins: there the neighbourhood is at least this wide
  const REACH = 12;
  const around = [];
  let worst = 1;
  for (let k = first; k <= last; k++) {
    const lo = Math.max(1, Math.min(Math.floor(k / SPAN), k - REACH));
    const hi = Math.min(N / 2 - 1, Math.max(Math.ceil(k * SPAN), k + REACH));
    around.length = 0;
    for (let j = lo; j <= hi; j++) if (Math.abs(j - k) > GUARD) around.push(power[j]);
    if (around.length < 6) continue;
    around.sort((a, b) => a - b);
    const middle = around[around.length >> 1];
    // the floor keeps a silent stretch of the spectrum from making a whisper beside it look like a shout
    const ratio = power[k] / Math.max(middle, total * 1e-9);
    if (ratio > worst) worst = ratio;
  }
  return 10 * Math.log10(worst);
}

const windows = new Map();
/** a Hann window `n` long: made once */
function hann(n) {
  if (!windows.has(n)) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    windows.set(n, w);
  }
  return windows.get(n);
}

/** The power in each frequency of the `n` samples from `start` on (silence past either end), into `power`. */
function piece(samples, start, n, re, im, power) {
  const window = hann(n);
  for (let i = 0; i < n; i++) {
    const at = start + i;
    re[i] = at >= 0 && at < samples.length ? samples[at] * window[i] : 0;
    im[i] = 0;
  }
  fft(re, im);
  for (let k = 0; k < n / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
}

/**
 * How much of a SHORT sound is one bare note — a bleep: 0 … 1.
 *
 * `tonalProminence` needs a third of a second and a note that stands still. The sounds a game bleeps with are a
 * twentieth of a second long, and half of them slide. So: the sound is taken a fortieth of a second at a time;
 * in each piece the strongest partial is found, and what lies on it and on its first two overtones is weighed
 * against the whole piece; and the pieces are averaged by how loud each is. Only what is above `from` counts —
 * under that, a tone is the thump in the body of a knock, not a note — so a low rough voice, whose pitch is down
 * there, is not a bleep either.
 * A bare square, sine or saw, steady or sliding, measures 0.6 and more; a knock, a click, noise: 0.35 and less.
 * @param {Float32Array} samples one channel
 * @param {number} sampleRate
 * @param {{ from?: number, to?: number }} [band] the frequencies looked at, in hertz
 * @returns {number} 0 for silence
 */
export function bareTone(samples, sampleRate, { from = 250, to = 8000 } = {}) {
  const N = 1024;
  const hop = N / 4;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const power = new Float64Array(N / 2);
  const hertz = sampleRate / N;
  // (two frequencies clear of `from`: a thump just under it spills that far over)
  const first = Math.max(2, Math.ceil(from / hertz) + 2);
  const last = Math.min(N / 2 - 1, Math.floor(to / hertz));
  let onNote = 0;
  let whole = 0;
  let all = 0;
  for (let i = 0; i < samples.length; i++) all += samples[i] * samples[i];
  if (all < 1e-12) return 0;
  for (let start = -N / 2; start < samples.length; start += hop) {
    piece(samples, start, N, re, im, power);
    // the whole piece, the thump under `from` too: a knock with a little hiss on it is not a note for that
    let total = 0;
    for (let k = 1; k < N / 2; k++) total += power[k];
    let top = first;
    for (let k = first; k <= last; k++) if (power[k] > power[top]) top = k;
    if (total <= 0) continue;
    // The note, and its first two overtones: each band a little wider than the last, as a sliding note smears.
    // What a band holds is counted only as far as it stands above the sound on either side of it: a band of
    // noise is as loud beside its loudest part as in it, a note is not.
    const half = Math.max(3, Math.ceil(top * 0.08));
    let note = 0;
    for (let n = 1; n <= 3; n++) {
      const w = half * n;
      const lo = Math.max(first, top * n - w, n > 1 ? top * (n - 1) + half * (n - 1) + 1 : 0);
      const hi = Math.min(last, top * n + w);
      if (hi < lo) continue;
      let inside = 0;
      for (let k = lo; k <= hi; k++) inside += power[k];
      let beside = 0;
      let count = 0;
      for (let k = Math.max(1, lo - w - 1); k < lo; k++, count++) beside += power[k];
      for (let k = hi + 1; k <= Math.min(N / 2 - 1, hi + w + 1); k++, count++) beside += power[k];
      note += Math.max(0, inside - (count ? beside / count : 0) * (hi - lo + 1));
    }
    onNote += note;
    whole += total;
  }
  return whole > 0 ? onNote / whole : 0;
}

/**
 * How long the longest-held note in a sound holds its level, in seconds.
 *
 * A hum is a note that is HELD; a score is made of notes that are struck and die away. The sound is taken a
 * tenth of a second at a time; in each piece the notes are found (what stands well clear of the sound around it,
 * as in `tonalProminence`), to the nearest semitone; and a note is followed from piece to piece for as long as it
 * neither falls 12 dB below the loudest it has been — it has died away — nor leaps up by 6 dB — it has been
 * struck again. A drone measures as long as it sounds; one struck note, the few tenths of a second it takes to
 * fall away; the same note struck over and over, no more than that.
 * @param {Float32Array} samples one channel
 * @param {number} sampleRate
 * @returns {number} 0 for silence, and for a sound with no note in it
 */
export function heldFor(samples, sampleRate, { from = 40, to = 5000 } = {}) {
  const N = 4096;
  const hop = N / 4;
  if (samples.length < N) return 0;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const power = new Float64Array(N / 2);
  const hertz = sampleRate / N;
  const first = Math.max(3, Math.ceil(from / hertz));
  const last = Math.min(N / 2 - 3, Math.floor(to / hertz));
  const SPAN = Math.pow(2, 1 / 3);
  const around = [];
  /** every piece's notes: semitone → power */
  const pieces = [];
  let loudest = 0;
  for (let start = 0; start + N <= samples.length; start += hop) {
    piece(samples, start, N, re, im, power);
    let total = 0;
    for (let k = first; k <= last; k++) total += power[k];
    const notes = new Map();
    pieces.push(notes);
    if (total < 1e-12) continue;
    for (let k = first; k <= last; k++) {
      const p = power[k];
      // a peak — and not one of the thousand small ones that noise is made of
      if (p < total * 2e-3 || p < power[k - 1] || p < power[k + 1] || p < power[k - 2] || p < power[k + 2]) continue;
      const lo = Math.max(1, Math.min(Math.floor(k / SPAN), k - 12));
      const hi = Math.min(N / 2 - 1, Math.max(Math.ceil(k * SPAN), k + 12));
      around.length = 0;
      for (let j = lo; j <= hi; j++) if (Math.abs(j - k) > 3) around.push(power[j]);
      around.sort((a, b) => a - b);
      if (p < 16 * Math.max(around[around.length >> 1], total * 1e-9)) continue;
      const semitone = Math.round(69 + 12 * Math.log2((k * hertz) / 440));
      if (p > (notes.get(semitone) || 0)) notes.set(semitone, p);
      if (p > loudest) loudest = p;
    }
  }
  if (loudest <= 0) return 0;
  // a note 40 dB under the loudest there ever was is not heard as one
  const heard = loudest * 1e-4;
  const FELL = Math.pow(10, -1.2);
  const STRUCK = 4;
  // a note lost for a moment under another being struck beside it is still sounding: this many pieces of grace
  const GRACE = 4;
  const running = new Map();
  let longest = 0;
  const done = (run) => {
    longest = Math.max(longest, run.seen - run.from + 1);
  };
  pieces.forEach((notes, n) => {
    for (const [semitone, run] of running) {
      const p = notes.get(semitone) || 0;
      if (p < heard) {
        if (n - run.seen <= GRACE) continue;
      } else if (p >= run.most * FELL && p <= run.last * STRUCK) continue;
      done(run);
      running.delete(semitone);
    }
    for (const [semitone, p] of notes) {
      if (p < heard) continue;
      const run = running.get(semitone);
      if (!run) running.set(semitone, { from: n, seen: n, most: p, last: p });
      else {
        run.most = Math.max(run.most, p);
        run.last = p;
        run.seen = n;
      }
    }
  });
  for (const run of running.values()) done(run);
  return (longest * hop) / sampleRate;
}

/** The share of a sound's energy that lies under `hertz`: its weight. 0 for silence. */
export function weightBelow(samples, sampleRate, hertz = 250) {
  let n = 1024;
  while (n < samples.length && n < 1 << 19) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < Math.min(n, samples.length); i++) re[i] = samples[i];
  fft(re, im);
  const cut = Math.floor((hertz * n) / sampleRate);
  let low = 0;
  let all = 0;
  for (let k = 1; k < n / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k];
    all += p;
    if (k <= cut) low += p;
  }
  return all > 1e-12 ? low / all : 0;
}

/** How long a sound lasts, in seconds: from when it first comes within 40 dB of its loudest to when it last is. */
export function lasts(samples, sampleRate) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-6) return 0;
  const floor = peak * 0.01;
  let from = 0;
  let to = samples.length - 1;
  while (Math.abs(samples[from]) < floor) from++;
  while (Math.abs(samples[to]) < floor) to--;
  return (to - from + 1) / sampleRate;
}

/** How loud a sound is where it is loudest: the rms of its loudest `seconds` (a fiftieth of a second). */
export function loudest(samples, sampleRate, seconds = 0.02) {
  const n = Math.max(1, Math.min(samples.length, Math.round(sampleRate * seconds)));
  let sum = 0;
  let most = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
    if (i >= n) sum -= samples[i - n] * samples[i - n];
    if (i >= n - 1 && sum > most) most = sum;
  }
  return Math.sqrt(most / n);
}

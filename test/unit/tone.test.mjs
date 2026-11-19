// Contract lock: how a hum is told from a hush. The background sounds of the game are measured with this, so
// that none of them can go back to being a steady note (docs/DESIGN.md, "Sound").
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tonalProminence, bareTone, heldFor, weightBelow, lasts, loudest } from '../../src/audio/tone.js';

const RATE = 44100;

/** Seeded white noise, −1 … 1. */
function noise(seconds, seed = 1) {
  const out = new Float32Array(Math.round(seconds * RATE));
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s / 2147483648 - 1;
  }
  return out;
}
const mix = (...parts) => {
  const out = new Float32Array(parts[0].length);
  for (const part of parts) for (let i = 0; i < out.length; i++) out[i] += part[i];
  return out;
};
const scale = (a, k) => a.map((v) => v * k);
const sine = (seconds, freq, amp = 1) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / RATE));
const saw = (seconds, freq, amp = 1) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * (2 * (((freq * i) / RATE) % 1) - 1));
/** A one-pole low-pass: makes noise dull without giving it a pitch. */
function dull(a, k = 0.03) {
  const out = new Float32Array(a.length);
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    y += (a[i] - y) * k;
    out[i] = y;
  }
  return out;
}

test('a hush has no note in it: white noise, dull noise and fluttering noise all measure low', () => {
  const white = tonalProminence(noise(4), RATE);
  const dark = tonalProminence(dull(noise(4, 7)), RATE);
  // noise switched up and down ninety-five times a second, like air through a rotor
  const flutter = tonalProminence(
    noise(4, 3).map((v, i) => v * (0.55 + 0.45 * Math.sin((2 * Math.PI * 95 * i) / RATE))),
    RATE,
  );
  for (const [name, db] of [
    ['white', white],
    ['dull', dark],
    ['flutter', flutter],
  ])
    assert.ok(db < 8, `${name} noise measured ${db.toFixed(1)} dB`);
});

test('a hum has: a mains hum, a whine and a rotor buzz all measure high', () => {
  const mains = tonalProminence(mix(saw(4, 120, 0.2), scale(noise(4), 0.05)), RATE);
  const whine = tonalProminence(mix(sine(4, 2200, 0.09), sine(4, 2200.25, 0.09), scale(noise(4), 0.01)), RATE);
  const rotor = tonalProminence(saw(4, 110, 0.35), RATE);
  for (const [name, db] of [
    ['mains hum', mains],
    ['whine', whine],
    ['rotor', rotor],
  ])
    assert.ok(db > 25, `${name} measured only ${db.toFixed(1)} dB`);
});

test('a faint note under a loud hush is still found, and a fainter one measures less', () => {
  const loud = tonalProminence(mix(sine(4, 440, 0.1), scale(noise(4), 0.3)), RATE);
  const faint = tonalProminence(mix(sine(4, 440, 0.02), scale(noise(4), 0.3)), RATE);
  assert.ok(loud > 15, `${loud.toFixed(1)} dB`);
  assert.ok(faint < loud - 8, `the fainter note measured ${faint.toFixed(1)} dB against ${loud.toFixed(1)}`);
});

test('silence, and something too short to measure, are no hum at all', () => {
  assert.equal(tonalProminence(new Float32Array(RATE * 2), RATE), 0);
  assert.equal(tonalProminence(noise(0.05), RATE), 0);
});

test('where the note is does not matter: low, middle and high are all found', () => {
  for (const freq of [55, 300, 1500, 6000])
    assert.ok(tonalProminence(mix(sine(3, freq, 0.2), scale(noise(3), 0.03)), RATE) > 25, `${freq} Hz`);
});

// ---------- a bleep, and a knock ----------
// Decision of 16 November 2026 — the owner: "make the sounds more serious". What the game said to the player
// (a hit, a kill, a menu, a charge armed) and what its machines said to each other were bleeps: a bare square or
// sine at one pitch, or sliding from one to another. `bareTone` is how that is told from a knock, a click or a
// growl — the SHORT sounds, which `tonalProminence` is too slow for — and test/smoke.test.mjs holds the sounds
// themselves to it.

/** shaped like a struck thing: at once, then dying away over `seconds` */
const struck = (a, seconds) => a.map((v, i) => v * Math.exp((-5 * i) / (seconds * RATE)));
const square = (seconds, freq, amp = 1) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => (((freq * i) / RATE) % 1 < 0.5 ? amp : -amp));
/** a tone sliding from one pitch to another, as the machines' chirps did */
const chirp = (seconds, from, to, shape = 'saw') => {
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    phase += (from * Math.pow(to / from, i / out.length)) / RATE;
    const p = phase % 1;
    out[i] = shape === 'sine' ? Math.sin(2 * Math.PI * p) : 2 * p - 1;
  }
  return out;
};
/** noise through a crude band-pass: what a click or a knock is made of */
const band = (a, lo = 0.02, hi = 0.3) => {
  const low = dull(a, hi);
  const lower = dull(a, lo);
  return low.map((v, i) => v - lower[i]);
};

test('a bleep is a bare tone, held or sliding: the old hit marker, kill chime and chirp all measure high', () => {
  for (const [name, sound] of [
    ['a 2.6 kHz square tick', struck(square(0.05, 2600, 0.3), 0.04)],
    ['a 700 Hz sine blip', struck(sine(0.12, 700, 0.3), 0.1)],
    ['a saw chirp, 400 → 900 Hz', chirp(0.14, 400, 900)],
    ['a falling sine, 800 → 350 Hz', chirp(0.3, 800, 350, 'sine')],
    ['a keypad beep', struck(square(0.1, 1800, 0.3), 0.08)],
  ])
    assert.ok(bareTone(sound, RATE) > 0.5, `${name} measured ${bareTone(sound, RATE).toFixed(2)}`);
});

test('a knock, a click and a growl are not: noise, struck noise over a low thump, a rough low saw', () => {
  const knock = mix(struck(band(noise(0.08, 5)), 0.03), struck(sine(0.08, 150, 0.6), 0.06));
  const click = struck(noise(0.03, 9), 0.01);
  // a saw low enough to be a growl, switched up and down forty times a second, with breath on it
  const growl = mix(
    saw(0.3, 96, 0.5).map((v, i) => v * (0.6 + 0.4 * Math.sin((2 * Math.PI * 41 * i) / RATE))),
    scale(band(noise(0.3, 4)), 0.5),
  );
  for (const [name, sound] of [
    ['a knock', knock],
    ['a click', click],
    ['a growl', growl],
    ['white noise', noise(0.2, 2)],
  ])
    assert.ok(bareTone(sound, RATE) < 0.35, `${name} measured ${bareTone(sound, RATE).toFixed(2)}`);
});

test('a thump low down is the body of a knock, not a bleep: what is under 250 Hz is not counted', () => {
  assert.ok(bareTone(struck(sine(0.1, 90, 0.8), 0.08), RATE) < 0.35);
  // …and silence is nothing
  assert.equal(bareTone(new Float32Array(4000), RATE), 0);
});

// ---------- a note that is held ----------
// Decision of 16 November 2026 — the owner: "some background music that nice appropriate at the background",
// four days after "change the annoying humming sounds". A score has notes in it; a hum is a note that is HELD.
// `heldFor` is how long the longest-held note of a sound holds its level, and the score is kept under a limit of
// it (src/audio/score.js `MAX_NOTE`): every note of it is struck and dies away.

test('a hum holds its note for as long as it sounds; a struck note for well under a second', () => {
  assert.ok(heldFor(mix(saw(5, 110, 0.3), scale(noise(5), 0.02)), RATE) > 4.5, 'a rotor hum');
  assert.ok(heldFor(sine(5, 55, 0.4), RATE) > 4.5, 'a 55 Hz drone');
  const pluck = struck(mix(sine(2, 294, 0.5), sine(2, 588, 0.15)), 1.2);
  const one = heldFor(pluck, RATE);
  assert.ok(one > 0.05 && one < 0.9, `one struck note held ${one.toFixed(2)} s`);
});

test('the same note struck again and again is not held: each time it dies away and is struck anew', () => {
  const beat = 0.5;
  const out = new Float32Array(RATE * 6);
  for (let n = 0; n * beat < 5.5; n++) {
    const at = Math.round(n * beat * RATE);
    const note = struck(sine(0.8, 73.4, 0.6), 0.45);
    for (let i = 0; i < note.length && at + i < out.length; i++) out[at + i] += note[i];
  }
  const held = heldFor(out, RATE);
  assert.ok(held < 1, `a bass note struck twice a second measured ${held.toFixed(2)} s`);
});

test('a tune of struck notes measures by its longest note, and a pad under it is found', () => {
  const tune = new Float32Array(RATE * 6);
  [294, 349, 440, 392, 349, 294, 262, 294].forEach((freq, n) => {
    const at = Math.round(n * 0.7 * RATE);
    const note = struck(sine(1.2, freq, 0.4), 0.9);
    for (let i = 0; i < note.length && at + i < tune.length; i++) tune[at + i] += note[i];
  });
  assert.ok(heldFor(tune, RATE) < 1, `the tune measured ${heldFor(tune, RATE).toFixed(2)} s`);
  const withPad = mix(tune, sine(6, 147, 0.08));
  assert.ok(
    heldFor(withPad, RATE) > 5,
    `a faint pad under the tune was not found: ${heldFor(withPad, RATE).toFixed(2)} s`,
  );
});

test('a hush holds no note at all, and neither does silence', () => {
  assert.ok(heldFor(noise(4, 11), RATE) < 0.3, `noise measured ${heldFor(noise(4, 11), RATE).toFixed(2)} s`);
  assert.equal(heldFor(new Float32Array(RATE * 2), RATE), 0);
});

// ---------- weight, and how long a sound lasts ----------

test('weight is the share of a sound that is low down; a sound lasts until it has died away', () => {
  const low = sine(0.5, 80, 0.5);
  const high = sine(0.5, 3000, 0.5);
  assert.ok(weightBelow(low, RATE, 250) > 0.95);
  assert.ok(weightBelow(high, RATE, 250) < 0.02);
  const half = weightBelow(mix(low, high), RATE, 250);
  assert.ok(half > 0.4 && half < 0.6, `${half}`);
  assert.equal(weightBelow(new Float32Array(1000), RATE, 250), 0);

  const tail = struck(noise(1, 3), 0.5);
  const whole = lasts(tail, RATE);
  assert.ok(whole > 0.3 && whole < 0.6, `a sound dying away over half a second lasts ${whole.toFixed(2)} s`);
  // silence before it and after it is not part of it
  const padded = new Float32Array(RATE * 2);
  padded.set(tail, RATE / 2);
  assert.ok(Math.abs(lasts(padded, RATE) - whole) < 0.01);
  assert.equal(lasts(new Float32Array(100), RATE), 0);

  // how loud it is where it is loudest: a steady sine's is its rms, wherever in a longer silence it stands
  assert.ok(Math.abs(loudest(sine(0.5, 440, 0.5), RATE) - 0.5 / Math.SQRT2) < 0.005);
  const burst = new Float32Array(RATE);
  burst.set(sine(0.05, 440, 0.5), RATE / 3);
  assert.ok(Math.abs(loudest(burst, RATE) - 0.5 / Math.SQRT2) < 0.01);
  assert.equal(loudest(new Float32Array(1000), RATE), 0);
});

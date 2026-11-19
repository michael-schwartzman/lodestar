// The score, written down: what is played on each sixteenth of each bar in each scene. No Web Audio in here —
// src/audio/music.js plays it — so it runs under `node --test` (test/unit/score.test.mjs).
//
// Decision of 16 November 2026 — the owner: "some background music that nice appropriate at the background".
// Four days before, he had asked for "the annoying humming sounds" to be changed, and the score was cut down to
// a breath of noise and a drum. The two are held together by one rule: a hum is a note that is HELD, and nothing
// here is. Every note is struck — a felted piano, a plucked bass, short bowed strings — and dies away; none may
// sound for longer than MAX_NOTE; there is no pad, no drone, no organ point.
//
// It is in D minor, slow, and it goes round in eight bars, two to a chord: D minor, B flat, G minor, and an A
// with no third in it that leans back towards the D. All four scenes are the same eight bars — the same harmony
// in the same place — so that when the site wakes up the music does not start again: more of it is played.
//   calm    a few notes of the piano to a bar, and one of the bass. Nothing is beaten.
//   tense   the same tune thinned out, the bass twice a bar, a heartbeat under it and a clock ticking.
//   combat  low drums, the strings in quavers, the bass with the drum; the piano only marks the bar.
//   exfil   the fight's music, quicker, the clock in semiquavers, the strings an octave up every other bar.

export const SCENES = ['none', 'calm', 'tense', 'combat', 'exfil'];
/** beats a minute */
export const TEMPO = { none: 72, calm: 72, tense: 84, combat: 124, exfil: 136 };
/** sixteenths in a bar, and bars in the round */
export const STEPS = 16;
export const BARS = 8;
/** the longest any note may sound, in seconds: its whole life, from the stroke to silence */
export const MAX_NOTE = 1.6;
/** D minor, as the twelve notes are numbered from C */
export const SCALE = new Set([2, 4, 5, 7, 9, 10, 0]);

/** How long a sixteenth lasts in a scene, in seconds. */
export const stepSeconds = (scene) => 60 / (TEMPO[scene] || TEMPO.calm) / 4;

// A chord: its bass note and the fifth that answers it, and five notes the piano chooses among, low to high (as
// MIDI numbers: 60 is middle C).
const CHORDS = [
  { bass: 38, fifth: 45, tones: [62, 65, 69, 74, 76] }, // D minor: D F A D, and the E over it
  { bass: 34, fifth: 41, tones: [58, 62, 65, 70, 72] }, // B flat: B♭ D F B♭, and the C
  { bass: 43, fifth: 38, tones: [55, 58, 62, 67, 69] }, // G minor: G B♭ D G, and the A
  { bass: 45, fifth: 40, tones: [57, 62, 64, 69, 67] }, // A, open: A D E A, and the G under the top
];

// What each scene plays in a bar. There are two kinds of bar: the first of a chord's two (A), and the second (B).
// keys and strings: [sixteenth, which of the chord's five notes, how loud]. bass: [sixteenth, 0 the root | 1 the
// fifth over it, how loud]. The drums: [sixteenth, how loud].
const PARTS = {
  calm: {
    keys: {
      A: [
        [0, 2, 0.5],
        [3, 3, 0.42],
        [6, 1, 0.45],
        [10, 2, 0.4],
        [12, 4, 0.5],
      ],
      B: [
        [2, 3, 0.45],
        [6, 2, 0.4],
        [8, 1, 0.45],
        [12, 0, 0.5],
      ],
      seconds: 1.5,
    },
    bass: { A: [[0, 0, 0.6]], B: [[0, 0, 0.55]], seconds: 1.4 },
  },
  tense: {
    keys: {
      A: [
        [0, 2, 0.5],
        [6, 1, 0.45],
        [12, 4, 0.5],
      ],
      B: [
        [2, 3, 0.45],
        [8, 1, 0.45],
        [12, 0, 0.5],
      ],
      seconds: 1.2,
    },
    bass: {
      A: [
        [0, 0, 0.65],
        [10, 1, 0.5],
      ],
      B: [
        [0, 0, 0.65],
        [10, 1, 0.5],
      ],
      seconds: 0.9,
    },
    pulse: [
      [0, 0.7],
      [3, 0.45],
    ],
    tick: [
      [4, 0.2],
      [8, 0.2],
      [12, 0.2],
    ],
  },
  combat: {
    keys: {
      A: [
        [0, 3, 0.5],
        [8, 4, 0.4],
      ],
      B: [
        [4, 2, 0.4],
        [12, 1, 0.45],
      ],
      seconds: 0.9,
    },
    bass: {
      A: [
        [0, 0, 0.8],
        [6, 0, 0.7],
        [10, 1, 0.7],
      ],
      B: [
        [0, 0, 0.8],
        [6, 0, 0.7],
        [10, 1, 0.7],
      ],
      seconds: 0.4,
    },
    // quavers: the root twice, then up through the chord and back to it
    strings: {
      A: [0, 0, 2, 0, 1, 0, 2, 3].map((tone, n) => [n * 2, tone, [0.8, 0.5, 0.6, 0.5, 0.7, 0.5, 0.6, 0.6][n]]),
      B: [0, 0, 2, 0, 1, 0, 2, 3].map((tone, n) => [n * 2, tone, [0.8, 0.5, 0.6, 0.5, 0.7, 0.5, 0.6, 0.6][n]]),
      seconds: 0.16,
      lift: { A: -12, B: -12 },
    },
    low: [
      [0, 0.9],
      [6, 0.7],
      [10, 0.8],
    ],
    hit: [
      [4, 0.6],
      [12, 0.65],
    ],
    tick: [0, 2, 4, 6, 8, 10, 12, 14].map((step) => [step, 0.25]),
  },
};
// the way out is the fight again, with more of it
PARTS.exfil = {
  ...PARTS.combat,
  strings: { ...PARTS.combat.strings, lift: { A: -12, B: 0 } },
  low: [...PARTS.combat.low, [14, 0.7]],
  tick: Array.from({ length: STEPS }, (_, step) => [step, step % 2 ? 0.18 : 0.28]),
};

/** One scene's whole round, worked out once: a list of what starts on each sixteenth. */
function write(scene) {
  const part = PARTS[scene];
  const steps = Array.from({ length: STEPS * BARS }, () => []);
  if (!part) return steps.map(Object.freeze);
  for (let bar = 0; bar < BARS; bar++) {
    const chord = CHORDS[bar >> 1];
    const kind = bar % 2 ? 'B' : 'A';
    const put = (step, event) => steps[bar * STEPS + step].push(Object.freeze(event));
    for (const [step, tone, gain] of part.keys?.[kind] || [])
      put(step, { voice: 'keys', midi: chord.tones[tone], seconds: part.keys.seconds, gain });
    for (const [step, fifth, gain] of part.bass?.[kind] || [])
      put(step, { voice: 'bass', midi: fifth ? chord.fifth : chord.bass, seconds: part.bass.seconds, gain });
    for (const [step, tone, gain] of part.strings?.[kind] || [])
      put(step, {
        voice: 'strings',
        midi: chord.tones[tone] + part.strings.lift[kind],
        seconds: part.strings.seconds,
        gain,
      });
    for (const drum of ['low', 'hit', 'tick', 'pulse'])
      for (const [step, gain] of part[drum] || []) put(step, { voice: drum, gain });
  }
  return steps.map(Object.freeze);
}
const ROUNDS = Object.fromEntries(SCENES.map((scene) => [scene, write(scene)]));
const NOTHING = Object.freeze([]);

/**
 * What starts on a sixteenth of a scene: a list (often empty) of
 *   { voice: 'keys' | 'bass' | 'strings', midi, seconds, gain }   a note: which, how long it sounds, how loud
 *   { voice: 'low' | 'hit' | 'tick' | 'pulse', gain }             a drum, the clock, the heartbeat
 * `step` counts sixteenths from wherever the round began and may be as large as you like: it comes round.
 */
export function scoreAt(scene, step) {
  const written = ROUNDS[scene];
  if (!written) return NOTHING;
  const n = written.length;
  return written[((Math.floor(step) % n) + n) % n];
}

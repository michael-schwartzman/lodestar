// Contract lock: what the score is. Decision of 16 November 2026 — the owner: "some background music that nice
// appropriate at the background", four days after "change the annoying humming sounds". So the game has a score
// again, with notes in it, and it is still never a hum: every note of it is STRUCK and dies away (src/audio/score.js
// says what is played and when; src/audio/music.js plays it; test/smoke.test.mjs measures what comes out).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreAt, SCENES, TEMPO, STEPS, BARS, MAX_NOTE, stepSeconds, SCALE } from '../../src/audio/score.js';

const ROUND = STEPS * BARS;
const PLAYED = ['calm', 'tense', 'combat', 'exfil'];
const round = (scene) => Array.from({ length: ROUND }, (_, step) => scoreAt(scene, step));
const pitched = (events) => events.filter((e) => e.midi !== undefined);
const count = (scene, pick = () => true) => round(scene).reduce((n, events) => n + events.filter(pick).length, 0);

test('there are four scenes with a score, and one with none', () => {
  assert.deepEqual(SCENES, ['none', ...PLAYED]);
  assert.equal(count('none'), 0);
  for (const scene of PLAYED) assert.ok(count(scene) > 0, `${scene} plays nothing`);
  // something nobody has written a score for plays nothing, and does not throw
  assert.deepEqual(scoreAt('elevator', 3), []);
});

test('it is in D minor: every note of every scene is in the scale', () => {
  assert.deepEqual(
    [...SCALE].sort((a, b) => a - b),
    [0, 2, 4, 5, 7, 9, 10],
  );
  for (const scene of PLAYED)
    for (const events of round(scene))
      for (const e of pitched(events))
        assert.ok(
          SCALE.has(((e.midi % 12) + 12) % 12),
          `${scene}: ${e.voice} plays ${e.midi}, which is not in D minor`,
        );
});

test('every note is struck and dies away: none may sound for longer than MAX_NOTE, and that is under two seconds', () => {
  assert.ok(MAX_NOTE > 0.5 && MAX_NOTE < 2, `MAX_NOTE is ${MAX_NOTE}`);
  for (const scene of PLAYED)
    for (const events of round(scene))
      for (const e of events) {
        assert.ok(e.gain > 0 && e.gain <= 1, `${scene}: ${e.voice} at ${e.gain}`);
        if (e.midi === undefined) continue;
        assert.ok(e.seconds > 0.05 && e.seconds <= MAX_NOTE, `${scene}: a ${e.voice} note ${e.seconds} s long`);
      }
});

test('the same note is never struck over and over until it stands still: three times running at the most', () => {
  for (const scene of PLAYED) {
    const last = {};
    for (let step = 0; step < ROUND * 2; step++)
      for (const e of pitched(scoreAt(scene, step))) {
        const run = last[e.voice] && last[e.voice].midi === e.midi ? last[e.voice].run + 1 : 1;
        last[e.voice] = { midi: e.midi, run };
        assert.ok(run <= 3, `${scene}: ${e.voice} strikes ${e.midi} ${run} times running (step ${step})`);
      }
  }
});

test('each voice keeps to its own part of the keyboard', () => {
  const span = { keys: [55, 79], bass: [31, 50], strings: [43, 74] };
  for (const scene of PLAYED)
    for (const events of round(scene))
      for (const e of pitched(events)) {
        assert.ok(span[e.voice], `${scene}: a voice called ${e.voice}`);
        const [lo, hi] = span[e.voice];
        assert.ok(e.midi >= lo && e.midi <= hi, `${scene}: ${e.voice} plays ${e.midi}`);
      }
});

test('a quiet site is played quietly and sparsely; the more the site knows, the more is played', () => {
  const notes = Object.fromEntries(PLAYED.map((scene) => [scene, count(scene)]));
  assert.ok(
    notes.calm < notes.tense && notes.tense < notes.combat && notes.combat <= notes.exfil,
    JSON.stringify(notes),
  );
  // calm: a handful of notes a bar, and nothing that is beaten
  assert.ok(notes.calm / BARS <= 7, `${notes.calm / BARS} notes a bar in the calm scene`);
  const drums = (scene) => count(scene, (e) => e.midi === undefined);
  assert.equal(drums('calm'), 0);
  assert.ok(drums('tense') > 0 && drums('tense') < drums('combat'));
  // and it is slower
  assert.ok(
    TEMPO.calm < TEMPO.tense && TEMPO.tense < TEMPO.combat && TEMPO.combat < TEMPO.exfil,
    JSON.stringify(TEMPO),
  );
  assert.ok(TEMPO.calm >= 60 && TEMPO.exfil <= 150);
  assert.equal(stepSeconds('calm'), 60 / TEMPO.calm / 4);
  // the loudest thing in the calm scene is quieter than the loudest in a fight
  const loudest = (scene) => Math.max(...round(scene).flatMap((events) => events.map((e) => e.gain)));
  assert.ok(loudest('calm') < loudest('combat'));
});

test('the round is eight bars and comes round again; and it is the same every time it is asked', () => {
  assert.equal(STEPS, 16);
  assert.equal(BARS, 8);
  for (const scene of PLAYED)
    for (let step = 0; step < ROUND; step++) {
      assert.deepEqual(scoreAt(scene, step + ROUND), scoreAt(scene, step), `${scene}, step ${step}`);
      assert.deepEqual(scoreAt(scene, step), scoreAt(scene, step));
    }
  // the scenes share one harmony: the bass of each, where it plays at the top of a bar, plays the same root
  for (let bar = 0; bar < BARS; bar++) {
    const roots = PLAYED.map((scene) => scoreAt(scene, bar * STEPS).find((e) => e.voice === 'bass')?.midi % 12);
    assert.equal(new Set(roots).size, 1, `bar ${bar}: the scenes disagree about the harmony (${roots})`);
  }
});

test('every bar of every scene has something in it: the score never falls silent for a bar', () => {
  for (const scene of PLAYED)
    for (let bar = 0; bar < BARS; bar++) {
      let n = 0;
      for (let step = 0; step < STEPS; step++) n += scoreAt(scene, bar * STEPS + step).length;
      assert.ok(n > 0, `${scene}: bar ${bar} is empty`);
    }
});

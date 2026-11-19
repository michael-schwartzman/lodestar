// Music a scene (src/wild/music.js): which cue a moment calls for, and how long a fight's music holds after the
// fight — with no browser in it. The wild build: docs/WILD.md, "Music a scene".
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CUES, MUSIC, createScene, crossInto, cueFor, stepScene } from '../../src/wild/music.js';

const playing = (over = {}) => ({
  state: 'playing',
  screen: null,
  phase: 'infil',
  mood: 'calm',
  hall: false,
  overspeed: false,
  ...over,
});

test('there is a cue a scene, and each is a file in the repository that is not too heavy to fetch', () => {
  assert.deepEqual([...CUES].sort(), ['combat', 'end', 'exfil', 'hall', 'infil', 'overspeed', 'tense', 'title']);
  let total = 0;
  for (const cue of CUES) {
    const file = fileURLToPath(new URL(`../../src/wild/music/${cue}.mp3`, import.meta.url));
    assert.ok(existsSync(file), `${cue}.mp3 is missing`);
    const bytes = statSync(file).size;
    assert.ok(bytes > 300_000 && bytes <= 1_100_000, `${cue}.mp3 is ${bytes} bytes`);
    total += bytes;
  }
  assert.ok(total <= 7_600_000, `the eight weigh ${total} bytes together`);
});

test('unseen, it is the quiet of where you are: the hall has its own, everywhere else the same', () => {
  assert.equal(cueFor(playing()), 'infil');
  assert.equal(cueFor(playing({ hall: true })), 'hall');
});

test('the worse it gets the more it is heard: wary, a fight, the drives pushed, the run out — each over what is under it', () => {
  assert.equal(cueFor(playing({ mood: 'tense' })), 'tense');
  assert.equal(cueFor(playing({ mood: 'tense', hall: true })), 'tense');
  assert.equal(cueFor(playing({ mood: 'combat' })), 'combat');
  assert.equal(cueFor(playing({ mood: 'combat', hall: true })), 'combat');
  // the drives pushed past their limit are louder than the fight they bring
  assert.equal(cueFor(playing({ overspeed: true })), 'overspeed');
  assert.equal(cueFor(playing({ overspeed: true, mood: 'combat' })), 'overspeed');
  // and the run out is over everything: by then the hall is gone
  for (const phase of ['exfil']) {
    assert.equal(cueFor(playing({ phase })), 'exfil');
    assert.equal(cueFor(playing({ phase, mood: 'combat', overspeed: true })), 'exfil');
  }
  // the lodestar raised and the strike not yet called (the mission's `mark`) is still what it was
  assert.equal(cueFor(playing({ phase: 'mark', mood: 'tense' })), 'tense');
});

test('off the mission: the title’s on the title and its menus and when the mission is lost; the ending’s when it is won', () => {
  assert.equal(cueFor({ state: 'title', screen: 'title' }), 'title');
  assert.equal(cueFor({ state: 'title', screen: 'briefing' }), 'title');
  assert.equal(cueFor({ state: 'title', screen: 'controls' }), 'title');
  assert.equal(cueFor({ state: 'over', screen: 'failed' }), 'title');
  assert.equal(cueFor({ state: 'over', screen: 'debrief' }), 'end');
  // the strike coming down on the mountain is the ending already
  assert.equal(cueFor({ state: 'ending', screen: null }), 'end');
  // paused, or going down: nothing is changed — what was playing goes on
  assert.equal(cueFor({ state: 'paused', screen: 'pause' }), null);
  assert.equal(cueFor({ state: 'dying', screen: null }), null);
});

test('a fight’s music holds a while after the fight, and wariness’s after the wariness: it does not flicker', () => {
  const s = createScene();
  const step = (want, seconds) => {
    let cue = s.cue;
    for (let t = 0; t < seconds - 1e-9; t += 0.1) cue = stepScene(s, want, 0.1);
    return cue;
  };
  assert.equal(stepScene(s, 'infil', 0.1), 'infil');
  // up at once
  assert.equal(stepScene(s, 'combat', 0.1), 'combat');
  // the fight is over: for seven seconds it is still the fight's
  assert.equal(step('infil', MUSIC.hold.combat - 0.5), 'combat');
  assert.equal(step('infil', 1), 'infil');
  // wariness: five
  assert.equal(stepScene(s, 'tense', 0.1), 'tense');
  assert.equal(step('infil', MUSIC.hold.tense - 0.5), 'tense');
  assert.equal(step('infil', 1), 'infil');
  // from a fight DOWN to wariness it also holds — and up from wariness to a fight it does not wait
  stepScene(s, 'combat', 0.1);
  assert.equal(step('tense', 2), 'combat');
  assert.equal(step('tense', MUSIC.hold.combat), 'tense');
  assert.equal(stepScene(s, 'combat', 0.1), 'combat');
  // what is over everything is not held back by a hold: the run out, the ending, the title
  stepScene(s, 'combat', 0.1);
  assert.equal(stepScene(s, 'exfil', 0.1), 'exfil');
  stepScene(s, 'combat', 0.1);
  assert.equal(stepScene(s, 'title', 0.1), 'title');
  // "as it is" changes nothing
  assert.equal(stepScene(s, null, 5), 'title');
  assert.ok(MUSIC.hold.combat >= 5 && MUSIC.hold.tense >= 3);
});

test('a fight comes in fast and quiet comes in slowly', () => {
  assert.ok(crossInto('combat') <= 0.8);
  assert.ok(crossInto('overspeed') <= 1);
  assert.ok(crossInto('infil') >= 1.5 && crossInto('title') >= 1.5);
  for (const cue of CUES) assert.ok(crossInto(cue) > 0.2 && crossInto(cue) < 4, cue);
  assert.ok(MUSIC.loop >= 1.5 && MUSIC.loop <= 4);
  assert.ok(MUSIC.keep >= 1 && MUSIC.keep <= 3, 'a decoded cue is twenty megabytes: few are kept');
});

// The second look, behind its switch (`?look=2`), measured in the built game in a real browser.
//
// Decision of 15 November 2026. The owner had asked four times for a game that looks far better than it did; a
// count of what is drawn (13 November) found that no object had a material, that nothing threw a real shadow and
// that metal had nothing to mirror. To the plan — every object a material, one strong light to a space that
// throws real shadows, the surroundings captured for metal to mirror, more shape where the eye rests, and ONE
// VIEW BUILT ALL THE WAY THROUGH FIRST, behind a switch, for him to judge — he said: "go ahead".
//
// The first tests here are that one view: out of the drainage adit into the main cavern (src/look/stations.js).
// The last are the targets for the whole site. They were marked `todo`: they ran, and said how far there was to
// go, and stopped being `todo` — and started being locks — as each was reached. All have been (16 November 2026).
//
// The ceilings of 12 November (test/smoke.test.mjs CEILINGS: a gun of at most 10 000 triangles on a desk) stay as
// they are for the game without the switch — which this file also holds to drawing, lighting and fetching nothing
// of the second look. With the switch they are replaced by the floors and ceilings below: the plan the owner
// agreed to said that they "have to go" — a gun held this near the eye wants five times as many.
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sleep } from '../../tools/lib/browser.mjs';
import { decodePng } from '../../tools/lib/png.mjs';
import { startHarness } from '../helpers/harness.mjs';
import { ARMS } from '../../src/arms.js';
import { BORROWED, MATTER, MATTER_NAMES } from '../../src/gfx/matter.js';
import { noticed } from '../../src/enemies/sight.js';
import { MID } from '../../src/look/exposure.js';
import { KEYS, MIRROR, MIRRORS, ROOM_FILL } from '../../src/look/keys.js';
import { SETUPS as BENCH, addressOf as benchAddress, packRows } from '../../src/look/setups.js';
import { STATIONS } from '../../src/look/stations.js';
import { SPIN } from '../../src/world/spin.js';

/** the materials that have a picture of their own to fetch: concrete's and rock's are the level's, and glass has none */
const OWN_PICTURES = MATTER_NAMES.filter((name) => MATTER[name].picture && !BORROWED[name]);

let harness;
/** the game as it is without the switch */
let plain;
/** with the switch, as a desk gets it */
let desk;
/** with the switch and without the finishing passes: what the materials themselves put on the screen */
let raw;

async function open(query) {
  const page = await harness.browser.newPage();
  await page.navigate(`${harness.url}/?${query}`);
  await page.waitFor('window.__ready === true || !!window.__fatal', { timeoutMs: 120000, label: 'the game to start' });
  assert.equal(await page.evaluate('window.__fatal || null'), null, `?${query}`);
  page.problems = async () => [
    ...JSON.parse(await page.evaluate('JSON.stringify((window.__errors || []).concat(window.__rejections || []))')),
    ...page.exceptions,
    ...page.logErrors,
    ...page.console.filter((m) => m.type === 'error').map((m) => m.text),
  ];
  page.framesIn = async (ms) => {
    const a = await page.evaluate('__G.frames');
    await sleep(ms);
    return (await page.evaluate('__G.frames')) - a;
  };
  page.json = async (expression) => JSON.parse(await page.evaluate(`JSON.stringify(${expression})`));
  page.stand = async (at) => {
    await page.evaluate(`__G.debug.teleport(${at.x}, ${at.z}, ${at.yaw}); __G.player.pitch = ${at.pitch}; void 0`);
    await sleep(350);
  };
  return page;
}

const PLAY = 'autostart=1&noaudio=1&dynres=0&touch=0';
/** nothing on the picture but the game: no HUD; and nobody shooting at the camera while it is counted */
const QUIET = 'document.getElementById("ui").style.display = "none"; __G.player.hidden = true; void 0';

before(async () => {
  harness = await startHarness();
  plain = await open(PLAY);
  desk = await open(`look=2&${PLAY}`);
  raw = await open(`look=2&post=0&${PLAY}`);
  for (const page of [plain, desk, raw]) await page.evaluate(QUIET);
});

after(async () => {
  await harness?.stop();
});

/** What a model weighs, and how much of it says what it is made of. */
const WEIGH = `((root) => {
  let triangles = 0, lit = 0, tagged = 0, wrapped = true, lettering = 0;
  root.traverse((m) => {
    const g = m.geometry;
    if (!m.isMesh || !g) return;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    triangles += n;
    if (m.name === 'lettering') lettering++;
    if (!m.material || !m.material.uniforms || !m.material.uniforms.uRim || m.name === 'lettering') return;
    lit += n;
    if (!m.material.defines.LODE_MATTER) wrapped = false;
    const mat = g.attributes.mat;
    if (!mat) return;
    for (let i = 0; i < n; i++) if (mat.getX(g.index ? g.index.getX(i * 3) : i * 3) >= 0) tagged++;
  });
  return { triangles: Math.round(triangles), tagged: lit ? tagged / lit : 0, wrapped, lettering };
})`;

/** The picture on the page, as pixels. */
const picture = async (page) => decodePng(await page.screenshot());

/** Counts a picture drawn with `debug.classes(true)`: green has a material, magenta is bare paint. */
function classes({ data }) {
  let material = 0;
  let bare = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (g > 200 && r < 90 && b < 90) material++;
    else if (r > 200 && b > 200 && g < 90) bare++;
  }
  return { material, bare, all: data.length / 4 };
}

const median = (list) => list.slice().sort((a, b) => a - b)[list.length >> 1];

/** to `debug.keySolo`: a number no key light has — none of them burns */
const NO_KEY = 99;

/**
 * Stops the game where it stands, for reading pictures against what the processor works out: every door shut
 * (their leaves put where shut doors are), every machine out of the picture — a machine's shadow, or a door half
 * open, is in the picture and not in the sum. The picture goes on being drawn. THAW sets it going again.
 */
const FREEZE =
  '__G.debug.pause(); __G.world.updateDoors(10, [], null); for (const u of __G.enemies.list) u.model.root.visible = false; void 0';
const THAW = '__G.debug.resume(); void 0';

// What "without the switch" means, exactly. Nothing of the second look is drawn, lit or fetched: no material has a
// line of its shader, no model carries the attribute, the look's code and pictures are not downloaded. What IS
// different from before 15 November: the one script a player downloads is 24.8 kB (3.0%) larger — 863.5 kB where
// it was 838.7 — because it carries the second look's shader text and the world builder's hooks, fenced off. That
// is all, and it is held to staying so: under 870 kB.
//
// Decision of 16 November 2026: the ceiling is 880 kB. Nothing of the second look was added to that script. The
// GAME grew: the owner asked for lamps that can be shot out, an EMP that puts a room in the dark, and drones that
// can be found far off — for everybody, with the switch or without — and that is 13.5 kB of the one script
// (858 557 bytes → 872 027): the level's light worked out again when a lamp goes out, the rules of it, three
// sounds, the drones' lights. The ceiling was put there to hold what the second look costs somebody who never
// switches it on; it still holds that, ten thousand bytes higher. What the second look itself gained (its key
// lights go out too) is in its own script, which is fetched only with the switch: 1.2 kB.
//
// Decision of 16 November 2026, later the same day: the ceiling is 905 kB. The GAME grew, by 24.7 kB (872 027 →
// 896 705), because the owner asked for eight things in one afternoon, for everybody: a reload that is seen and
// heard; sounds with weight in them; a score; machines that find their fallen and raise the alarm; wrecks that
// can be dragged; an alarm and a wave of machines for every charge; casings that turn; a title in the middle of
// a desk's screen. Of the second look, one hook of a few lines came into this script with the turning — the
// casings' colours kept as they were before their streaks, for what metal mirrors to be taken in
// (`cascade.still`) — and its own script gained 61 bytes for calling it (204 353 → 204 414). The ceiling goes on
// holding what it was put there to hold: the next thing added to this script has to be the game's, and has to be
// asked for.
const SCRIPT_CEILING = 905_000;
test('without the switch nothing of the second look is drawn, lit or fetched', async () => {
  const assets = fileURLToPath(new URL('../../dist/assets/', import.meta.url));
  const scripts = readdirSync(assets).filter((name) => /^index-.*\.js$/.test(name));
  assert.equal(scripts.length, 1, `the game's own script: ${scripts}`);
  const bytes = statSync(`${assets}${scripts[0]}`).size;
  assert.ok(bytes <= SCRIPT_CEILING, `the script every player downloads is ${bytes} bytes; it was 838 700`);
  const facts = await plain.json(`(() => {
    const G = __G, found = new Set();
    let carried = 0;
    for (const root of [G.world.group.parent, G.weapon.scene])
      root.traverse((o) => {
        for (const d of Object.keys((o.material && o.material.defines) || {})) found.add(d);
        if (o.geometry && o.geometry.attributes && o.geometry.attributes.mat) carried++;
      });
    const fetched = performance.getEntriesByType('resource').map((r) => r.name.split('/').pop());
    return {
      look: G.look,
      defines: [...found].filter((d) => /MATTER|KEY|ENVCUBE|LOOK/.test(d)),
      carried,
      keys: (G.world.keys || []).length,
      mirror: !!G.world.env,
      marks: G.world.stats.marks.squares + G.world.group.children.filter((o) => o.name === 'marks').length,
      scripts: fetched.filter((n) => /\\.js(\\?|$)/.test(n)).length,
      pictures: fetched.filter((n) => /^(${OWN_PICTURES.join('|')})\\.\\d+-/.test(n)),
    };
  })()`);
  assert.deepEqual(facts, {
    look: 1,
    defines: [],
    carried: 0,
    keys: 0,
    mirror: false,
    marks: 0,
    scripts: 1,
    pictures: [],
  });
  assert.deepEqual(await plain.problems(), []);
});

test('with the switch, the view out of the adit has a material on everything in it — the gun included', async () => {
  assert.equal(await raw.evaluate('__G.look'), 2);
  await raw.evaluate('__G.debug.classes(true); void 0');
  try {
    for (const [name, at] of Object.entries(STATIONS)) {
      await raw.stand(at);
      const seen = classes(await picture(raw));
      const surfaces = seen.material + seen.bare;
      // the count must be of a picture that is mostly surfaces: not passed by a screen of sky, lamps or nothing
      assert.ok(surfaces > seen.all * 0.6, `${name}: only ${surfaces} of ${seen.all} pixels are surfaces`);
      assert.ok(
        seen.material >= surfaces * 0.99,
        `${name}: ${((100 * seen.bare) / surfaces).toFixed(1)}% of what is on screen is bare paint`,
      );
    }
  } finally {
    await raw.evaluate('__G.debug.classes(false); void 0');
  }
});

test('the gun in the hands is built for a desk: 35 000 triangles or more, and it says what it is made of', async () => {
  const gun = await desk.json(`${WEIGH}(__G.weapon.scene.children[0])`);
  assert.ok(gun.triangles >= 35000, `the carbine is ${gun.triangles} triangles`);
  assert.ok(gun.triangles <= 60000, `the carbine is ${gun.triangles} triangles: more than its ceiling`);
  assert.equal(gun.wrapped, true, 'its materials do not wrap pictures round it');
  assert.ok(gun.tagged >= 0.95, `only ${(gun.tagged * 100).toFixed(0)}% of it has a material`);
  assert.ok(gun.lettering >= 1, 'nothing is written on it');
});

test('a sentry: 14 000 triangles or more, a material on it, and its number', async () => {
  const sentry = await desk.json(`${WEIGH}(__G.enemies.list.find((u) => u.type === 'sentry').model.root)`);
  assert.ok(sentry.triangles >= 14000, `a sentry is ${sentry.triangles} triangles`);
  assert.ok(sentry.triangles <= 24000, `a sentry is ${sentry.triangles} triangles, and there are fifteen of them`);
  assert.equal(sentry.wrapped, true);
  assert.ok(sentry.tagged >= 0.95, `only ${(sentry.tagged * 100).toFixed(0)}% of it has a material`);
  assert.ok(sentry.lettering >= 1, 'it has no number');
});

test('the truck and the container: more shape than they had, a material on every part, and lettering', async () => {
  const kinds = await desk.json('__G.world.stats.kinds');
  const FLOOR = { truck: 10000, container: 5000 };
  const CEILING = { truck: 30000, container: 14000 };
  for (const kind of ['truck', 'container']) {
    const k = kinds[kind];
    assert.ok(k, `nothing is known about the ${kind}`);
    assert.ok(
      k.triangles >= FLOOR[kind],
      `a ${kind} is ${k.triangles} triangles (it was ${kind === 'truck' ? 2522 : 2264})`,
    );
    assert.ok(k.triangles <= CEILING[kind], `a ${kind} is ${k.triangles} triangles`);
    assert.ok(k.tagged >= 0.95, `only ${(k.tagged * 100).toFixed(0)}% of a ${kind} has a material`);
    assert.ok(k.lettering >= 1, `nothing is written on a ${kind}`);
  }
  // and the default rule covers what nobody tuned by hand: no kind of prop on the site is left bare
  for (const [kind, k] of Object.entries(kinds)) assert.ok(k.tagged >= 0.95, `${kind}: ${k.tagged}`);
});

// Decision of 15 November 2026, the same evening. The plan said "one strong light to a space". One is not enough
// here: by a single flood behind the containers every face the eye is on is in the dark (`debug.keySolo(1)`
// shows it). The yard has two: one that lights what is looked at, one behind it. What is asked of a key light
// is not made any less by that: every one of them is held to it, alone, with the others put out.
//
// 16 November 2026: there is a lamp in every space now, twenty-eight of them, and each is held to it where it
// shines — the game says where to stand to look at each (`debug.keyStation`). Their depth pictures are tiles of
// two larger pictures (look/keylight.js): what is asked here is asked of every tile.
test('strong lights throw real shadows: where a ray to one is blocked the ground is dark, and where not, lit', async () => {
  const keys = await desk.json('__G.world.keys');
  assert.equal(keys.length, KEYS.length);
  // the gun is put away for the pictures: it would stand in front of the ground they are read from
  await raw.evaluate(`__G.weapon.scene.visible = false; ${FREEZE}`);
  /** the lamps whose shadows could be read: enough ground in their light AND enough in their shadow was in view */
  const read = [];
  // Two pictures: one lamp alone, and no key light at all. What the lamp ADDS at each point is the one against
  // the other — a space's own lamps are not the same everywhere (a post stands in one shadow), so a lit point
  // is held against itself unlit, not against some other point. `shot` gives the picture's brightness at a point.
  //
  // 16 November 2026: every space has a capture of itself now, and wet ground in a lamp's shadow does mirror the
  // wall that lamp lights — rightly. What is held to the ray here is the lamp's OWN light, so what is mirrored is
  // kept as it was between the two pictures (`keySolo(k, true)`): the same in both, it divides out. And what is
  // kept is the place with no key light in it (asked for once, below, before any picture): a capture of a lit
  // place would brighten both pictures and make every lamp look weaker than it is.
  await raw.evaluate(`__G.debug.keySolo(${NO_KEY}); void 0`);
  const shot = async (solo) => {
    await raw.evaluate(`__G.debug.keySolo(${solo}, true); void 0`);
    await sleep(120);
    const image = await picture(raw);
    const scaleX = image.width / 1280;
    const scaleY = image.height / 720;
    return ({ px, py }) => {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const i = (Math.round(py * scaleY + dy) * image.width + Math.round(px * scaleX + dx)) * 4;
          sum += image.data[i] * 0.3 + image.data[i + 1] * 0.59 + image.data[i + 2] * 0.11;
        }
      return sum / 9;
    };
  };
  try {
    for (const [k, key] of keys.entries()) {
      const at = await raw.json(`__G.debug.keyStation(${k})`);
      assert.ok(at, `${key.name}: there is nowhere to stand to look at it`);
      await raw.stand(at);

      // The game is asked for points on the ground that are in view and well inside the beam, and whether a
      // straight line from each to the lamp is clear — worked out on the processor, against the real shapes, the
      // way a round is. The picture is then read at those points, with this lamp alone burning. The two must
      // agree: that is what makes the shadows real.
      const points = await raw.json(`__G.debug.keySamples(${k})`);
      const lit = points.filter((p) => p.lit);
      const dark = points.filter((p) => !p.lit);
      assert.ok(lit.length >= 12, `${key.name}: ${lit.length} lit points in view from (${at.x}, ${at.z})`);
      const withIt = await shot(k);
      // …and what the lamp is, while it alone burns: in a slot, its tile drawn
      const now = (await raw.json('__G.world.keys'))[k];
      assert.ok(now.slot >= 0 && now.level === 1, `${key.name}: alone, it is in slot ${now.slot} at ${now.level}`);
      assert.ok(now.map >= 1024, `${key.name}: its depth picture is ${now.map} pixels across`);
      assert.ok(now.casters >= 20, `${key.name}: only ${now.casters} things can throw a shadow`);
      assert.ok(now.drawn >= 2000, `${key.name}: only ${now.drawn} triangles were drawn into its depth picture`);
      assert.equal(now.moving, true, 'on a desk the shadows of moving things are kept up to date');
      assert.equal(now.taps, 16, 'on a desk a shadow’s edge is asked at sixteen points');
      const without = await shot(NO_KEY);
      const gain = (p) => withIt(p) / Math.max(1, without(p));
      // where the lamp's light arrives well — four tenths of it or more — if enough such ground is in view
      const well = lit.filter((p) => p.reach >= 0.4);
      const inLight = median((well.length >= 12 ? well : lit).map(gain));
      const wrongOnes = dark.filter((p) => gain(p) > (1 + inLight) / 2);
      if (process.env.LOOK_NUMBERS) {
        console.log(
          `KEYNUM ${String(k).padStart(2)} ${key.name.padEnd(30)} lit ${String(lit.length).padStart(3)} dark ${String(dark.length).padStart(3)} well ${String(well.length).padStart(3)} inLight ${inLight.toFixed(2)} inShadow ${dark.length ? median(dark.map(gain)).toFixed(2) : '-'} wrong ${wrongOnes.length} drawn ${now.drawn} base ${median(lit.map(without)).toFixed(0)}`,
        );
        if (wrongOnes.length > 4)
          console.log(
            `KEYWRONG ${k} from (${at.x}, ${at.z}): ${wrongOnes
              .filter((_, n) => n % Math.ceil(wrongOnes.length / 14) === 0)
              .map((p) => `(${p.x},${p.z})`)
              .join(' ')}`,
          );
        if (dark.length >= 20 && median(dark.map(gain)) > 1.05)
          console.log(
            `KEYDARK ${k} from (${at.x}, ${at.z}, yaw ${at.yaw}): ${dark
              .filter((_, n) => n % Math.ceil(dark.length / 16) === 0)
              .map((p) => `(${p.x},${p.z}) ${gain(p).toFixed(2)} was ${without(p).toFixed(0)}`)
              .join(' | ')}`,
          );
      }
      // What is read is the picture, after the tone curve, and ground is the surface a lamp lights least — it
      // lies nearly flat to a lamp across a yard, and a room's floor has the room's own lamps on it already. A
      // quarter brighter there is a lamp that is seen (the weakest measured was a third: the flood on the
      // portal, 1.33); the walls and things that face a lamp get several times that.
      // (From the slice's own station its two lamps are still held to half as much again: further down.)
      assert.ok(inLight >= 1.25, `${key.name}: it makes the ground it reaches ${inLight.toFixed(2)} times as bright`);
      if (dark.length < 20) continue;
      const inShadow = median(dark.map(gain));
      assert.ok(inShadow <= 1.1, `${key.name}: it makes ground in its shadow ${inShadow.toFixed(2)} times as bright`);
      assert.ok(
        wrongOnes.length <= dark.length * 0.15,
        `${key.name}: ${wrongOnes.length} of ${dark.length} shadowed points are lit by it all the same`,
      );
      read.push(key.name);
    }

    // The slice of 15 November, as it was held then: from the yard station, each of its two lamps makes the
    // ground it reaches half as bright again, and leaves the ground in its shadow alone.
    await raw.stand(STATIONS.yard);
    for (const k of [0, 1]) {
      const points = await raw.json(`__G.debug.keySamples(${k})`);
      const lit = points.filter((p) => p.lit);
      const dark = points.filter((p) => !p.lit);
      assert.ok(lit.length >= 20 && dark.length >= 20, `${keys[k].name}: ${lit.length} lit, ${dark.length} shadowed`);
      const withIt = await shot(k);
      const without = await shot(NO_KEY);
      const gain = (p) => withIt(p) / Math.max(1, without(p));
      const inLight = median(lit.map(gain));
      const inShadow = median(dark.map(gain));
      assert.ok(inLight >= 1.5, `${keys[k].name}, from the yard: ${inLight.toFixed(2)} times as bright in its light`);
      assert.ok(inShadow <= 1.1, `${keys[k].name}, from the yard: ${inShadow.toFixed(2)} times in its shadow`);
      const wrong = dark.filter((p) => gain(p) > (1 + inLight) / 2).length;
      assert.ok(wrong <= dark.length * 0.15, `${keys[k].name}, from the yard: ${wrong} of ${dark.length} wrong`);
    }
  } finally {
    await raw.evaluate(`__G.debug.keySolo(-1); __G.weapon.scene.visible = true; ${THAW}`);
  }
  // a lamp in an empty room has no shadow to be read; a dozen have, and every flood over the yard has
  assert.ok(read.length >= 12, `shadows could be read for only ${read.length}: ${read.join(', ')}`);
  for (const key of keys.filter((k) => k.name.startsWith('yard flood')))
    assert.ok(read.includes(key.name), `${key.name}: its shadows could not be read`);
});

// Decision of 16 November 2026. As first written (for the two lamps of the slice) this test also held somebody
// standing in a key light to being seen "better than without the switch". With a lamp in every space that made
// the site harder: what a machine's attention is multiplied by, summed over the floor of the main cavern, came
// to 1.65 times what it is without the switch. The game is not to be made harder by being made to look better,
// so each space is now held to being AS WATCHFUL AS IT WAS on the whole (the next test), and that one clause is
// replaced by what it was there to guard: in a lamp's light a body is seen better than in its shadow.
test('a key light counts in the game as it does in the picture: you are seen in it, and its shadow hides you', async () => {
  const keys = await desk.json('__G.world.keys');
  const seen = (p) => `__G.world.visibility(${p.x}, ${p.z})`;
  // the game's own sums were worked out with every door open (light goes through a doorway): so are these
  await desk.evaluate('__G.debug.pause(); for (const d of __G.world.grid.doors) d.open = 1; void 0');
  let all = [];
  /** the lamps with a shadow somebody could stand in, in view of where they were looked at from */
  const held = [];
  /** …and those with a shadow no other lamp shines into */
  const hidden = [];
  try {
    for (const [k, key] of keys.entries()) {
      await desk.stand(await desk.json(`__G.debug.keyStation(${k})`));
      // what the game counts is the light on a body, not on the ground under it: the sight line is from the chest
      const points = await desk.json(`__G.debug.keySamples(${k})`);
      const lit = points.filter((p) => p.chest && p.reach > 0.4).slice(0, 12);
      // in its shadow: where neither the chest of somebody standing nor the ground at their feet sees the lamp —
      // and the same is so a step away on every side. (16 November 2026. The game's sums are a cell coarse, and
      // at a shadow's edge they are a blend of both sides by construction — which the limits below always allowed
      // for, by taking the middle one of twelve points. With the furniture built again the first twelve
      // shadowed points of the dock flood all lay along the edge of a one-metre gap between two containers,
      // and their middle one was at the edge too: 0.27 where the limit is 0.18. What "its shadow hides you" asks
      // is asked of where a body can be IN a shadow: a step or more inside it. The limits are what they were.)
      const shade = points.filter((p) => !p.chest && !p.lit && p.reach > 0.4);
      const dark = shade.filter((p) => points.every((q) => !q.chest || Math.hypot(q.x - p.x, q.z - p.z) > 1.1));
      assert.ok(lit.length >= 6, `${key.name}: ${lit.length} places to stand in its light`);
      const counted = (list) => desk.json(`[${list.map((p) => `__G.world.keyAt(${p.x}, ${p.z}, ${k})`).join(',')}]`);
      const inLight = median(await counted(lit));
      assert.ok(inLight >= 0.3, `${key.name}: the game counts ${inLight.toFixed(2)} of it on somebody in its light`);
      all = all.concat(lit.slice(0, 2));
      if (dark.length < 6) continue;
      const inShadow = median(await counted(dark.slice(0, 12)));
      // the two lamps of the slice as they were held on the 15th; the rest by the same rule in proportion — a
      // weaker lamp is counted for less in its light, and the game's sheets are a cell coarse: at a shadow's
      // edge they are a blend of both sides
      assert.ok(
        k < 2
          ? inLight >= inShadow + 0.3 && inShadow <= 0.12
          : inLight >= inShadow + 0.25 && inShadow <= Math.max(0.12, inLight * 0.25),
        `${key.name}: the game counts ${inLight.toFixed(2)} of it in its light and ${inShadow.toFixed(2)} in its shadow`,
      );
      held.push(key.name);
      all = all.concat(dark.slice(0, 2));
      // …and what a guard goes by is all of the light together. This lamp makes somebody standing in its light
      // easier to see than they would be without it: by a tenth or more — or as well seen as anything can be
      const withIt = await desk.json(`[${lit.map(seen).join(',')}]`);
      const withoutIt = await desk.json(`[${lit.map((p) => `__G.world.visibility(${p.x}, ${p.z}, ${k})`).join(',')}]`);
      const added = median(withIt.map((v, n) => v - withoutIt[n]));
      assert.ok(
        added >= 0.1 || median(withIt) >= 0.97,
        `${key.name}: in its light somebody is seen at ${median(withIt).toFixed(2)}; without it, ${median(withoutIt).toFixed(2)}`,
      );
      // …while in its shadow it adds next to nothing
      const shaded = dark.slice(0, 12);
      const inShade = await desk.json(`[${shaded.map(seen).join(',')}]`);
      const inShadeWithout = await desk.json(
        `[${shaded.map((p) => `__G.world.visibility(${p.x}, ${p.z}, ${k})`).join(',')}]`,
      );
      const leaked = median(inShade.map((v, n) => v - inShadeWithout[n]));
      assert.ok(
        leaked <= 0.06,
        `${key.name}: in its shadow it still adds ${leaked.toFixed(2)} to how well somebody is seen`,
      );
      if (added >= 0.1) hidden.push(key.name);
    }
  } finally {
    await desk.evaluate(THAW);
  }
  assert.ok(held.length >= 8, `only these have a shadow to stand in: ${held.join(', ')}`);
  assert.ok(hidden.length >= 6, `only these have a shadow that hides somebody: ${hidden.join(', ')}`);
  for (const name of ['yard flood, south', 'yard flood, east']) assert.ok(held.includes(name), `${name} was not held`);
  // the whole is the sum of its parts: nothing is counted that no lamp gives, and no lamp is left out
  const sums = await desk.json(
    `[${all.map((p) => `[__G.world.keyAt(${p.x}, ${p.z}), ${keys.map((_, k) => `__G.world.keyAt(${p.x}, ${p.z}, ${k})`).join(' + ')}]`).join(',')}]`,
  );
  for (const [whole, parts] of sums) assert.ok(Math.abs(whole - parts) < 1e-5, `${whole} is not ${parts}`);
  // …while the light that moving things are SHADED by has not got the key lights in it (the picture adds them per
  // pixel, with their shadows). In the cavern it is what it is without the switch; under a roof it is that turned
  // down to be the fill beside the room's key light (src/look/keys.js ROOM_FILL). (The light at a point is a
  // blend of the four cells round it: points with a roof over some of those and not others are left out.)
  const probe = (p) =>
    `(() => { const c = { r: 0, g: 0, b: 0, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; } }; __G.world.probe(${p.x}, ${p.z}, c); let roofs = 0; for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) if (__G.world.indoors(${p.x} + dx, ${p.z} + dz)) roofs++; return [c.r, c.g, c.b, roofs]; })()`;
  let roofed = 0;
  let open = 0;
  for (const p of all) {
    const now = await desk.json(probe(p));
    if (now[3] !== 0 && now[3] !== 4) continue;
    const was = await plain.json(probe(p));
    const fill = now[3] ? ROOM_FILL : 1;
    if (now[3]) roofed++;
    else open++;
    for (let c = 0; c < 3; c++)
      assert.ok(Math.abs(now[c] - was[c] * fill) < 1e-4, `the probe at ${p.x}, ${p.z}: ${now} was ${was}`);
  }
  assert.ok(roofed >= 8 && open >= 8, `${roofed} points under a roof and ${open} in the open were looked at`);
});

test('each space is as watchful as it was: what the light does to a machine’s attention, summed over its floor', async () => {
  // for every cell of floor, how well lit a body standing on it is — as the game has it, in both looks
  const floor = (page) =>
    page.json(`(() => {
      const w = __G.world, g = w.grid, zones = {};
      for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) if (g.walkable(x, z))
        (zones[g.zone[z * g.w + x]] ||= []).push(+w.visibility(x + 0.5, z + 0.5).toFixed(4));
      return zones;
    })()`);
  const now = await floor(desk);
  const was = await floor(plain);
  const attention = (list) => list.reduce((sum, v) => sum + noticed(v), 0);
  let spaces = 0;
  let brighter = 0;
  let darker = 0;
  for (const [zone, cells] of Object.entries(was)) {
    assert.equal(now[zone].length, cells.length);
    if (cells.length < 40) continue;
    spaces++;
    const ratio = attention(now[zone]) / attention(cells);
    assert.ok(Math.abs(ratio - 1) <= 0.03, `zone ${zone}: ${ratio.toFixed(3)} times as watchful as without the switch`);
    // light counts for more than it did, not less: some of the floor is better lit than it was, some worse
    for (const [n, v] of cells.entries()) {
      if (now[zone][n] > v + 0.1) brighter++;
      if (now[zone][n] < v - 0.1) darker++;
    }
  }
  assert.ok(spaces >= 15, `${spaces} spaces were held to it`);
  assert.ok(brighter > 600 && darker > 600, `${brighter} cells are better lit than they were, ${darker} worse`);
});

test('what is in the hands is lit by a key light too — by a sight line from the eye, since it is not in the world', async () => {
  // every material in the hands is told that the sum done pixel by pixel in the world is not for it…
  const gains = await desk.json(`(() => {
    const out = [];
    __G.weapon.scene.traverse((o) => { const u = o.material && o.material.uniforms; if (u && u.uKeyGain && u.uRim) out.push(u.uKeyGain.value); });
    return out;
  })()`);
  assert.ok(gains.length > 0 && gains.every((g) => g === 0), `the gun's materials take the key lights at ${gains}`);
  // …and gets the lamp's light by hand instead: there when the eye is in it, gone when the eye is in its shadow
  await desk.stand(STATIONS.yard);
  const points = await desk.json('__G.debug.keySamples(0)');
  const lit = points.filter((p) => p.lit && p.chest && p.reach > 0.5).slice(0, 3);
  const dark = points.filter((p) => !p.lit && !p.chest && p.reach > 0.4).slice(0, 3);
  assert.ok(lit.length === 3 && dark.length === 3, `${lit.length} lit and ${dark.length} shadowed places to stand`);
  const onGun = async (p) => {
    await desk.stand({ x: p.x, z: p.z, yaw: STATIONS.yard.yaw, pitch: 0 });
    await sleep(600);
    const k = await desk.json('__G.weapon.keyHeld');
    return k.r * 0.3 + k.g * 0.59 + k.b * 0.11;
  };
  await desk.evaluate('__G.debug.keySolo(0); void 0');
  try {
    const inLight = [];
    const inShadow = [];
    for (const p of lit) inLight.push(await onGun(p));
    for (const p of dark) inShadow.push(await onGun(p));
    assert.ok(median(inLight) >= 0.5, `in the lamp's light the gun gets ${median(inLight).toFixed(2)} of it`);
    assert.ok(median(inShadow) <= 0.05, `in its shadow the gun still gets ${median(inShadow).toFixed(2)}`);
  } finally {
    await desk.evaluate('__G.debug.keySolo(-1); void 0');
  }
});

// A sight is for looking through. Found on 15 November 2026, in the first picture taken with the new carbine's
// sight raised: its lens was a dark disc in the middle of the screen, over whatever was aimed at. The gun without
// the switch has an open window; so must any that stands in for it.
test('with the sight raised, nothing of the gun stands between the eye and what is aimed at — in either look', async () => {
  // Lines from the eye — the middle of the little scene the hands are drawn in — through the sight's window: its
  // centre, and four points three millimetres off it (the dot is under two across). Every triangle of the gun any
  // of them crosses is in the way. No wider than that: the tip of the folded front sight shows in the bottom of
  // the window, eight millimetres down, in the gun as it is, and that is a sight picture, not a fault.
  const IN_THE_WAY = `(() => {
    const w = __G.weapon, root = w.scene.children[0];
    w.scene.updateMatrixWorld(true);
    let dot = null;
    root.traverse((o) => { if (o.isMesh && o.material && o.material.userData && o.material.userData.lode === 'glow') dot = o; });
    if (!dot) return ['the sight has no dot'];
    const s = dot.matrixWorld.elements;
    const rays = [[0, 0], [0.003, 0], [-0.003, 0], [0, 0.003], [0, -0.003]].map(([dx, dy]) => {
      const x = s[12] + dx, y = s[13] + dy, z = s[14], l = Math.hypot(x, y, z);
      return [x / l, y / l, z / l];
    });
    const crossed = {};
    root.traverse((o) => {
      if (!o.isMesh || o === dot) return;
      for (let up = o; up; up = up.parent) if (!up.visible) return;
      const p = o.geometry.attributes.position, index = o.geometry.index, m = o.matrixWorld.elements;
      const n = index ? index.count : p.count;
      const corner = (i) => {
        const k = index ? index.getX(i) : i, x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      };
      for (let i = 0; i + 2 < n; i += 3) {
        const a = corner(i), b = corner(i + 1), c = corner(i + 2);
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        for (const d of rays) {
          const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
          const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
          if (Math.abs(det) < 1e-12) continue;
          const u = -(a[0] * h[0] + a[1] * h[1] + a[2] * h[2]) / det;
          if (u < 0 || u > 1) continue;
          const q = [-(a[1] * e1[2] - a[2] * e1[1]), -(a[2] * e1[0] - a[0] * e1[2]), -(a[0] * e1[1] - a[1] * e1[0])];
          const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
          if (v < 0 || u + v > 1) continue;
          const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
          if (t > 1e-4) crossed[o.name || 'a part of the gun'] = (crossed[o.name || 'a part of the gun'] || 0) + 1;
        }
      }
    });
    return Object.entries(crossed).map(([name, count]) => name + ': ' + count + ' crossings');
  })()`;
  for (const [name, page] of [
    ['without the switch', plain],
    ['with it', desk],
  ]) {
    await page.stand(STATIONS.yard);
    await page.holdKey('KeyZ', 'z', 0, 120);
    try {
      await page.waitFor('__G.weapon.aim > 0.98', { timeoutMs: 8000, label: `${name}: the sight to come up` });
      await sleep(150);
      assert.deepEqual(await page.json(IN_THE_WAY), [], `${name}: something of the gun is in the line of sight`);
    } finally {
      await page.holdKey('KeyZ', 'z', 0, 120);
      await page.waitFor('__G.weapon.aim < 0.02', { timeoutMs: 8000, label: `${name}: the sight to come down` });
    }
  }
});

test('metal has the cavern to mirror: it was captured, there is something in it, and the view stands inside it', async () => {
  await desk.stand(STATIONS.yard);
  await sleep(400);
  const mirror = await desk.json('__G.world.env');
  assert.ok(mirror, 'nothing was captured');
  assert.equal(mirror.name, 'yard, west');
  assert.ok(mirror.size >= 64, `the capture is ${mirror.size} pixels across`);
  assert.ok(mirror.mean > 0.002, `the capture is black: ${mirror.mean}`);
  assert.deepEqual(mirror.box, MIRROR.box);
  const [x0, z0, x1, z1] = mirror.box;
  for (const [name, at] of Object.entries(STATIONS).filter(([name]) => name !== 'start'))
    assert.ok(at.x > x0 && at.x < x1 && at.z > z0 && at.z < z1, `${name} is outside what was captured`);
  // every lit surface of the world can mirror it — but a mark: a stain, or the dark under a thing, mirrors nothing,
  // and is told so (16 November 2026, world/build.js: with a bright place captured round it, a mark that mirrored
  // it was brighter than the floor it lay on let through)
  const defined = await desk.json(`(() => {
    let all = true, any = false, marks = 0, mirroring = 0;
    __G.world.group.traverse((o) => {
      const m = o.material;
      if (!m || !m.uniforms || !m.uniforms.uRim) return;
      if (o.name === 'marks') { marks++; if (m.defines.LODE_ENVCUBE) mirroring++; return; }
      any = true;
      if (!m.defines.LODE_ENVCUBE) all = false;
    });
    return { every: any && all, marks: marks > 0, mirroring };
  })()`);
  assert.deepEqual(defined, { every: true, marks: true, mirroring: 0 }, 'not every surface can mirror it');
});

// 16 November 2026, the plan's third step: "one captured view of each kind of space". There is one of each
// space now (src/look/keys.js MIRRORS), taken the first time the eye is in it — its key lights burn only when
// the eye is near, and a capture is of a place as it is lit — and kept. The one that is mirrored is the one
// whose box the eye is in.
test('a place is captured the first time the eye is in it, and kept: the hall mirrors the hall, a room its room', async () => {
  const page = await open(`look=2&${PLAY}`);
  await page.evaluate(QUIET);
  const env = () => page.json('__G.world.env');
  const start = await env();
  assert.equal(start.name, 'drainage adit', 'the game starts in the adit');
  assert.deepEqual(start.captured, ['drainage adit']);
  assert.equal(start.captures, 1);
  // a walk through the site: at each place, its own capture, made once, with something in it
  const walk = [
    ['yard, west', STATIONS.yard],
    [
      'cascade hall',
      await page.json(`__G.debug.keyStation(${KEYS.findIndex((k) => k.name === 'cascade hall, south-west')})`),
    ],
    ['control room', await page.json(`__G.debug.keyStation(${KEYS.findIndex((k) => k.name === 'control room')})`)],
    ['corridor', { x: 65.5, z: 44.5, yaw: Math.PI / 2, pitch: 0 }],
    [
      'shaft cavern',
      await page.json(`__G.debug.keyStation(${KEYS.findIndex((k) => k.name === 'the moon, down the shaft')})`),
    ],
    ['tunnel and forecourt', { x: 64.5, z: 92.5, yaw: 0, pitch: 0 }],
  ];
  let made = start.captures;
  for (const [name, at] of walk) {
    await page.stand(at);
    await page.waitFor(`__G.world.env.name === ${JSON.stringify(name)} && __G.world.env.presence === 1`, {
      timeoutMs: 4000,
      label: `the capture of the ${name}`,
    });
    const here = await env();
    assert.equal(here.captures, ++made, `${name}: ${here.captures} captures have been made`);
    assert.ok(here.mean > 0.002, `the capture of the ${name} is black: ${here.mean}`);
    const place = MIRRORS.find((m) => m.name === name);
    assert.deepEqual(here.box, place.box);
    assert.ok(at.x > place.box[0] && at.x < place.box[2] && at.z > place.box[1] && at.z < place.box[3]);
  }
  // back where it has been: nothing is captured again
  for (const [name, at] of walk.slice(0, 3)) {
    await page.stand(at);
    await page.waitFor(`__G.world.env.name === ${JSON.stringify(name)} && __G.world.env.presence === 1`, {
      timeoutMs: 4000,
      label: `the capture of the ${name}, again`,
    });
    assert.equal((await env()).captures, made, `${name} was captured again`);
  }
  assert.deepEqual((await env()).captured.slice().sort(), ['drainage adit', ...walk.map(([name]) => name)].sort());
  // walking, not jumping, from one place into the next: the old capture is faded out and the new one in —
  // from the yard through the lobby's door, a step at a time
  await page.stand({ x: 40.5, z: 57.5, yaw: 0, pitch: 0 });
  await page.waitFor('__G.world.env.name === "yard, west" && __G.world.env.presence === 1', {
    timeoutMs: 4000,
    label: 'the yard',
  });
  const seen = [];
  for (let z = 57; z >= 50.5; z -= 0.5) {
    await page.evaluate(`__G.debug.teleport(40.5, ${z}, 0); void 0`);
    await sleep(60);
    const now = await env();
    seen.push([now.name, +now.presence.toFixed(2)]);
  }
  await sleep(500);
  const inLobby = await env();
  assert.deepEqual([inLobby.name, inLobby.presence], ['lobby', 1], JSON.stringify(seen));
  assert.ok(
    seen.some(([, presence]) => presence > 0 && presence < 1),
    `it went from one to the other without fading: ${JSON.stringify(seen)}`,
  );
  assert.deepEqual(await page.problems(), []);
  await page.close();
});

// A capture that is black, or upside down, or the wrong way round, passes the test above. This one asks it what
// it shows. The game knows which points of the ground each key light reaches (the same sight lines the shadow
// test reads the picture against); the capture, looked into from where it was made towards those points, must
// show the lit ones bright and the shadowed ones dark. It can only do that if it is the right way round, and has
// the key lights' shadows in it. (Measured when this was written, for the east flood: the right way round, lit
// ground 2.8 times as bright as shadowed and 8% of the shadowed points wrong. Read as a capture stored the wrong
// way round would be — mirrored left to right: 1.7 times and 30% wrong; front to back: 0.5 times; turned half
// round: 0.7 times. All three fail what is asked below.)
test('what was captured is the place as it stands: bright ground where a key light falls, dark in its shadow', async () => {
  const keys = await desk.json('__G.world.keys');
  const near = (p) => Math.hypot(p.x - MIRROR.x, p.z - MIRROR.z) <= 12;
  const shown = (points) => desk.json(`[${points.map((p) => `__G.debug.mirrorToward(${p.x}, 0, ${p.z})`).join(',')}]`);
  // a lamp that hangs on the same side as the place it was captured from throws its shadows away from it, behind
  // the things that throw them: such a lamp is held to this only if enough of its shadow can be seen from there
  let held = 0;
  try {
    // the two floods over the yard it was captured in: no other lamp shines near where it was made
    for (const [k, key] of keys.slice(0, 2).entries()) {
      // this lamp alone, and the place captured again by its light: two floods leave almost no ground near the
      // middle of the yard that neither reaches
      await desk.evaluate(`__G.debug.keySolo(${k}); void 0`);
      const lit = [];
      const dark = [];
      // stand where it was captured from and look round: what is seen from there is what is in it
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        await desk.stand({ x: MIRROR.x, z: MIRROR.z, yaw, pitch: -0.3 });
        const points = (await desk.json(`__G.debug.keySamples(${k})`)).filter(near);
        lit.push(...points.filter((p) => p.lit));
        dark.push(...points.filter((p) => !p.lit));
      }
      if (lit.length < 20 || dark.length < 20) continue;
      held++;
      const inLight = median(await shown(lit));
      const shadowed = await shown(dark);
      const inShadow = median(shadowed);
      assert.ok(
        inLight >= inShadow * 1.5,
        `${key.name}: the capture shows ground it lights at ${inLight.toFixed(3)}, ground in its shadow at ${inShadow.toFixed(3)}`,
      );
      const wrong = shadowed.filter((v) => v > (inLight + inShadow) / 2).length;
      assert.ok(
        wrong <= dark.length * 0.15,
        `${key.name}: ${wrong} of ${dark.length} points in its shadow are lit in the capture all the same`,
      );
    }
  } finally {
    await desk.evaluate('__G.debug.keySolo(-1); void 0');
    await sleep(150);
  }
  assert.ok(held >= 1, 'no key light throws enough shadow in sight of where the capture was made to hold it to this');
});

// Decision of 15 November 2026. Every surface already shows its lamps' highlights, by the sums that know where
// each lamp is. With the lamps in the capture as well they are counted twice — and a lamp's own face is many times
// brighter than anything it lights (read back, the capture showed 7 towards a flood where the floor under it is
// 0.3), so that in the cube's smaller copies, which rough things mirror, a few lamp faces outweigh the place.
// The capture is of what the lamps light, not of the lamps.
test('the lamps themselves are not in the capture: looked into towards a lamp, it does not show one', async () => {
  // from the yard: it is the yard's capture that is asked
  await desk.stand(STATIONS.yard);
  await desk.waitFor('__G.world.env.name === "yard, west" && __G.world.env.presence === 1', {
    timeoutMs: 4000,
    label: 'the yard’s capture',
  });
  const lamps = await desk.json(
    `__G.world.keys.map((k) => ({ what: k.name, x: k.x, y: k.y, z: k.z })).concat(__G.site.lamps.filter((l) => Math.hypot(l.x - ${MIRROR.x}, l.z - ${MIRROR.z}) < 16).map((l) => ({ what: l.kind + ' lamp', x: l.x, y: l.y, z: l.z })))`,
  );
  assert.ok(lamps.length >= 4, `${lamps.length} lamps near where it was captured from`);
  // a lamp's face is a pixel tall in the capture: it is looked for within two pixels of where it should be
  const shown = await desk.json(`[${lamps.map((l) => `__G.debug.mirrorToward(${l.x}, ${l.y}, ${l.z}, 2)`).join(',')}]`);
  // with the lamps in, it showed 7.4 and 6.7 towards the two floods, 5.4 towards the nearest post and 4.7 towards
  // a wall lamp — which also says the capture is the right way round: each was where it hangs
  for (const [i, lamp] of lamps.entries())
    assert.ok(
      shown[i] !== null && shown[i] < 2.5,
      `towards the ${lamp.what} at ${lamp.x}, ${lamp.z} it shows ${shown[i]}`,
    );
});

// Found in review, 16 November 2026, the day the casings were made to turn (world/spin.js). A capture is a
// picture that is KEPT: of what stands still. The casings are in it — they are what the hall is full of — and
// the hall's is made two metres from the nearest row. Taken with the marks their skins are seen to turn by, it
// showed those marks for good where they stood when it was taken, in metal beside casings that turn. A drum
// without marks looks the same wherever it has got to: so a capture is taken with the skins plain, and the marks
// are back before anything is drawn for the eye — also when the capture fails.
test('what metal mirrors is kept, so the casings in it carry no marks: a capture is taken with their skins plain, and the eye never sees them so', async () => {
  const page = await open(`look=2&${PLAY}`);
  await page.evaluate(QUIET);
  await page.evaluate('__G.enemies.clear(); void 0');
  // which colours the cascade wears at every draw into a cube, and at every other draw; and, while
  // window.__throws is above nought, every draw into a cube fails
  await page.evaluate(`(() => {
    const r = __G.view.renderer, real = r.render.bind(r);
    const mesh = __G.world.group.getObjectByName('cascade');
    window.__marked = mesh.geometry.attributes.color;
    window.__plain = null;
    window.__worn = { cube: [0, 0], eye: [0, 0] }; // draws [with the marks, without them]
    window.__throws = 0;
    window.__thrown = 0;
    r.render = (scene, camera) => {
      const target = r.getRenderTarget();
      const cube = !!(target && target.isWebGLCubeRenderTarget);
      const worn = mesh.geometry.attributes.color;
      window.__worn[cube ? 'cube' : 'eye'][worn === window.__marked ? 0 : 1]++;
      if (cube && worn !== window.__marked) window.__plain = worn;
      if (cube && window.__throws > 0) {
        window.__throws--;
        window.__thrown++;
        throw new Error('a draw that fails');
      }
      return real(scene, camera);
    };
  })()`);
  const state = () =>
    page.json(`(() => {
      const mesh = __G.world.group.getObjectByName('cascade'), g = mesh.geometry, spin = g.attributes.spin;
      const marked = window.__marked.array, plain = window.__plain ? window.__plain.array : null;
      const shades = new Set();
      let differ = 0, offSkin = 0;
      if (plain)
        for (let i = 0; i < spin.count; i++) {
          let c = 0;
          for (let k = 1; k < 3; k++) if (plain[i * 3 + k] > plain[i * 3 + c]) c = k;
          if (Math.abs(marked[i * 3 + c] - plain[i * 3 + c]) < 1e-6) continue;
          differ++;
          if (!spin.getX(i)) offSkin++;
          shades.add((marked[i * 3 + c] / plain[i * 3 + c]).toFixed(2));
        }
      return { worn: window.__worn, back: g.attributes.color === window.__marked, differ, offSkin,
        shades: [...shades].sort(), captures: __G.world.env.captures, thrown: window.__thrown,
        // (look/mirror.js MIRROR_LAYER is 4: the layer of what is in a capture)
        inIt: (mesh.layers.mask & (1 << 4)) !== 0 };
    })()`);

  // into the hall: its capture is made now, the first time the eye is in it
  await page.stand(
    await page.json(`__G.debug.keyStation(${KEYS.findIndex((k) => k.name === 'cascade hall, south-west')})`),
  );
  await page.waitFor('__G.world.env.name === "cascade hall" && __G.world.env.presence === 1', {
    timeoutMs: 4000,
    label: 'the capture of the hall',
  });
  await sleep(300);
  const taken = await state();
  assert.equal(taken.inIt, true, 'the casings are not in what is captured at all');
  assert.ok(taken.worn.cube[1] >= 6, `the hall was captured with the marks on: ${JSON.stringify(taken.worn)}`);
  assert.equal(taken.worn.cube[0], 0, 'a face of a capture was drawn with the marks on the skins');
  // …and the eye: every other draw has the marks, and they are on now
  assert.ok(taken.worn.eye[0] > 0);
  assert.equal(taken.worn.eye[1], 0, 'the eye was shown skins without their marks');
  assert.equal(taken.back, true, 'the marks were not put back');
  // what was left off is the marks and nothing else: corners of the skin, each by one of the three shades
  assert.ok(taken.differ > 0, 'the colours a capture is taken with are the ones the eye sees');
  assert.equal(taken.offSkin, 0, 'something that is not skin changes colour for a capture');
  assert.deepEqual(taken.shades, SPIN.marks.map(([, shade]) => shade.toFixed(2)).sort());

  // …and what the eye is shown HAS them, after a capture as before one: from the aisle, a third of a second
  // changes the skins — the streaks have gone round — and not the heads over them (the measure, sixteen pixels
  // at a time, is test/smoke.test.mjs's, where the look without the switch is held to the same)
  await page.stand({ x: 40.5, z: 23.7, yaw: 0, pitch: 0 });
  await page.evaluate('__G.weapon.visible = false; void 0');
  await sleep(500);
  const one = await picture(page);
  await sleep(330);
  const two = await picture(page);
  await page.evaluate('__G.weapon.visible = true; void 0');
  const BLOCK = 16;
  const coarse = ({ width, height, data }) => {
    const w = Math.floor(width / BLOCK);
    const h = Math.floor(height / BLOCK);
    const out = new Float64Array(w * h);
    for (let y = 0; y < h * BLOCK; y++)
      for (let x = 0; x < w * BLOCK; x++) {
        const i = (y * width + x) * 4;
        out[Math.floor(y / BLOCK) * w + Math.floor(x / BLOCK)] +=
          (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / (BLOCK * BLOCK);
      }
    return { w, h, out };
  };
  const first = coarse(one);
  const second = coarse(two);
  const moved = (x0, y0, x1, y1) => {
    let sum = 0;
    let n = 0;
    for (let y = Math.floor(first.h * y0); y < first.h * y1; y++)
      for (let x = Math.floor(first.w * x0); x < first.w * x1; x++, n++)
        sum += Math.abs(first.out[y * first.w + x] - second.out[y * first.w + x]);
    return sum / n;
  };
  const skins = moved(0.1, 0.2, 0.9, 0.6);
  const heads = moved(0.1, 0, 0.9, 0.09);
  // (measured when this was written, three times: the skins 4.1 to 4.3 of 255, the heads 0.4 to 0.5)
  assert.ok(skins > 2, `the skins changed by ${skins.toFixed(2)} of 255 in a third of a second`);
  assert.ok(skins > heads * 4, `the skins changed by ${skins.toFixed(2)}, and the heads by ${heads.toFixed(2)}`);

  // a capture that fails puts them back too
  await page.evaluate('window.__throws = 1000; __G.debug.keySolo(-1); void 0');
  await sleep(1200);
  const failed = await state();
  assert.ok(failed.thrown >= 1, 'no capture was tried');
  assert.equal(failed.captures, taken.captures);
  assert.equal(failed.back, true, 'a capture that failed left the skins without their marks');
  assert.equal(failed.worn.eye[1], 0, 'after a capture that failed the eye was shown skins without their marks');
  // and so does the next that is made
  await page.evaluate('window.__throws = 0; __G.debug.keySolo(-1); void 0');
  await page.waitFor(`__G.world.env.captures > ${failed.captures}`, {
    timeoutMs: 5000,
    label: 'the capture to be made again',
  });
  await sleep(300);
  const again = await state();
  assert.deepEqual([again.back, again.worn.cube[0], again.worn.eye[1]], [true, 0, 0]);
  assert.deepEqual(await page.problems(), []);
  await page.close();
});

// Found in review, 16 November 2026. A capture is six draws of the site in the middle of a frame. If one of them
// fails, the frame must go on; what was not finished must not be mirrored; and it is tried again — on the next
// frame, and no more than twice — after which the sum that stood in before there was a capture stands in again,
// until something asks for a capture once more. (As it was written first, a failed capture was never tried
// again, left every surface mirroring nothing, and left the capture's smaller copies switched off for good.)
test('a capture that fails does not stop the game: it is tried twice, then metal mirrors as it did before there was one', async () => {
  const page = await open(`look=2&${PLAY}`);
  const uniforms =
    '__G.world.group.children.find((mesh) => mesh.material && mesh.material.uniforms && mesh.material.uniforms.uEnvBox).material.uniforms';
  // …and how much of the capture what is in the hands mirrors (it is told, not worked out from where it is drawn)
  const GUN = `(() => { let mix = null; __G.weapon.scene.children[0].traverse((o) => { const u = o.material && o.material.uniforms; if (mix === null && u && u.uEnvMix && u.uRim && o.name !== 'lettering') mix = u.uEnvMix.value; }); return mix; })()`;
  const state = () =>
    page.json(
      `({ captures: __G.world.env.captures, blurred: __G.world.env.blurred, thrown: window.__thrown, cube: !!${uniforms}.uEnvCube.value, box: ${uniforms}.uEnvBox.value.toArray(), gun: ${GUN} })`,
    );
  // in the yard, well inside the captured place: the gun mirrors all of it
  await page.evaluate('__G.player.hidden = true; void 0');
  await page.stand(STATIONS.yard);
  // from here on, every draw into a cube fails for as long as window.__throws is above nought
  await page.evaluate(`(() => {
    const r = __G.view.renderer, real = r.render.bind(r);
    window.__throws = 0;
    window.__thrown = 0;
    r.render = (scene, camera) => {
      const target = r.getRenderTarget();
      if (window.__throws > 0 && target && target.isWebGLCubeRenderTarget) {
        window.__throws--;
        window.__thrown++;
        throw new Error('a draw that fails');
      }
      return real(scene, camera);
    };
  })()`);
  const before = await state();
  assert.deepEqual([before.cube, before.blurred, before.thrown], [true, true, 0]);
  assert.ok(before.captures >= 1);
  assert.ok(before.gun > 0.9, `in the yard the gun mirrors ${before.gun} of the capture`);

  // once: the next frame tries again, and has it
  await page.evaluate('window.__throws = 1; __G.debug.keySolo(-1); void 0');
  await page.waitFor(`__G.world.env.captures > ${before.captures}`, {
    timeoutMs: 5000,
    label: 'the capture to be made on the second try',
  });
  const once = await state();
  assert.deepEqual([once.thrown, once.cube, once.blurred, once.box], [1, true, true, before.box]);

  // every time: two tries and no more, and nothing half-made is mirrored
  await page.evaluate('window.__throws = 1000; __G.debug.keySolo(-1); void 0');
  await sleep(1200);
  const never = await state();
  assert.equal(never.thrown - once.thrown, 2, `it was tried ${never.thrown - once.thrown} times`);
  assert.equal(never.captures, once.captures);
  assert.deepEqual([never.cube, never.box], [false, [0, 0, 0, 0]], 'a capture that was not finished is mirrored');
  assert.equal(never.gun, 0, 'the gun mirrors a capture that is not there');
  assert.ok((await page.framesIn(700)) >= 14, 'the game stopped drawing');

  // and asked again once the fault has gone, it is made — smaller copies and all
  await page.evaluate('window.__throws = 0; __G.debug.keySolo(-1); void 0');
  await page.waitFor(`__G.world.env.captures > ${never.captures}`, {
    timeoutMs: 5000,
    label: 'the capture to be made again',
  });
  // (it is faded in, and the gun's share of it is eased after that)
  await sleep(700);
  const after = await state();
  assert.deepEqual([after.cube, after.blurred, after.box], [true, true, before.box]);
  assert.ok(after.gun > 0.9, `with the capture back the gun mirrors ${after.gun} of it`);
  // a capture that failed is said, as a warning: it is not an error of the game's, and none was logged
  assert.deepEqual(await page.problems(), []);
  await page.close();
});

// The capture is made from the middle of the yard. A thing that stands in the world reads it corrected for where
// it stands — the box is taken for the room, and the ray followed to its wall. What is in the hands, which is
// drawn in a space of its own, was not corrected: at the adit's mouth, a dim corner fourteen metres from where
// the capture was made, the gun mirrored the lit wall that lies north of the CAPTURE, and one flank of a charcoal
// gun was red — a tenth of all its pixels (15 November 2026, the first pictures with the capture in use). It is
// corrected now by where the eye is.
test('what is in the hands mirrors the place from where it is held: at the adit’s mouth the charcoal gun is not red', async () => {
  await desk.stand(STATIONS.mouth);
  const eye = await desk.json(`(() => {
    const p = __G.player, from = [];
    // what is drawn just now: the gun in hand, not the two that are put away
    const shown = (o) => { for (let up = o; up; up = up.parent) if (!up.visible) return false; return true; };
    __G.weapon.scene.traverse((o) => { const u = o.material && o.material.uniforms; if (u && u.uEnvFrom && u.uRim && shown(o)) from.push(u.uEnvFrom.value.toArray()); });
    return { at: [p.headX, p.eye, p.headZ], from };
  })()`);
  assert.ok(eye.from.length > 0, 'nothing in the hands is told where the eye is');
  for (const from of eye.from)
    for (let c = 0; c < 3; c++)
      assert.ok(Math.abs(from[c] - eye.at[c]) < 0.25, `told the eye is at ${from}; it is at ${eye.at}`);

  // three pictures: as it is; with the gun put away (which pixels are the gun's); and with the gun mirroring nothing
  const withGun = await picture(desk);
  await desk.evaluate('__G.weapon.scene.visible = false; void 0');
  await sleep(150);
  const without = await picture(desk);
  await desk.evaluate(
    '__G.weapon.scene.visible = true; __G.__hand = __G.weapon.look; __G.weapon.look = { key: __G.__hand.key, mirror: () => 0 }; void 0',
  );
  await sleep(300);
  let plain;
  try {
    plain = await picture(desk);
  } finally {
    await desk.evaluate('__G.weapon.look = __G.__hand; delete __G.__hand; void 0');
  }
  const differs = (a, b, i) =>
    Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]) >
    40;
  const red = (p, i) => p.data[i] > 45 && p.data[i] > 1.3 * p.data[i + 2] && p.data[i] > 1.15 * p.data[i + 1];
  let gun = 0;
  let redMirroring = 0;
  let redPlain = 0;
  for (let i = 0; i < withGun.data.length; i += 4) {
    if (!differs(withGun, without, i) || !differs(plain, without, i)) continue;
    gun++;
    if (red(withGun, i)) redMirroring++;
    if (red(plain, i)) redPlain++;
  }
  assert.ok(gun > (withGun.data.length / 4) * 0.05, `only ${gun} pixels of the picture are the gun`);
  assert.ok(
    redMirroring - redPlain <= gun * 0.02,
    `${((100 * redMirroring) / gun).toFixed(1)}% of the gun is red when it mirrors the place, ${((100 * redPlain) / gun).toFixed(1)}% when it does not`,
  );
});

// 16 November 2026, the plan's third step: "exposure that adapts". With a strong lamp in every space one place
// is ten times as bright as the next; the picture is exposed for the place the eye is looking at, as an eye is
// (src/look/exposure.js) — beside the player's own brightness setting, never in place of it.
test('the picture is exposed for the place: stopped down in a flood, opened up in the dark, the player’s own setting kept', async () => {
  const facts = () =>
    desk.json(
      `({ e: __G.debug.exposure(), shown: __G.world.group.children.find((m) => m.material && m.material.uniforms && m.material.uniforms.uExposure).material.uniforms.uExposure.value, set: __G.settings.get('brightness') })`,
    );
  // in the south flood's light, looking at what it lights
  await desk.stand(STATIONS.yard);
  await sleep(300);
  const lit = await facts();
  assert.ok(lit.e.light > MID, `the light in view in the yard is ${lit.e.light}`);
  assert.ok(lit.e.value < 0.95 && lit.e.value >= 0.62, `in the flood the picture is exposed at ${lit.e.value}`);
  assert.ok(Math.abs(lit.shown - lit.set * lit.e.value) < 1e-3, `${lit.shown} is not ${lit.set} × ${lit.e.value}`);
  // the darkest floor of the site, looking whichever way is darkest
  const dark = await desk.json(`(() => {
    const w = __G.world, g = w.grid;
    let best = null;
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) if (g.walkable(x, z)) {
      const v = w.lit(x + 0.5, z + 0.5);
      if (!best || v < best.v) best = { x: x + 0.5, z: z + 0.5, v };
    }
    return best;
  })()`);
  let most = 0;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    await desk.stand({ x: dark.x, z: dark.z, yaw, pitch: 0 });
    most = Math.max(most, (await facts()).e.value);
  }
  assert.ok(most > 1.15 && most <= 1.5, `in the dark at (${dark.x}, ${dark.z}) the picture is exposed at ${most}`);
  // the player's brightness still does what it did: it multiplies whatever the place asks for
  await desk.stand(STATIONS.yard);
  await desk.evaluate('__G.__was = __G.settings.get("brightness"); __G.settings.set("brightness", 1.4); void 0');
  try {
    await sleep(300);
    const turnedUp = await facts();
    assert.equal(turnedUp.set, 1.4);
    assert.ok(Math.abs(turnedUp.shown - 1.4 * turnedUp.e.value) < 1e-3, `${turnedUp.shown} with brightness at 1.4`);
    assert.ok(Math.abs(turnedUp.e.value - lit.e.value) < 0.05, 'the place’s own exposure moved with the setting');
  } finally {
    await desk.evaluate('__G.settings.set("brightness", __G.__was); delete __G.__was; void 0');
  }
  // …and without the switch there is nothing but the setting
  const plainly = await plain.json(
    `({ shown: __G.world.group.children.find((m) => m.material && m.material.uniforms && m.material.uniforms.uExposure).material.uniforms.uExposure.value, set: __G.settings.get('brightness'), e: __G.debug.exposure() })`,
  );
  assert.deepEqual([plainly.shown, plainly.e], [plainly.set, null]);
});

// ---------- lamps that go out (16 November 2026) ----------
// The owner, having played the second look: "i want to have the ability to shoot at the light to turn it off and
// turn on night goggles to use them also emp needs to turn of the light in a room". The rules are held without
// a browser (test/unit/lamps.test.mjs) and what they do to the game as it is, in test/smoke.test.mjs. Here: the
// second look's own lamps — the key lights — obey them too, and what was added to the level by the second look
// (marks, lettering, the rebuilt furniture) is lit again with the rest.

/** the light on a corner is kept in thirty-two bits: worked out again it is the same to that much, and no more */
const EXACT = 1e-5;
/** How bright the middle pixel of a picture is — half are darker, half lighter — 0 to 255. */
function middleBrightness({ data }) {
  const counts = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4)
    counts[Math.round(data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11)]++;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += counts[v];
    if (seen >= data.length / 8) return v;
  }
  return 255;
}

test('with the switch the level’s light can still be worked out again, marks and lettering and all, and comes to what it was built with', async () => {
  await desk.evaluate(`__G.debug.start(); ${QUIET}`);
  const built = await desk.json('__G.world.lamps.check()');
  assert.ok(built.corners > 1000000, `only ${built.corners} corners can be lit again`);
  assert.ok(built.worst < EXACT, `a corner of ${built.where} is ${built.worst} from what it was built with`);
  // every lamp of the site and every key light that hangs somewhere has something a round can break
  const lamps = await desk.json(
    '(() => { const d = __G.debug.lamps; const all = Array.from({ length: d.count }, (_, i) => d.at(i)); return { count: d.count, site: d.site, fixed: all.filter((l) => l.fixed).length, bare: all.filter((l) => !l.fixed && !l.box).length }; })()',
  );
  assert.equal(
    lamps.count - lamps.site,
    KEYS.length,
    'the key lights are in the game’s list of lamps, after the site’s own',
  );
  assert.equal(lamps.fixed, 1 + KEYS.filter((key) => key.kind === 'moon').length, 'the sky’s glow and the two moons');
  assert.equal(lamps.bare, 0, 'lamps with nothing a round can break');
  // …and a round can get to it: for each there is somewhere a player can stand from which a round aimed at the
  // middle of its box meets that lamp before it meets anything else
  const stuck = await desk.json(`(() => {
    const d = __G.debug.lamps, g = __G.world.grid, hit = {}, proud = ${ARMS.lamp.proud}, stuck = [];
    const names = ${JSON.stringify(KEYS.map((key) => key.name))};
    for (let i = 0; i < d.count; i++) {
      const lamp = d.at(i);
      if (lamp.fixed) continue;
      const cx = (lamp.box[0] + lamp.box[3]) / 2, cy = (lamp.box[1] + lamp.box[4]) / 2, cz = (lamp.box[2] + lamp.box[5]) / 2;
      let can = false;
      for (let z = Math.floor(lamp.z - 14); z <= lamp.z + 14 && !can; z++)
        for (let x = Math.floor(lamp.x - 14); x <= lamp.x + 14 && !can; x++) {
          if (!g.inside(x, z) || !g.walkable(x, z)) continue;
          const ex = x + 0.5, ey = 1.62, ez = z + 0.5;
          const far = Math.hypot(cx - ex, cy - ey, cz - ez);
          const dx = (cx - ex) / far, dy = (cy - ey) / far, dz = (cz - ez) / far;
          const reach = g.raycast(ex, ey, ez, dx, dy, dz, 120, hit) ? hit.t : 120;
          const met = d.hit(ex, ey, ez, dx, dy, dz, reach + proud);
          can = !!met && met.i === i;
        }
      if (!can) stuck.push(i < d.site ? 'lamp ' + i : names[i - d.site]);
    }
    return stuck;
  })()`);
  assert.deepEqual(stuck, [], 'lamps that no round can reach');
});

test('a key light can be shot out: one round, and it is dark at once — no light, no shadow, no shine, and the game counts none of it', async () => {
  const k = KEYS.findIndex((key) => key.name === 'control room');
  await desk.evaluate(`__G.debug.start(); __G.weapon.arms.mode = "semi"; ${QUIET}`);
  // in the control room, five metres in front of its lamp, looking back up at it
  await desk.stand({ x: 78.5, z: 35.5, yaw: Math.PI / 2, pitch: 0.3 });
  await desk.waitFor(`__G.world.keys[${k}].level > 0.95`, {
    timeoutMs: 6000,
    label: 'the control room’s lamp to burn',
  });
  const aimed = await desk.json(
    `(() => { const d = __G.debug.lamps, b = d.at(d.site + ${k}).box, c = __G.camera.position, p = __G.player; const dx = (b[0] + b[3]) / 2 - c.x, dy = (b[1] + b[4]) / 2 - c.y, dz = (b[2] + b[5]) / 2 - c.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); return { i: d.site + ${k}, far: Math.hypot(dx, dy, dz) }; })()`,
  );
  assert.ok(aimed.far > 3 && aimed.far < 7, `the lamp is ${aimed.far} m off`);
  await sleep(500);
  const facts = () =>
    desk.json(
      `({ out: __G.debug.lamps.out(), key: { slot: __G.world.keys[${k}].slot, level: __G.world.keys[${k}].level }, own: __G.world.keyAt(77.5, 35.5, ${k}), all: __G.world.keyAt(77.5, 35.5), seen: __G.world.visibility(77.5, 35.5) })`,
    );
  // what is drawn of the lamp itself: its lens, and the middle of the picture, where it hangs
  const lens = () =>
    desk.json(
      `(() => { const groups = __G.world.group.parent.getObjectByName("key lights").children.filter((o) => o.isGroup); const n = ${KEYS.slice(0, k).filter((key) => key.kind !== 'moon').length}; const face = groups[n].children.find((m) => m.material.userData.lode === "glow"); return face.material.uniforms.uIntensity.value; })()`,
    );
  const centre = (shot) => {
    let most = 0;
    for (let y = shot.height / 2 - 14; y < shot.height / 2 + 14; y++)
      for (let x = shot.width / 2 - 14; x < shot.width / 2 + 14; x++) {
        const i = (y * shot.width + x) * 4;
        most = Math.max(most, shot.data[i] * 0.3 + shot.data[i + 1] * 0.59 + shot.data[i + 2] * 0.11);
      }
    return most;
  };
  const before = { ...(await facts()), lens: await lens(), centre: centre(await picture(desk)) };
  assert.deepEqual(before.out, []);
  assert.ok(before.key.slot >= 0 && before.own > 0.3 && before.seen > 0.9, JSON.stringify(before));
  assert.ok(before.lens > 2 && before.centre > 200, `its lens: ${before.lens}, and in the picture ${before.centre}`);

  await desk.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await sleep(60);
  await desk.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await desk.waitFor('__G.debug.lamps.out().length > 0', { timeoutMs: 3000, label: 'the lamp to go out' });
  const after = await facts();
  assert.deepEqual(after.out, [aimed.i], 'the control room’s key light, and nothing else');
  assert.equal(await desk.evaluate('__G.weapon.shots'), 1, 'one round');
  // at once: it does not fade, and its slot is free for another lamp
  await desk.waitFor(`__G.world.keys[${k}].slot === -1`, { timeoutMs: 2000, label: 'its slot to be given up' });
  assert.equal((await facts()).key.level, 0);
  assert.equal(after.own, 0, 'the game still counts its light on a body');
  assert.ok(Math.abs(after.all - (before.all - before.own)) < 1e-6, 'the other key lights count as they did');
  assert.ok(after.seen < before.seen, `somebody in the room is seen at ${after.seen}; it was ${before.seen}`);
  await desk.evaluate('__G.debug.lamps.settle(); void 0');
  await sleep(500);
  const dead = { lens: await lens(), centre: centre(await picture(desk)) };
  assert.ok(dead.lens < 0.1, `its lens is still drawn at ${dead.lens}`);
  assert.ok(
    dead.centre < before.centre * 0.5,
    `where it hangs the picture went from ${before.centre} to ${dead.centre}`,
  );
  // it stays out wherever the eye goes, and comes back with a new mission
  await desk.stand(STATIONS.yard);
  await sleep(400);
  await desk.stand({ x: 78.5, z: 35.5, yaw: Math.PI / 2, pitch: 0.3 });
  await sleep(600);
  assert.deepEqual((await facts()).key, { slot: -1, level: 0 });
  await desk.evaluate(`__G.debug.start(); ${QUIET}`);
  await desk.stand({ x: 78.5, z: 35.5, yaw: Math.PI / 2, pitch: 0.3 });
  await desk.waitFor(`__G.world.keys[${k}].level > 0.95`, { timeoutMs: 6000, label: 'it to burn again' });
  const again = await facts();
  assert.deepEqual(again.out, []);
  assert.ok(Math.abs(again.own - before.own) < 1e-6 && Math.abs((await lens()) - before.lens) < 1e-6);
  assert.deepEqual(await desk.problems(), []);
});

test('a room an EMP has put in the dark is dark — and night vision brings it back, in either look', async () => {
  for (const [page, name] of [
    [plain, 'the game as it is'],
    [desk, 'the second look'],
  ]) {
    await page.evaluate(`__G.debug.start(); ${QUIET}`);
    // the control room, looked along from its window
    await page.stand({ x: 74.2, z: 36.5, yaw: -Math.PI / 2 - 0.25, pitch: -0.08 });
    await sleep(1200);
    const lit = middleBrightness(await picture(page));
    const reached = await page.json('__G.debug.lamps.trip(__G.site.firing.x, __G.site.firing.z)');
    assert.ok(reached.length >= 3, `${name}: an EMP at the firing point put out ${reached.length} lamps`);
    await page.evaluate('__G.debug.lamps.settle(); void 0');
    // the eye opens in the dark (the second look's exposure): the picture is read when it has
    await sleep(2500);
    const dark = middleBrightness(await picture(page));
    await page.holdKey('KeyN', 'n', 0, 60);
    await page.waitFor('__G.nv === true', { timeoutMs: 2000, label: 'the goggles' });
    await sleep(900);
    const goggles = middleBrightness(await picture(page));
    await page.holdKey('KeyN', 'n', 0, 60);
    await page.waitFor('__G.nv === false', { timeoutMs: 2000, label: 'the goggles to come off' });
    // 16 November 2026: lit 68, dark 15, with the goggles 51 as it is; 70, 12 and 45 with the switch
    assert.ok(lit > 40, `${name}: the room, lit, is ${lit}`);
    assert.ok(dark < lit * 0.4, `${name}: the room in the dark is ${dark}; lit it is ${lit}`);
    assert.ok(goggles > dark * 2, `${name}: with the goggles the dark room is ${goggles}; without, ${dark}`);
    assert.ok(goggles > lit * 0.45, `${name}: with the goggles the dark room is ${goggles}; lit it is ${lit}`);
    // the level is lit as its lamps say, and a new mission lights the room again
    const check = await page.json('__G.world.lamps.check()');
    assert.ok(check.worst < EXACT && check.waiting === 0, `${name}: ${JSON.stringify(check)}`);
    await page.evaluate(`__G.debug.start(); ${QUIET}`);
    assert.deepEqual(await page.json('__G.debug.lamps.out()'), []);
    assert.deepEqual(await page.problems(), []);
  }
});

test('a room’s key light goes out with the room: an EMP trips it, what metal mirrors is taken again, and it comes back', async () => {
  const k = KEYS.findIndex((key) => key.name === 'control room');
  await desk.evaluate(`__G.debug.start(); ${QUIET}`);
  await desk.stand({ x: 78.5, z: 35.5, yaw: Math.PI / 2, pitch: 0 });
  await desk.waitFor(`__G.world.keys[${k}].level > 0.95`, {
    timeoutMs: 6000,
    label: 'the control room’s lamp to burn',
  });
  // the room has been captured for its metal to mirror; looked into towards its floor, the capture is lit
  await desk.waitFor('__G.debug.mirrorToward(79.5, 0, 35.5) !== null', {
    timeoutMs: 8000,
    label: 'the room to be captured',
  });
  const floor = () => desk.json('__G.debug.mirrorToward(79.5, 0, 35.5, 2)');
  const litFloor = await floor();
  const reached = await desk.json('__G.debug.lamps.trip(__G.site.firing.x, __G.site.firing.z)');
  const site = await desk.evaluate('__G.debug.lamps.site');
  assert.ok(reached.includes(site + k), 'the EMP did not reach the room’s key light');
  assert.deepEqual(
    reached.filter((i) => i >= site).map((i) => KEYS[i - site].name),
    ['control room'],
    'and no key light of any other space',
  );
  await desk.waitFor(`__G.world.keys[${k}].slot === -1`, { timeoutMs: 2000, label: 'its slot to be given up' });
  // the capture is taken again once the level has been lit again: metal in a dark room does not mirror a lit one
  await desk.waitFor('__G.debug.lamps.waiting() === 0', { timeoutMs: 8000, label: 'the level to be lit again' });
  let darkFloor = litFloor;
  for (let n = 0; n < 40 && !(darkFloor < litFloor * 0.5); n++) {
    await sleep(150);
    darkFloor = await floor();
  }
  assert.ok(darkFloor < litFloor * 0.5, `the captured room’s floor went from ${litFloor} to ${darkFloor}`);
  // twenty seconds later the breaker is back in: the lamp comes up again, by itself
  await desk.evaluate('__G.debug.speed(8); void 0');
  await desk.waitFor('__G.debug.lamps.out().length === 0', { timeoutMs: 12000, label: 'the lamps to come back' });
  await desk.evaluate('__G.debug.speed(1); void 0');
  await desk.waitFor(`__G.world.keys[${k}].level > 0.95`, {
    timeoutMs: 6000,
    label: 'the control room’s lamp to burn again',
  });
  await desk.waitFor('__G.debug.lamps.waiting() === 0', { timeoutMs: 8000, label: 'the level to be lit again' });
  let back = darkFloor;
  for (let n = 0; n < 40 && !(back > litFloor * 0.8); n++) {
    await sleep(150);
    back = await floor();
  }
  assert.ok(back > litFloor * 0.8, `the captured room’s floor is ${back} with the lamps back; it was ${litFloor}`);
  await desk.evaluate(`__G.debug.start(); ${QUIET}`);
  assert.deepEqual(await desk.problems(), []);
});

test('a desk still draws it at the display’s pace, and nothing is logged as an error', async () => {
  await desk.stand(STATIONS.mouth);
  // the target is 60 a second; 55 is asked of a machine that is also running the rest of the tests
  const frames = await desk.framesIn(3000);
  assert.ok(frames >= 165, `${frames} frames in three seconds at the adit's mouth`);
  // How much there is to draw. Until 16 November 2026 the world was held under 700,000 triangles in either look.
  // The plan's fourth step — more shape, for everything — is more triangles by definition: the cascade's 512
  // casings went from eight sides to round (245,000 where they were 113,000) and sixteen kinds of furniture were
  // built again. Decision of that day: the game as it is stays under what was agreed (it is 360,654); the second
  // look on a desk may be 900,000 (it is about 825,000) — held, as it always was in fact, by the frames counted
  // here: the display's pace at the adit's mouth and in five other places with their lamps burning. A device
  // held in the hand is given neither the casings nor the furniture (look/index.js).
  assert.ok((await plain.evaluate('__G.world.stats.triangles')) <= 700000, 'the world has grown past what was agreed');
  const weight = await desk.evaluate('__G.world.stats.triangles');
  assert.ok(weight <= 900000, `the second look's world is ${weight} triangles: past what was agreed for it`);
  // …and wherever a lamp shines: the hall, a room, the foot of the shaft, the forecourt, with their lamps burning
  for (const name of [
    'cascade hall, south-west',
    'control room',
    'the moon, down the shaft',
    'tunnel lamp',
    'dock flood',
  ]) {
    const k = KEYS.findIndex((key) => key.name === name);
    await desk.stand(await desk.json(`__G.debug.keyStation(${k})`));
    const there = await desk.framesIn(1500);
    assert.ok(there >= 82, `${there} frames in a second and a half by the ${name}`);
  }
  assert.deepEqual(await desk.problems(), []);
  assert.deepEqual(await raw.problems(), []);
});

// Until 16 November 2026 each key light's depth picture was of everything, and was drawn again every frame:
// half a million triangles a frame for two lamps. What stands still is now drawn once, when a lamp takes a slot;
// only machines and the leaves of doors are drawn every frame.
test('what stands still is drawn into a depth picture once; only what moves is drawn every frame', async () => {
  await desk.stand(STATIONS.yard);
  await sleep(600);
  const facts = () =>
    desk.json(
      `({ keys: __G.world.keys.map((k) => ({ name: k.name, slot: k.slot, level: k.level, draws: k.draws })), frame: __G.view.renderer.info.render.triangles, world: __G.world.stats.triangles, frames: __G.frames })`,
    );
  const first = await facts();
  await sleep(1000);
  const later = await facts();
  assert.ok(later.frames - first.frames >= 20, 'frames are being drawn');
  const burning = later.keys.filter((k) => k.slot >= 0);
  assert.ok(burning.length >= 2 && burning.length <= 6, `${burning.length} lamps hold slots in the yard`);
  for (const k of ['yard flood, south', 'yard flood, east'])
    assert.ok(
      burning.some((b) => b.name === k && b.level === 1),
      `${k} is not burning in full: ${JSON.stringify(burning)}`,
    );
  // nothing that stands still was drawn again while the eye stood still
  for (const [n, key] of later.keys.entries())
    assert.equal(key.draws, first.keys[n].draws, `${key.name}: its still tile was drawn again`);
  // a frame is the world, the gun, and the machines once more for each lamp that sees them: nowhere near the
  // world over again (it was two and a half times the world)
  assert.ok(
    later.frame <= later.world * 1.35 + 60000,
    `${later.frame} triangles in a frame; the world is ${later.world}`,
  );
  // walk a few steps: still nothing is drawn again; walk to another part of the site: other lamps, drawn once
  await desk.stand({ ...STATIONS.yard, x: STATIONS.yard.x + 2 });
  await sleep(300);
  const stepped = await facts();
  for (const [n, key] of stepped.keys.entries())
    if (first.keys[n].slot >= 0 && key.slot >= 0)
      assert.equal(key.draws, first.keys[n].draws, `${key.name}: drawn again for two metres' walk`);
  const hall = KEYS.findIndex((key) => key.name === 'cascade hall, south-west');
  await desk.stand(await desk.json(`__G.debug.keyStation(${hall})`));
  const away = await facts();
  assert.ok(away.keys[hall].slot >= 0 && away.keys[hall].level === 1, 'the hall’s lamp did not come on in the hall');
  assert.equal(away.keys[hall].draws, first.keys[hall].draws + 1);
  assert.ok(away.keys.filter((k) => k.slot >= 0).length <= 6);
});

// A machine walking through a beam throws its shadow as it goes: it is in the picture of moving things, which
// is drawn every frame. Held to it by standing one in a lamp's light and reading the ground behind it.
test('a machine that stands in a key light throws a shadow, and takes it with it when it is moved', async () => {
  await raw.stand(STATIONS.yard);
  await raw.evaluate('__G.weapon.scene.visible = false; __G.debug.keySolo(0); void 0');
  try {
    const points = (await raw.json('__G.debug.keySamples(0)')).filter((p) => p.lit && p.chest && p.reach > 0.5);
    assert.ok(points.length >= 10, `${points.length} lit points in view`);
    // a point in view, and a place a stride from it towards the lamp to stand a machine — one that is well to
    // the side of the line from the eye to the point, so that what is read is the ground and not the machine
    const lamp = KEYS[0];
    const eye = STATIONS.yard;
    const aside = (p) => {
      const d = Math.hypot(lamp.x - p.x, lamp.z - p.z);
      const stand = { x: p.x + ((lamp.x - p.x) / d) * 0.9, z: p.z + ((lamp.z - p.z) / d) * 0.9 };
      const ex = p.x - eye.x;
      const ez = p.z - eye.z;
      const along = Math.min(1, Math.max(0, ((stand.x - eye.x) * ex + (stand.z - eye.z) * ez) / (ex * ex + ez * ez)));
      return { stand, off: Math.hypot(stand.x - eye.x - ex * along, stand.z - eye.z - ez * along) };
    };
    const p = points.find((q) => aside(q).off >= 0.85 && Math.hypot(q.x - eye.x, q.z - eye.z) > 5);
    assert.ok(p, 'no point in view has room beside it for a machine');
    const { stand } = aside(p);
    const read = async () => {
      await sleep(150);
      const image = await picture(raw);
      const sx = image.width / 1280;
      const sy = image.height / 720;
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const i = (Math.round(p.py * sy + dy) * image.width + Math.round(p.px * sx + dx)) * 4;
          sum += image.data[i] * 0.3 + image.data[i + 1] * 0.59 + image.data[i + 2] * 0.11;
        }
      return sum / 25;
    };
    // the game is stopped, so that the machine stays where it is put; the picture goes on being drawn
    await raw.evaluate('__G.debug.pause(); void 0');
    // 16 November 2026. Until now the machine was read in whatever stride and facing the game had left it in
    // when it was stopped — and the point is in the shadow of its LEGS: with a stride open towards the lamp, or
    // the machine facing it, the light goes between them. Measured over fifteen poses the ground behind it read
    // 0.52 to 0.98 of the open ground; the test passed or failed by when in the suite it was reached (it failed,
    // at 0.81, the first time four tests were added before it). The machine stands at attention now, broadside
    // to the lamp: what is asked is that a machine throws a shadow, not that its stride happens to. The limits
    // are what they were.
    const broadside = Math.atan2(-(lamp.x - stand.x), -(lamp.z - stand.z)) + Math.PI / 2;
    const MOVE = (x, z) =>
      `(() => { const u = __G.enemies.list.find((u) => u.type === 'sentry' && !u.dead); u.x = ${x}; u.z = ${z}; u.model.root.visible = true; u.model.root.position.set(${x}, 0, ${z}); u.model.root.rotation.set(0, ${broadside}, 0); for (const part of ['legL', 'legR', 'shinL', 'shinR']) if (u.parts[part]) u.parts[part].rotation.x = 0; u.model.root.updateMatrixWorld(true); return true; })()`;
    await raw.evaluate(MOVE(stand.x + 30, stand.z));
    const open = await read();
    await raw.evaluate(MOVE(stand.x, stand.z));
    const shaded = await read();
    await raw.evaluate(MOVE(stand.x + 30, stand.z));
    const openAgain = await read();
    assert.ok(shaded <= open * 0.8, `the ground behind it reads ${shaded.toFixed(0)}; without it, ${open.toFixed(0)}`);
    assert.ok(
      Math.abs(openAgain - open) <= open * 0.08,
      `moved away again it reads ${openAgain.toFixed(0)}, not ${open.toFixed(0)}`,
    );
  } finally {
    await raw.evaluate('__G.debug.resume(); __G.debug.keySolo(-1); __G.weapon.scene.visible = true; void 0');
  }
});

test('a phone with the switch: it starts, plays, logs nothing, and its shadows are worked out once', async () => {
  const phone = await open('look=2&q=low&touch=1&autostart=1&noaudio=1&dynres=0');
  assert.equal(await phone.evaluate('__G.state'), 'playing');
  assert.ok((await phone.framesIn(1500)) >= 30, 'frames are being drawn');
  const facts = await phone.json(
    `({ gun: ${WEIGH}(__G.weapon.scene.children[0]), keys: __G.world.keys, matter: __G.world.matter })`,
  );
  // provisional, until a real phone has been timed with the test page (?bench=1): a gun the size of the old desk one
  assert.ok(facts.gun.triangles <= 16000, `the carbine is ${facts.gun.triangles} triangles on a phone`);
  // a phone has no picture of moving things — a machine throws no shadow there — and burns four lamps, not six
  assert.equal(facts.keys.length, KEYS.length);
  assert.ok(
    facts.keys.every((k) => k.moving === false && k.map === 1024),
    'a phone was given the desk’s depth pictures',
  );
  const burning = facts.keys.filter((k) => k.slot >= 0);
  assert.ok(burning.length >= 1 && burning.length <= 4, `${burning.length} lamps hold slots on a phone`);
  // four points of the depth picture to a pixel where the card blends neighbouring answers itself, nine where
  // it does not (look/probe.js asks it): never the sixteen of a desk
  assert.ok([4, 9].includes(facts.keys[0].taps), `a phone asks ${facts.keys[0].taps} points of a depth picture`);
  assert.equal(facts.matter.size, 256);
  assert.deepEqual(await phone.problems(), []);
  await phone.close();
});

// The 76 tests of how the game PLAYS run without the switch. This one takes it to both of its endings with the
// switch — the states of the second look that nothing else reaches: the cascades down, every lamp put out, the
// ground moved by the strike (when the key lights must be dark: a depth picture knows nothing of moved ground),
// the place captured again in the dark, and the title afterwards with everything alight once more.
test('with the switch the mission still ends, both ways: the lamps go out, the mountain comes down, and nothing is logged', async () => {
  const page = await open(`look=2&${PLAY}`);
  const until = (expression, label, timeoutMs) => page.waitFor(expression, { timeoutMs, intervalMs: 100, label });
  const uniforms =
    '__G.world.group.children.find((mesh) => mesh.material && mesh.material.uniforms && mesh.material.uniforms.uKeyCol).material.uniforms';
  // how bright the key lights are in the shader just now, and how often the place has been captured
  const look = () =>
    page.json(
      `({ keys: ${uniforms}.uKeyCol.value.map((c) => +(c.x + c.y + c.z).toFixed(3)), captures: __G.world.env.captures, ruin: ${uniforms}.uRuin.value, crater: ${uniforms}.uCraterGo.value })`,
    );
  // to the beacon: cleared, rigged, blown; the pad is held until the lodestar is up — the hold is counted in the
  // game's own time, which a busy machine stretches, so it is tried up to three times
  const toExfil = async () => {
    await page.evaluate('__G.debug.clearSite(); __G.debug.rig(); __G.debug.blow(); void 0');
    await until('__G.mission.phase === "mark"', 'the mark phase', 8000);
    await page.evaluate(
      'for (const u of [...__G.enemies.list]) if (!u.dead && u.rollId < 0) __G.enemies.damage(u, 1e6, 0, 0); __G.player.hidden = true; void 0',
    );
    for (let attempt = 0; attempt < 3 && (await page.evaluate('__G.mission.phase')) !== 'exfil'; attempt++) {
      await page.evaluate(
        '__G.debug.teleport(__G.site.beacon.x, __G.site.beacon.z, 0); __G.player.health = 100; void 0',
      );
      await sleep(200);
      await page.holdKey('KeyF', 'f', 0, 3500);
      await sleep(400);
    }
    assert.equal(await page.evaluate('__G.mission.phase'), 'exfil', 'the lodestar was not raised');
  };

  const first = await look();
  // (the slots, as the shader has them: at the start the lamp of the adit burns, and the rest are empty)
  assert.ok(first.keys.length >= 4 && first.keys.some((k) => k > 1), `the key lights at the start: ${first.keys}`);
  assert.equal(await page.evaluate('__G.enemies.list.filter((u) => u.type === "sentry").length > 0'), true);

  // ---------- won: watched from the valley as the mountain sinks ----------
  await toExfil();
  await page.evaluate('__G.debug.teleport(__G.site.pickup.x, __G.site.pickup.z, 0); void 0');
  await until('__G.state === "ending"', 'the ending to start', 5000);
  await until('__G.cine && __G.cine.hit', 'the strike', 20000);
  await until('__G.menus.current() === "debrief"', 'the debrief', 40000);
  assert.equal(await page.evaluate('__G.mission.phase'), 'extracted');
  const won = await look();
  assert.deepEqual(
    won.keys,
    won.keys.map(() => 0),
    'a key light is still burning after the strike',
  );
  assert.equal(won.crater, 1);
  assert.ok(won.captures > first.captures, 'the place was not captured again when its lamps went out');
  assert.ok((await page.framesIn(600)) >= 10, 'frames are still being drawn behind the debrief');

  // ---------- and a new mission stands everything up again ----------
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; void 0');
  await until('__G.state === "playing"', 'a new mission', 8000);
  await sleep(300);
  const again = await look();
  assert.deepEqual(again.keys, first.keys, 'the key lights did not come back as they were');
  assert.deepEqual([again.ruin, again.crater], [0, 0]);
  assert.ok(again.captures > won.captures, 'the place was not captured again when its lamps came back');

  // ---------- lost: the clock runs out inside, and the facility comes down round you ----------
  await toExfil();
  await page.evaluate('__G.mission.clock = 0.4; void 0');
  await until('__G.menus.current() === "failed"', 'the failed screen', 15000);
  assert.equal(await page.evaluate('__G.mission.phase'), 'lost');
  const lost = await look();
  assert.deepEqual(
    lost.keys,
    lost.keys.map(() => 0),
    'a key light is still burning in the ruin',
  );
  assert.equal(lost.ruin, 1);
  assert.ok((await page.framesIn(600)) >= 10, 'frames are still being drawn behind the failed screen');

  assert.deepEqual(await page.problems(), []);
  await page.close();
});

// The pieces are fenced apart in one shader, and a fence in the wrong place only shows in the one combination
// that needs it. Each piece is left out by itself here, and the plainer way of laying materials on is tried: the
// game must start, play, compile every shader it uses, and log nothing.
test('each piece can be left out by itself: every shader still compiles, and nothing is logged', async () => {
  const BROKEN =
    '__G.view.renderer.info.programs.filter((p) => p.diagnostics && p.diagnostics.runnable === false).length';
  for (const [query, expected] of [
    ['mats=0', { matter: false, keys: KEYS.length, mirror: true }],
    ['key=0', { matter: true, keys: 0, mirror: true }],
    ['env=0', { matter: true, keys: KEYS.length, mirror: false }],
    ['mats=cheap', { matter: true, keys: KEYS.length, mirror: true }],
    ['shapes=0', { matter: true, keys: KEYS.length, mirror: true }],
    // the two pieces of 16 November
    ['marks=0', { matter: true, keys: KEYS.length, mirror: true }],
    ['shafts=0', { matter: true, keys: KEYS.length, mirror: true }],
  ]) {
    const page = await open(`look=2&${query}&${PLAY}`);
    assert.equal(await page.evaluate('__G.state'), 'playing', query);
    await page.stand(STATIONS.yard);
    assert.ok((await page.framesIn(700)) >= 14, `${query}: frames are being drawn`);
    const facts = await page.json(
      `({ matter: !!__G.world.matter, keys: __G.world.keys.length, mirror: !!__G.world.env, programs: __G.view.renderer.info.programs.length, broken: ${BROKEN} })`,
    );
    assert.ok(facts.programs >= 5, `${query}: ${facts.programs} shader programs in use`);
    assert.equal(facts.broken, 0, `${query}: ${facts.broken} shaders did not compile`);
    assert.deepEqual({ matter: facts.matter, keys: facts.keys, mirror: facts.mirror }, expected, query);
    assert.deepEqual(await page.problems(), [], query);
    // …and the switch did leave its piece out, and nothing else
    const left = await page.json(
      `({ marks: __G.world.stats.marks.squares > 0, shafts: !!__G.world.group.parent.getObjectByName('shafts') })`,
    );
    assert.deepEqual(left, { marks: query !== 'marks=0', shafts: query !== 'shafts=0' && query !== 'key=0' }, query);
    await page.close();
  }
});

test('any piece of it can be left out, and a material whose picture cannot be fetched is drawn in its paint', async () => {
  // `mats=miss` asks for material pictures that are not there: what a failed download looks like to the game
  const page = await open(`look=2&mats=miss&key=0&env=0&shapes=0&${PLAY}`);
  assert.equal(await page.evaluate('__G.state'), 'playing');
  const facts = await page.json(
    `({ matter: __G.world.matter, keys: __G.world.keys.length, mirror: !!__G.world.env, gun: ${WEIGH}(__G.weapon.scene.children[0]).triangles, truck: __G.world.stats.kinds.truck.triangles })`,
  );
  assert.deepEqual(facts.matter.failed.slice().sort(), [...OWN_PICTURES, ...Object.keys(BORROWED)].sort());
  assert.deepEqual([facts.keys, facts.mirror], [0, false]);
  // `shapes=0`: the models are the ones the game has without the switch
  assert.ok(facts.gun <= 10000 && facts.truck <= 3000, `the carbine is ${facts.gun} triangles, a truck ${facts.truck}`);
  assert.ok((await page.framesIn(1000)) >= 20, 'frames are being drawn');
  // a warning is not an error: the game says which it could not have, and goes on. A picture that is not there
  // is the browser's to complain about, and the only thing it may complain about
  const problems = (await page.problems()).filter((p) => !/a-picture-that-is-not-there/.test(p));
  assert.deepEqual(problems, []);
  await page.close();
});

// The phone test page is run by a person, on a device nobody here has. What can be held to here is that it runs to
// its end: every set-up loaded and timed, a table, and one line to copy. What the numbers ARE on a phone is the
// one thing in this file that no test can say.
test('the phone test page goes through every set-up once and ends on a table and a line to copy', async () => {
  const page = await harness.browser.newPage();
  // `fast=1`: a fraction of a second to a measurement instead of three — this is a test of the page, not of the machine
  await page.navigate(`${harness.url}/?bench=1&fast=1&q=low&touch=1`);
  await page.waitFor('!!(window.__bench && window.__bench.done) || !!window.__fatal', {
    timeoutMs: 180000,
    label: 'the bench to finish',
  });
  assert.equal(await page.evaluate('window.__fatal || null'), null);
  const bench = JSON.parse(await page.evaluate('JSON.stringify(window.__bench)'));
  assert.deepEqual(
    bench.rows.map((row) => row.id),
    BENCH.map((setup) => setup.id),
  );
  for (const row of bench.rows) {
    assert.equal(row.failed, undefined, `${row.id} did not start: ${row.failed}`);
    assert.equal(row.rates.length, 3, `${row.id}: timed drawing the world once, twice and three times a frame`);
    for (const rate of row.rates) assert.ok(rate > 1 && rate < 400, `${row.id}: ${row.rates} frames a second`);
    assert.ok(row.triangles > 10000, `${row.id}: ${row.triangles} triangles in a frame`);
    // a shader that does not compile draws nothing, and nothing is quick to draw: the page counts them, so that
    // a set-up is not written down as fast because half of it was missing
    assert.equal(row.broken, 0, `${row.id}: ${row.broken} of its shaders did not compile`);
  }
  // the page went through seven set-ups, five of them the second look with one thing changed: nothing was
  // logged as an error in any of them
  assert.deepEqual(
    [...page.exceptions, ...page.logErrors, ...page.console.filter((m) => m.type === 'error').map((m) => m.text)],
    [],
  );
  // each set-up really was what it says: A is the game as it is, B has everything, C no key light, E no capture
  const [a, b, c, , e] = bench.rows;
  assert.deepEqual([a.look, b.look, b.keys > 0, b.mirror], [1, 2, true, true]);
  assert.deepEqual([c.look, c.keys, e.look, e.mirror], [2, 0, 2, false]);
  assert.ok(['blended', 'nearest'].includes(bench.shadowFilter), `the shadow sampler: ${bench.shadowFilter}`);
  // 16 November 2026, the second version: the line says so, and says what the first could not — the screen's own
  // rate, the level of the look the device was given, and the detail the person asked for (not the last set-up's)
  assert.match(bench.line, /^LODESTAR-BENCH 2 \| /);
  assert.match(bench.line, / \| q=low \| /);
  assert.match(bench.line, / \| screen (\d+ Hz|\?) \| level hand \| /);
  assert.ok(bench.hz === 0 || (bench.hz >= 20 && bench.hz <= 240), `the screen was timed at ${bench.hz}`);
  for (const row of bench.rows) assert.ok(bench.line.includes(` ${row.id} ${row.rates.join('/')}`), bench.line);
  // and a person can read it: the table is on the page, with a button that copies the line
  const shown = JSON.parse(
    await page.evaluate(
      `JSON.stringify({ rows: document.querySelectorAll('#bench tbody tr:not([data-warning])').length, copy: !!document.querySelector('#bench button[data-copy]'), line: (document.querySelector('#bench textarea') || {}).value })`,
    ),
  );
  assert.deepEqual(shown, { rows: BENCH.length, copy: true, line: bench.line });
  await page.close();
});

// 16 November 2026. The owner's line from his iPhone had three rows of five: his browser had loaded the page
// afresh between two set-ups, and the rows — kept only in the page's own store — went with it. The rows now
// travel in the address. Held here: a page that is opened cold at the LAST set-up, with nothing in its store and
// the earlier rows in its address, ends on a table with all of them — the numbers it was given, not others.
test('the phone test page loses nothing to a fresh load: the rows so far are in the address, and are the ones in the table', async () => {
  const page = await harness.browser.newPage();
  const last = BENCH.length - 1;
  const given = BENCH.slice(0, last).map((setup, n) => ({
    id: setup.id,
    rates: [60 - n, 41.5 - n, 20 + n],
    broken: 0,
    triangles: 300000 + n,
  }));
  const address = benchAddress(
    last,
    [
      ['fast', '1'],
      ['q', 'low'],
      ['touch', '1'],
    ],
    {
      rows: packRows(given),
      hz: 60,
      level: 'hand.high',
    },
  );
  await page.navigate(`${harness.url}/${address}`);
  await page.waitFor('!!(window.__bench && window.__bench.done) || !!window.__fatal', {
    timeoutMs: 90000,
    label: 'the last set-up to finish',
  });
  assert.equal(await page.evaluate('window.__fatal || null'), null);
  const bench = JSON.parse(await page.evaluate('JSON.stringify(window.__bench)'));
  assert.deepEqual(
    bench.rows.map((row) => row.id),
    BENCH.map((setup) => setup.id),
  );
  for (const [n, row] of given.entries()) {
    assert.deepEqual(bench.rows[n].rates, row.rates, `${row.id}: not the rates it was given`);
    assert.equal(bench.rows[n].name, BENCH[n].name);
  }
  assert.equal(bench.rows[last].rates.length, 3, 'the last set-up was timed');
  // what was found out before the fresh load is in the line as it was found: the screen, the level, the detail
  assert.match(
    bench.line,
    /^LODESTAR-BENCH 2 \| .* \| q=high \| .* \| screen 60 Hz \| level hand \| A 60\/41.5\/20 \| /,
  );
  const shown = await page.evaluate("document.querySelectorAll('#bench tbody tr:not([data-warning])').length");
  assert.equal(shown, BENCH.length);
  await page.close();
});

// ---------- the whole site ----------

// This was the first of the targets below, and it has been reached (15 November 2026: three thousandths of one
// per cent bare over these sixteen places, two hundredths in the worst single picture) — by the rule that gives a
// material to any part whose builder did not name one. It is a lock now. What is NOT reached by a rule is what
// the targets further down ask for: lettering, light, shape.
test('the whole site: 99% of what is on screen has a material, from sixteen places', async () => {
  await raw.evaluate('__G.debug.classes(true); void 0');
  const spots = await raw.json(
    `(() => { const g = __G.world.grid, out = []; for (let x = 12.5; x < g.w; x += 16) for (let z = 8.5; z < g.h; z += 16) if (g.walkable(Math.floor(x), Math.floor(z))) out.push([x, z]); return out.slice(0, 16); })()`,
  );
  assert.equal(spots.length, 16, 'the sixteen places are not all there');
  let material = 0;
  let bare = 0;
  try {
    for (const [x, z] of spots)
      for (const yaw of [0, Math.PI]) {
        await raw.stand({ x, z, yaw, pitch: 0 });
        const seen = classes(await picture(raw));
        material += seen.material;
        bare += seen.bare;
      }
  } finally {
    await raw.evaluate('__G.debug.classes(false); void 0');
  }
  assert.ok(material + bare > 0, 'nothing was counted');
  assert.ok(
    material >= (material + bare) * 0.99,
    `${((100 * bare) / (material + bare)).toFixed(1)}% bare over ${spots.length} places`,
  );
});

// ---------- the whole site: where this is going ----------
// 16 November 2026, the plan's second step: "a material on everything — by hand". "Has a material" was true of a
// site nobody had named: a part that did not say what it is made of was given a material by a rule, from its
// colour. A guess is now marked as one (gfx/geo.js GUESSED), and counted here: of the corners of what stands on
// the site, of the cascade, of a machine of each kind and of what is in the hands, nineteen in twenty or more
// were named by whoever built the thing; and no kind of furniture is left more than a tenth to the rule.
// (It ran as a target until the helpers' cascade casing and side arms were in, the same day: it is a lock.)
test('what is on the site says what it is made of: nineteen parts in twenty were named by their builder, not guessed', async () => {
  const NAMED = `((root) => {
    let corners = 0, guessed = 0;
    root.traverse((m) => {
      const mat = m.geometry && m.geometry.attributes && m.geometry.attributes.mat;
      if (!mat) return;
      const many = m.isInstancedMesh ? m.count : 1;
      for (let i = 0; i < mat.count; i++) {
        const v = mat.array[i];
        if (v < 0) continue;
        corners += many;
        const f = v - Math.floor(v);
        if (Math.abs((f >= 0.5 ? f - 0.5 : f) - 0.125) < 0.01) guessed += many;
      }
    });
    return { corners, guessed };
  })`;
  const site = await desk.json('__G.world.stats.named');
  assert.ok(site.corners > 400000, `only ${site.corners} corners of furniture on the site`);
  const share = (c) => 1 - c.guessed / Math.max(1, c.corners);
  assert.ok(share(site) >= 0.95, `${(share(site) * 100).toFixed(1)}% of the site's furniture says what it is made of`);
  const kinds = await desk.json('__G.world.stats.kinds');
  for (const [kind, k] of Object.entries(kinds))
    assert.ok(k.named >= 0.9, `${kind}: ${(k.named * 100).toFixed(0)}% of it says what it is made of`);
  for (const [what, root] of [
    ['the cascade', "__G.world.group.children.find((o) => o.name === 'cascade')"],
    ['a sentry', "__G.enemies.list.find((u) => u.type === 'sentry').model.root"],
    ['a drone', "__G.enemies.list.find((u) => u.type === 'drone').model.root"],
    ['what is in the hands', '__G.weapon.scene'],
  ]) {
    const c = await desk.json(`${NAMED}(${root})`);
    assert.ok(c.corners >= 3000, `${what}: ${c.corners} corners with a material`);
    assert.ok(share(c) >= 0.95, `${what}: ${(share(c) * 100).toFixed(1)}% of it says what it is made of`);
  }
});

// 16 November 2026, the plan's fifth step ("finishing"). A floor that has been worked on is not a clean sheet of
// one material, and a thing that stands on a floor keeps the light off it where the two meet. Where the marks go
// is held in test/unit/marks.test.mjs; here, that they are drawn — and that the dark under a thing is in the
// picture: beside a crate's foot the ground is a fifth darker, or more, than a step away, and with the marks left
// out (`marks=0`) it is not.
test('what is painted and spilt is on the floors, and under a thing that stands there the ground is darker than a step away', async () => {
  const stats = await raw.json('__G.world.stats.marks');
  assert.ok(stats.squares >= 2500 && stats.squares <= 4200, `${stats.squares} squares of marks`);
  for (const kind of ['contact', 'threshold', 'line', 'number', 'oil', 'damp', 'scuff', 'drip', 'face'])
    assert.ok(stats.kinds[kind] >= 1, `no ${kind} on the site`);
  const MESHES = `__G.world.group.children.filter((o) => o.name === 'marks').map((o) => ({
    transparent: o.material.transparent, writes: o.material.depthWrite,
    picture: o.material.uniforms.uMap.value.name, wide: o.material.uniforms.uMap.value.image.width,
    triangles: o.geometry.index.count / 3 }))`;
  const meshes = await raw.json(MESHES);
  assert.ok(meshes.length >= 2, `${meshes.length} meshes of marks`);
  for (const m of meshes)
    assert.deepEqual(
      { transparent: m.transparent, writes: m.writes, picture: m.picture, wide: m.wide },
      { transparent: true, writes: false, picture: 'marks', wide: 2048 },
    );
  assert.equal(
    meshes.reduce((sum, m) => sum + m.triangles, 0),
    stats.squares * 2,
  );

  // A crate with clear ground on one side of it; the eye three and a half metres off on that side, looking down at
  // its foot. No key light burns (what is mirrored kept as it was): the dark under a thing is the dark where no
  // light gets, and a lamp's own shadow is another test's business.
  const SPOT = `(() => {
    const G = __G, g = G.world.grid, clear = (x, z) => {
      const i = g.index(Math.floor(x), Math.floor(z));
      return g.inside(Math.floor(x), Math.floor(z)) && g.kind[i] < 2 && g.block[i] === 0;
    };
    for (const p of G.world.site.props) {
      if (p.kind !== 'crate' || p.y > 0.05) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let ok = true;
        for (let d = 1; d <= 5 && ok; d++)
          for (const s of [-1, 0, 1]) ok = ok && clear(p.x + dx * d - dz * s, p.z + dz * d + dx * s);
        if (ok) return { x: p.x, z: p.z, dx, dz };
      }
    }
    return null;
  })()`;
  const READ = (spot) => `(() => {
    const G = __G, at = (x, z) => {
      const v = G.camera.position.clone().set(x, 0.01, z).project(G.camera);
      return { px: (v.x + 1) * 640, py: (1 - v.y) * 360 };
    };
    const s = ${JSON.stringify(spot)}, near = [], far = [];
    for (const side of [-0.3, -0.15, 0, 0.15, 0.3]) {
      near.push(at(s.x + s.dx * 0.56 - s.dz * side, s.z + s.dz * 0.56 + s.dx * side));
      far.push(at(s.x + s.dx * 1.7 - s.dz * side, s.z + s.dz * 1.7 + s.dx * side));
    }
    return { near, far };
  })()`;
  const darkAtFoot = async (page) => {
    const spot = await page.json(SPOT);
    assert.ok(spot, 'no crate on the site has clear ground on one side of it');
    await page.evaluate(`__G.weapon.scene.visible = false; ${FREEZE}`);
    await page.evaluate(`__G.debug.keySolo(${NO_KEY}, true); void 0`);
    try {
      await page.stand({
        x: spot.x + spot.dx * 4,
        z: spot.z + spot.dz * 4,
        yaw: Math.atan2(spot.dx, spot.dz),
        pitch: -0.38,
      });
      const points = await page.json(READ(spot));
      const image = await picture(page);
      const read = ({ px, py }) => {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = Math.round((px * image.width) / 1280 + dx);
            const y = Math.round((py * image.height) / 720 + dy);
            assert.ok(
              x >= 0 && y >= 0 && x < image.width && y < image.height,
              `a point at (${px}, ${py}) is out of the picture`,
            );
            const i = (y * image.width + x) * 4;
            sum += image.data[i] * 0.3 + image.data[i + 1] * 0.59 + image.data[i + 2] * 0.11;
          }
        return sum / 9;
      };
      const far = median(points.far.map(read));
      assert.ok(far >= 6, `the ground a step from the crate is black in the picture (${far})`);
      return median(points.near.map(read)) / far;
    } finally {
      await page.evaluate(`__G.debug.keySolo(-1); __G.weapon.scene.visible = true; ${THAW}`);
    }
  };
  const marked = await darkAtFoot(raw);
  const bare = await open(`look=2&post=0&marks=0&${PLAY}`);
  try {
    assert.deepEqual(await bare.json(`[__G.world.stats.marks.squares, ${MESHES}.length]`), [0, 0]);
    const unmarked = await darkAtFoot(bare);
    if (process.env.LOOK_NUMBERS)
      console.log(`MARKS at a crate's foot ${marked.toFixed(2)} of a step away; unmarked ${unmarked.toFixed(2)}`);
    assert.ok(marked <= 0.8, `at a crate's foot the ground is ${marked.toFixed(2)} of what it is a step away`);
    assert.ok(
      unmarked >= marked + 0.12,
      `without the marks it is ${unmarked.toFixed(2)}; with them ${marked.toFixed(2)}`,
    );
    assert.deepEqual(await bare.problems(), []);
  } finally {
    await bare.close();
  }
  assert.deepEqual(await raw.problems(), []);
});

// 16 November 2026, the plan's fifth step: "lights that shine". The air under a strong lamp is lit — a cone of
// haze from every lamp that hangs, along its beam, and the moon's light a column down the exhaust shaft
// (look/key.js shaftOf says where each begins and ends; test/unit/slots.test.mjs holds that). Here: that they are
// made, drawn the way haze is, and that the moon's column is in the picture.
test('the air under a lamp is lit: a cone from every lamp that hangs, and the moon’s column down the shaft is in the picture', async () => {
  const SHAFTS = "__G.world.group.parent.getObjectByName('shafts')";
  const facts = await raw.json(`(() => {
    const m = ${SHAFTS};
    return m && { triangles: m.geometry.index.count / 3, blending: m.material.blending, writes: m.material.depthWrite,
      transparent: m.material.transparent, group: m.parent.name, order: m.renderOrder };
  })()`);
  assert.ok(facts, 'no lit air under any lamp');
  // every lamp but the moon over the forecourt, which shines through no dark air: four bands of 24 squares each
  const cones = KEYS.filter((key) => !key.sky).length;
  assert.equal(cones, KEYS.length - 1);
  assert.deepEqual(facts, {
    triangles: cones * 4 * 24 * 2,
    blending: 2, // added to the picture
    writes: false,
    transparent: true,
    group: 'key lights',
    order: 3,
  });

  // from the cavern floor, eleven metres from the foot of the shaft, looking at the middle of the column half way
  // up: with the lit air drawn that part of the picture is brighter than without it
  await raw.evaluate(`__G.weapon.scene.visible = false; ${FREEZE}`);
  try {
    await raw.stand({ x: 101.5, z: 24.5, yaw: Math.atan2(101.5 - 106.3, 24.5 - 34.8), pitch: 0.3 });
    const at = await raw.json(`(() => {
      const v = __G.camera.position.clone().set(106.3, 5, 34.8).project(__G.camera);
      return { px: (v.x + 1) * 640, py: (1 - v.y) * 360 };
    })()`);
    assert.ok(
      at.px > 100 && at.px < 1180 && at.py > 60 && at.py < 660,
      `the column is not in view: ${at.px}, ${at.py}`,
    );
    const read = async (visible) => {
      await raw.evaluate(`${SHAFTS}.visible = ${visible}; void 0`);
      await sleep(150);
      const image = await picture(raw);
      let sum = 0;
      let count = 0;
      for (let dy = -12; dy <= 12; dy += 3)
        for (let dx = -12; dx <= 12; dx += 3) {
          const x = Math.round((at.px * image.width) / 1280 + dx);
          const y = Math.round((at.py * image.height) / 720 + dy);
          const i = (y * image.width + x) * 4;
          sum += image.data[i] * 0.3 + image.data[i + 1] * 0.59 + image.data[i + 2] * 0.11;
          count++;
        }
      return sum / count;
    };
    const lit = await read(true);
    const unlit = await read(false);
    if (process.env.LOOK_NUMBERS)
      console.log(`SHAFT the moon's column ${lit.toFixed(1)}, the air without it ${unlit.toFixed(1)}`);
    assert.ok(
      lit >= unlit * 1.15 && lit >= unlit + 4,
      `the moon's column is ${lit.toFixed(1)} where the air without it is ${unlit.toFixed(1)}`,
    );
  } finally {
    await raw.evaluate(`${SHAFTS}.visible = true; __G.weapon.scene.visible = true; ${THAW}`);
  }
  assert.deepEqual(await raw.problems(), []);
});

// The targets of 15 November. They were marked `todo` — they ran, said how far there was to go, and did not fail
// the run — until each was reached. All of them have been (16 November 2026), and every one is a lock now: the
// title of the one below still says what it was.

// Reached on 16 November 2026, when the helpers' furniture came in: a lock from then on.
test('the whole site: something is written on every hero prop', async () => {
  const kinds = await desk.json('__G.world.stats.kinds');
  const HEROES = [
    'truck',
    'container',
    'forklift',
    'generator',
    'transformer',
    'tank',
    'console',
    'switchgear',
    'rack',
    'locker',
  ];
  const without = HEROES.filter((kind) => !(kinds[kind] && kinds[kind].lettering >= 1));
  assert.deepEqual(without, []);
});

test('TARGET the whole site: a strong light that throws real shadows in every space', async () => {
  const lit = await desk.json(`(() => {
    const G = __G, g = G.world.grid, zones = new Map();
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) if (g.walkable(x, z)) { const id = g.zone[z * g.w + x]; const s = zones.get(id) || { cells: 0, reached: 0 }; s.cells++; if (G.world.keyAt(x + 0.5, z + 0.5) > 0.05) s.reached++; zones.set(id, s); }
    return [...zones].map(([id, s]) => [id, s.cells, s.reached]);
  })()`);
  const dark = lit.filter(([, cells, reached]) => cells >= 40 && reached < cells * 0.25).map(([id]) => id);
  assert.deepEqual(dark, [], `spaces no key light reaches: ${dark.join(', ')}`);
});

// A target of the 15th, reached on the 16th: the drone was 2 668 triangles of boxes.
test('a drone: 9 000 triangles or more, a material on it, and its number', async () => {
  const drone = await desk.json(`${WEIGH}(__G.enemies.list.find((u) => u.type === 'drone').model.root)`);
  assert.ok(drone.triangles >= 9000, `a drone is ${drone.triangles} triangles`);
  assert.ok(drone.triangles <= 16000, `a drone is ${drone.triangles} triangles, and there are four of them`);
  assert.equal(drone.wrapped, true);
  assert.ok(drone.tagged >= 0.95);
  assert.ok(drone.lettering >= 1, 'it has no number');
});

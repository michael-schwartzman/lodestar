// The site answers (src/wild/response.js): what a broken wire, an alarm and a finished task bring — the rules
// alone, by arithmetic; and that the rounds on the site are enough for what they bring, against the game's own
// tables.
//
// THE CONTRACT these hold (18 November 2026 — the owner: "every trip wire and every site alarm and completion of
// a task needs to bring a significant amount of enemies"):
//   - every cause brings machines, never fewer than two, and more on a harder setting;
//   - a wire brings its wave once;
//   - there are never more machines of waves running than the cap, nor more waiting than the cap again,
//     whatever is set off and however often;
//   - a wave shut down to its last machine pays for itself in rounds, at a hit rate the setting may fairly ask.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GUNS, GUN_ORDER, pelletDamage } from '../../src/arms.js';
import { POINT_WORDS, bearingOf, pointOf } from '../../src/bearing.js';
import { DIFFICULTY } from '../../src/difficulty.js';
import { buildSite, garrison } from '../../src/world/map.js';
import { ARMOUR } from '../../src/wild/armour.js';
import {
  RESPONSE,
  TIERS,
  call,
  capOf,
  createResponse,
  fallen,
  keep,
  mixOf,
  nextDoor,
  pointWord,
  restore,
  sizeOf,
  step,
  tierOf,
  topUp,
  words,
} from '../../src/wild/response.js';

const CAUSES = ['tripwire', 'alarm', 'task'];
const at = { x: 50, z: 30 };
const none = { sentries: 0, drones: 0 };

test('every cause brings a wave: never fewer than two machines, more on a harder setting, and a task the most', () => {
  for (const cause of CAUSES) {
    const sizes = TIERS.map((_, tier) => sizeOf(cause, tier));
    assert.ok(sizes[0] >= 2, `${cause} on Recruit brings ${sizes[0]}`);
    assert.ok(sizes[0] <= sizes[1] && sizes[1] < sizes[2], `${cause}: ${sizes}`);
  }
  for (const tier of [0, 1, 2]) {
    assert.ok(sizeOf('task', tier) >= sizeOf('alarm', tier), 'a task brings no fewer than an alarm');
    assert.ok(sizeOf('alarm', tier) >= sizeOf('tripwire', tier), 'an alarm no fewer than a wire');
  }
  // the figures themselves: changing one is a decision, to be written down with its date
  assert.deepEqual(RESPONSE.size, { tripwire: [2, 3, 4], alarm: [3, 4, 5], task: [3, 4, 6] });
  assert.deepEqual(RESPONSE.alive, [6, 9, 12]);
  assert.equal(sizeOf('nothing', 1), 0);
  // a setting nobody has heard of plays as Operator, as it does in the game
  assert.deepEqual(['recruit', 'operator', 'ghost', 'legend'].map(tierOf), [0, 1, 2, 1]);
});

test('a wave is mostly on foot: one machine in three comes by air', () => {
  assert.deepEqual(
    [2, 3, 4, 5, 6].map((n) => mixOf(n)),
    [
      { sentries: 2, drones: 0 },
      { sentries: 2, drones: 1 },
      { sentries: 3, drones: 1 },
      { sentries: 4, drones: 1 },
      { sentries: 4, drones: 2 },
    ],
  );
});

test('what the game already sends for a task counts towards its figure: the rest is made up, never less than nothing', () => {
  for (const [tier, name] of TIERS.entries()) {
    const d = DIFFICULTY[name];
    // a charge's own wave, the blast's drones, the lodestar's drones (src/difficulty.js)
    const sent = [
      { sentries: d.wave.guards, drones: d.wave.drones },
      { sentries: 0, drones: d.responders },
      { sentries: 0, drones: d.pursuers },
    ];
    for (const already of sent) {
      const add = topUp('task', tier, already);
      assert.ok(add.sentries >= 0 && add.drones >= 0, `${name}: ${JSON.stringify(add)}`);
      assert.equal(
        add.sentries + add.drones + already.sentries + already.drones,
        sizeOf('task', tier),
        `${name}, with ${JSON.stringify(already)} sent already`,
      );
      // every task brings more than the game sent for it: that is what was asked
      assert.ok(add.sentries + add.drones >= 1, `${name}: nothing was added to ${JSON.stringify(already)}`);
    }
  }
  // more sent already than the figure: nothing more
  assert.deepEqual(topUp('task', 0, { sentries: 2, drones: 5 }), none);
  // nothing sent: the whole wave, in its mix
  assert.deepEqual(topUp('alarm', 2), { sentries: 4, drones: 1 });
});

test('a wire brings its wave once in a mission; another wire brings its own', () => {
  const r = createResponse();
  const first = call(r, 'tripwire', { tier: 1, cap: 9, to: at, key: 'lobby' });
  assert.deepEqual([first.sentries, first.drones, first.total, first.shed], [2, 1, 3, 0]);
  assert.equal(call(r, 'tripwire', { tier: 1, cap: 9, to: at, key: 'lobby' }), null);
  assert.equal(r.queue.length, 3, 'the second crossing put nobody in the queue');
  assert.equal(call(r, 'tripwire', { tier: 1, cap: 9, to: at, key: 'corridor' }).total, 3);
  // an alarm and a task are not held to once: each fresh one brings its wave
  assert.equal(call(r, 'alarm', { tier: 1, cap: 99, to: at }).total, 4);
  assert.equal(call(r, 'alarm', { tier: 1, cap: 99, to: at }).total, 4);
});

test('a wave arrives, it does not appear: one machine at a time, a gap between them, on foot and by air in turn', () => {
  const r = createResponse();
  call(r, 'task', { tier: 2, cap: 12, to: at });
  const came = [];
  for (let t = 0; t < 10; t += 1 / 60) {
    const now = step(r, 1 / 60, { alive: came.length, cap: 12 });
    assert.ok(now.length <= 1);
    for (const order of now) came.push({ t, ...order });
  }
  assert.deepEqual(
    came.map((c) => c.type),
    ['sentry', 'drone', 'sentry', 'drone', 'sentry', 'sentry'],
  );
  assert.ok(came[0].t < 0.02, 'the first walks in at once');
  for (let k = 1; k < came.length; k++) {
    const gap = came[k].t - came[k - 1].t;
    assert.ok(gap >= RESPONSE.gap - 0.02 && gap < RESPONSE.gap + 0.05, `${gap} s between two`);
  }
  for (const c of came) assert.deepEqual(c.to, at);
  assert.equal(r.queue.length, 0, 'and the loop is over: nobody is waiting');
  assert.deepEqual(step(r, 1, { alive: 0, cap: 12 }), []);
});

test('however much is set off, never more than the cap are running and never more than the cap again are waiting', () => {
  for (const phone of [false, true])
    for (const tier of [0, 1, 2]) {
      const cap = capOf(tier, phone);
      const r = createResponse();
      let running = 0;
      let most = 0;
      // forty minutes in which an alarm goes up every ten seconds, every wire is broken and every task done at
      // once — and the player shuts nothing down
      for (let t = 0, k = 0; t < 2400; t += 1 / 30) {
        if (t >= k * 10) {
          k++;
          call(r, 'alarm', { tier, cap, to: at });
          if (k < 9) call(r, 'tripwire', { tier, cap, to: at, key: `wire-${k}` });
          if (k < 8) call(r, 'task', { tier, cap, to: at });
          assert.ok(r.queue.length <= cap, `${r.queue.length} waiting, cap ${cap}`);
        }
        running += step(r, 1 / 30, { alive: running, cap }).length;
        most = Math.max(most, running);
      }
      assert.equal(most, cap, `tier ${tier}${phone ? ' on a phone' : ''}: ${most} running, cap ${cap}`);
      assert.ok(r.queue.length <= cap);
      assert.ok(r.shed > 0, 'what did not fit was shed, and counted');
      assert.equal(r.sent, cap);
    }
  // a phone is asked to draw fewer; nobody is asked to draw fewer than two
  assert.deepEqual(
    [0, 1, 2].map((tier) => [capOf(tier), capOf(tier, true)]),
    [
      [6, 4],
      [9, 6],
      [12, 8],
    ],
  );
});

test('a wave is shut down when its last machine is — those the game sent for it count, those shed do not', () => {
  const r = createResponse();
  // a charge on Operator: the game has sent a guard and a drone, and two more are made up
  const wave = call(r, 'task', { tier: 1, cap: 9, to: at, already: { sentries: 1, drones: 1 } });
  assert.deepEqual([wave.sentries, wave.drones, wave.total], [2, 0, 4]);
  for (let k = 0; k < 3; k++) assert.equal(fallen(r, wave.id), null, `machine ${k + 1} of four`);
  assert.equal(fallen(r, wave.id).id, wave.id, 'the fourth is the last');
  assert.equal(fallen(r, wave.id), null, 'and it is not shut down twice');
  assert.equal(fallen(r, 999), null);
  // with room for one machine only, a wave of four is a wave of one — and one down is the wave down
  const tight = createResponse();
  tight.queue.push(...Array.from({ length: 5 }, () => ({ type: 'sentry', wave: 0, to: at })));
  const cut = call(tight, 'alarm', { tier: 1, cap: 6, to: at });
  assert.deepEqual([cut.total, cut.shed], [1, 3]);
  assert.equal(fallen(tight, cut.id).id, cut.id);
  // nothing fitted at all: there is no wave to shut down
  const full = createResponse();
  full.queue.push(...Array.from({ length: 6 }, () => ({ type: 'sentry', wave: 0, to: at })));
  const nobody = call(full, 'alarm', { tier: 1, cap: 6, to: at });
  assert.deepEqual([nobody.total, nobody.shed, full.waves.length], [0, 4, 0]);
});

test('a checkpoint keeps which wires have brought their wave, and nothing of the machines', () => {
  const r = createResponse();
  call(r, 'tripwire', { tier: 1, cap: 9, to: at, key: 'lobby' });
  call(r, 'task', { tier: 1, cap: 9, to: at });
  const kept = JSON.parse(JSON.stringify(keep(r)));
  const again = createResponse();
  call(again, 'alarm', { tier: 1, cap: 9, to: at });
  restore(again, kept);
  assert.deepEqual([again.queue.length, again.waves.length, again.shed, again.sent], [0, 0, 0, 0]);
  assert.equal(call(again, 'tripwire', { tier: 1, cap: 9, to: at, key: 'lobby' }), null, 'that wire has been');
  assert.ok(call(again, 'tripwire', { tier: 1, cap: 9, to: at, key: 'feed' }));
  // a checkpoint from before there was anything to keep
  restore(again, undefined);
  assert.deepEqual(again.wires, []);
});

test('the doors: out of sight and far off first, then from more than one side, then the nearer — and round again', () => {
  // four doors round a place at (50, 30): west, east, north, south of it; the player stands at the place
  const entries = [
    [30, 30],
    [70, 30],
    [50, 10],
    [50, 52],
  ];
  const player = { x: 50, z: 30 };
  const blind = () => false;
  const used = [];
  for (let k = 0; k < 4; k++) used.push(nextDoor(entries, player, at, used, blind));
  // all four, each once: the nearest first (they are equally far: the first listed), then the one opposite
  assert.deepEqual(used.slice(0, 2), [
    [30, 30],
    [70, 30],
  ]);
  assert.equal(new Set(used.map(String)).size, 4);
  // …and with all four used, the fifth begins again
  assert.deepEqual(nextDoor(entries, player, at, used, blind), [30, 30]);
  // a door the player can see is passed over while there is one he cannot (the north door is then the nearest)
  const seesWest = (x) => x === 30;
  assert.deepEqual(nextDoor(entries, player, at, [], seesWest), [50, 10]);
  // a door nearer than `far` is the last resort
  const near = { x: 32, z: 30 };
  const order = [];
  for (let k = 0; k < 4; k++) order.push(nextDoor(entries, near, at, order, blind));
  assert.deepEqual(order.at(-1), [30, 30], `it came in by the door he stands at ${order.indexOf(order.at(-1))}th`);
  assert.equal(nextDoor([], player, at, [], blind), null);
});

test('which way they come from is named as everything else names it', () => {
  for (let degrees = 0; degrees < 360; degrees += 1) {
    const dx = Math.sin((degrees * Math.PI) / 180);
    const dz = -Math.cos((degrees * Math.PI) / 180);
    assert.equal(pointWord(dx, dz), POINT_WORDS[pointOf(bearingOf(dx, dz))], `${degrees}°`);
  }
});

test('what Overwatch says of a wave: how many, what for, how', () => {
  assert.equal(
    words({ sentries: 2, drones: 1 }, 'the wire', 'east'),
    'Three coming for the wire — two on foot from the east, one by air.',
  );
  assert.equal(
    words({ sentries: 2, drones: 0 }, 'the charge', 'north-west', true),
    'Two more coming for the charge — two on foot from the north-west.',
  );
  assert.equal(words({ sentries: 0, drones: 1 }, 'the alarm', null), 'One coming for the alarm — one by air.');
  assert.equal(words(none, 'the alarm', 'east'), '');
});

// ---------- what pays for it ----------

/** a machine's health as it is built (src/enemies/index.js keeps the table to itself: read off its text) */
const source = readFileSync(new URL('../../src/enemies/index.js', import.meta.url), 'utf8');
const HP = {
  sentry: Number(/sentry: \{\s+hp: (\d+)/.exec(source)?.[1]),
  drone: Number(/drone: \{\s+hp: (\d+)/.exec(source)?.[1]),
};
/** the hit rate each setting may fairly ask of whoever plays it: one round in four, three in ten, seven in twenty */
const AIM = [0.25, 0.3, 0.35];
/** what a shotgun's pellet does at the distance a wave is met at */
const MET_AT = 12;
/**
 * The game as it is played, and as it was before its machines were plated (18 November 2026, src/wild/armour.js
 * — `?armour=0`): with the plating a round counts `ARMOUR.rounds` of what it did against a machine, and there
 * are `ARMOUR.plenty` times the rounds — in reserve at the start, in a cache, from a wave shut down. Everything
 * below is asked of both.
 */
const GAMES = [
  { name: 'plated', worth: (type) => ARMOUR.rounds[type], plenty: ARMOUR.plenty },
  { name: 'unplated', worth: () => 1, plenty: 1 },
];
/** the damage in `rounds(gun)` rounds of every gun, every one a hit on a body, were nothing plated */
const damageOf = (rounds) =>
  GUN_ORDER.reduce((sum, key) => {
    const gun = GUNS[key];
    return sum + rounds(gun) * (gun.pellets > 1 ? gun.pellets * pelletDamage(MET_AT) : gun.damage);
  }, 0);
/** what a cache gives, and what is carried when a mission starts (the magazines are not multiplied: arms.js) */
const cacheOf = (game) => damageOf((gun) => gun.cache * game.plenty);
const carriedOf = (game) => damageOf((gun) => gun.mag + gun.reserve * game.plenty);
/** a machine's health in the same measure: what unplated rounds would have to do to shut it down */
const toughOf = (type, name, game) => (HP[type] * DIFFICULTY[name].health) / game.worth(type);
const healthOf = (wave, name, game) =>
  wave.sentries * toughOf('sentry', name, game) + wave.drones * toughOf('drone', name, game);

test('the tables this reads are the ones it thinks they are', () => {
  assert.deepEqual(HP, { sentry: 100, drone: 55 });
  assert.equal(buildSite().ammo.length, 3, 'three caches on the site');
  assert.deepEqual(TIERS, Object.keys(DIFFICULTY));
  assert.deepEqual(Object.keys(ARMOUR.rounds).sort(), Object.keys(HP).sort(), 'a figure for every machine there is');
});

test('a wave shut down to its last machine pays for itself: the cache it gives holds the rounds it took', () => {
  for (const game of GAMES) {
    const cache = cacheOf(game);
    for (const [tier, name] of TIERS.entries())
      for (const cause of CAUSES) {
        const wave = mixOf(sizeOf(cause, tier));
        const needs = healthOf(wave, name, game);
        assert.ok(
          cache * AIM[tier] >= needs,
          `${game.name}, ${name}, ${cause}: ${Math.round(needs)} health in the wave, ${Math.round(cache * AIM[tier])} in a cache at ${AIM[tier]}`,
        );
      }
  }
});

test('a whole mission, the worst there is: every wire, every task and an alarm a minute — and the rounds are there', () => {
  const site = buildSite();
  for (const game of GAMES) {
    const carried = carriedOf(game);
    const cache = cacheOf(game);
    for (const [tier, name] of TIERS.entries()) {
      const cap = capOf(tier);
      const d = DIFFICULTY[name];
      const r = createResponse();
      const roll = garrison(site, d.tier).reduce((sum, g) => sum + toughOf(g.type, name, game), 0);
      let health = roll;
      let rounds = (carried + site.ammo.length * cache) * AIM[tier];
      let waves = 0;
      const meet = (wave) => {
        if (!wave) return;
        waves++;
        health += healthOf(wave, name, game);
        // shut down to the last machine, as it must be for the next to come in full: its cache
        rounds += cache * AIM[tier];
        for (let left = wave.total; left > 0; left--) fallen(r, wave.id);
        r.queue.length = 0;
      };
      // the seven wires (the lobby's two beams are one doorway), each broken twice
      for (let k = 0; k < 7; k++)
        for (let twice = 0; twice < 2; twice++) meet(call(r, 'tripwire', { tier, cap, to: at, key: `wire-${k}` }));
      // the four charges, the blast, the roll shut down, the lodestar — with what the game sends for each
      const sent = [
        ...Array.from({ length: 4 }, () => ({ sentries: d.wave.guards, drones: d.wave.drones })),
        { sentries: 0, drones: d.responders },
        none,
        { sentries: 0, drones: d.pursuers },
      ];
      for (const already of sent) {
        const wave = call(r, 'task', { tier, cap, to: at, already });
        meet(wave && { ...wave, sentries: wave.sentries + already.sentries, drones: wave.drones + already.drones });
      }
      // and half an hour of alarms, one a minute
      for (let k = 0; k < 30; k++) meet(call(r, 'alarm', { tier, cap, to: at }));
      assert.equal(waves, 7 + 7 + 30, `${game.name}, ${name}: ${waves} waves`);
      assert.ok(
        rounds >= health,
        `${game.name}, ${name}: ${Math.round(health)} health met in ${waves} waves and the roll, ${Math.round(rounds)} in the rounds at ${AIM[tier]}`,
      );
      // and before any wave is down: what is carried and cached is enough for the roll and a full cap of the wave's
      const first = (carried + site.ammo.length * cache) * AIM[tier];
      assert.ok(
        first >= roll + cap * toughOf('sentry', name, game),
        `${game.name}, ${name}: ${Math.round(first)} for ${Math.round(roll + cap * toughOf('sentry', name, game))}`,
      );
    }
  }
});

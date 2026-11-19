// Contract lock: what you carry, how much of it, and what each of them is for.
//
// Decision of 12 November 2026 (the owner: "display two ammo counters: the number of bullets remaining until the
// next reload, and the total bullets you have left. It shouldn't be unlimited"): ammunition is counted and it runs
// out. Each cache on the site gives a fixed amount, once.
//
// Second decision, later the same day (the owner: "the game is slighly too easy make it a bit harder and make the
// weponds more versatile"): one gun became three and a grenade, each with a job of its own, and the carbine's
// reserve was cut from 120 rounds to 90 — a cache now gives a little of everything (30 carbine rounds, where it
// gave 60). What you carry is more varied; it is not more.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ARMS,
  GUNS,
  GUN_ORDER,
  addRounds,
  allDry,
  canReload,
  createArms,
  createKnife,
  gunOf,
  isDry,
  loadShell,
  nextGun,
  pelletDamage,
  reloadMag,
  selectGun,
  spendRound,
  takeCache,
  toggleMode,
  totalRounds,
} from '../../src/arms.js';

const fresh = () => ({ mag: ARMS.mag, reserve: ARMS.reserve });

// ---------- the carbine's ammunition, as it was — less thirty rounds ----------

test('the carbine starts with one magazine in it and three in reserve: 120 rounds', () => {
  const a = fresh();
  assert.deepEqual([a.mag, a.reserve, totalRounds(a)], [30, 90, 120]);
  assert.equal(isDry(a), false);
  assert.deepEqual([GUNS.carbine.mag, GUNS.carbine.reserve], [ARMS.mag, ARMS.reserve], 'ARMS is the carbine');
});

test('a round fired comes out of the magazine and out of the total, and an empty magazine fires nothing', () => {
  const a = fresh();
  assert.equal(spendRound(a), true);
  assert.deepEqual([a.mag, a.reserve, totalRounds(a)], [29, 90, 119]);
  a.mag = 0;
  assert.equal(spendRound(a), false);
  assert.deepEqual([a.mag, totalRounds(a)], [0, 90]);
});

test('a reload fills the magazine from the reserve and changes the total by nothing', () => {
  const a = { mag: 7, reserve: 90 };
  assert.equal(canReload(a), true);
  assert.equal(reloadMag(a), 23);
  assert.deepEqual([a.mag, a.reserve, totalRounds(a)], [30, 67, 97]);
  assert.equal(canReload(a), false, 'a full magazine needs nothing');
  assert.equal(reloadMag(a), 0);
});

test('the last reload takes what is left, and after that there is nothing to reload from', () => {
  const a = { mag: 0, reserve: 11 };
  assert.equal(reloadMag(a), 11);
  assert.deepEqual([a.mag, a.reserve], [11, 0]);
  assert.equal(canReload(a), false);
  assert.equal(isDry(a), false, 'eleven rounds are still eleven rounds');
});

test('it is not unlimited: fire and reload until nothing happens — exactly 120 rounds come out of the carbine', () => {
  const a = fresh();
  let fired = 0;
  for (let n = 0; n < 1000; n++) {
    if (spendRound(a)) fired++;
    else if (reloadMag(a) === 0) break;
  }
  assert.equal(fired, 120);
  assert.deepEqual([a.mag, a.reserve, totalRounds(a)], [0, 0, 0]);
  assert.equal(isDry(a), true);
  assert.equal(spendRound(a), false);
  assert.equal(reloadMag(a), 0);
});

test('rounds added to a reserve are whole, and a reserve is never less than nothing', () => {
  const a = { mag: 4, reserve: 0 };
  addRounds(a, 30);
  assert.deepEqual([a.mag, a.reserve, totalRounds(a)], [4, 30, 34]);
  addRounds(a, -500);
  assert.deepEqual([a.mag, a.reserve], [4, 0], 'never below nothing');
  addRounds(a, 2.9);
  assert.equal(a.reserve, 2);
});

// ---------- three guns and a grenade ----------

test('what you carry: a carbine, a sidearm, a shotgun and two EMP grenades — and every number of it', () => {
  assert.deepEqual(GUN_ORDER, ['carbine', 'pistol', 'shotgun']);
  const table = Object.fromEntries(
    GUN_ORDER.map((key) => [key, [GUNS[key].slot, GUNS[key].mag, GUNS[key].reserve, GUNS[key].cache]]),
  );
  assert.deepEqual(table, { carbine: [1, 30, 90, 30], pistol: [2, 12, 36, 12], shotgun: [3, 6, 18, 6] });
  const arms = createArms();
  assert.equal(arms.current, 'carbine');
  assert.equal(arms.mode, 'auto');
  assert.equal(arms.grenades, 2);
  assert.deepEqual(
    GUN_ORDER.map((key) => totalRounds(arms.guns[key])),
    [120, 48, 24],
  );
  assert.equal(gunOf(arms), GUNS.carbine);
  assert.equal(allDry(arms), false);
  // two missions do not share a magazine
  createArms().guns.carbine.mag = 0;
  assert.equal(createArms().guns.carbine.mag, 30);
});

test('each gun has a job: the sidearm is the quiet one, the shotgun the loud one, the carbine the one that keeps firing', () => {
  const { carbine, pistol, shotgun } = GUNS;
  // how far each carries to a machine's ears
  assert.ok(pistol.noise <= carbine.noise / 2, 'the sidearm is at least twice as quiet as the carbine');
  assert.ok(shotgun.noise >= carbine.noise * 2.5, 'the shotgun wakes the room next door');
  // how fast
  assert.ok(carbine.interval < pistol.interval && pistol.interval < shotgun.interval);
  assert.deepEqual([carbine.modes, pistol.modes, shotgun.modes], [['auto', 'semi'], ['semi'], ['semi']]);
  // how far
  assert.ok(carbine.range > pistol.range && pistol.range > shotgun.range);
  // one in the head from either shuts down a sentry on Operator (100) and not Ghost's (110): the sidearm is not
  // a better gun than the carbine, it is a quieter one
  const HEAD = 3;
  for (const gun of [carbine, pistol]) {
    const head = gun.damage * gun.head * HEAD;
    assert.ok(head >= 100 && head < 110, `${gun.name}: ${head} in the head`);
  }
  // …and in the body the carbine does more a round, and more than twice as much a second
  assert.ok(carbine.damage > pistol.damage);
  assert.ok(carbine.damage / carbine.interval > 2 * (pistol.damage / pistol.interval));
  // the shotgun, close: everything it fires, landing, is more than any sentry can take
  assert.equal(shotgun.pellets, 8);
  assert.ok(shotgun.pellets * shotgun.damage >= 110);
  assert.deepEqual([carbine.pellets, pistol.pellets], [1, 1]);
  // only the shotgun needs both hands
  assert.deepEqual([carbine.twoHands, pistol.twoHands, shotgun.twoHands], [false, false, true]);
});

test('a shotgun pellet loses its sting with distance: whole to 8 m, about a third at 28 m, and never nothing', () => {
  const d = GUNS.shotgun.damage;
  assert.equal(pelletDamage(0), d);
  assert.equal(pelletDamage(8), d);
  assert.ok(Math.abs(pelletDamage(18) - d * 0.675) < 1e-9, 'half way down the slope');
  assert.ok(Math.abs(pelletDamage(28) - d * 0.35) < 1e-9);
  assert.ok(Math.abs(pelletDamage(500) - d * 0.35) < 1e-9, 'it does not go on falling past its range');
  // so: across a room it takes two blasts to do what one does at arm's length
  assert.ok(8 * pelletDamage(4) >= 110 && 8 * pelletDamage(22) < 110);
});

test('the carbine has two ways of firing and B changes between them; the others have one', () => {
  const arms = createArms();
  assert.equal(toggleMode(arms), 'semi');
  assert.equal(arms.mode, 'semi');
  assert.equal(toggleMode(arms), 'auto');
  arms.current = 'pistol';
  assert.equal(toggleMode(arms), null, 'the sidearm has no selector');
  assert.equal(arms.mode, 'auto', 'and the carbine keeps the setting it was left on');
});

test('choosing a gun: the one asked for, if it is not the one in hand — and not the shotgun with a machine on your arm', () => {
  const arms = createArms();
  assert.equal(selectGun(arms, 'carbine'), false, 'it is already in your hands');
  assert.equal(selectGun(arms, 'pistol'), true);
  assert.equal(arms.current, 'pistol');
  assert.equal(selectGun(arms, 'nonsense'), false);
  assert.equal(arms.current, 'pistol');
  assert.equal(selectGun(arms, 'shotgun', { holding: true }), false, 'it takes two hands');
  assert.equal(arms.current, 'pistol');
  assert.equal(selectGun(arms, 'shotgun'), true);
  // a dry gun can still be chosen: looking at an empty gun is how you learn that it is empty
  arms.guns.carbine = { mag: 0, reserve: 0 };
  assert.equal(selectGun(arms, 'carbine'), true);
});

test('the next gun: round the three in order, passing over any that is dry — and the shotgun, with a machine on your arm', () => {
  const arms = createArms();
  assert.equal(nextGun(arms), 'pistol');
  assert.equal(nextGun(arms, { step: -1 }), 'shotgun');
  arms.current = 'shotgun';
  assert.equal(nextGun(arms), 'carbine');
  arms.current = 'pistol';
  assert.equal(nextGun(arms, { holding: true }), 'carbine', 'not the shotgun: one hand is full');
  arms.guns.carbine = { mag: 0, reserve: 0 };
  assert.equal(nextGun(arms), 'shotgun');
  assert.equal(nextGun(arms, { holding: true }), null, 'nothing else to turn to: the sidearm stays where it is');
  arms.guns.shotgun = { mag: 0, reserve: 0 };
  assert.equal(nextGun(arms), null);
  assert.equal(allDry(arms), false, 'the sidearm still has rounds');
  arms.guns.pistol = { mag: 0, reserve: 0 };
  assert.equal(allDry(arms), true);
  assert.equal(nextGun(arms), null, 'and then there is the knife');
});

test('running dry never goes round in circles: from any gun, taking the next until there is none ends within two steps', () => {
  for (const start of GUN_ORDER)
    for (const dry of [[], ['carbine'], ['pistol'], ['shotgun'], ['carbine', 'pistol'], GUN_ORDER]) {
      const arms = createArms();
      arms.current = start;
      for (const key of dry) arms.guns[key] = { mag: 0, reserve: 0 };
      let steps = 0;
      // what the game does when the trigger is pulled on a gun with no round anywhere
      while (isDry(arms.guns[arms.current]) && nextGun(arms) && steps < 10) {
        arms.current = nextGun(arms);
        steps++;
      }
      assert.ok(steps <= 2, `${start}, with ${dry.join(' + ') || 'nothing'} dry: ${steps} steps`);
      assert.equal(isDry(arms.guns[arms.current]), dry.length === 3, 'it ends on a gun that fires, if there is one');
    }
});

test('a cache gives a little of everything, once: thirty rounds, twelve, six shells and a grenade — if there is room for it', () => {
  const arms = createArms();
  const got = takeCache(arms);
  assert.deepEqual(got, { carbine: 30, pistol: 12, shotgun: 6, grenades: 1 });
  assert.deepEqual(
    GUN_ORDER.map((key) => [arms.guns[key].mag, arms.guns[key].reserve]),
    [
      [30, 120],
      [12, 48],
      [6, 24],
    ],
  );
  assert.equal(arms.grenades, 3);
  assert.equal(takeCache(arms).grenades, 1);
  // four is all you can carry: the third cache has rounds for you and no grenade — and says so (it returns 0)
  assert.equal(takeCache(arms).grenades, 0);
  assert.equal(arms.grenades, 4);
  assert.equal(ARMS.grenades.carry, 4);
  // everything there is on the site, with all three caches: more variety than the 330 carbine rounds there were,
  // and not more killing
  const all = createArms();
  for (let n = 0; n < 3; n++) takeCache(all);
  assert.deepEqual(
    GUN_ORDER.map((key) => totalRounds(all.guns[key])),
    [210, 84, 42],
  );
});

test('more rounds, for whoever asks: so many times the reserve at the start and so many times a cache — and no more grenades', () => {
  // (18 November 2026: the wild build's machines are plated — a round counts half — and it asks for twice the
  // rounds: src/wild/armour.js. Asked for nothing, as the classic game asks, everything is as the table says.)
  const twice = createArms(2);
  assert.deepEqual(
    GUN_ORDER.map((key) => [twice.guns[key].mag, twice.guns[key].reserve]),
    [
      [30, 180],
      [12, 72],
      [6, 36],
    ],
  );
  assert.equal(twice.grenades, ARMS.grenades.start);
  assert.deepEqual(takeCache(twice, 2), { carbine: 60, pistol: 24, shotgun: 12, grenades: 1 });
  assert.deepEqual(
    GUN_ORDER.map((key) => totalRounds(twice.guns[key])),
    [270, 108, 54],
  );
  // and what a cache says it gave is what it gave
  const plain = createArms();
  assert.deepEqual(takeCache(plain), { carbine: 30, pistol: 12, shotgun: 6, grenades: 1 });
  assert.deepEqual(takeCache(plain, 1), { carbine: 30, pistol: 12, shotgun: 6, grenades: 1 });
});

test('the shotgun is filled one shell at a time, and a full tube takes no more', () => {
  const a = { mag: 2, reserve: 3 };
  const size = GUNS.shotgun.mag;
  assert.equal(canReload(a, size), true);
  assert.equal(loadShell(a, size), true);
  assert.deepEqual([a.mag, a.reserve], [3, 2]);
  assert.equal(loadShell(a, size), true);
  assert.equal(loadShell(a, size), true);
  assert.deepEqual([a.mag, a.reserve], [5, 0]);
  assert.equal(loadShell(a, size), false, 'nothing left to put in');
  const full = { mag: 6, reserve: 9 };
  assert.equal(canReload(full, size), false);
  assert.equal(loadShell(full, size), false);
  assert.deepEqual([full.mag, full.reserve], [6, 9]);
  // and a magazine is filled to its own size, not the carbine's
  const p = { mag: 1, reserve: 40 };
  assert.equal(reloadMag(p, GUNS.pistol.mag), 11);
  assert.deepEqual([p.mag, p.reserve], [12, 29]);
});

test('the EMP grenade: it stops machines for a few seconds within a few metres, and does them no harm', () => {
  const g = ARMS.grenades;
  assert.deepEqual([g.start, g.carry, g.cache], [2, 4, 1]);
  assert.ok(g.radius >= 6 && g.radius <= 8, `${g.radius} m`);
  assert.ok(g.stun >= 3 && g.stun <= 5, `${g.stun} s`);
  assert.ok(g.fuse >= 1.2 && g.fuse <= 2, `${g.fuse} s`);
  assert.equal(g.damage, 0);
  // heard, but less far than it reaches: what it stuns cannot come and look, what it wakes was out of its reach
  assert.ok(g.noise > g.radius && g.noise <= GUNS.carbine.noise);
});

// ---------- the knife ----------

test('the knife: one strike a swing, a moment after it starts, and no second swing until the first is over', () => {
  const k = createKnife();
  assert.equal(k.busy, false);
  assert.equal(k.start(), true);
  assert.equal(k.busy, true);
  assert.equal(k.start(), false, 'already swinging');
  const dt = 1 / 120;
  let strikes = 0;
  let struckAt = -1;
  let time = 0;
  while (k.busy && time < 2) {
    if (k.step(dt)) {
      strikes++;
      struckAt = time + dt;
    }
    time += dt;
  }
  assert.equal(strikes, 1);
  assert.ok(Math.abs(struckAt - ARMS.knife.strikeAt) < 0.02, `struck at ${struckAt.toFixed(3)} s`);
  assert.ok(Math.abs(time - ARMS.knife.swing) < 0.02, `the swing took ${time.toFixed(3)} s`);
  assert.equal(k.step(dt), false, 'nothing happens while it is at rest');
  assert.equal(k.start(), true, 'and then it can swing again');
});

test('the knife: a long frame cannot skip the strike, and stopping it puts it away at once', () => {
  const k = createKnife();
  k.start();
  assert.equal(k.step(0.4), true, 'one long frame still lands the blow');
  assert.equal(k.step(0.4), false);
  assert.equal(k.busy, false);
  k.start();
  k.stop();
  assert.equal(k.busy, false);
  assert.equal(k.step(0.2), false, 'a swing that was stopped never strikes');
});

test('the knife: how far the swing has got, 0 at rest and 0 → 1 across it', () => {
  const k = createKnife();
  assert.equal(k.progress, 0);
  k.start();
  k.step(ARMS.knife.swing / 2);
  assert.ok(Math.abs(k.progress - 0.5) < 0.01);
});

test('what the knife does: two blows for a sentry, one for a drone, and it reaches about two metres', () => {
  // the toughest machines are Ghost's: a sentry of 110, a drone of 60.5 (src/enemies/index.js, src/difficulty.js)
  assert.equal(ARMS.knife.damage, 65);
  assert.ok(ARMS.knife.damage * 2 >= 110, 'two body blows finish a sentry on any setting');
  assert.ok(ARMS.knife.damage >= 55 * 1.1, 'one finishes a drone');
  assert.ok(ARMS.knife.reach >= 1.8 && ARMS.knife.reach <= 2.2);
  assert.ok(ARMS.knife.strikeAt < ARMS.knife.swing);
});

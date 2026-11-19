// Contract lock: how hard each setting is — above all, how many machines guard the site.
//
// Decision of 12 November 2026 (the owner, after playing it: "the game is too difficult, adjust the amount of
// enemies"): the garrison went from 26 machines on every setting to 9 on Recruit, 13 on Operator and 20 on Ghost;
// one fewer machine may fire at a time, and one fewer drone comes after you once the beacon is up.
//
// Second decision, later the same day (the owner, after playing that: "the game is slighly too easy make it a bit
// harder"): a little back the other way, and no more than a little. One more machine on Recruit (10) and two more
// on Operator (15), all of them inside the facility, where the charges now are; on Operator and Ghost the machines
// make up their minds a tenth faster and hit a tenth harder; Operator's clock is 60 seconds, not 65; and blowing
// the cascades sends drones up from the bay on Operator (2) and Ghost (3). Recruit's machines are as they were.
//
// These numbers are those decisions. Change them only with another one, and write it down here and in
// docs/DESIGN.md §5.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIFFICULTY, difficultyOf } from '../../src/difficulty.js';
import { buildSite, garrison, ZONE } from '../../src/world/map.js';

const site = buildSite();
const roster = (name) => garrison(site, DIFFICULTY[name].tier);
const names = (name) => roster(name).map((g) => g.name);
const LEVELS = ['recruit', 'operator', 'ghost'];

test('how many machines guard the site: 10 on Recruit, 15 on Operator, 20 on Ghost', () => {
  assert.deepEqual(
    LEVELS.map((name) => roster(name).length),
    [10, 15, 20],
  );
  assert.equal(site.guards.length, 20, 'Ghost fields every machine there is');
  assert.deepEqual(
    LEVELS.map((name) => roster(name).filter((g) => g.type === 'drone').length),
    [1, 2, 4],
    'drones',
  );
});

test('every machine has a name of its own and a setting it first appears on', () => {
  const all = site.guards.map((g) => g.name);
  assert.equal(new Set(all).size, all.length, `a name is used twice: ${all.join(', ')}`);
  for (const g of site.guards) {
    assert.match(g.name, /^[a-z][A-Za-z]+$/, `not a name: ${g.name}`);
    assert.ok([1, 2, 3].includes(g.tier), `${g.name}: tier ${g.tier}`);
  }
});

test('a harder setting keeps every machine of the easier one, in the same order, and adds to it', () => {
  const [recruit, operator, ghost] = LEVELS.map(names);
  assert.deepEqual(
    operator.filter((n) => recruit.includes(n)),
    recruit,
  );
  assert.deepEqual(
    ghost.filter((n) => operator.includes(n)),
    operator,
  );
  assert.deepEqual(
    recruit,
    ['gate', 'road', 'yardEast', 'corridor', 'hallLoop', 'control', 'feed', 'switchgear', 'dock', 'droneYard'],
    'Recruit',
  );
  assert.deepEqual(
    operator.filter((n) => !recruit.includes(n)).sort(),
    ['droneHall', 'eastCorridor', 'hallAisle', 'lobby', 'stackYard'],
    'what Operator adds',
  );
});

test('what was added to make it a bit harder is inside the facility: the way to it across the cavern is as it was', () => {
  const g = site.grid;
  const zoneOf = (x, z) => g.zone[g.index(Math.floor(x), Math.floor(z))];
  const outside = new Set([ZONE.YARD, ZONE.OUTSIDE, ZONE.STACK, ZONE.ADIT, ZONE.TUNNEL, ZONE.BAY]);
  for (const name of ['dock', 'lobby', 'eastCorridor']) {
    const unit = site.guards.find((u) => u.name === name);
    assert.ok(
      unit.route.every(([x, z]) => !outside.has(zoneOf(x, z))),
      `${name} leaves the building`,
    );
  }
  // and out in the cavern each setting has exactly the machines it had
  const inCavern = (name) =>
    roster(name)
      .filter((u) => u.route.some(([x, z]) => outside.has(zoneOf(x, z))))
      .map((u) => u.name);
  assert.deepEqual(inCavern('recruit'), ['gate', 'road', 'yardEast', 'droneYard']);
  assert.deepEqual(inCavern('operator'), ['gate', 'road', 'yardEast', 'stackYard', 'droneYard']);
});

test('on every setting each room that takes a charge has a machine of its own', () => {
  const g = site.grid;
  const zoneOf = (x, z) => g.zone[g.index(Math.floor(x), Math.floor(z))];
  for (const name of LEVELS)
    for (const charge of site.charges) {
      const zone = zoneOf(charge.stand[0], charge.stand[1]);
      const guarded = roster(name).some((u) => u.route.some(([x, z]) => zoneOf(x, z) === zone));
      assert.ok(guarded, `${name}: nothing guards the ${charge.name}`);
    }
});

test('below Ghost the way in is quiet: nothing walks or flies within 20 m of the cut in the wire', () => {
  const cut = [14.5, 67];
  const toSegment = ([px, pz], [ax, az], [bx, bz]) => {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  };
  const nearest = (unit) => {
    const posts = unit.route.map(([x, z]) => [x + 0.5, z + 0.5]);
    if (posts.length === 1) return Math.hypot(cut[0] - posts[0][0], cut[1] - posts[0][1]);
    let best = Infinity;
    const legs = unit.loop === false ? posts.length - 1 : posts.length;
    for (let k = 0; k < legs; k++) best = Math.min(best, toSegment(cut, posts[k], posts[(k + 1) % posts.length]));
    return best;
  };
  for (const unit of roster('operator'))
    assert.ok(nearest(unit) >= 20, `${unit.name} comes within ${nearest(unit).toFixed(0)} m of the way in`);
  assert.ok(
    roster('ghost').some((unit) => nearest(unit) < 12),
    'on Ghost something does walk past it',
  );
});

test('fewer may fire at once, and fewer come after you, on the easier settings', () => {
  assert.deepEqual(
    LEVELS.map((name) => DIFFICULTY[name].shooters),
    [1, 2, 3],
  );
  assert.deepEqual(
    LEVELS.map((name) => DIFFICULTY[name].pursuers),
    [2, 3, 4],
  );
  // blowing the cascades is answered from the drone bay — except on Recruit, where it is only heard
  assert.deepEqual(
    LEVELS.map((name) => DIFFICULTY[name].responders),
    [0, 2, 3],
  );
  const most = Math.max(DIFFICULTY.ghost.pursuers, DIFFICULTY.ghost.responders);
  assert.ok(site.reinforcements.length >= most, 'somewhere for each of them to come from');
  const g = site.grid;
  for (const [x, z] of site.reinforcements)
    assert.equal(g.zone[g.index(x, z)], ZONE.BAY, `(${x}, ${z}) is not in the drone bay`);
});

test('the clock, the radar and the machines themselves are kinder on the easier settings', () => {
  assert.deepEqual(
    LEVELS.map((name) => DIFFICULTY[name].exfilSeconds),
    [80, 60, 50],
  );
  assert.deepEqual(
    LEVELS.map((name) => DIFFICULTY[name].radar),
    [true, true, false],
    'Overwatch marks every machine near you on the small map, except on Ghost',
  );
  for (const key of ['gain', 'damage', 'health', 'aim']) {
    const [a, b, c] = LEVELS.map((name) => DIFFICULTY[name][key]);
    assert.ok(a < b && b < c, `${key} should rise with the setting: ${a}, ${b}, ${c}`);
  }
  // "a bit harder": a tenth quicker to see you and a tenth harder hitting than the measure was, on Operator; the
  // same step on Ghost; nothing on Recruit. How much a machine can take, and how well it shoots, are as they were.
  const row = (name) => ['gain', 'damage', 'health', 'aim'].map((key) => DIFFICULTY[name][key]);
  assert.deepEqual(row('recruit'), [0.65, 0.6, 0.85, 0.8]);
  assert.deepEqual(row('operator'), [1.1, 1.1, 1, 1]);
  assert.deepEqual(row('ghost'), [1.55, 1.6, 1.1, 1.15]);
});

test('a setting nobody has heard of plays as Operator', () => {
  assert.equal(difficultyOf('nonsense'), DIFFICULTY.operator);
  assert.equal(difficultyOf(undefined), DIFFICULTY.operator);
  assert.equal(difficultyOf('ghost'), DIFFICULTY.ghost);
});

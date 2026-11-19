// Threads of light (src/wild/tripwires.js): the rules of TRIPWIRES, with no browser in them.
// The wild branch's experiment — docs/WILD.md, "Threads of light".
//
// This file alone may import the site: a placement is only honest if it is checked against the real grid, not
// against what somebody typed. `src/wild/tripwires.js` itself never imports `world/map.js` or `world/grid.js` —
// it only holds the numbers this file has proved, so it can run with nothing but `node --test` behind it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSite, W, H, ZONE_NAMES } from '../../src/world/map.js';
import { KIND } from '../../src/world/grid.js';
import {
  LOW,
  HIGH,
  REARM_SECONDS,
  EMP_REACH,
  EMITTER_RADIUS,
  TELEPORT_GUARD,
  BEAM_DEFS,
  crosses,
  isCleared,
  rayEmitter,
  createTripwires,
} from '../../src/wild/tripwires.js';

const site = buildSite();
const g = site.grid;

// ---------------------------------------------------------------------------------------------------------------
// The crossing math: the two positions are on opposite sides of the beam's line, and meet it within its length.
// ---------------------------------------------------------------------------------------------------------------

const BEAM = { x0: 0, z0: -1, x1: 0, z1: 1 }; // a beam along x = 0, from z = −1 to z = 1

test('walking straight across a beam crosses it', () => {
  assert.equal(crosses(BEAM, -1, 0, 1, 0), true);
  // either direction
  assert.equal(crosses(BEAM, 1, 0, -1, 0), true);
});

test('a step that stays on one side of the beam does not cross it', () => {
  assert.equal(crosses(BEAM, -1, 0, -0.1, 0.5), false);
  assert.equal(crosses(BEAM, 1, -0.5, 0.2, 0.9), false);
});

test('grazing past an end of the beam — beyond its length — is not a crossing', () => {
  // the line x = 0 is met, but at z = −2: past the beam's own end at z = −1
  assert.equal(crosses(BEAM, -1, -2, 1, -2), false);
  assert.equal(crosses(BEAM, -1, 2, 1, 2), false);
});

test('standing still on the beam does not trip it — there are not two different sides', () => {
  assert.equal(crosses(BEAM, 0, 0, 0, 0), false);
  assert.equal(crosses(BEAM, 3, 3, 3, 3), false);
});

test('a step along the beam\u2019s own line, not across it, is not a crossing', () => {
  assert.equal(crosses(BEAM, 0, -5, 0, 5), false);
});

test('a step that only reaches the beam\u2019s line (does not pass through it) does not cross it', () => {
  // both ends of the step are on the same side (x < 0): it touches x = 0 but does not go beyond
  assert.equal(crosses(BEAM, -1, 0, 0, 0), false);
});

// ---------------------------------------------------------------------------------------------------------------
// Clearing: low by height, high by crouching. A pair needs both at once, which the player's own body never gives.
// ---------------------------------------------------------------------------------------------------------------

test('a low beam is cleared by feet at or above its height — jumped over it', () => {
  const low = { kind: 'low', y: LOW };
  assert.equal(isCleared(low, { y: 0, crouched: false }), false);
  assert.equal(isCleared(low, { y: LOW - 0.01, crouched: false }), false);
  assert.equal(isCleared(low, { y: LOW, crouched: false }), true);
  assert.equal(isCleared(low, { y: 1.0, crouched: false }), true);
  // crouching alone does not lift the feet
  assert.equal(isCleared(low, { y: 0, crouched: true }), false);
});

test('a high beam is cleared only by crouching, height does not matter to it', () => {
  const high = { kind: 'high', y: HIGH };
  assert.equal(isCleared(high, { y: 0, crouched: false }), false);
  assert.equal(isCleared(high, { y: 0, crouched: true }), true);
  // jumping (not crouched) does not clear it, however high the feet are
  assert.equal(isCleared(high, { y: 1.0, crouched: false }), false);
});

test('a pair cannot be cleared by any posture the player\u2019s own body can take', () => {
  const low = BEAM_DEFS.find((b) => b.id === 'lobby-low');
  const high = BEAM_DEFS.find((b) => b.id === 'lobby-high');
  // standing: the high one is not cleared
  assert.equal(isCleared(high, { y: 0, crouched: false }), false);
  // crouching, feet on the ground: the low one is not cleared
  assert.equal(isCleared(low, { y: 0, crouched: true }), false);
  // jumping: src/player.js stands the player up the instant a jump begins (p.crouched = false on p.vy =
  // PLAYER.jump), so a jump is never crouched — the high one is still not cleared
  assert.equal(isCleared(high, { y: 1.0, crouched: false }), false);
  // there is no fourth posture: a crouched jump does not exist in this game, which is what makes the pair absolute
});

// ---------------------------------------------------------------------------------------------------------------
// The ray against the emitter: a sphere of EMITTER_RADIUS at the emitter's point.
// ---------------------------------------------------------------------------------------------------------------

const EBEAM = { emitter: { x: 10, y: 1, z: 0 } };

test('a ray aimed straight at the emitter, within range, hits', () => {
  const t = rayEmitter(EBEAM, 0, 1, 0, 1, 0, 0, 20);
  assert.ok(t !== null);
  assert.ok(Math.abs(t - (10 - EMITTER_RADIUS)) < 1e-6, `t was ${t}`);
});

test('a ray that passes well wide of the emitter misses', () => {
  assert.equal(rayEmitter(EBEAM, 0, 1, 5, 1, 0, 0, 20), null);
});

test('a ray aimed away from the emitter — it is behind the origin — does not hit', () => {
  assert.equal(rayEmitter(EBEAM, 0, 1, 0, -1, 0, 0, 20), null);
});

test('a ray aimed true but shorter than the distance to the emitter does not reach it', () => {
  assert.equal(rayEmitter(EBEAM, 0, 1, 0, 1, 0, 0, 5), null);
  // just long enough, it does
  assert.ok(rayEmitter(EBEAM, 0, 1, 0, 1, 0, 0, 10) !== null);
});

// ---------------------------------------------------------------------------------------------------------------
// WHERE: every one of the seven placements, proved against the real site — not against what anybody typed.
// ---------------------------------------------------------------------------------------------------------------

const SOLID = new Set([KIND.WALL, KIND.ROCK, KIND.FENCE]);

test('every beam has both ends on a solid cell — wall, rock or fence — and nothing else', () => {
  for (const b of BEAM_DEFS) {
    for (const [x, z] of [
      [b.x0, b.z0],
      [b.x1, b.z1],
    ]) {
      const kind = g.kind[g.index(Math.floor(x), Math.floor(z))];
      assert.ok(SOLID.has(kind), `${b.id}'s end at (${x}, ${z}) is kind ${kind}, not solid`);
    }
  }
});

test('every cell a beam\u2019s thread crosses is walkable floor — the player can stand under or jump over it', () => {
  for (const b of BEAM_DEFS) {
    const steps = Math.max(Math.abs(b.x1 - b.x0), Math.abs(b.z1 - b.z0)) * 4;
    for (let n = 1; n < steps; n++) {
      const x = b.x0 + ((b.x1 - b.x0) * n) / steps;
      const z = b.z0 + ((b.z1 - b.z0) * n) / steps;
      // the very ends are the solid cells just proved above; only the interior must be floor
      if (Math.floor(x) === Math.floor(b.x0) && Math.floor(z) === Math.floor(b.z0)) continue;
      if (Math.floor(x) === Math.floor(b.x1) && Math.floor(z) === Math.floor(b.z1)) continue;
      assert.ok(g.walkable(Math.floor(x), Math.floor(z)), `${b.id} crosses (${x}, ${z}), which is not walkable`);
    }
  }
});

test('no beam is within 12 m of where the player starts', () => {
  for (const b of BEAM_DEFS) {
    const mx = (b.x0 + b.x1) / 2;
    const mz = (b.z0 + b.z1) / 2;
    const d = Math.hypot(mx - site.start.x, mz - site.start.z);
    assert.ok(d >= 12, `${b.id} is only ${d.toFixed(1)} m from the start`);
  }
});

test('every beam\u2019s place names the zone the real site has there', () => {
  for (const b of BEAM_DEFS) {
    const mx = Math.floor((b.x0 + b.x1) / 2);
    const mz = Math.floor((b.z0 + b.z1) / 2);
    const zone = ZONE_NAMES[g.zone[g.index(mx, mz)]];
    assert.equal(b.place, zone, `${b.id} says "${b.place}" but the site there is "${zone}"`);
  }
});

test('there are seven placements: eight beams, one place holding a pair', () => {
  assert.equal(BEAM_DEFS.length, 8);
  const lines = new Map();
  for (const b of BEAM_DEFS) {
    const key = `${b.x0},${b.z0},${b.x1},${b.z1}`;
    lines.set(key, (lines.get(key) || 0) + 1);
  }
  assert.equal(lines.size, 7);
  assert.equal([...lines.values()].filter((n) => n === 2).length, 1, 'exactly one line is shared by a pair');
});

test('a pair\u2019s two beams are a low one and a high one on the very same line, each its own emitter', () => {
  const byLine = new Map();
  for (const b of BEAM_DEFS) {
    const key = `${b.x0},${b.z0},${b.x1},${b.z1}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(b);
  }
  const pair = [...byLine.values()].find((list) => list.length === 2);
  assert.deepEqual(pair.map((b) => b.kind).sort(), ['high', 'low']);
  assert.notDeepEqual(pair[0].emitter, pair[1].emitter);
});

// With every pair treated as a wall (the only way the site could be cut in two), the site must still be whole:
// the start can still reach the firing point, the beacon, the pickup, and every charge.
test('no pair of beams would cut the facility in two — a route survives from the start to everything the mission needs', () => {
  const blocked = new Set();
  for (const b of BEAM_DEFS) {
    // only a pair can block a route at all (a single beam is jumped or crouched under); find the cells a pair's
    // line crosses and mark them as if they were a wall
    const twin = BEAM_DEFS.find((o) => o !== b && o.x0 === b.x0 && o.z0 === b.z0 && o.x1 === b.x1 && o.z1 === b.z1);
    if (!twin) continue;
    const steps = Math.max(Math.abs(b.x1 - b.x0), Math.abs(b.z1 - b.z0)) * 4;
    for (let n = 1; n < steps; n++) {
      const x = Math.floor(b.x0 + ((b.x1 - b.x0) * n) / steps);
      const z = Math.floor(b.z0 + ((b.z1 - b.z0) * n) / steps);
      blocked.add(g.index(x, z));
    }
  }
  const seen = new Uint8Array(W * H);
  const sx = Math.floor(site.start.x);
  const sz = Math.floor(site.start.z);
  const queue = [sx, sz];
  seen[g.index(sx, sz)] = 1;
  while (queue.length) {
    const z = queue.pop();
    const x = queue.pop();
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      const i = g.index(nx, nz);
      if (blocked.has(i)) continue;
      if (!g.walkable(nx, nz)) continue;
      if (seen[i]) continue;
      seen[i] = 1;
      queue.push(nx, nz);
    }
  }
  const can = (x, z) => seen[g.index(Math.floor(x), Math.floor(z))] === 1;
  assert.ok(can(site.firing.x, site.firing.z), 'the firing point is cut off');
  assert.ok(can(site.beacon.x, site.beacon.z), 'the beacon is cut off');
  assert.ok(can(site.pickup.x, site.pickup.z), 'the pickup is cut off');
  for (const charge of site.charges) assert.ok(can(charge.stand[0], charge.stand[1]), `${charge.id} is cut off`);
});

// ---------------------------------------------------------------------------------------------------------------
// The loop: live, re-arming, put out by an EMP, or dead. Nothing else, and reset() leaves nothing pending.
// ---------------------------------------------------------------------------------------------------------------

const PLAYING = { crouched: false, hidden: false, alive: true, playing: true };

/**
 * A straight walk through a beam's own middle, perpendicular to its thread — whichever way the thread itself
 * runs. Returns { prevX, prevZ, x, z }: a step from one side to the other, `offset` metres each way.
 */
function crossingPath(beam, offset = 1.5) {
  const mx = (beam.x0 + beam.x1) / 2;
  const mz = (beam.z0 + beam.z1) / 2;
  const len = Math.hypot(beam.x1 - beam.x0, beam.z1 - beam.z0);
  const px = -(beam.z1 - beam.z0) / len; // the thread's direction, rotated a quarter turn
  const pz = (beam.x1 - beam.x0) / len;
  return { prevX: mx - px * offset, prevZ: mz - pz * offset, x: mx + px * offset, z: mz + pz * offset };
}

test('fresh, every beam is live and nothing is pending', () => {
  const tw = createTripwires();
  tw.reset(0, 0);
  for (const b of tw.beams) assert.deepEqual([b.live, b.dead, b.empT, b.rearmT], [true, false, 0, 0]);
});

test('crossing a live beam trips it, and it does not trip again for six seconds', () => {
  const tw = createTripwires();
  const b0 = tw.beams.find((b) => b.id === 'corridor-57'); // low
  const path = crossingPath(b0);
  tw.reset(path.prevX, path.prevZ);
  const said = tw.step(1 / 60, { ...PLAYING, x: path.x, z: path.z, y: 0 }); // straight across, on foot
  assert.equal(said.length, 1);
  assert.equal(said[0].beam.id, 'corridor-57');
  assert.equal(
    tw.beams.find((b) => b.id === 'corridor-57').live,
    true,
    'a live beam that trips stays live — it is re-arming, not dead',
  );

  // standing where it crossed and stepping time forward without crossing again: no second trip while it re-arms
  let total = 0;
  while (total < REARM_SECONDS - 0.2) {
    const dt = 1 / 60;
    const again = tw.step(dt, { ...PLAYING, x: path.x, z: path.z, y: 0 });
    assert.deepEqual(again, []);
    total += dt;
  }
  assert.ok(tw.beams.find((b) => b.id === 'corridor-57').rearmT > 0);

  // cross back over it once the clock has run out, and it trips again
  while (tw.beams.find((b) => b.id === 'corridor-57').rearmT > 0)
    tw.step(1 / 60, { ...PLAYING, x: path.x, z: path.z, y: 0 });
  const second = tw.step(1 / 60, { ...PLAYING, x: path.prevX, z: path.prevZ, y: 0 });
  assert.equal(second.length, 1);
  assert.equal(second[0].beam.id, 'corridor-57');
});

test('jumping a low beam clears it: no trip for the whole crossing', () => {
  const tw = createTripwires();
  const b0 = tw.beams.find((b) => b.id === 'corridor-57');
  const path = crossingPath(b0);
  tw.reset(path.prevX, path.prevZ);
  const said = tw.step(1 / 60, { ...PLAYING, x: path.x, z: path.z, y: LOW + 0.1 });
  assert.deepEqual(said, []);
});

test('crouching under a high beam clears it; standing does not', () => {
  const tw = createTripwires();
  const b0 = tw.beams.find((b) => b.id === 'corridor-73'); // high
  const path = crossingPath(b0);
  tw.reset(path.prevX, path.prevZ);
  const crouchedOk = tw.step(1 / 60, { ...PLAYING, x: path.x, z: path.z, y: 0, crouched: true });
  assert.deepEqual(crouchedOk, []);

  const tw2 = createTripwires();
  tw2.reset(path.prevX, path.prevZ);
  const standingTrips = tw2.step(1 / 60, { ...PLAYING, x: path.x, z: path.z, y: 0, crouched: false });
  assert.equal(standingTrips.length, 1);
});

test('nothing trips while the player is hidden, dead, or the mission is not playing', () => {
  const b0 = BEAM_DEFS.find((b) => b.id === 'corridor-57');
  const path = crossingPath(b0);
  for (const over of [{ hidden: true }, { alive: false }, { playing: false }]) {
    const tw = createTripwires();
    tw.reset(path.prevX, path.prevZ);
    const said = tw.step(1 / 60, { ...PLAYING, ...over, x: path.x, z: path.z, y: 0 });
    assert.deepEqual(said, [], `with ${JSON.stringify(over)} a beam still tripped`);
  }
});

test('an instantaneous jump across a beam\u2019s line (a teleport, not a walk) does not trip it', () => {
  const b0 = BEAM_DEFS.find((b) => b.id === 'corridor-57');
  const far = crossingPath(b0, 50); // fifty metres each way: a jump, not a walk
  const near = crossingPath(b0, 1); // one metre each way: an ordinary close-up step

  const tw = createTripwires();
  tw.reset(far.prevX, far.prevZ); // starts a long way off, on one side
  assert.ok(
    Math.hypot(far.x - far.prevX, far.z - far.prevZ) > TELEPORT_GUARD,
    'the test itself must jump further than the guard allows',
  );
  // one huge jump straight across to the far side of the line: not read as a crossing
  assert.deepEqual(tw.step(1 / 60, { ...PLAYING, x: far.x, z: far.z, y: 0 }), []);
  // closing in, still on that same side: nothing to trip here either
  assert.deepEqual(tw.step(1 / 60, { ...PLAYING, x: near.x, z: near.z, y: 0 }), []);
  // the guard does not leave a stale position behind: a small, real step the rest of the way across
  // (well under the guard\u2019s distance) still trips normally
  const said = tw.step(1 / 60, { ...PLAYING, x: near.prevX, z: near.prevZ, y: 0 });
  assert.equal(said.length, 1, 'a genuine small crossing right after the jump must still be seen');
});

test('an EMP puts out every beam within 9 m of it, and they come back by themselves', () => {
  const tw = createTripwires();
  tw.reset(0, 0);
  const lowId = 'lobby-low';
  const highId = 'lobby-high';
  const lobby = tw.beams.find((b) => b.id === lowId);
  const mx = (lobby.x0 + lobby.x1) / 2;
  const mz = (lobby.z0 + lobby.z1) / 2;
  tw.onEmp(mx, mz, 2);
  assert.equal(tw.beams.find((b) => b.id === lowId).live, false);
  assert.equal(tw.beams.find((b) => b.id === highId).live, false, 'both of a pair are within reach of the same point');
  // far beams (checked above: all at least 12 m from this point) are untouched
  for (const id of ['corridor-57', 'corridor-73', 'switchgear-pass', 'hall-corridor', 'hall-feed', 'north-passage'])
    assert.equal(tw.beams.find((b) => b.id === id).live, true, `${id} should be out of an EMP's 9 m reach`);

  let total = 0;
  while (total < 2 - 0.2) {
    tw.step(1 / 60, { ...PLAYING, x: -50, z: -50, y: 0 }); // nowhere near a beam: no crossing confuses the result
    total += 1 / 60;
  }
  assert.equal(tw.beams.find((b) => b.id === lowId).live, false, 'not back yet');
  while (tw.beams.find((b) => b.id === lowId).empT > 0) tw.step(1 / 60, { ...PLAYING, x: -50, z: -50, y: 0 });
  assert.equal(tw.beams.find((b) => b.id === lowId).live, true, 'back by itself once its time is up');
  assert.equal(tw.beams.find((b) => b.id === highId).live, true);
});

test('EMP reach is 9 m, checked from the beam\u2019s own middle', () => {
  const tw = createTripwires();
  tw.reset(0, 0);
  const b = tw.beams.find((b2) => b2.id === 'north-passage');
  const mx = (b.x0 + b.x1) / 2;
  const mz = (b.z0 + b.z1) / 2;
  tw.onEmp(mx + EMP_REACH + 0.5, mz, 5);
  assert.equal(tw.beams.find((b2) => b2.id === 'north-passage').live, true, 'just outside 9 m: untouched');
  tw.onEmp(mx + EMP_REACH - 0.5, mz, 5);
  assert.equal(tw.beams.find((b2) => b2.id === 'north-passage').live, false, 'just inside 9 m: put out');
});

test('a round into the emitter puts the beam out for good, and a dead beam cannot be shot again', () => {
  const tw = createTripwires();
  tw.reset(0, 0);
  const b = tw.beams.find((b2) => b2.id === 'hall-feed');
  const e = b.emitter;
  const met = tw.shot(e.x, e.y, e.z - 5, 0, 0, 1, 20);
  assert.ok(met, 'the ray should have met the emitter');
  assert.equal(met.beam.id, 'hall-feed');
  tw.markDead(met.beam);
  assert.equal(tw.beams.find((b2) => b2.id === 'hall-feed').live, false);
  assert.equal(tw.beams.find((b2) => b2.id === 'hall-feed').dead, true);
  // shot again: nothing left to hit
  assert.equal(tw.shot(e.x, e.y, e.z - 5, 0, 0, 1, 20), null);
  // a dead beam cannot be crossed into a trip either
  const path = crossingPath(b);
  tw.reset(path.prevX, path.prevZ);
  tw.markDead(tw.beams.find((b2) => b2.id === 'hall-feed'));
  const said = tw.step(1 / 60, { ...PLAYING, x: path.x, z: path.z, y: 0 });
  assert.deepEqual(said, []);
});

test('save() keeps only which emitters are dead, and load() puts that back — a checkpoint retry keeps them out', () => {
  const tw = createTripwires();
  tw.reset(0, 0);
  tw.markDead(tw.beams.find((b) => b.id === 'corridor-73'));
  tw.markDead(tw.beams.find((b) => b.id === 'lobby-high'));
  const kept = tw.save();
  assert.deepEqual([...kept.dead].sort(), ['corridor-73', 'lobby-high']);

  // the game resets the experiment to nothing, then loads the checkpoint on top — reset() alone would lose it
  const retry = createTripwires();
  retry.reset(0, 0);
  for (const b of retry.beams) assert.equal(b.dead, false);
  retry.load(kept);
  const dead = retry.beams.filter((b) => b.dead).map((b) => b.id);
  assert.deepEqual(dead.sort(), ['corridor-73', 'lobby-high']);
  assert.equal(retry.beams.find((b) => b.id === 'corridor-57').dead, false);
});

test('reset() leaves every beam live and nothing pending, even after a trip, an EMP and a kill', () => {
  const tw = createTripwires();
  const b0 = tw.beams.find((b) => b.id === 'hall-corridor');
  const path = crossingPath(b0);
  tw.reset(path.prevX, path.prevZ);
  tw.step(1 / 60, { ...PLAYING, x: path.x, z: path.z, y: 0 }); // tripped: now re-arming
  tw.onEmp(b0.x0, b0.z0, 5); // and under an EMP for good measure
  tw.markDead(tw.beams.find((b) => b.id === 'corridor-57'));
  assert.ok(
    tw.beams.some((b) => b.dead) && tw.beams.some((b) => b.empT > 0 || b.rearmT > 0),
    'the test itself must leave something pending before reset() is asked to clear it',
  );

  tw.reset(0, 0);
  for (const b of tw.beams) assert.deepEqual([b.live, b.dead, b.empT, b.rearmT], [true, false, 0, 0]);
});

// ---------------------------------------------------------------------------------------------------------------
// The numbers hold together.
// ---------------------------------------------------------------------------------------------------------------

test('the numbers hold together', () => {
  assert.ok(LOW > 0 && LOW < HIGH);
  assert.ok(HIGH < 1.8, 'a high beam must still be under the player\u2019s standing height to mean anything');
  assert.equal(REARM_SECONDS, 6);
  assert.equal(EMP_REACH, 9);
  assert.ok(EMITTER_RADIUS > 0 && EMITTER_RADIUS < 0.3);
  // generous above a real per-frame walk (PLAYER.run is 6.6 m/s; even a bad frame of 0.1 s is 0.66 m), and well
  // below a real teleport (debug.teleport / page.stand jump the player clean across the map)
  assert.ok(TELEPORT_GUARD > 1 && TELEPORT_GUARD < 10);
});

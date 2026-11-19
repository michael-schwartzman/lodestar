// The squad's rules alone (src/wild/squad.js), by arithmetic — no engine, no browser, no randomness.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SQUAD,
  candidates,
  fallBack,
  givenBack,
  keepsClear,
  lingered,
  marksRound,
  orbits,
  plan,
  spread,
  stagger,
  standOff,
  wayRound,
} from '../../src/wild/squad.js';

const DEG = Math.PI / 180;
const open = () => true;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** the short way round the circle between two bearings (radians), 0 … PI — the test's own, so it does not
 *  lean on `spread()` to check what `spread()` itself is supposed to produce */
const circ = (a, b) => {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};
const pairs = (bearings) => {
  const out = [];
  for (let i = 0; i < bearings.length; i++)
    for (let j = i + 1; j < bearings.length; j++) out.push(circ(bearings[i], bearings[j]));
  return out;
};
const bearingOfPost = (center, p) => Math.atan2(p.x - center.x, p.z - center.z);

test('one machine: the squad gives out nothing (fence entry is two)', () => {
  const lastSeen = { x: 0, z: 0 };
  const units = [{ id: 1, x: 0, z: -10, dist: 10 }];
  const posts = plan({ lastSeen, units, walkable: open, sight: open, now: 0, previous: new Map() });
  assert.equal(posts.size, 0);
});

test('two machines side by side in the open: posts at least 100 degrees apart as the player sees them', () => {
  const lastSeen = { x: 0, z: 0 };
  const units = [
    { id: 1, x: -1, z: -10, dist: 10 },
    { id: 2, x: 1, z: -10, dist: 10 },
  ];
  const posts = plan({ lastSeen, units, walkable: open, sight: open, now: 0, previous: new Map() });
  assert.equal(posts.size, 2);
  const bearings = [...posts.values()].map((p) => bearingOfPost(lastSeen, p));
  assert.ok(circ(bearings[0], bearings[1]) >= 100 * DEG, `${circ(bearings[0], bearings[1]) / DEG} degrees apart`);
  // posts must also be real candidates: walkable and seen, which `open` makes trivially true here, and roled
  for (const p of posts.values()) assert.ok(p.role === 'anchor' || p.role === 'flank');
});

test('three machines: the widest neighbour gap is at most 200 degrees and no two are nearer than 60', () => {
  const lastSeen = { x: 0, z: 0 };
  const units = [
    { id: 1, x: 0, z: -10, dist: 10 },
    { id: 2, x: -2, z: -10, dist: 10.2 },
    { id: 3, x: 2, z: -10, dist: 10.2 },
  ];
  const posts = plan({ lastSeen, units, walkable: open, sight: open, now: 0, previous: new Map() });
  assert.equal(posts.size, 3);
  const bearings = [...posts.values()].map((p) => bearingOfPost(lastSeen, p));
  assert.ok(spread(bearings).widestGap <= 200 * DEG, `${spread(bearings).widestGap / DEG} degrees widest gap`);
  assert.ok(Math.min(...pairs(bearings)) >= 60 * DEG, `${Math.min(...pairs(bearings)) / DEG} degrees closest pair`);
});

test('posts are kept at least SQUAD.minPostGap apart', () => {
  const lastSeen = { x: 0, z: 0 };
  const units = [
    { id: 1, x: 0, z: -8, dist: 8 },
    { id: 2, x: 1, z: -8, dist: 8 },
    { id: 3, x: -1, z: -8, dist: 8 },
  ];
  const posts = plan({ lastSeen, units, walkable: open, sight: open, now: 0, previous: new Map() });
  const list = [...posts.values()];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) assert.ok(dist(list[i], list[j]) >= SQUAD.minPostGap - 1e-9);
});

test('a blocked candidate is never used', () => {
  const lastSeen = { x: 0, z: 0 };
  // a wedge of the ring from 0 to 120 degrees is unwalkable: no post should land in it
  const walkable = (x, z) => {
    const b = ((bearingOfPost(lastSeen, { x, z }) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return !(b >= 0 && b <= 120 * DEG);
  };
  const units = [
    { id: 1, x: 0, z: -10, dist: 10 },
    { id: 2, x: 7, z: -7, dist: 10 },
    { id: 3, x: 10, z: 0, dist: 10 },
  ];
  const posts = plan({ lastSeen, units, walkable, sight: open, now: 0, previous: new Map() });
  for (const p of posts.values()) {
    const b = ((bearingOfPost(lastSeen, p) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    assert.ok(!(b >= 0 && b <= 120 * DEG), `post at ${b / DEG} degrees, inside the blocked wedge`);
  }
});

test('hysteresis: the player seen 1 m away keeps the same posts', () => {
  const units = [
    { id: 1, x: 0, z: -10, dist: 10 },
    { id: 2, x: -2, z: -10, dist: 10.2 },
    { id: 3, x: 2, z: -10, dist: 10.2 },
  ];
  const first = plan({ lastSeen: { x: 0, z: 0 }, units, walkable: open, sight: open, now: 0, previous: new Map() });
  const second = plan({ lastSeen: { x: 1, z: 0 }, units, walkable: open, sight: open, now: 0.5, previous: first });
  for (const [id, post] of first)
    assert.deepEqual([second.get(id).x, second.get(id).z], [post.x, post.z], `unit ${id} kept its post`);
});

test('hysteresis: the player seen 12 m away allows new posts', () => {
  const units = [
    { id: 1, x: 0, z: -10, dist: 10 },
    { id: 2, x: -2, z: -10, dist: 10.2 },
    { id: 3, x: 2, z: -10, dist: 10.2 },
  ];
  const first = plan({ lastSeen: { x: 0, z: 0 }, units, walkable: open, sight: open, now: 0, previous: new Map() });
  const second = plan({ lastSeen: { x: 12, z: 0 }, units, walkable: open, sight: open, now: 0.5, previous: first });
  let changed = 0;
  for (const [id, post] of first) if (dist(post, second.get(id)) > 1e-6) changed++;
  assert.ok(changed > 0, 'at least one post moved once the fight itself moved 12 m');
});

test('a hurt machine falls back, and not again inside 15 s', () => {
  const unit = { id: 9, x: 0, z: 0, hp: 20, hpMax: 100 };
  const previous = new Map();
  const spot = fallBack({ unit, now: 10, previous, walkable: open, sight: () => false, path: open });
  assert.ok(spot, 'a hiding place was found');
  assert.ok(dist(unit, spot) <= SQUAD.fallBackRing + 1e-6);
  previous.set(unit.id, { at: 10 });
  assert.equal(fallBack({ unit, now: 11, previous, walkable: open, sight: () => false, path: open }), null, 'too soon');
  assert.ok(
    fallBack({
      unit,
      now: 10 + SQUAD.fallBackCooldown + 0.1,
      previous,
      walkable: open,
      sight: () => false,
      path: open,
    }),
  );
});

test('a machine above the fall-back line is left alone', () => {
  const unit = { id: 9, x: 0, z: 0, hp: 80, hpMax: 100 };
  assert.equal(fallBack({ unit, now: 0, previous: new Map(), walkable: open, sight: () => false, path: open }), null);
});

test('four drones bunched together end up at least 60 degrees apart', () => {
  const drones = [
    { id: 1, orbit: 0 },
    { id: 2, orbit: 5 * DEG },
    { id: 3, orbit: 10 * DEG },
    { id: 4, orbit: 15 * DEG },
  ];
  const out = orbits(drones);
  assert.equal(out.size, 4);
  const bearings = drones.map((d) => out.get(d.id).orbit);
  assert.ok(
    Math.min(...pairs(bearings)) >= 60 * DEG - 1e-9,
    `${Math.min(...pairs(bearings)) / DEG} degrees closest pair`,
  );
  // alternating direction: neighbours in the new order do not all spin the same way
  const dirs = [...out.values()].map((v) => v.orbitDir);
  assert.ok(dirs.includes(1) && dirs.includes(-1));
});

test('drones already spread apart are left alone', () => {
  const drones = [
    { id: 1, orbit: 0 },
    { id: 2, orbit: Math.PI },
  ];
  assert.equal(orbits(drones).size, 0);
});

test('staggered rest never shortens and never grows past its cap', () => {
  const entries = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const out = stagger(entries, 0.6);
  assert.equal(out.get(1), 0);
  for (const v of out.values()) assert.ok(v >= 0 && v <= 0.6 + 1e-9);
  // strictly non-decreasing in the order handed in
  const vals = entries.map((e) => out.get(e.id));
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] >= vals[i - 1]);
});

test('the same input gives the same output, every time (no randomness inside)', () => {
  const units = [
    { id: 1, x: 0, z: -10, dist: 10 },
    { id: 2, x: -2, z: -10, dist: 10.2 },
    { id: 3, x: 2, z: -10, dist: 10.2 },
  ];
  const run = () => plan({ lastSeen: { x: 0, z: 0 }, units, walkable: open, sight: open, now: 0, previous: new Map() });
  const a = run();
  const b = run();
  assert.deepEqual([...a.entries()], [...b.entries()]);
});

test('twelve machines engaged plan within the declared sight-test budget', () => {
  const units = [];
  for (let i = 0; i < 12; i++) units.push({ id: i, x: Math.cos(i) * 10, z: Math.sin(i) * 10, dist: 10 });
  let calls = 0;
  const sight = () => {
    calls++;
    return true;
  };
  // the steady-state turn (a post already kept for every unit) is the costlier one: a ring plus one check a unit
  const previous = plan({ lastSeen: { x: 0, z: 0 }, units, walkable: open, sight: open, now: 0, previous: new Map() });
  calls = 0;
  plan({ lastSeen: { x: 0.2, z: 0 }, units, walkable: open, sight, now: 0.5, previous });
  const budget = SQUAD.ringSteps * SQUAD.ringRadii.length + units.length;
  assert.ok(calls <= budget, `${calls} sight tests, budget ${budget}`);
});

test('candidates: the budget is a fixed ring, not one that grows with who is looking', () => {
  let calls = 0;
  const sight = (x, z) => {
    calls++;
    return true;
  };
  candidates({ x: 0, z: 0 }, open, sight);
  assert.equal(calls, SQUAD.ringSteps * SQUAD.ringRadii.length);
});

// ---------- going round him, never through (18 November 2026) ----------
// Found by the full suite the night the squad was merged: a machine whose post lay across him walked into the
// game's own "closer than 4.5 m: back off" line, was backed out by the game and sent in again by the squad, and
// stood shaking on that line, 4.5 m in front of him — three fights in sixteen. The squad now walks round him,
// and it alone steers a machine it has posted (src/wild/squad-live.js no longer hands one back by distance).
const him = { x: 3, z: -2 };
/** a point `r` metres from him at `deg` degrees (the file's own convention: 0 = +z, growing toward +x) */
const at = (r, deg) => ({ x: him.x + Math.sin(deg * DEG) * r, z: him.z + Math.cos(deg * DEG) * r });
/** how near to him the straight line between two points comes — the test's own arithmetic */
const nearest = (a, b) => {
  const fx = a.x - him.x;
  const fz = a.z - him.z;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, -(fx * dx + fz * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(fx + dx * t, fz + dz * t);
};

test('the keep-off line is well clear of the line the game backs a machine off at', () => {
  // a route ends at the middle of a cell, up to 0.71 m from the point asked for: the room has to cover that
  assert.ok(SQUAD.keepOff >= SQUAD.tooClose + 1, `${SQUAD.keepOff} against ${SQUAD.tooClose}`);
  assert.ok(SQUAD.roundAt > SQUAD.keepOff, 'the circle walked is outside the line kept');
  // a machine making for a mark one step ahead on that circle — the mark set anew at every stride — spirals in
  // to roundAt * cos(step) and no nearer: that, too, has to be outside the line
  assert.ok(SQUAD.roundAt * Math.cos(SQUAD.roundStep) >= SQUAD.keepOff, 'a step round cuts inside the line');
  // a straight line let through without a walk round (up to roundSlack inside the line) still clears the game's
  // line by more than a route's last cell can be off
  assert.ok(SQUAD.roundSlack > 0 && SQUAD.keepOff - SQUAD.roundSlack >= SQUAD.tooClose + 0.72);
  // …and the squad's posts are not nearer him than the circle it walks: a post is never inside its own detour
  assert.ok(SQUAD.ring[0] >= SQUAD.roundAt);
});

test('a line that keeps clear of him is walked straight', () => {
  const from = at(12, 0);
  const to = at(11, 80);
  assert.ok(nearest(from, to) >= SQUAD.keepOff, 'the case is not what it says');
  const w = wayRound(him, from, to);
  assert.equal(w.round, false);
  assert.ok(dist(w, to) < 1e-9);
  assert.equal(keepsClear(him, from, to), true);
});

test('a line through him is not walked: the mark is off to the side, the short way round, outside the line', () => {
  const from = at(12, 0);
  for (const deg of [135, 180 - 1, -135, -150]) {
    const to = at(9.67, deg);
    assert.ok(nearest(from, to) < SQUAD.tooClose, `${deg}: the straight line would not have tripped the game's rule`);
    assert.equal(keepsClear(him, from, to), false);
    const w = wayRound(him, from, to);
    assert.equal(w.round, true, `${deg}`);
    assert.equal(w.side, Math.sign(deg), `${deg}: the short way round`);
    assert.ok(Math.abs(dist(w, him) - SQUAD.roundAt) < 1e-9, `${deg}: the mark is on the circle walked`);
    assert.ok(nearest(from, w) >= SQUAD.keepOff, `${deg}: the walk to the mark comes within ${nearest(from, w)} m`);
    // the mark is on the way: nearer the place by bearing than the machine is, and not past it
    const b = (p) => bearingOfPost(him, p);
    assert.ok(circ(b(w), b(to)) < circ(b(from), b(to)), `${deg}: the mark is not on the way`);
  }
  // told which side to keep to, it keeps to it — a walk begun one way is not turned back half-way
  assert.equal(wayRound(him, from, at(9.67, 135), -1).side, -1);
});

test('a place to stand inside the line is moved straight out to it; one outside is left where it is', () => {
  const from = at(10, 20);
  const inside = at(3.5, 70);
  const out = standOff(him, from, inside);
  assert.ok(Math.abs(dist(out, him) - SQUAD.keepOff) < 1e-9);
  assert.ok(circ(bearingOfPost(him, out), bearingOfPost(him, inside)) < 1e-9, 'straight out, not round');
  const fine = at(8, 70);
  assert.ok(dist(standOff(him, from, fine), fine) < 1e-9);
  // right on top of him there is no "straight out": out towards where the machine is
  const on = standOff(him, from, { x: him.x, z: him.z });
  assert.ok(Math.abs(dist(on, him) - SQUAD.keepOff) < 1e-9);
  assert.ok(circ(bearingOfPost(him, on), bearingOfPost(him, from)) < 1e-9);
});

test('a machine already inside the line and walking out of it is let go: it is not sent round to get out', () => {
  const from = at(4.6, 10);
  const to = at(11, 25);
  assert.equal(keepsClear(him, from, to), true);
  assert.equal(wayRound(him, from, to).round, false);
  // …but one inside it whose line leads further in is turned out and round
  const across = at(9.67, 190);
  assert.equal(keepsClear(him, from, across), false);
  const w = wayRound(him, from, across);
  assert.equal(w.round, true);
  assert.ok(nearest(from, w) >= dist(from, him) - 1e-9, 'the first step of the way round goes further in');
});

test('the places a mark may be set: the first is the one walked in the open, and every one of them is clear of him', () => {
  // (the first time the way round was asked for beside a centrifuge, the one place a mark could be was not
  // floor, and the walk was given up: so there are five more to try before it is)
  const DEGS = 180 / Math.PI;
  for (const r of [3, 4.6, 6.5, 7, 7.5, 9, 12, 12.33, 18]) {
    for (const side of [1, -1]) {
      const from = at(r, 40);
      const list = marksRound(him, from, side);
      assert.equal(list.length, SQUAD.roundOut.length * 2, 'a short, fixed list');
      // the first is wayRound's own mark for a walk that has to go round on that side
      const across = standOff(him, from, at(10, 40 + side * 170));
      const first = wayRound(him, from, across, side);
      assert.equal(first.round, true);
      assert.ok(dist(first, list[0]) < 1e-9, `from ${r} m, side ${side}: the first is not the mark walked in the open`);
      for (const [k, p] of list.entries()) {
        const where = `from ${r} m, side ${side}, mark ${k} ${JSON.stringify(p)}`;
        assert.equal(p.side, side);
        // on the side asked, and at least a step further round than the walker stands
        const turned = side * (bearingOfPost(him, p) - bearingOfPost(him, from)) * DEGS;
        const round = ((turned % 360) + 360) % 360;
        assert.ok(round >= 30 - 1e-6 && round <= 110, `${where}: ${round.toFixed(1)}° round`);
        // no nearer him than the circle walked, no further out than the last of the list
        const out = dist(p, him);
        assert.ok(out >= SQUAD.roundAt - 1e-9 && out <= SQUAD.roundAt + Math.max(...SQUAD.roundOut) + 1e-9, where);
        // and the straight walk to it keeps clear of him. (For a walker already inside the line, the three at
        // the first bearing lead straight out; those further round may dip a hair nearer first, and
        // squad-live.js, which asks `keepsClear` of every one before it takes it, passes them over.)
        const inside = r < SQUAD.keepOff - SQUAD.roundSlack;
        if (!inside || k < SQUAD.roundOut.length)
          assert.equal(keepsClear(him, from, p, SQUAD.keepOff - SQUAD.roundSlack), true, where);
      }
    }
  }
});

test('on the edge: a walk round is begun only for a line well inside the one kept, and left only for one clear of it', () => {
  // (the first time the way round was run in the game, a machine whose straight line lay at 6.07 m — the line
  // kept is 6 — changed its mind at every step between the mark and the post, and stood a second and a half)
  const from = at(SQUAD.roundAt, 0);
  // a place whose straight line from there passes between the two thresholds
  let to = null;
  for (let deg = 60; deg <= 170 && !to; deg++) {
    const p = at(11, deg);
    const d = nearest(from, p);
    if (d < SQUAD.keepOff - 0.2 && d > SQUAD.keepOff - SQUAD.roundSlack + 0.2) to = p;
  }
  assert.ok(to, 'no such line in this ring: the case is not being asked');
  assert.equal(wayRound(him, from, to).round, false, 'not begun for a line that near the edge');
  assert.equal(wayRound(him, from, to, 1).round, true, 'but one under way goes on until the line is clear');
  assert.equal(wayRound(him, from, to, 1).side, 1);
});

test('two thousand walks: none comes inside the line, none is turned back, every one arrives', () => {
  // a seeded source: the same two thousand every run
  let seed = 20261118;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stride = 0.3;
  let rounded = 0;
  for (let n = 0; n < 2000; n++) {
    const start = at(4.6 + rnd() * 16, rnd() * 360);
    const place = standOff(him, start, at(3 + rnd() * 15, rnd() * 360));
    let pos = start;
    let side = 0;
    let near = dist(start, him);
    let walked = 0;
    let arrived = false;
    const label = () => `walk ${n} from ${JSON.stringify(start)} to ${JSON.stringify(place)}`;
    for (let step = 0; step < 600 && !arrived; step++) {
      const w = wayRound(him, pos, place, side);
      if (w.round) {
        if (side) assert.equal(w.side, side, `${label()}: turned back`);
        else rounded++;
        side = w.side;
      }
      const d = dist(pos, w);
      if (!w.round && d <= stride) {
        arrived = true;
        break;
      }
      const go = Math.min(stride, d);
      pos = { x: pos.x + ((w.x - pos.x) / d) * go, z: pos.z + ((w.z - pos.z) / d) * go };
      walked += go;
      near = Math.min(near, dist(pos, him));
    }
    assert.ok(arrived, `${label()}: not there after ${walked.toFixed(1)} m`);
    // never nearer than it began, or than the nearest a straight line is let through at — and so never inside
    // the game's back-off line unless it began there
    const floor = Math.min(dist(start, him), SQUAD.keepOff - SQUAD.roundSlack) - 0.02;
    assert.ok(near >= floor, `${label()}: came within ${near.toFixed(2)} m`);
    // and no grand tour: the straight line, or at most that and once round the circle walked
    assert.ok(walked <= dist(start, place) + Math.PI * 2 * SQUAD.roundAt, `${label()}: ${walked.toFixed(1)} m`);
  }
  assert.ok(rounded > 200, `only ${rounded} of the walks had to go round: the case is not being asked`);
});

// ---------- the net under it: given back to the game, and for how long (18 November 2026) ----------
// The way round is for open ground. Run at a dozen places that are not open — a corridor, a hall with things
// in it — a machine with no way round went by its route, and its route went through him: within a metre of
// him, seven times in 108. And one whose sight of him came and went at a corner was sent two ways by turns and
// stood there. So: the way round does not ask what the machine sees; and a posted machine that is inside the
// game's line in his sight — walking through, or not out of it soon — is given back to the game's own rules,
// which back it off, and is not given a post again for some seconds. One hand-over at a time, seconds apart:
// never two rules by turns.

test('inside the line in his sight: one walking through is given back at once, one getting out is given time', () => {
  const line = SQUAD.tooClose;
  // walking through (no way round was found), seeing him, inside the line: at once
  assert.equal(givenBack({ sees: true, dist: line - 0.01, through: true, inside: 0 }), true);
  // the same, not yet inside: not yet
  assert.equal(givenBack({ sees: true, dist: line, through: true, inside: 0 }), false);
  // not walking through — he came up to it, and it is on its way out: time to get there
  assert.equal(givenBack({ sees: true, dist: 3, through: false, inside: SQUAD.insideFor }), false);
  assert.equal(givenBack({ sees: true, dist: 3, through: false, inside: SQUAD.insideFor + 0.01 }), true);
  // what it cannot see it is not backed off from (a wall between them): the game's own rule is the same
  assert.equal(givenBack({ sees: false, dist: 1, through: true, inside: 99 }), false);
  // and outside the line nothing is given back, whatever else
  assert.equal(givenBack({ sees: true, dist: line + 3, through: true, inside: 99 }), false);
});

test('how long it has been inside: runs while he is seen, holds while he is not, and starts again once it is out', () => {
  const line = SQUAD.tooClose;
  let t = 0;
  for (let i = 0; i < 30; i++) t = lingered(t, true, 3, 0.05);
  assert.ok(Math.abs(t - 1.5) < 1e-9);
  // sight of him coming and going at a corner does not start the clock again — it only stops it for a step
  for (let i = 0; i < 30; i++) t = lingered(t, i % 2 === 0, 3, 0.05);
  assert.ok(Math.abs(t - 2.25) < 1e-9, `${t}`);
  // out of the line: nothing is held against it
  assert.equal(lingered(t, true, line, 0.05), 0);
  assert.equal(lingered(t, false, line + 2, 0.05), 0);
});

test('the times: long enough to get out by its own way, and hand-overs seconds apart, not steps', () => {
  // from 3 m to the line at the pace a sentry gives ground at (2.5 m/s), after the quarter second the game's
  // `goTo` may wait on a new route: 0.85 s. Given less than that it would be handed back while doing right.
  assert.ok(SQUAD.insideFor >= 1 && SQUAD.insideFor <= 2, `${SQUAD.insideFor}`);
  // the fault of the night of the merge was two rules changing hands four times a second. A hand-over now
  // holds for at least eight turns of the plan (half a second each), and for at least four seconds.
  assert.ok(SQUAD.barFor >= 4 && SQUAD.barFor <= 10, `${SQUAD.barFor}`);
});

test('a machine that could not get round is posted on its own side — and the one beside it still goes round', () => {
  // (given back to the game because its way to a post beyond him led up to him: sent to the same post again
  // when its time is up it would only try the same walk again — in a corridor, for ever)
  const lastSeen = { x: 0, z: 0 };
  const units = [
    { id: 1, x: 0, z: -10, dist: 10 },
    { id: 2, x: -2, z: -10, dist: 10.2 },
    { id: 3, x: 2, z: -10, dist: 10.2, stay: true },
  ];
  const posts = plan({ lastSeen, units, walkable: open, sight: open, now: 0, previous: new Map() });
  assert.equal(posts.size, 3);
  const own = (u) => bearingOfPost(lastSeen, u);
  const of = (id) => bearingOfPost(lastSeen, posts.get(id));
  // the one that stays: within a step of the ring (15 degrees) or two of where it stands, as he sees it
  assert.ok(
    circ(of(3), own(units[2])) <= 30 * DEG,
    `${(circ(of(3), own(units[2])) / DEG).toFixed(0)} degrees from its own side`,
  );
  assert.equal(posts.get(3).role, 'hold');
  // the anchor as ever; the other still a flank, wide of both
  assert.equal(posts.get(1).role, 'anchor');
  assert.equal(posts.get(2).role, 'flank');
  assert.ok(circ(of(2), of(1)) >= 100 * DEG, `${(circ(of(2), of(1)) / DEG).toFixed(0)} degrees from the anchor`);
  // and no two of the three on one spot
  for (const [a, b] of [
    [1, 2],
    [1, 3],
    [2, 3],
  ])
    assert.ok(dist(posts.get(a), posts.get(b)) >= SQUAD.minPostGap);
  // without the word, the same machine is sent round like any other flank
  const plain = plan({
    lastSeen,
    units: units.map((u) => ({ ...u, stay: false })),
    walkable: open,
    sight: open,
    now: 0,
    previous: new Map(),
  });
  assert.equal(plain.get(3).role, 'flank');
  assert.ok(circ(bearingOfPost(lastSeen, plain.get(3)), own(units[2])) > 30 * DEG);
});

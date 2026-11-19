// Squad: do the machines that share a fight stand apart and spread the player's attention, or still each for
// itself? test/wild/events.test.mjs already locks the seam (enemies/index.js's hooks.squad, and that it is asked
// for every machine in a fight, seeing and not); this suite is what answers it — src/wild/squad.js's rules,
// joined to the game by src/wild/squad-live.js — read against the game running, not against the lookup tables.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { SQUAD } from '../../src/wild/squad.js';
import { PLAY, openWith, startWild } from './helpers.mjs';

let harness;
let open;
let page;
/** one open place on the live map, found rather than guessed — a player's spot with sight AND footing on more
 *  than one side of it, at the range posts are actually chosen in (score: how many of 24 rays at 11 m are both
 *  walkable and seen from the centre — a candidate squad.js itself could use) */
let spot;

before(async () => {
  harness = await startWild();
  open = openWith(harness);
  // (18 November 2026, at the merge: a fight that goes on for four seconds raises the alarm, and an alarm now
  // brings a wave of machines — src/wild/response.js. This suite counts what the machines it staged do: the
  // site's answer is switched off on its pages, and the last test asks what happens with both on.)
  page = await open(`${PLAY}&response=0`);
  spot = await page.json(`(() => {
    const grid = __G.world.grid;
    const rays = [];
    for (let i = 0; i < 24; i++) rays.push([Math.cos((i / 24) * Math.PI * 2), Math.sin((i / 24) * Math.PI * 2)]);
    const openness = (x, z) =>
      rays.filter(([dx, dz]) => {
        const cx = x + dx * 11, cz = z + dz * 11;
        return grid.walkable(Math.floor(cx), Math.floor(cz)) && grid.sight(x, 1.7, z, cx, 1.72, cz);
      }).length;
    let best = null;
    for (let x = 15; x < grid.w - 15; x += 3)
      for (let z = 15; z < grid.h - 15; z += 3) {
        if (!grid.walkable(x, z)) continue;
        const score = openness(x + 0.5, z + 0.5);
        if (!best || score > best.score) best = { x: x + 0.5, z: z + 0.5, score };
      }
    return best;
  })()`);
  assert.ok(spot && spot.score >= 16, `no sufficiently open place found on this map: ${JSON.stringify(spot)}`);
});

after(async () => {
  await harness?.stop();
});

/**
 * Stages `n` sentries at one walkable, visible cell about 12 m from (spot.x, spot.z) — the direction is found and
 * checked against the grid, not assumed — all facing the player and already in COMBAT (reinforce() does not put
 * them there itself; a fight already under way is what this suite is asking about, not how one catches light).
 * Also wraps __G.wild.emit so window.__seen.fired counts rounds at the player, as test/wild/events.test.mjs does.
 * @param {{x: number, z: number}} [at] where the player stands (the open place found above, unless said)
 * @param {number} [first] which of the 24 bearings round him is tried first for the machines' cell
 * @returns {Promise<{px: number, pz: number, ids: number[]}>}
 */
async function stage(onPage, n, at = spot, first = 0) {
  return onPage.json(`(() => {
    const G = __G, grid = G.world.grid, e = G.enemies;
    G.debug.start();
    e.remove(e.list.map((u) => u.rollId));
    const px = ${at.x}, pz = ${at.z};
    if (!grid.walkable(Math.floor(px), Math.floor(pz))) throw new Error('the chosen spot is not walkable');
    G.debug.teleport(px, pz, 0);
    G.player.health = 1e6;
    let cx = null, cz = null;
    for (let k = 0; k < 24 && cx == null; k++) {
      const a = (((k + ${first}) % 24) / 24) * Math.PI * 2;
      const x = px + Math.cos(a) * 12, z = pz + Math.sin(a) * 12;
      const tx = Math.floor(x), tz = Math.floor(z);
      if (grid.walkable(tx, tz) && grid.sight(x, 1.72, z, px, G.player.eye, pz)) { cx = tx; cz = tz; }
    }
    if (cx == null) throw new Error('no walkable cell with sight of the player 12 m from the chosen spot');
    const cells = Array.from({ length: ${n} }, () => [cx, cz]);
    const units = e.reinforce('sentry', cells, { x: px, z: pz });
    for (const u of units) { u.brain.state = 'combat'; u.brain.awareness = 3; }
    window.__seen = { fired: 0 };
    // wrapped once a page, however often a fight is staged on it (wrapped again each time, as it was until 18
    // November 2026, every round was counted once for each fight staged so far)
    if (!G.wild.__counted) {
      const emit = G.wild.emit;
      G.wild.emit = (name, a2, b2, c2) => { if (name === 'fired') window.__seen.fired++; return emit(name, a2, b2, c2); };
      G.wild.__counted = true;
    }
    return { px, pz, ids: units.map((u) => u.id) };
  })()`);
}

/** every half second of game time over `seconds`, each staged unit's bearing from the player (radians, null if
 *  dead or missing) — collected with one async call rather than one round trip per sample. */
async function bearings(onPage, ids, seconds) {
  const json = await onPage.evaluate(`(async () => {
    const G = __G;
    const ids = ${JSON.stringify(ids)};
    const t0 = G.mission.time;
    const samples = [];
    let nextAt = 0.5;
    while (G.mission.time - t0 < ${seconds}) {
      if (G.mission.time - t0 >= nextAt) {
        samples.push(ids.map((id) => {
          const u = G.enemies.list.find((e) => e.id === id);
          return u && !u.dead ? Math.atan2(u.x - G.player.x, u.z - G.player.z) : null;
        }));
        nextAt += 0.5;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return JSON.stringify(samples);
  })()`);
  return JSON.parse(json);
}

/** the widest angle, in degrees, between any two of one sample's bearings (the dead and the missing left out) */
function widestGap(sample) {
  const b = sample.filter((v) => typeof v === 'number');
  let max = 0;
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) {
      let d = Math.abs(b[i] - b[j]);
      if (d > Math.PI) d = 2 * Math.PI - d;
      max = Math.max(max, d);
    }
  return (max * 180) / Math.PI;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

test('A/B: posted apart, wide of one another, and still firing without a let-up — the point of the feature', async () => {
  const pageOff = await open(`${PLAY}&response=0&squad=0`);
  const runs = [];
  try {
    for (let run = 0; run < 3; run++) {
      const [onInfo, offInfo] = await Promise.all([stage(page, 3), stage(pageOff, 3)]);
      await Promise.all([page.evaluate('__G.debug.speed(4); void 0'), pageOff.evaluate('__G.debug.speed(4); void 0')]);
      const [onSamples, offSamples] = await Promise.all([
        bearings(page, onInfo.ids, 14),
        bearings(pageOff, offInfo.ids, 14),
      ]);
      const [onFired, offFired] = await Promise.all([page.evaluate('__seen.fired'), pageOff.evaluate('__seen.fired')]);
      const onGap = mean(onSamples.slice(-12).map(widestGap));
      const offGap = mean(offSamples.slice(-12).map(widestGap));
      const onState = await page.json('__G.wild.feature("squad").state');
      runs.push({ onGap, offGap, onFired, offFired, posts: onState.posts });
    }
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
    await pageOff.evaluate('__G.debug.speed(1); void 0');
    await pageOff.close();
  }
  console.log('A/B runs (deg widest-gap mean, fired counts):', JSON.stringify(runs, null, 1));
  for (const { onGap, offGap, onFired, offFired } of runs) {
    assert.ok(onGap >= 90, `squad ON: mean widest gap ${onGap.toFixed(1)}° (want >= 90°)`);
    assert.ok(onGap >= offGap + 40, `ON ${onGap.toFixed(1)}° not >= 40° wider than OFF ${offGap.toFixed(1)}°`);
    assert.ok(onFired >= 0.6 * offFired, `squad ON fired ${onFired} rounds, OFF fired ${offFired}`);
  }
  assert.deepEqual(await page.problems(), []);
});

test('nobody is left to be shot standing still: at the post or moving, every one of them', async () => {
  const { ids } = await stage(page, 3);
  await page.evaluate('__G.debug.speed(4); void 0');
  await page.until('__G.wild.feature("squad").state.engaged >= 3', 'all three engaged', 15000);
  // a trail of positions over the last few seconds of game time, so "moved lately" can be read off it — an async
  // function, so page.evaluate directly and parse it here rather than page.json (which cannot await one)
  const trail = JSON.parse(
    await page.evaluate(`(async () => {
    const G = __G, ids = ${JSON.stringify(ids)};
    const t0 = G.mission.time;
    const rows = [];
    while (G.mission.time - t0 < 8) {
      rows.push({ t: G.mission.time, pos: ids.map((id) => {
        const u = G.enemies.list.find((e) => e.id === id);
        return u ? [u.x, u.z] : null;
      }) });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return JSON.stringify(rows);
  })()`),
  );
  await page.evaluate('__G.debug.speed(1); void 0');
  const state = await page.json('__G.wild.feature("squad").state');
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const last = trail[trail.length - 1].pos[i];
    assert.ok(last, `unit ${id} is gone`);
    const post = state.posts[id];
    const atPost = post && Math.hypot(last[0] - post.x, last[1] - post.z) <= 2.5;
    // "moved in the last 3 s": compare against the row nearest three seconds before the end
    const cut = trail[trail.length - 1].t - 3;
    const back = trail.find((r) => r.t >= cut) || trail[0];
    const prior = back.pos[i];
    const moved = prior && Math.hypot(last[0] - prior[0], last[1] - prior[1]) > 0.1;
    assert.ok(
      atPost || moved,
      `unit ${id} is neither at its post nor has moved lately (post ${JSON.stringify(post)}, at ${JSON.stringify(last)})`,
    );
  }
  assert.deepEqual(await page.problems(), []);
});

test('a post on his far side: the machine goes round him, not through him, and it gets there', async () => {
  // (18 November 2026. The full suite, the night of the merge, failed the test above once: a machine sent to a
  // post across him walked into the game's own "closer than 4.5 m: back off" line, was backed out by the game
  // and sent in again by the squad, and stood shaking on that line in front of him — three staged fights in
  // sixteen when counted. Here the case is made on purpose rather than waited for: a posted machine is set
  // down straight across him from its post.)
  const { ids, px, pz } = await stage(page, 2);
  await page.evaluate('__G.debug.speed(4); void 0');
  await page.until('Object.keys(__G.wild.feature("squad").state.posts).length >= 2', 'both given a post', 15000);
  const set = await page.json(`(() => {
    const G = __G, grid = G.world.grid, s = G.wild.feature('squad').state;
    for (const id of ${JSON.stringify(ids)}) {
      const u = G.enemies.list.find((e) => e.id === id), post = s.posts[id];
      const x = 2 * ${px} - post.x, z = 2 * ${pz} - post.z;
      if (!grid.walkable(Math.floor(x), Math.floor(z)) || !grid.sight(x, 1.72, z, ${px}, G.player.eye, ${pz})) continue;
      // set down, and its route in hand thrown away (it led from where it was)
      u.x = x; u.z = z; u.goalX = -1; u.path = null; u.pathI = 0;
      return { id, post, from: [x, z] };
    }
    return null;
  })()`);
  assert.ok(set, 'neither machine could be set down across him from its post');
  const walk = JSON.parse(
    await page.evaluate(`(async () => {
    const G = __G, id = ${set.id};
    const t0 = G.mission.time;
    let near = Infinity, there = null, seen = 0, frames = 0;
    while (G.mission.time - t0 < 20 && there == null) {
      const u = G.enemies.list.find((e) => e.id === id);
      const post = G.wild.feature('squad').state.posts[id];
      frames++;
      if (u.sees) { seen++; near = Math.min(near, Math.hypot(u.x - G.player.x, u.z - G.player.z)); }
      if (post && Math.hypot(u.x - post.x, u.z - post.z) <= 2.5) there = G.mission.time - t0;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return JSON.stringify({ near, there, seen, frames });
  })()`),
  );
  await page.evaluate('__G.debug.speed(1); void 0');
  const told = `${JSON.stringify(set)} → ${JSON.stringify(walk)}`;
  assert.ok(walk.seen > walk.frames / 2, `it did not have him in sight for most of the way: ${told}`);
  // half a metre clear of the line the game backs a machine off at: not skimmed, and not stepped over
  assert.ok(walk.near >= SQUAD.tooClose + 0.5, `it came within ${walk.near.toFixed(2)} m of him: ${told}`);
  assert.ok(walk.there != null, `it was not at its post twenty seconds on: ${told}`);
  assert.deepEqual(await page.problems(), []);
});

test('walked up to: a machine at its post gives him ground, and does not come back in', async () => {
  // (the game's own rule — under 4.5 m, back off — is not asked of a machine the squad has posted any more:
  // the squad steers it alone. This holds it to the same distance.)
  const { ids, px, pz } = await stage(page, 2);
  await page.evaluate('__G.debug.speed(4); void 0');
  const arrived = `(() => {
    const G = __G, s = G.wild.feature('squad').state;
    for (const id of ${JSON.stringify(ids)}) {
      const u = G.enemies.list.find((e) => e.id === id), post = s.posts[id];
      if (u && post && u.sees && Math.hypot(u.x - post.x, u.z - post.z) <= 2.5) return id;
    }
    return null;
  })()`;
  await page.until(`${arrived} != null`, 'one of them to be at its post', 20000);
  const up = await page.json(`(() => {
    const G = __G, grid = G.world.grid;
    const u = G.enemies.list.find((e) => e.id === ${arrived});
    const len = Math.hypot(${px} - u.x, ${pz} - u.z);
    // three metres from it, on its own line of sight to where he stood
    for (const d of [3, 2.6, 3.4, 2.2]) {
      const x = u.x + ((${px} - u.x) / len) * d, z = u.z + ((${pz} - u.z) / len) * d;
      if (!grid.walkable(Math.floor(x), Math.floor(z)) || !grid.sight(u.x, 1.72, u.z, x, G.player.eye, z)) continue;
      G.debug.teleport(x, z);
      return { id: u.id, d };
    }
    return null;
  })()`);
  assert.ok(up, 'nowhere to stand three metres from the machine');
  const after = JSON.parse(
    await page.evaluate(`(async () => {
    const G = __G, id = ${up.id}, line = ${SQUAD.tooClose};
    const t0 = G.mission.time;
    let out = null, back = Infinity, first = null;
    while (G.mission.time - t0 < 7) {
      const u = G.enemies.list.find((e) => e.id === id);
      const t = G.mission.time - t0;
      const d = Math.hypot(u.x - G.player.x, u.z - G.player.z);
      if (first == null) first = d;
      if (out == null && d >= line) out = t;
      if (out != null && t > out + 0.25) back = Math.min(back, d);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return JSON.stringify({ first, out, back });
  })()`),
  );
  await page.evaluate('__G.debug.speed(1); void 0');
  const told = `${JSON.stringify(up)} → ${JSON.stringify(after)}`;
  assert.ok(after.first < SQUAD.tooClose, `he was not inside its line to begin with: ${told}`);
  assert.ok(after.out != null && after.out <= 2.5, `it was still inside the line 2.5 s on: ${told}`);
  assert.ok(after.back >= SQUAD.tooClose - 0.05, `it came back inside the line: ${told}`);
  assert.deepEqual(await page.problems(), []);
});

test('his sight of it coming and going changes nothing: it is sent one way, not two by turns', async () => {
  // (18 November 2026. Found by the review of the way round, and then seen in the game at the mouth of a
  // corridor: a machine that saw him one step and not the next was sent to its mark on the steps it saw him and
  // straight at its post — across him — on the steps it did not, and stood at the corner, 3.5 m from him, for as
  // long as it was watched. Here the squad's own half of a step is asked directly, his sight of the machine made
  // to come and go with every one.)
  const { ids, px, pz } = await stage(page, 2);
  await page.evaluate('__G.debug.speed(4); void 0');
  await page.until('Object.keys(__G.wild.feature("squad").state.posts).length >= 2', 'both given a post', 15000);
  await page.evaluate('__G.debug.speed(1); void 0');
  const sent = await page.json(`(() => {
    const G = __G, grid = G.world.grid, f = G.wild.feature('squad');
    for (const id of ${JSON.stringify(ids)}) {
      const u = G.enemies.list.find((e) => e.id === id), post = f.state.posts[id];
      const x = 2 * ${px} - post.x, z = 2 * ${pz} - post.z;
      if (!grid.walkable(Math.floor(x), Math.floor(z)) || !grid.sight(x, 1.72, z, ${px}, G.player.eye, ${pz})) continue;
      // set down straight across him from its post, as in the test of the far side
      u.x = x; u.z = z; u.goalX = -1; u.path = null; u.pathI = 0;
      u.dist = Math.hypot(x - ${px}, z - ${pz});
      const asked = [];
      const inner = { goTo: (unit, gx, gz, speed) => { asked.push({ gx, gz, speed }); return false; } };
      const answers = [];
      // sixty steps a second for two seconds, without a frame of the game between them
      for (let i = 0; i < 120; i++) { u.sees = i % 2 === 0; answers.push(f.squad(u, 1 / 60, inner)); }
      let changes = 0;
      for (let i = 1; i < asked.length; i++)
        if (Math.floor(asked[i].gx) !== Math.floor(asked[i - 1].gx) || Math.floor(asked[i].gz) !== Math.floor(asked[i - 1].gz)) changes++;
      const off = asked.map((a) => Math.hypot(a.gx - ${px}, a.gz - ${pz}));
      // how far round him from where the machine stands each of them is, in degrees (its post is 180 round)
      const turn = asked.map((a) => {
        const ax = a.gx - ${px}, az = a.gz - ${pz}, bx = x - ${px}, bz = z - ${pz};
        return (Math.acos((ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz))) * 180) / Math.PI;
      });
      return { id, post, from: [x, z], asked: asked.length, moved: answers.every((a) => a === true), changes,
        nearest: Math.min(...off), furthest: Math.max(...off), widest: Math.max(...turn),
        run: u.spec.run, speeds: [...new Set(asked.map((a) => a.speed))] };
    }
    return null;
  })()`);
  assert.ok(sent, 'neither machine could be set down across him from its post');
  const told = JSON.stringify(sent);
  assert.equal(sent.asked, 120, told);
  assert.equal(sent.moved, true, `the squad did not move it on every step: ${told}`);
  assert.ok(sent.changes <= 1, `where it was sent changed ${sent.changes} times in 120 steps: ${told}`);
  // every one of them a mark on its own side of him, on or just outside the circle it walks — none of them its
  // post, straight across him
  assert.ok(sent.widest < 100, `it was sent ${sent.widest.toFixed(0)}° round him in one go: ${told}`);
  assert.ok(sent.nearest >= SQUAD.roundAt - 0.01, told);
  assert.ok(sent.furthest <= SQUAD.roundAt + Math.max(...SQUAD.roundOut) + 0.01, told);
  assert.deepEqual(sent.speeds, [sent.run], `the way round is walked at its full pace: ${told}`);
  assert.deepEqual(await page.problems(), []);
});

test("no way round, and its way through leads up to him: at the line it is the game's again — for seconds, not steps", async () => {
  // (18 November 2026. Where a mark cannot be walked to, a machine goes by its route — and run at a dozen places
  // that are not open ground, its route went through him: within a metre of him, seven machines in 108.)
  const { ids, px, pz } = await stage(page, 3);
  await page.evaluate('__G.debug.speed(4); void 0');
  await page.until('Object.keys(__G.wild.feature("squad").state.posts).length >= 3', 'all three given a post', 15000);
  const given = await page.json(`(() => {
    const G = __G, grid = G.world.grid, f = G.wild.feature('squad');
    for (const id of ${JSON.stringify(ids)}) {
      const u = G.enemies.list.find((e) => e.id === id), post = f.state.posts[id];
      const x = 2 * ${px} - post.x, z = 2 * ${pz} - post.z;
      const len = Math.hypot(x - ${px}, z - ${pz});
      const nx = ${px} + ((x - ${px}) / len) * 4, nz = ${pz} + ((z - ${pz}) / len) * 4;
      if (!grid.walkable(Math.floor(x), Math.floor(z)) || !grid.sight(x, 1.72, z, ${px}, G.player.eye, ${pz})) continue;
      if (!grid.walkable(Math.floor(nx), Math.floor(nz))) continue;
      u.x = x; u.z = z; u.goalX = -1; u.path = null; u.pathI = 0; u.sees = true; u.dist = len;
      // "there", the game says of a mark the machine is not at: its route could get no nearer — no way round
      const stuck = { goTo: () => true };
      const first = f.squad(u, 1 / 60, stuck);
      const through = !!(f.state.rounding || []).find((w) => w.id === id)?.through;
      // …and its way through has brought it inside the game's line, in his sight
      u.x = nx; u.z = nz; u.dist = 4; u.sees = true;
      const second = f.squad(u, 1 / 60, stuck);
      const s = f.state;
      return { id, first, through, second, barred: (s.barred || []).includes(id), posts: Object.keys(s.posts).length, at: G.mission.time };
    }
    return null;
  })()`);
  assert.ok(given, 'none of the three could be set down across him from its post');
  const told = JSON.stringify(given);
  assert.equal(given.first, true, told);
  assert.equal(given.through, true, `it was not going by its route: ${told}`);
  assert.equal(given.second, false, `the squad kept hold of it inside the line: ${told}`);
  assert.equal(given.barred, true, told);
  // the post it could not get to is given up at once…
  assert.equal(given.posts, 2, told);
  // …and it stays the game's until the time is up: asked half-way, the squad still will not walk it — but the
  // plan has gone on counting it, and has a post for it on its own side of him
  const later = JSON.parse(
    await page.evaluate(`(async () => {
    const G = __G, f = G.wild.feature('squad'), id = ${given.id}, t0 = ${given.at};
    const u = G.enemies.list.find((e) => e.id === id);
    let walked = 0;
    const spy = { goTo: () => { walked++; return false; } };
    let half = null, again = null;
    while (G.mission.time - t0 < ${SQUAD.barFor + 5} && again == null) {
      const t = G.mission.time - t0;
      if (half == null && t >= ${SQUAD.barFor / 2}) {
        const s = f.state, post = s.posts[id];
        const ax = post ? post.x - ${px} : 0, az = post ? post.z - ${pz} : 1, bx = u.x - ${px}, bz = u.z - ${pz};
        half = { answer: f.squad(u, 1 / 60, spy), walked, posts: Object.keys(s.posts).length, role: post ? post.role : null,
          round: (Math.acos((ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz))) * 180) / Math.PI };
      }
      if (!f.state.barred.includes(id)) again = t;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return JSON.stringify({ half, again, state: u.brain.state, after: again == null ? null : f.squad(u, 1 / 60, spy), walked });
  })()`),
  );
  await page.evaluate('__G.debug.speed(1); void 0');
  const then = JSON.stringify(later);
  assert.ok(later.half, then);
  assert.equal(later.half.answer, false, `half-way through its time the squad walked it: ${then}`);
  assert.equal(later.half.walked, 0, then);
  assert.equal(later.half.posts, 3, `the plan left it out: ${then}`);
  // (the nearest of them to him is the anchor whatever else it is; either way it is posted where it stands)
  assert.ok(later.half.role === 'hold' || later.half.role === 'anchor', then);
  assert.ok(
    later.half.round <= 45,
    `its next post is ${later.half.round.toFixed(0)}° round him from where it stands: ${then}`,
  );
  assert.ok(
    later.again != null && later.again >= SQUAD.barFor - 0.1 && later.again <= SQUAD.barFor + 1,
    `it was to be the squad's again ${SQUAD.barFor} s on, no sooner: ${then}`,
  );
  assert.equal(later.after, true, `its time up, the squad did not walk it again: ${then}`);
  assert.equal(later.walked, 1, then);
  assert.deepEqual(await page.problems(), []);
});

test('where there is no room to go round — a corridor, a hall with things in it: nobody is walked through him, nobody is left inside the line', async () => {
  // (18 November 2026. Every other test here is at the most open place on the map. Fights are not.)
  const places = await page.json(`(() => {
    const grid = __G.world.grid;
    const rays = [];
    for (let i = 0; i < 24; i++) rays.push([Math.cos((i / 24) * Math.PI * 2), Math.sin((i / 24) * Math.PI * 2)]);
    const openness = (x, z) =>
      rays.filter(([dx, dz]) => {
        const cx = x + dx * 11, cz = z + dz * 11;
        return grid.walkable(Math.floor(cx), Math.floor(cz)) && grid.sight(x, 1.7, z, cx, 1.72, cz);
      }).length;
    const out = [];
    // places found in each band of openness (of 24): corridors, corners, a hall with things in it
    for (const [lo, hi, most] of [[2, 4, 2], [5, 7, 2], [11, 13, 1]]) {
      let took = 0;
      for (let x = 6; x < grid.w - 6 && took < most; x += 2)
        for (let z = 6; z < grid.h - 6 && took < most; z += 2) {
          if (!grid.walkable(x, z)) continue;
          const score = openness(x + 0.5, z + 0.5);
          if (score < lo || score > hi) continue;
          if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 14)) continue;
          // …with somewhere 12 m off to stage them, in sight of it
          let staged = false;
          for (let i = 0; i < 24 && !staged; i++) {
            const a = (i / 24) * Math.PI * 2;
            const sx = x + 0.5 + Math.cos(a) * 12, sz = z + 0.5 + Math.sin(a) * 12;
            staged = grid.walkable(Math.floor(sx), Math.floor(sz)) && grid.sight(sx, 1.72, sz, x + 0.5, __G.player.eye, z + 0.5);
          }
          if (!staged) continue;
          out.push({ x: x + 0.5, z: z + 0.5, score });
          took++;
        }
    }
    return out;
  })()`);
  assert.ok(places.length >= 3, `too few places that are not open ground on this map: ${JSON.stringify(places)}`);
  const told = [];
  for (const place of places)
    for (const first of [0, 8]) {
      const { ids } = await stage(page, 3, place, first);
      await page.evaluate('__G.debug.speed(4); void 0');
      const trail = JSON.parse(
        await page.evaluate(`(async () => {
        const G = __G, ids = ${JSON.stringify(ids)}, f = G.wild.feature('squad');
        const t0 = G.mission.time;
        const rows = [];
        while (G.mission.time - t0 < 10) {
          const s = f.state;
          rows.push({ t: G.mission.time - t0, u: ids.map((id) => {
            const u = G.enemies.list.find((e) => e.id === id);
            if (!u) return null;
            // "the squad's": it has a post and the squad is walking it (not one given back to the game for now)
            return { posted: id in s.posts && !s.barred.includes(id), sees: !!u.sees, d: Math.hypot(u.x - G.player.x, u.z - G.player.z),
              through: !!s.rounding.find((w) => w.id === id)?.through };
          }) });
          await new Promise((r) => requestAnimationFrame(r));
        }
        return JSON.stringify(rows);
      })()`),
      );
      await page.evaluate('__G.debug.speed(1); void 0');
      for (let i = 0; i < ids.length; i++) {
        // the longest it was the squad's, inside the game's line, in his sight — and the nearest it came to him
        // while the squad was walking it by its route
        let longest = 0;
        let since = null;
        let deepest = Infinity;
        for (const row of trail) {
          const u = row.u[i];
          const inside = u && u.posted && u.sees && u.d < SQUAD.tooClose;
          if (inside && since == null) since = row.t;
          if (inside) longest = Math.max(longest, row.t - since);
          if (!inside) since = null;
          if (u && u.posted && u.through && u.sees) deepest = Math.min(deepest, u.d);
        }
        const where = `at ${place.x},${place.z} (openness ${place.score}, from bearing ${first}) unit ${ids[i]}`;
        told.push(
          `${where}: inside ${longest.toFixed(2)} s, through to ${Number.isFinite(deepest) ? deepest.toFixed(2) : '-'}`,
        );
        assert.ok(
          longest <= SQUAD.insideFor + 0.6,
          `${where} was the squad's for ${longest.toFixed(2)} s inside the line, in his sight`,
        );
        assert.ok(
          deepest >= SQUAD.tooClose - 0.6,
          `${where} was walked by its route to within ${deepest.toFixed(2)} m of him`,
        );
      }
    }
  console.log(`narrow places:\n${told.join('\n')}`);
  assert.deepEqual(await page.problems(), []);
});

test("out of sight: the machines do not bunch on one spot, and none leaves the fight for a reason of the squad's", async () => {
  const { ids, px, pz } = await stage(page, 3);
  await page.evaluate('__G.debug.speed(4); void 0');
  await page.until('__G.wild.feature("squad").state.engaged >= 3', 'all three engaged', 15000);
  const far = await page.json(`(() => {
    const grid = __G.world.grid;
    const corners = [[0.1,0.1],[0.9,0.1],[0.1,0.9],[0.9,0.9],[0.5,0.05],[0.05,0.5],[0.95,0.5],[0.5,0.95]];
    for (const [fx, fz] of corners) {
      const x = Math.floor(grid.w * fx), z = Math.floor(grid.h * fz);
      if (grid.walkable(x, z) && Math.hypot(x - ${px}, z - ${pz}) > 40) return [x + 0.5, z + 0.5];
    }
    return null;
  })()`);
  assert.ok(far, 'no place far enough from the staged fight to call "out of sight"');
  // let posts establish around the player first — they are reinforced onto one shared cell (see stage()), so
  // teleporting before they have had a chance to walk out to posts would just be measuring their spawn point
  await page.evaluate(`(async () => {
    const t0 = __G.mission.time;
    while (__G.mission.time - t0 < 3) await new Promise((r) => requestAnimationFrame(r));
  })()`);
  await page.evaluate(`__G.debug.teleport(${far[0]}, ${far[1]}, 0); void 0`);
  // sample the whole window, not just the tail: once every engaged machine alike loses sight for the game's own
  // 3 s "lost" timeout they drop out of COMBAT together, which ends the hook's reach (it is only ever asked in
  // case AI.COMBAT) — so what the squad can actually promise is that they do not bunch up while it still holds
  // them; after that the game's own SEARCH behaviour, outside this fence, takes over the "same last-known point"
  // path the feature exists to fix only for the COMBAT machines it is given
  const json = await page.evaluate(`(async () => {
    const ids = ${JSON.stringify(ids)};
    const t0 = __G.mission.time;
    const minSeps = [];
    const states = [];
    while (__G.mission.time - t0 < 6) {
      const units = ids.map((id) => __G.enemies.list.find((e) => e.id === id));
      states.push(units.map((u) => (u ? u.brain.state : null)));
      let min = Infinity;
      for (let i = 0; i < units.length; i++)
        for (let j = i + 1; j < units.length; j++) {
          if (!units[i] || !units[j]) continue;
          min = Math.min(min, Math.hypot(units[i].x - units[j].x, units[i].z - units[j].z));
        }
      minSeps.push(min);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return JSON.stringify({ minSeps, states });
  })()`);
  await page.evaluate('__G.debug.speed(1); void 0');
  const { minSeps, states } = JSON.parse(json);
  for (const row of states) for (const s of row) assert.ok(s === 'combat' || s === 'search', `left the fight: ${s}`);
  assert.ok(
    Math.max(...minSeps) >= 2,
    `machines stayed under 2 m apart through the whole window: best was ${Math.max(...minSeps).toFixed(2)} m`,
  );
  assert.deepEqual(await page.problems(), []);
});

test('the stealth guard: a machine that has not noticed the player is never touched, or even listed', async () => {
  const { px, pz } = await stage(page, 3);
  const quiet = await page.json(`(() => {
    const G = __G, grid = G.world.grid, e = G.enemies;
    const corners = [[0.1,0.1],[0.9,0.1],[0.1,0.9],[0.9,0.9],[0.5,0.05],[0.05,0.5],[0.95,0.5],[0.5,0.95]];
    let spot = null;
    for (const [fx, fz] of corners) {
      const x = Math.floor(grid.w * fx), z = Math.floor(grid.h * fz);
      if (grid.walkable(x, z) && Math.hypot(x - ${px}, z - ${pz}) > 40) { spot = [x, z]; break; }
    }
    if (!spot) throw new Error('no quiet corner far enough from the staged fight');
    const u = e.reinforce('sentry', [spot], { x: ${px}, z: ${pz} })[0];
    // reinforce() is written for a wave already called to a place: it pings the unit (a radioed alarm) and starts
    // it half-suspicious (WAVE.awareness) — both the game's own doing for that case, and not what this test asks
    // of the squad; cleared so only this unit's own sight and hearing of the fight can move it, same as any
    // sentry on patrol that has not been sent for
    u.ping = null; u.pingP = { x: 0, z: 0 }; u.brain.awareness = 0;
    return { id: u.id };
  })()`);
  await page.evaluate('__G.debug.speed(4); void 0');
  // held under the game's OWN alarm clock (ai.js tuning.callAlarmAfter = 4 s of unanswered combat, read as
  // "the game gives the player 4 s to silence a machine before it raises the alarm" in the brief) — that alarm
  // is a global percept every machine gets, patrol units included, entirely apart from the squad; run the full
  // 10 s here and even a machine a kilometre away would be fetched by the game itself, which is no test of ours
  await page.evaluate(`(async () => {
    const t0 = __G.mission.time;
    while (__G.mission.time - t0 < 3.2) await new Promise((r) => requestAnimationFrame(r));
  })()`);
  await page.evaluate('__G.debug.speed(1); void 0');
  const after = await page.json(`(() => {
    const u = __G.enemies.list.find((e) => e.id === ${quiet.id});
    return u ? u.brain.state : null;
  })()`);
  assert.equal(after, 'patrol', `the quiet sentry's state after the fight: ${after}`);
  const state = await page.json('__G.wild.feature("squad").state');
  assert.ok(!(quiet.id in state.posts), 'the quiet sentry was given a post');
  assert.ok(!state.engagedIds.includes(quiet.id), "the quiet sentry was on the squad's own list");
  assert.deepEqual(await page.problems(), []);
});

test('falling back: a sentry hurt badly breaks off, and is back at a post before long', async () => {
  const { ids } = await stage(page, 3);
  await page.evaluate('__G.debug.speed(4); void 0');
  await page.until('__G.wild.feature("squad").state.engaged >= 3', 'all three engaged', 15000);
  const hurtId = ids[0];
  const before = await page.json(`(() => {
    const u = __G.enemies.list.find((e) => e.id === ${hurtId});
    u.hp = u.hpMax * 0.3;
    return { x: u.x, z: u.z, sees: u.sees };
  })()`);
  // within 4 s of game time it is sent somewhere the last-seen point cannot see, or well back from it
  await page.until(
    `(() => { const u = __G.enemies.list.find((e) => e.id === ${hurtId});
      const d = Math.hypot(u.x - ${before.x}, u.z - ${before.z});
      return __G.wild.feature('squad').state.fallenBack.includes(${hurtId}) || d >= 3;
    })()`,
    'the hurt sentry to fall back',
    4000 / 4 + 3000,
  );
  // and within twelve more seconds of game time it holds a post again
  await page.until(
    `${hurtId} in __G.wild.feature('squad').state.posts`,
    'the hurt sentry to take a post again',
    12000 / 4 + 3000,
  );
  await page.evaluate('__G.debug.speed(1); void 0');
  assert.deepEqual(await page.problems(), []);
});

test('squad=0: the feature does not exist, and asks nothing of the fight', async () => {
  const off = await open(`${PLAY}&response=0&squad=0`);
  try {
    assert.equal(await off.evaluate('__G.wild.feature("squad")'), null);
    await stage(off, 3);
    await off.evaluate('__G.debug.speed(4); void 0');
    await off.evaluate(`(async () => {
      const t0 = __G.mission.time;
      while (__G.mission.time - t0 < 6) await new Promise((r) => requestAnimationFrame(r));
    })()`);
    await off.evaluate('__G.debug.speed(1); void 0');
    assert.deepEqual(await off.problems(), []);
  } finally {
    await off.close();
  }
});

test('with the site answering as well: the machines of a wave that walk into the fight are given posts like the rest', async () => {
  // (18 November 2026, at the merge: the two features were built apart, each with the other switched off)
  const both = await open(PLAY);
  try {
    assert.ok(await both.evaluate('!!__G.wild.feature("squad") && !!__G.wild.feature("response")'));
    const { ids } = await stage(both, 2);
    await both.evaluate('__G.debug.speed(4); void 0');
    // the fight raises the alarm; the alarm brings four more; those that find him join it
    await both.until('__G.wild.feature("response").state().called >= 1', 'the alarm to bring a wave', 60000);
    await both.until(
      `(() => { const posts = Object.keys(__G.wild.feature('squad').state.posts).map(Number); return posts.some((id) => !${JSON.stringify(ids)}.includes(id)); })()`,
      'a machine of the wave to be given a post',
      90000,
    );
    const now = await both.json(`(() => {
      const G = __G, s = G.wild.feature('squad').state;
      const posted = Object.keys(s.posts).map(Number).map((id) => G.enemies.list.find((u) => u.id === id));
      return { engaged: s.engaged, posted: posted.length, waves: posted.filter((u) => u.wave > 0).length, planMs: s.planMs,
        apart: posted.every((a) => posted.every((b) => a === b || Math.hypot(s.posts[a.id].x - s.posts[b.id].x, s.posts[a.id].z - s.posts[b.id].z) >= 2.5)) };
    })()`);
    assert.ok(now.waves >= 1 && now.posted >= 3, JSON.stringify(now));
    assert.equal(now.apart, true, 'no two of them on one post');
    assert.ok(now.planMs < 20, `a plan took ${now.planMs} ms`);
    await both.evaluate('__G.debug.speed(1); void 0');
    assert.deepEqual(await both.problems(), []);
  } finally {
    await both.close();
  }
});

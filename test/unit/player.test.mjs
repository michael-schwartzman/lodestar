// Contract lock: the operator's body — above all the jump, and what can and cannot be climbed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLAYER, createPlayer } from '../../src/player.js';
import { Grid, KIND } from '../../src/world/grid.js';
import { PROPS } from '../../src/world/props.js';
import { buildSite } from '../../src/world/map.js';

const DT = 1 / 120;

/**
 * A 24 × 24 field under open sky, with:
 *   a crate (1.0 m, can be stood on) at 10,10 and a tall crate (2.0 m) beside it at 11,10;
 *   a console (1.15 m, not for standing on) at 10,14; a pole (thin) at 14,14;
 *   a low roof (2.6 m, like a door's lintel) over 4..6 × 4..6;
 *   a room 3.0 m high over 16..19 × 4..7 with a crate at 17,5.
 */
function arena() {
  const g = new Grid(24, 24);
  const put = (x, z, block, stand = 1, thin = 0) => {
    const i = g.index(x, z);
    g.block[i] = block;
    g.stand[i] = stand;
    g.thin[i] = thin;
  };
  put(10, 10, 1.0);
  put(11, 10, 2.0);
  put(10, 14, 1.15, 0);
  put(14, 14, 6, 0, 1);
  for (let z = 4; z <= 6; z++) for (let x = 4; x <= 6; x++) g.ceil[g.index(x, z)] = 2.6;
  for (let z = 4; z <= 7; z++) for (let x = 16; x <= 19; x++) g.ceil[g.index(x, z)] = 3.0;
  put(17, 5, 1.0);
  return { grid: g };
}

const still = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, run: false, crouchToggle: false, jump: false });

/** A player standing at (x, z) facing `yaw` (0 = north, −Z). */
function stand(world, x, z, yaw = 0) {
  const p = createPlayer(world);
  p.reset({ x, z, yaw });
  return p;
}

/**
 * Steps the player for `seconds`. `intent` may be a function of the time so far. Returns what happened on the way.
 */
function run(p, seconds, intent = still()) {
  const log = { top: p.y, landings: [], steps: 0, jumps: 0, air: 0, highestEye: p.eye };
  const frames = Math.round(seconds / DT);
  for (let f = 0; f < frames; f++) {
    const now = typeof intent === 'function' ? intent(f * DT, p) : intent;
    p.update(DT, { ...still(), ...now }, 0);
    log.top = Math.max(log.top, p.y);
    log.highestEye = Math.max(log.highestEye, p.eye);
    if (p.landed > 0) log.landings.push(p.landed);
    if (p.stepped) log.steps++;
    if (p.jumped) log.jumps++;
    if (!p.grounded) log.air += DT;
  }
  return log;
}
/** `intent` for one frame only, at the start. */
const once = (first, rest = {}) => {
  let done = false;
  return () => {
    if (done) return rest;
    done = true;
    return { ...rest, ...first };
  };
};
/**
 * Walks forward until whatever is ahead stops it, then jumps at it, still pushing forward, and stops pushing once
 * standing on something higher than `above`.
 */
function mount(p, above = 0.5) {
  run(p, 1.2, { moveY: 1 });
  return run(p, 0.9, (t, body) => ({ jump: t === 0, moveY: body.grounded && body.y > above ? 0 : 1 }));
}

test('Space takes you off the ground and gravity brings you back: about a metre up, under a second in the air', () => {
  const p = stand(arena(), 12.5, 20.5);
  assert.deepEqual([p.y, p.vy, p.grounded], [0, 0, true]);
  const log = run(p, 1.5, once({ jump: true }));
  assert.ok(log.top >= 1.02 && log.top <= 1.15, `the top of the jump was ${log.top.toFixed(2)} m`);
  assert.ok(log.air >= 0.7 && log.air <= 0.9, `${log.air.toFixed(2)} s in the air`);
  assert.deepEqual([p.y, p.vy, p.grounded], [0, 0, true], 'back on the ground, at rest');
  assert.equal(log.jumps, 1);
  assert.equal(log.landings.length, 1, 'one landing');
  assert.ok(log.landings[0] > 4.5 && log.landings[0] < 6, `landed at ${log.landings[0].toFixed(1)} m/s`);
  assert.ok(log.highestEye > PLAYER.eyeStand + 1, 'the eye goes up with the body');
});

test('the eye is always the feet plus the stance: enemies, the camera and the weapon all read it', () => {
  const p = stand(arena(), 12.5, 20.5);
  let worst = 0;
  run(p, 1.2, (t, body) => {
    if (body.y > 0.2) worst = Math.max(worst, Math.abs(body.eye - body.y - PLAYER.eyeStand));
    return { jump: t === 0 };
  });
  assert.ok(worst < 0.01, `in the air the eye strayed ${worst.toFixed(3)} m from feet + standing height`);
  run(p, 1, once({ crouchToggle: true }));
  assert.ok(Math.abs(p.eye - PLAYER.eyeCrouch) < 0.02, 'crouched on the ground');
});

test('there is no jumping off thin air: a second press on the way up does nothing', () => {
  const p = stand(arena(), 12.5, 20.5);
  const log = run(p, 1.5, (t) => ({ jump: t === 0 || Math.abs(t - 0.3) < DT / 2 }));
  assert.equal(log.jumps, 1);
  assert.ok(log.top <= 1.15);
  assert.equal(log.landings.length, 1);
});

test('a press just before you land is remembered; an old one is not', () => {
  const air = run(stand(arena(), 12.5, 20.5), 1.5, once({ jump: true })).air;
  const early = stand(arena(), 12.5, 20.5);
  // pressed again 0.08 s before touching down: the second jump follows at once
  const a = run(early, 2.2, (t) => ({ jump: t === 0 || Math.abs(t - (air - 0.08)) < DT / 2 }));
  assert.equal(a.jumps, 2, 'a press 80 ms before landing still counts');
  const late = stand(arena(), 12.5, 20.5);
  const b = run(late, 2.2, (t) => ({ jump: t === 0 || Math.abs(t - (air - 0.3)) < DT / 2 }));
  assert.equal(b.jumps, 1, 'a press 300 ms before landing is forgotten');
});

test('jumping stands you up, and there are no footsteps in the air', () => {
  const p = stand(arena(), 12.5, 20.5);
  run(p, 0.6, once({ crouchToggle: true }));
  assert.equal(p.crouched, true);
  const log = run(p, 0.5, once({ jump: true }, { moveY: 1 }));
  assert.equal(p.crouched, false);
  assert.equal(log.jumps, 1);
  assert.equal(log.steps, 0, 'no footfalls while the feet are off the ground');
  assert.equal(p.footNoise, 0, 'and nothing for a guard to hear until you land');
});

test('a running jump carries you forward: between four and six and a half metres', () => {
  const p = stand(arena(), 2.5, 22.5, -Math.PI / 2);
  run(p, 1.2, { moveY: 1, run: true });
  const from = p.x;
  assert.ok(p.speed > 6, `running at ${p.speed.toFixed(1)} m/s`);
  let landedAt = null;
  run(p, 1.2, (t, body) => {
    if (body.landed > 0 && landedAt === null) landedAt = body.x;
    return { moveY: 1, run: true, jump: t === 0 };
  });
  assert.ok(landedAt !== null, 'it landed');
  assert.ok(landedAt - from >= 4 && landedAt - from <= 6.5, `the jump covered ${(landedAt - from).toFixed(1)} m`);
});

test('in the air you keep the speed you left the ground with, and can only nudge it', () => {
  const p = stand(arena(), 2.5, 22.5, -Math.PI / 2);
  run(p, 1.0, { moveY: 1 });
  const speed = p.speed;
  // let go of everything at take-off: most of the speed is still there half-way through the jump
  run(p, 0.4, once({ jump: true }));
  assert.ok(p.speed > speed * 0.7, `${p.speed.toFixed(1)} m/s left of ${speed.toFixed(1)}`);
  // from a standing jump, pushing forward in the air gets you moving — but slowly
  const q = stand(arena(), 2.5, 22.5, -Math.PI / 2);
  run(q, 0.4, once({ jump: true }, { moveY: 1 }));
  assert.ok(q.speed > 0.5 && q.speed < 3.2, `steered up to ${q.speed.toFixed(1)} m/s in 0.4 s of air`);
});

test('a crate stops you on the ground; jump at it and you land on top, a metre up', () => {
  const world = arena();
  const p = stand(world, 10.5, 13.5, 0);
  run(p, 1.5, { moveY: 1 });
  assert.ok(Math.abs(p.z - (11 + PLAYER.radius)) < 0.02, `walking stops at the crate's face: z = ${p.z.toFixed(2)}`);
  assert.equal(p.y, 0);
  const log = mount(p);
  assert.equal(log.landings.length, 1);
  assert.deepEqual([p.y, p.grounded], [1, true], 'standing on the crate');
  assert.ok(p.z < 11 + PLAYER.radius && p.z > 10 - PLAYER.radius, `on top of it: z = ${p.z.toFixed(2)}`);
  assert.ok(Math.abs(p.eye - (1 + PLAYER.eyeStand)) < 0.13, `eye at ${p.eye.toFixed(2)} m`);
  // and it holds you: standing still up there, nothing changes
  run(p, 1, still());
  assert.deepEqual([p.y, p.grounded], [1, true]);
});

test('walk off the edge and you fall back to the ground, with a thump', () => {
  const p = stand(arena(), 10.5, 13.5, 0);
  mount(p);
  assert.equal(p.y, 1);
  const log = run(p, 1.5, { moveY: 1 });
  assert.deepEqual([p.y, p.grounded], [0, true]);
  assert.ok(p.z < 10 - PLAYER.radius, 'on the far side');
  assert.equal(log.jumps, 0);
  assert.equal(log.landings.length, 1);
  assert.ok(log.landings[0] > 3.5, `a metre's fall lands at ${log.landings[0].toFixed(1)} m/s`);
});

test('a two-metre crate is a wall from the ground and a step from the crate beside it', () => {
  const world = arena();
  const ground = stand(world, 11.5, 13.5, 0);
  const a = run(ground, 2.5, (t) => ({ moveY: 1, jump: t < 1.5 && Math.round(t / DT) % 110 === 30 }));
  assert.equal(a.jumps, 2, 'it tried twice');
  assert.equal(ground.y, 0);
  assert.ok(ground.z >= 11 + PLAYER.radius - 0.02, 'never got on top of it from the ground');

  // up onto the low crate first, then turn east and jump again
  const p = stand(world, 10.5, 13.5, 0);
  mount(p);
  assert.equal(p.y, 1);
  p.yaw = -Math.PI / 2;
  run(p, 0.4, { moveY: 1 });
  assert.ok(p.x <= 11 - PLAYER.radius + 0.02 && p.y === 1, 'walking does not get you up the second metre');
  mount(p, 1.5);
  assert.deepEqual([p.y, p.grounded], [2, true], 'standing on the tall crate');
  assert.ok(p.x > 11 - PLAYER.radius);
});

test('things that are not for standing on stop you however high you are', () => {
  const world = arena();
  // a console is 1.15 m: taller than the jump, and its top is not a floor
  const p = stand(world, 10.5, 16.5, 0);
  const log = run(p, 3, (t) => ({ moveY: 1, jump: t < 2.2 && Math.round(t / DT) % 110 === 20 }));
  assert.equal(log.jumps, 3);
  assert.equal(p.y, 0);
  assert.ok(p.z >= 15 + PLAYER.radius - 0.02);
  // a pole: from the crate's height or any other
  const g = world.grid;
  for (const feet of [0, 1, 3, 50]) {
    assert.equal(g.blocked(14, 14, false, feet), true, `the pole at ${feet} m`);
    assert.equal(g.blocked(10, 14, false, feet), true, `the console at ${feet} m`);
  }
});

test('a ceiling stops your head: under a 2.6 m lintel the jump is cut short', () => {
  const p = stand(arena(), 5.5, 5.5);
  const log = run(p, 1.2, once({ jump: true }));
  assert.ok(
    log.top <= 2.6 - PLAYER.height + 1e-6,
    `the feet got ${log.top.toFixed(2)} m up under a ${(2.6).toFixed(1)} m roof`,
  );
  assert.ok(log.top > 0.6, 'but it is still a jump');
  assert.ok(log.highestEye < 2.6 - 0.1, 'the eye never reaches the ceiling');
  assert.deepEqual([p.y, p.grounded], [0, true]);
  assert.ok(log.air < 0.75, 'and you are down sooner');
});

test('in a room three metres high you can get on the crate, but not jump through the roof from it', () => {
  const p = stand(arena(), 17.5, 7.5, 0);
  mount(p);
  assert.deepEqual([p.y, p.grounded], [1, true]);
  const log = run(p, 1.0, once({ jump: true }));
  assert.ok(log.top <= 3.0 - PLAYER.height + 1e-6, `feet at ${log.top.toFixed(2)} m under a 3 m ceiling`);
  assert.deepEqual([p.y, p.grounded], [1, true]);
});

test('down in mid-air, the body still comes to earth', () => {
  const p = stand(arena(), 12.5, 20.5);
  run(p, 0.35, once({ jump: true }));
  assert.ok(p.y > 0.8);
  p.damage(500, 0, 0);
  assert.equal(p.alive, false);
  run(p, 2.5, { jump: true, moveY: 1 });
  assert.equal(p.y, 0);
  assert.ok(p.eye < 0.45, `the view sinks to the floor: ${p.eye.toFixed(2)}`);
});

test('reset puts you back on the ground', () => {
  const p = stand(arena(), 12.5, 20.5);
  run(p, 0.3, once({ jump: true }));
  p.reset({ x: 3.5, z: 3.5, yaw: 1 });
  assert.deepEqual([p.x, p.z, p.yaw, p.y, p.vy, p.grounded, p.eye], [3.5, 3.5, 1, 0, 0, true, PLAYER.eyeStand]);
});

test('the jump clears what it is meant to clear, and no more', () => {
  const top = (PLAYER.jump * PLAYER.jump) / (2 * PLAYER.gravity);
  for (const kind of ['crate', 'barrel', 'barrier', 'desk'])
    assert.ok(PROPS[kind].stand && PROPS[kind].block <= top - 0.03, `${kind} should be an easy jump`);
  for (const kind of ['console', 'cylinder', 'rock', 'generator', 'truck', 'forklift', 'tank', 'transformer'])
    assert.ok(!PROPS[kind].stand, `${kind} is not for standing on`);
  assert.ok(PROPS.crateTall.stand && PROPS.container.stand, 'tall crates and containers have flat tops');
  assert.ok(PROPS.crateTall.block > top + 0.5, 'but neither can be reached from the ground');
});

test('on the real site: the highest thing you can stand on is a container, and nothing lets you over the wire', () => {
  const site = buildSite();
  const g = site.grid;
  let highest = 0;
  let standable = 0;
  for (let z = 0; z < g.h; z++)
    for (let x = 0; x < g.w; x++) {
      const i = g.index(x, z);
      if (g.stand[i]) {
        standable++;
        highest = Math.max(highest, g.block[i]);
        assert.ok(g.block[i] > 0 && !g.thin[i], `cell ${x},${z} is marked for standing on but holds nothing solid`);
        assert.ok(
          g.kind[i] === KIND.GROUND || g.kind[i] === KIND.FLOOR,
          `cell ${x},${z}: only things on open ground or a floor can be stood on`,
        );
      }
      // walls, rock, the wire and shut doors stop a body at any height
      if (g.kind[i] === KIND.WALL || g.kind[i] === KIND.ROCK || g.kind[i] === KIND.FENCE || g.kind[i] === KIND.DOOR)
        assert.equal(g.blocked(x, z, false, 99), true, `cell ${x},${z} can be crossed from above`);
    }
  // (heights on the grid are stored as 32-bit numbers)
  assert.equal(highest, Math.fround(PROPS.container.block));
  assert.ok(standable > 60, `only ${standable} cells can be stood on`);
  // the centrifuges are not furniture
  for (const [x, z] of site.centrifuges) assert.equal(g.stand[g.index(Math.floor(x), Math.floor(z))], 0);
});

// ---------- leaning: Q and E put the head out to one side, and the body stays where it is ----------

const EAST = -Math.PI / 2;

test('upright, the head is where the body is', () => {
  const p = stand(arena(), 12.5, 20.5);
  run(p, 0.5, { moveY: 1 });
  assert.deepEqual([p.headX, p.headZ, p.lean, p.leanK], [p.x, p.z, 0, 0]);
});

test('E leans the head half a metre to the right, Q to the left, and letting go brings it back', () => {
  const p = stand(arena(), 12.5, 20.5, 0);
  run(p, 0.7, { lean: 1 });
  assert.ok(p.lean > 0.97, `leaned ${p.lean.toFixed(2)} of the way`);
  assert.ok(Math.abs(p.headX - (12.5 + PLAYER.lean)) < 0.03, `head at x = ${p.headX.toFixed(2)}`);
  assert.equal(p.headZ, p.z, 'facing north, right is east: nothing changes north–south');
  assert.deepEqual([p.x, p.z], [12.5, 20.5], 'the body has not moved');
  assert.ok(p.leanK > 0.95);

  run(p, 0.9, { lean: -1 });
  assert.ok(Math.abs(p.headX - (12.5 - PLAYER.lean)) < 0.03, `head at x = ${p.headX.toFixed(2)}`);
  assert.ok(p.leanK < -0.95);

  run(p, 0.9, still());
  assert.deepEqual([p.headX, p.headZ, p.lean, p.leanK], [p.x, p.z, 0, 0], 'upright again, exactly');
  assert.ok(PLAYER.lean >= 0.4 && PLAYER.lean <= 0.6);
});

test('right is your right whichever way you face', () => {
  const p = stand(arena(), 12.5, 20.5, EAST);
  run(p, 0.7, { lean: 1 });
  // facing east, your right is south (+Z)
  assert.ok(Math.abs(p.headZ - (20.5 + PLAYER.lean)) < 0.03, `head at z = ${p.headZ.toFixed(2)}`);
  assert.ok(Math.abs(p.headX - 12.5) < 1e-6);
});

test('a wall stops the head: it never goes into one, however long you lean', () => {
  const world = arena();
  const g = world.grid;
  // a wall whose face is at x = 13, half a metre to the right of the body
  for (let z = 18; z <= 22; z++) g.kind[g.index(13, z)] = KIND.WALL;
  const p = stand(world, 12.5, 20.5, 0);
  run(p, 1.0, { lean: 1 });
  assert.ok(p.headX <= 13 - PLAYER.headRadius + 1e-6, `the head got to x = ${p.headX.toFixed(3)}`);
  assert.ok(p.headX > 12.7, 'but it went as far as it could');
  assert.ok(p.leanK > 0.5 && p.leanK < 0.8, `it reached ${p.leanK.toFixed(2)} of a full lean`);
  // the other way is open
  run(p, 1.0, { lean: -1 });
  assert.ok(p.leanK < -0.95);
});

test('the wire and a shut door stop the head too; an open door does not', () => {
  const world = arena();
  const g = world.grid;
  g.kind[g.index(13, 20)] = KIND.FENCE;
  const p = stand(world, 12.5, 20.5, 0);
  run(p, 1.0, { lean: 1 });
  assert.ok(p.headX <= 13 - PLAYER.headRadius + 1e-6, 'the wire');

  const other = arena();
  const door = other.grid.addDoor(13, 20, 13, 20);
  const q = stand(other, 12.5, 20.5, 0);
  run(q, 1.0, { lean: 1 });
  assert.ok(q.headX <= 13 - PLAYER.headRadius + 1e-6, 'a shut door');
  door.open = 1;
  run(q, 0.5, { lean: 1 });
  assert.ok(q.headX > 12.95, 'an open one');
});

test('you can lean out over a crate standing, but not crouched, and never through a tall one', () => {
  // the arena has a crate (1.0 m) at 10,10 and a tall crate (2.0 m) at 11,10
  const over = stand(arena(), 9.5, 10.5, 0);
  run(over, 0.9, { lean: 1 });
  assert.ok(over.leanK > 0.95, 'standing, the head goes over the low crate');

  const low = stand(arena(), 9.5, 10.5, 0);
  run(low, 0.6, once({ crouchToggle: true }));
  run(low, 0.9, { lean: 1 });
  assert.ok(low.headX <= 10 - PLAYER.headRadius + 1e-6, `crouched, the crate is in the way: ${low.headX.toFixed(2)}`);

  const tall = stand(arena(), 12.5, 10.5, 0);
  run(tall, 0.9, { lean: -1 });
  assert.ok(tall.headX >= 12 + PLAYER.headRadius - 1e-6, `the tall crate stops it: ${tall.headX.toFixed(2)}`);
});

test('no leaning on the run or in the air; walking is fine, and the head stays with the body', () => {
  const p = stand(arena(), 2.5, 22.5, EAST);
  run(p, 1.2, { moveY: 1, run: true, lean: 1 });
  assert.equal(p.running, true);
  assert.ok(Math.abs(p.leanK) < 0.05, `leaning ${p.leanK.toFixed(2)} at a run`);

  const q = stand(arena(), 12.5, 20.5, 0);
  run(q, 0.7, { lean: 1 });
  run(q, 0.35, once({ jump: true }, { lean: 1 }));
  assert.equal(q.grounded, false);
  assert.ok(q.leanK < 0.35, `still leaning ${q.leanK.toFixed(2)} in the air`);

  const w = stand(arena(), 2.5, 22.5, EAST);
  let widest = 0;
  run(w, 1.5, (t, body) => {
    widest = Math.max(widest, Math.hypot(body.headX - body.x, body.headZ - body.z));
    return { moveY: 1, lean: 1 };
  });
  assert.ok(w.leanK > 0.95, 'leaning while walking');
  assert.ok(widest <= PLAYER.lean + 1e-6, `the head got ${widest.toFixed(2)} m from the body`);
});

test('down, the body straightens; and reset puts the head back', () => {
  const p = stand(arena(), 12.5, 20.5, 0);
  run(p, 0.7, { lean: 1 });
  p.damage(500, 0, 0);
  run(p, 1.0, { lean: 1 });
  assert.ok(Math.abs(p.leanK) < 0.02);
  const q = stand(arena(), 12.5, 20.5, 0);
  run(q, 0.7, { lean: -1 });
  q.reset({ x: 3.5, z: 3.5, yaw: 0 });
  assert.deepEqual([q.headX, q.headZ, q.lean, q.leanK], [3.5, 3.5, 0, 0]);
});

// ---------- holding a machine in front of you as a shield ----------

test('with a machine held in front of you: slow, upright, and on the ground', () => {
  const p = stand(arena(), 2.5, 22.5, EAST);
  p.holding = true;
  run(p, 1.5, { moveY: 1, run: true });
  assert.equal(p.running, false);
  assert.ok(p.speed <= PLAYER.holdWalk + 0.05, `moving at ${p.speed.toFixed(1)} m/s`);
  assert.ok(p.speed > PLAYER.holdWalk - 0.3);
  assert.ok(PLAYER.holdWalk < PLAYER.walk);
  const log = run(p, 0.8, once({ jump: true, crouchToggle: true }, { lean: 1 }));
  assert.equal(log.jumps, 0, 'no jumping');
  assert.equal(p.crouched, false, 'no crouching');
  assert.ok(Math.abs(p.leanK) < 0.02, 'no leaning');
  p.reset({ x: 3.5, z: 3.5, yaw: 0 });
  assert.equal(p.holding, false, 'and a new start lets go');
});

test('being pushed out of something solid is not speed: put down against a post, you are moved clear and stand there', () => {
  // The pole at 14,14. Put down 0.2 m from its south face the body overlaps it by 0.12 m and is moved out — which
  // used to be read back as 0.12 m in one frame, 14 m/s, and slid you a metre further (found on 12 November 2026:
  // a test that stood the player by the lamp post at the gate saw them slide through the sentry in front of them).
  const p = stand(arena(), 14.5, 15.2, 0);
  run(p, 1);
  assert.ok(
    Math.abs(p.z - (15 + PLAYER.radius)) < 0.01,
    `ended at z = ${p.z.toFixed(2)}: clear of the post, no further`,
  );
  assert.ok(Math.abs(p.x - 14.5) < 0.01);
  assert.equal(Math.hypot(p.vx, p.vz), 0, 'and with no speed');
  // a wall still takes away the speed that runs into it: walking north into the post stops you dead against it
  run(p, 1, { moveY: 1 });
  assert.ok(Math.abs(p.z - (15 + PLAYER.radius)) < 0.01 && p.speed < 0.05);
  assert.ok(Math.abs(p.vz) < 0.05, `still pushing into it at ${p.vz.toFixed(2)} m/s`);
});

test('a body that is carried (the wild branch`s slide sets `slide`) goes where it is carried, whatever is asked of it — and takes no steps', () => {
  // Decision of 16 November 2026: the experiment's slide (src/wild/slide-live.js) is the one thing that carries
  // the body. Nothing in the game sets `slide`: unset, the body is the body it was (every test above).
  const p = stand(arena(), 12.5, 21.5, 0);
  assert.equal(p.slide, null);
  p.slide = { vx: 0, vz: -8 };
  // asked to go east, at a run, and to stand up: it goes north, at eight metres a second
  const log = run(p, 0.25, { moveX: 1, run: true });
  assert.ok(Math.abs(p.x - 12.5) < 1e-6, `it was steered ${(p.x - 12.5).toFixed(3)} m to one side`);
  assert.ok(Math.abs(p.z - 19.5) < 0.02, `it is at z = ${p.z.toFixed(2)}`);
  assert.ok(Math.abs(p.speed - 8) < 0.05);
  assert.equal(log.steps, 0, 'feet that are not under it take no steps');
  // a wall still stops it: carried north into the tall crate's row… (the pole at 14,14, from the south)
  const q = stand(arena(), 14.5, 16.5, 0);
  q.slide = { vx: 0, vz: -8 };
  run(q, 0.5);
  assert.ok(Math.abs(q.z - (15 + PLAYER.radius)) < 0.01 && q.speed < 0.05, `it went through to z = ${q.z.toFixed(2)}`);
  // let go, it is its own again — and a new start lets go
  p.slide = null;
  run(p, 0.6, { moveX: 1 });
  assert.ok(p.x > 13.5, 'it does what is asked again');
  p.slide = { vx: 3, vz: 0 };
  p.reset({ x: 3.5, z: 3.5, yaw: 0 });
  assert.equal(p.slide, null);
});

// The guard machines in the world: what each one senses, where it walks, when it shoots, how it falls.
// What it THINKS lives in ai.js; this file feeds that brain and carries out what it decides.
import * as THREE from 'three';
import { AI, createBrain, think, kill, hold, letGo, createAlarm, raiseAlarm, sightAlarm, stepAlarm } from './ai.js';
import { exposure, noticed } from './sight.js';
import { moveBody, pushOut } from '../world/collide.js';
import { garrison } from '../world/map.js';
import { DIFFICULTY, difficultyOf } from '../difficulty.js';
import { glow, ownMaterials, setProbe } from '../gfx/materials.js';
import { Billboards } from '../gfx/billboards.js';
import { isMetal } from '../gfx/fx.js';
import { angleDelta, turnTowards, yawTo, clamp, damp, lerp } from '../core/math.js';
import { FAR, LIGHT, lightShare, lightSize, strobe } from './lights.js';
import { WAVE } from './wave.js';
import { BODY, seesBody, stepBody, findable, haul, middleOf } from './bodies.js';

export { DIFFICULTY };

const SPEC = {
  sentry: {
    hp: 100,
    radius: 0.38,
    eye: 1.72,
    view: 36,
    cone: 0.96,
    walk: 1.4,
    hurry: 2.5,
    run: 3.6,
    turn: 3.4,
    damage: 8,
    burst: 3,
    gap: 0.11,
    rest: [0.9, 1.5],
    windup: 0.65,
    flying: false,
    // hit volumes: [height, radius, damage multiplier, name]
    hit: [
      [1.74, 0.2, 3, 'head'],
      [1.26, 0.36, 1, 'body'],
      [0.74, 0.31, 0.75, 'legs'],
      [0.28, 0.24, 0.75, 'legs'],
    ],
  },
  drone: {
    hp: 55,
    radius: 0.42,
    eye: 0,
    view: 32,
    cone: 1.15,
    walk: 2.3,
    hurry: 3.8,
    run: 5.4,
    turn: 5.5,
    damage: 4,
    burst: 2,
    gap: 0.09,
    rest: [0.7, 1.2],
    windup: 0.45,
    flying: true,
    hit: [[0, 0.46, 1, 'body']],
  },
};

const EYE = {
  [AI.PATROL]: [1.0, 0.62, 0.16, 1.1],
  [AI.SUSPICIOUS]: [1.0, 0.92, 0.5, 2.4],
  [AI.INVESTIGATE]: [1.0, 0.72, 0.22, 1.9],
  [AI.SEARCH]: [1.0, 0.45, 0.12, 2.0],
  [AI.COMBAT]: [1.0, 0.1, 0.06, 3.0],
  [AI.HELD]: [0.55, 0.8, 1.0, 1.5],
};
/** how brightly a drone's running lights are drawn: its eye, as many times its eye's own strength; its strobe */
const EYE_SHINE = 1.6;
const STROBE_SHINE = 2.6;
/** …and how far in front of the drone, towards the eye, they are drawn (metres): clear of its own body */
const LIGHT_PROUD = 0.5;

/**
 * A machine held as a shield: where it is carried, how wide an arc in front of the player it covers, how long it
 * reels when let go — and how near the eye it may be DRAWN, however little room there is to hold it out.
 */
const SHIELD = { ahead: 0.72, left: 0.26, arc: 1.13, stun: 1.5, near: 0.62 };

const rnd = (a, b) => a + Math.random() * (b - a);
const tint = new THREE.Color();
const v3 = new THREE.Vector3();
const hitOut = {};

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object} o.world       from buildWorld()
 * @param {object} o.models      { buildSentry, buildDrone }
 * @param {object} o.fx
 * @param {object} o.audio
 * @param {Record<string, THREE.Texture>} [o.textures]  `blob` is drawn under each walker
 * @param {object} o.hooks       kill(unit, { silent }), alarm(on), spotted(unit), suspicious(unit), playerHit(unit),
 *   and — the second look only — casts(x, z): something standing there throws a shadow that may be seen,
 *                               shield(unit, why) — the machine held as a shield is no longer held:
 *                               why = 'destroyed' | 'broke-free';
 *                               found(body, by) — a machine has found a fallen one, and raised the alarm for it;
 *                               dragged(why) — the fallen machine being dragged was let go of by itself:
 *                               why = 'snagged';
 *                               and — the experiment only (src/wild) — turned(unit, dt, inner), foe(unit, dt, inner),
 *                               alarmAt(unit): see `inner`, below
 */
export function createEnemies({ scene, world, models, fx, audio, textures, hooks }) {
  const grid = world.grid;
  const list = [];
  const alarm = createAlarm();
  /** the machine the player is holding in front of them as a shield, or null */
  let held = null;
  /** the fallen machine the player is dragging (enemies/bodies.js), or null; and when the wrecks are next looked for */
  let dragged = null;
  let bodyT = 0;
  /** how often the machines look about them for fallen ones, in seconds: as often as they look for the player */
  const BODY_TICK = 0.1;
  const watcher = { x: 0, z: 0, eye: 0, facing: 0, cone: 0 };
  const clearLine = (ax, ay, az, bx, by, bz) => grid.sight(ax, ay, az, bx, by, bz);

  // a soft dark patch under every walker, so that it stands on the ground instead of floating over it
  const SHADOWS = 48;
  let shadows = null;
  if (textures?.blob) {
    const material = glow({ color: 0x000000, map: textures.blob, transparent: true, opacity: 0.55 });
    material.depthWrite = false;
    shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), material, SHADOWS);
    shadows.frustumCulled = false;
    shadows.count = 0;
    shadows.renderOrder = 4;
    scene.add(shadows);
  }
  const shadowMatrix = new THREE.Matrix4();
  // a drone's running lights (enemies/lights.js): two flat pictures to a drone, its eye and its strobe — written
  // every frame from where the drone IS, for every drone the eye has a clear line to
  const LIGHTS = 24;
  let lights = null;
  if (textures?.flare) {
    lights = new Billboards({ capacity: LIGHTS, map: textures.flare, fogFloor: LIGHT.fogFloor });
    lights.mesh.name = 'drone lights';
    scene.add(lights.mesh);
  }
  let difficulty = DIFFICULTY.operator;
  let pingT = 0;
  let pingX = 0;
  let pingZ = 0;
  let clock = 0;
  let nextId = 0;

  function make(type, rollId, x, z, yaw, route, loop, name = '') {
    const spec = SPEC[type];
    const model = type === 'sentry' ? models.buildSentry() : models.buildDrone();
    model.root.rotation.order = 'YXZ';
    scene.add(model.root);
    const unit = {
      id: nextId++,
      type,
      spec,
      /** what the map calls it ('gate', 'droneYard', …); '' for a pursuer */
      name,
      /** its place on the mission's roll, or -1 for a pursuer */
      rollId,
      x: x + 0.5,
      z: z + 0.5,
      y: type === 'drone' ? 2.8 : 0,
      yaw,
      postYaw: yaw,
      hp: spec.hp * difficulty.health,
      hpMax: spec.hp * difficulty.health,
      /** seconds it is still reeling after being let go — or stopped by an EMP */
      stunT: 0,
      /** seconds left of an EMP's hold on it (part of stunT), where that EMP went off, and when it next sparks */
      empT: 0,
      empX: 0,
      empZ: 0,
      sparkT: 0,
      /** how much of the player it could see when it last looked: 1 the body, less for a head leaned out */
      exposed: 1,
      brain: createBrain(),
      route,
      loop,
      routeI: 0,
      routeDir: 1,
      waitT: rnd(0, 2),
      path: null,
      pathI: 0,
      goalX: -1,
      goalZ: -1,
      replanT: 0,
      stuckT: 0,
      speed: 0,
      arrived: false,
      sees: false,
      gain: 0,
      dist: 999,
      senseT: rnd(0, 0.1),
      cullT: 0,
      inSight: false,
      heard: null,
      heardP: { x: 0, z: 0 },
      hit: null,
      hitP: { x: 0, z: 0 },
      ping: null,
      pingP: { x: 0, z: 0 },
      aimT: 0,
      aimBlend: 0,
      fireT: rnd(0.2, 0.8),
      burstLeft: 0,
      moveT: 0,
      side: null,
      orbit: rnd(0, 6.28),
      orbitDir: Math.random() < 0.5 ? -1 : 1,
      walkPhase: rnd(0, 6),
      scanT: rnd(0, 20),
      headYaw: 0,
      flinch: 0,
      dead: false,
      deathT: 0,
      fallV: 0,
      model,
      parts: model.parts,
      mats: ownMaterials(model.root),
      eyeMat: model.parts.eye?.material || null,
      hipsY: model.parts.hips?.position.y ?? 0,
      hum: null,
    };
    if (type === 'drone')
      unit.hum = audio.loop('droneFly', { x: unit.x, y: unit.y, z: unit.z, gain: 0.45, rate: rnd(0.92, 1.08) });
    place(unit);
    list.push(unit);
    return unit;
  }

  function place(unit) {
    unit.model.root.position.set(unit.x, unit.y, unit.z);
    unit.model.root.rotation.y = unit.yaw;
  }

  function dispose(unit) {
    unit.hum?.stop(0);
    scene.remove(unit.model.root);
    unit.model.root.traverse((node) => node.geometry?.dispose());
    for (const m of [...unit.mats.lit, ...unit.mats.glow]) m.dispose();
  }

  // ---------- sensing ----------
  function sense(unit, player, vis) {
    const spec = unit.spec;
    const dx = player.x - unit.x;
    const dz = player.z - unit.z;
    const d = Math.hypot(dx, dz);
    unit.dist = d;
    unit.sees = false;
    unit.gain = 0;
    // `hidden` is a switch for tests: the player cannot be seen at all
    if (!player.alive || player.hidden) return;
    const alert = unit.brain.state === AI.COMBAT || unit.brain.state === AI.SEARCH;
    const view = spec.view * (alert ? 1.3 : 1);
    if (d > view) return;
    const off = Math.abs(angleDelta(unit.yaw + unit.headYaw, yawTo(unit.x, unit.z, player.x, player.z)));
    const cone = alert ? 2.0 : spec.cone;
    if (off > cone && d > 1.6) return;
    const eyeY = unit.type === 'drone' ? unit.y : spec.eye;
    // all of the player, only a head leaned out round a corner, or nothing (sight.js)
    const seen = exposure(grid, unit.x, eyeY, unit.z, player);
    if (!seen) return;
    unit.sees = true;
    unit.exposed = seen;
    const near = 1 - d / view;
    let gain = 0.22 + 2.7 * near * near;
    gain *= seen;
    gain *= noticed(vis);
    gain *= player.crouched ? 0.55 : 1;
    gain *= player.speed < 0.5 ? 0.75 : player.running ? 1.5 : 1;
    gain *= 1 - 0.4 * Math.min(1, off / cone);
    gain *= difficulty.gain * (alarm.active ? 1.6 : 1);
    if (d < 2.6) gain *= 3.5;
    unit.gain = gain;
  }

  // ---------- moving ----------
  /**
   * Walks (or flies) towards a point. Returns true once there — or once it is plain it can get no nearer.
   * @param {number | null} faceYaw keep facing this way while moving (a fighting unit side-stepping); null = face ahead
   */
  function goTo(unit, gx, gz, speed, dt, faceYaw = null) {
    const spec = unit.spec;
    const cx = Math.floor(gx);
    const cz = Math.floor(gz);
    unit.replanT -= dt;
    const changed = cx !== unit.goalX || cz !== unit.goalZ;
    if (unit.replanT <= 0 && (changed || unit.stuckT > 1.2)) {
      unit.goalX = cx;
      unit.goalZ = cz;
      unit.replanT = 0.25;
      unit.stuckT = 0;
      unit.path = grid.path(Math.floor(unit.x), Math.floor(unit.z), cx, cz, spec.flying);
      unit.pathI = 0;
    } else if (changed) {
      // the route in hand leads somewhere else, and it is too soon to plan again: wait a moment for the new one
      unit.speed = 0;
      return false;
    }
    if (!unit.path) {
      // no way there: look towards it from here, and say "arrived" so that the brain's clocks can run
      unit.speed = 0;
      if (faceYaw === null) unit.yaw = turnTowards(unit.yaw, yawTo(unit.x, unit.z, gx, gz), spec.turn * dt);
      return true;
    }
    const path = unit.path;
    while (unit.pathI < path.length - 2 && Math.hypot(path[unit.pathI] - unit.x, path[unit.pathI + 1] - unit.z) < 0.5)
      unit.pathI += 2;
    // cut the corners a grid route has, wherever the straight line is clear
    for (let k = 1; k <= 3; k++) {
      const ni = unit.pathI + 2;
      if (ni >= path.length) break;
      if (!grid.clearWalk(unit.x, unit.z, path[ni], path[ni + 1], spec.radius, spec.flying)) break;
      unit.pathI = ni;
    }
    const tx = path[unit.pathI];
    const tz = path[unit.pathI + 1];
    const dx = tx - unit.x;
    const dz = tz - unit.z;
    const d = Math.hypot(dx, dz);
    if (unit.pathI >= path.length - 2 && d < 0.4) {
      unit.speed = 0;
      return true;
    }
    let pace = speed;
    if (faceYaw === null) {
      const want = yawTo(unit.x, unit.z, tx, tz);
      unit.yaw = turnTowards(unit.yaw, want, spec.turn * dt);
      // a walker turns before it strides off
      if (!spec.flying && Math.abs(angleDelta(unit.yaw, want)) > 1.1) pace *= 0.2;
    }
    const step = Math.min(d, pace * dt);
    const bx = unit.x;
    const bz = unit.z;
    if (d > 1e-4) moveBody(grid, unit, (dx / d) * step, (dz / d) * step, spec.radius, spec.flying);
    const moved = Math.hypot(unit.x - bx, unit.z - bz);
    unit.speed = dt > 0 ? moved / dt : 0;
    unit.stuckT = moved < step * 0.3 ? unit.stuckT + dt : 0;
    return false;
  }

  function nextPost(unit) {
    const n = unit.route.length;
    if (unit.loop) unit.routeI = (unit.routeI + 1) % n;
    else {
      if (unit.routeI + unit.routeDir < 0 || unit.routeI + unit.routeDir >= n) unit.routeDir = -unit.routeDir;
      unit.routeI += unit.routeDir;
    }
  }

  // ---------- shooting ----------
  function shoot(unit, player, vis) {
    const spec = unit.spec;
    if (unit.parts.muzzle) unit.parts.muzzle.getWorldPosition(v3);
    else v3.set(unit.x, unit.type === 'drone' ? unit.y : 1.4, unit.z);
    const mx = v3.x;
    const my = v3.y;
    const mz = v3.z;
    let tx = player.x;
    let ty = player.eye - 0.32;
    let tz = player.z;
    const d = Math.max(0.5, unit.dist);

    let chance = 0.55 * difficulty.aim * lerp(1, 0.36, clamp((d - 8) / 28, 0, 1));
    chance *= player.running ? 0.6 : player.speed > 1.5 ? 0.8 : 1;
    chance *= player.crouched ? 0.8 : 1;
    chance *= 0.55 + 0.45 * vis;
    if (unit.type === 'drone') chance *= 0.9;
    // only a head leaned out round a corner: half the target, and that is where the round goes
    if (unit.exposed < 1) {
      chance *= 0.5;
      tx = player.headX ?? player.x;
      ty = player.eye - 0.1;
      tz = player.headZ ?? player.z;
    }

    const hit = Math.random() < chance;
    // a machine held in front of the player takes what comes from in front
    const shield =
      hit &&
      held &&
      !held.dead &&
      Math.abs(angleDelta(player.yaw, yawTo(player.x, player.z, unit.x, unit.z))) < SHIELD.arc;
    if (shield) {
      tx = held.x;
      ty = 1.3;
      tz = held.z;
    } else if (hit) {
      player.damage(spec.damage * difficulty.damage, unit.x, unit.z);
      hooks.playerHit?.(unit);
    } else {
      // a miss goes past the player and into whatever is behind
      const side = rnd(0.45, 1.3) * (Math.random() < 0.5 ? -1 : 1);
      const px = -(tz - mz) / d;
      const pz = (tx - mx) / d;
      tx += px * side;
      tz += pz * side;
      ty += rnd(-0.5, 0.5);
    }
    let dx = tx - mx;
    let dy = ty - my;
    let dz = tz - mz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    let ex = tx;
    let ey = ty;
    let ez = tz;
    if (!hit && grid.raycast(mx, my, mz, dx, dy, dz, 90, hitOut)) {
      ex = hitOut.x;
      ey = hitOut.y;
      ez = hitOut.z;
      fx.impact(ex, ey, ez, hitOut.nx, hitOut.ny, hitOut.nz, hitOut.what);
      if (Math.hypot(ex - player.x, ez - player.z) < 6)
        audio.play(isMetal(hitOut.what) ? 'hitMetal' : 'hitWall', { x: ex, y: ey, z: ez, gain: 0.7 });
    }
    fx.muzzle(mx, my, mz, dx, dy, dz, unit.type);
    fx.tracer(mx, my, mz, ex, ey, ez, unit.type);
    audio.play(unit.type === 'drone' ? 'shotDrone' : 'shotSentry', { x: mx, y: my, z: mz });
    hooks.fired?.(unit, { hit });
    if (shield) {
      // the round that would have found the player finds the machine in front of them instead
      fx.impact(ex, ey, ez, -dx, -dy, -dz, 'machine');
      audio.play('hitMachine', { x: ex, y: ey, z: ez });
      api.damage(held, spec.damage * difficulty.damage, unit.x, unit.z);
    }
  }

  /**
   * Only so many machines may be firing at once, however many have you in their sights: the rest hold their fire
   * and keep closing in. Without this, being seen by the whole yard is over in a second and there is nothing to
   * play. A burst takes a turn; the turn is handed back a little after the burst ends.
   */
  const turns = [];
  function fireControl(unit, dt, player, vis, facing) {
    const spec = unit.spec;
    unit.fireT -= dt;
    if (unit.aimT < spec.windup || !facing || unit.fireT > 0) return;
    if (unit.burstLeft <= 0) {
      let taken = 0;
      for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i] <= clock) turns.splice(i, 1);
        else taken++;
      }
      if (taken >= difficulty.shooters) {
        unit.fireT = rnd(0.15, 0.35);
        return;
      }
      turns.push(clock + spec.burst * spec.gap + 0.55);
      unit.burstLeft = spec.burst;
    }
    shoot(unit, player, vis);
    unit.burstLeft--;
    unit.fireT = unit.burstLeft > 0 ? spec.gap : rnd(spec.rest[0], spec.rest[1]);
  }

  // ---------- dying ----------
  function die(unit, silent = false) {
    if (unit.dead) return;
    kill(unit.brain);
    unit.dead = true;
    unit.deathT = 0;
    unit.speed = 0;
    // A wreck is something the others can find (enemies/bodies.js) — unless the site already knows it is under
    // attack: one that goes down while the alarm is sounding is no news to anybody.
    unit.found = alarm.active;
    unit.noticeT = 0;
    unit.hum?.stop(0.3);
    unit.hum = null;
    // a shield that is shut down or shot to pieces is a shield no longer
    const wasHeld = unit === held;
    if (wasHeld) held = null;
    const y = unit.type === 'drone' ? unit.y : 1.2;
    fx.breakdown(unit.x, y, unit.z);
    audio.play(silent ? 'takedown' : unit.type === 'drone' ? 'droneDown' : 'sentryDown', { x: unit.x, y, z: unit.z });
    if (!silent)
      for (const other of list) {
        // a machine that sees another go down comes to look
        if (other.dead || other === unit) continue;
        const d = Math.hypot(other.x - unit.x, other.z - unit.z);
        if (d < 14 && grid.sight(other.x, 1.6, other.z, unit.x, 1.2, unit.z)) hear(other, unit.x, unit.z);
      }
    hooks.kill?.(unit, { silent });
    if (wasHeld && !silent) hooks.shield?.(unit, 'destroyed');
  }

  function hear(unit, x, z) {
    unit.heardP.x = x;
    unit.heardP.z = z;
    unit.heard = unit.heardP;
  }

  function pingAll() {
    pingT = 3;
    pingX = alarm.x;
    pingZ = alarm.z;
    for (const unit of list) {
      if (unit.dead || unit.brain.state === AI.COMBAT) continue;
      unit.pingP.x = alarm.x + rnd(-3, 3);
      unit.pingP.z = alarm.z + rnd(-3, 3);
      unit.ping = unit.pingP;
    }
  }

  // ---------- the fallen (enemies/bodies.js) ----------
  /**
   * Every machine that can see looks about it for fallen ones. One that has a wreck in sight for a second has
   * found it: if the alarm is not sounding it is raised, at the wreck — and that is a machine's alarm, which
   * counts. (One found while it is sounding is no news: it is only struck off.)
   */
  function lookForBodies(dt) {
    for (const body of list) {
      if (!findable(body)) continue;
      const light = world.visibility(body.x, body.z);
      let by = null;
      for (const unit of list) {
        if (unit.dead || unit === held || unit.stunT > 0 || unit.turned) continue;
        const alert = unit.brain.state === AI.COMBAT || unit.brain.state === AI.SEARCH;
        watcher.x = unit.x;
        watcher.z = unit.z;
        watcher.eye = unit.spec.flying ? unit.y : unit.spec.eye;
        watcher.facing = unit.yaw + unit.headYaw;
        watcher.cone = alert ? 2.0 : unit.spec.cone;
        if (seesBody(watcher, body, light, clearLine, difficulty.bodies)) {
          by = unit;
          break;
        }
      }
      if (!stepBody(body, by !== null, dt) || alarm.active) continue;
      raiseAlarm(alarm, body.x, body.z);
      audio.play('sentryAlert', { x: by.x, y: 1.6, z: by.z });
      hooks.alarm?.(true);
      hooks.found?.(body, by);
      pingAll();
    }
  }

  // ---------- one unit, one frame ----------
  const percept = {
    sees: false,
    gain: 0,
    x: 0,
    z: 0,
    heard: null,
    hit: null,
    alarm: null,
    alarmActive: false,
    arrived: false,
  };

  /**
   * A machine held as a shield goes where the player goes: a little ahead and to the left, facing the way they
   * face, and never pushed into anything solid. Its brain senses nothing; only the clock of the hold runs.
   */
  function carry(unit, player, dt) {
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    // forward is (−sin, −cos); left of that is (−cos, sin)
    let dx = -sin * SHIELD.ahead - cos * SHIELD.left;
    let dz = -cos * SHIELD.ahead + sin * SHIELD.left;
    const want = Math.hypot(dx, dz);
    dx /= want;
    dz /= want;
    const got = grid.reach(player.x, player.z, 1, dx, dz, want, 0.28);
    unit.x = player.x + dx * got;
    unit.z = player.z + dz * got;
    // With a wall an arm's length ahead there is no room to hold it out. It stands where it can — but it is drawn
    // at arm's length all the same, into the wall: better that than the eye inside the machine.
    const show = Math.max(got, SHIELD.near);
    unit.shownX = player.x + dx * show;
    unit.shownZ = player.z + dz * show;
    unit.yaw = player.yaw;
    unit.speed = 0;
    unit.sees = false;
    unit.gain = 0;
    unit.dist = got;
    unit.path = null;
    unit.goalX = -1;
    unit.heard = unit.hit = unit.ping = null;
    unit.aimBlend = damp(unit.aimBlend, 0, 7, dt);
    unit.headYaw = damp(unit.headYaw, Math.sin(clock * 7 + unit.id) * 0.5, 6, dt);
    unit.flinch = Math.max(unit.flinch - dt * 4, 0.12 + 0.12 * Math.sin(clock * 11));
    percept.sees = false;
    percept.gain = 0;
    percept.x = player.x;
    percept.z = player.z;
    percept.heard = percept.hit = percept.alarm = null;
    percept.alarmActive = alarm.active;
    percept.arrived = false;
    const events = think(unit.brain, percept, dt);
    if (events.length && events[0] === 'broke-free') {
      held = null;
      unit.stunT = 0.5;
      unit.aimT = 0;
      unit.burstLeft = 0;
      pushOut(grid, unit, unit.spec.radius);
      audio.play('sentryAlert', { x: unit.x, y: 1.6, z: unit.z });
      hooks.shield?.(unit, 'broke-free');
    }
  }

  /**
   * What the experiment (src/wild) is lent to run a machine it has turned, or to have a loyal one fight it: the
   * walking, the dying and the hearing that are otherwise this file's own. It is handed to `hooks.turned` and
   * `hooks.foe`, and nothing else has it.
   *
   * The other half of that contract is three things on a machine that only the experiment sets — each does
   * nothing while it is unset:
   *   unit.turned    seconds left of being the player's: it is not stepped here but handed to `hooks.turned`,
   *                  it finds no wrecks, and it cannot be taken down by hand
   *   unit.piloted   it is being flown by the player: it is not drawn (the eye is inside it)
   *   unit.carried   something else says how high a drone is: its own flying does not put it back
   * To MOVE a machine from outside: keep `unit.stunT` above nought (it then does nothing of its own, step()
   * returns before it walks) and write x and z through world/collide.js `moveBody`, which never puts it in a wall.
   * To STOP one: `stun()` below, the EMP's own — after which `empX`, `empZ` may be rewritten, to say where what
   * stopped it came from (it looks there when it comes round).
   */
  const inner = { goTo, die, hear };

  function step(unit, dt, player, vis) {
    const spec = unit.spec;
    const brain = unit.brain;
    if (unit === held) {
      carry(unit, player, dt);
      return;
    }
    if (unit.stunT > 0) {
      // just let go, just broken free, or stopped by an EMP: it can do nothing until that has passed
      unit.stunT -= dt;
      unit.speed = 0;
      unit.heard = unit.hit = unit.ping = null;
      unit.flinch = Math.max(unit.flinch, 0.5);
      if (unit.empT > 0) {
        unit.empT -= dt;
        // it is seen to be stopped: it spits sparks while it is
        unit.sparkT -= dt;
        if (unit.sparkT <= 0) {
          unit.sparkT = 0.22 + Math.random() * 0.2;
          fx.sparks(unit.x, spec.flying ? unit.y : 1.3, unit.z, 0, 1, 0, 4, 0.55, 0.85, 1, 3);
        }
        // and when it comes round, the first thing it does is go and look at where that came from
        if (unit.stunT <= 0 || unit.empT <= 0) {
          unit.empT = 0;
          hear(unit, unit.empX, unit.empZ);
        }
      }
      return;
    }
    // a machine the player has turned (the experiment) does not think for itself: it is run from there
    if (unit.turned) {
      hooks.turned(unit, dt, inner);
      return;
    }
    unit.senseT -= dt;
    if (unit.senseT <= 0) {
      unit.senseT = 0.1;
      sense(unit, player, vis);
    }

    percept.sees = unit.sees;
    percept.gain = unit.gain;
    percept.x = player.x;
    percept.z = player.z;
    percept.heard = unit.heard;
    percept.hit = unit.hit;
    percept.alarm = unit.ping;
    percept.alarmActive = alarm.active;
    percept.arrived = unit.arrived;
    const before = brain.state;
    const events = think(brain, percept, dt);
    unit.heard = null;
    unit.hit = null;
    unit.ping = null;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event === 'spotted') {
        audio.play('sentryAlert', { x: unit.x, y: 1.6, z: unit.z });
        // `provoked`: it turned on you because you hit it, not because it found you
        hooks.spotted?.(unit, { provoked: percept.hit !== null });
      } else if (event === 'suspicious' || event === 'investigate') {
        audio.play('sentrySuspicious', { x: unit.x, y: 1.6, z: unit.z });
        hooks.suspicious?.(unit);
      } else if (event === 'lost') audio.play('sentryLost', { x: unit.x, y: 1.6, z: unit.z });
      else if (event === 'alarm') {
        // (the experiment: a machine that has been fighting one the player turned, and never saw the player,
        // names where THAT is — `hooks.alarmAt` says nothing otherwise, and then it is the player, as always)
        const at = hooks.alarmAt?.(unit) || player;
        if (raiseAlarm(alarm, at.x, at.z)) hooks.alarm?.(true);
        pingAll();
      }
    }
    if (brain.state !== before) {
      unit.arrived = false;
      unit.side = null;
      unit.moveT = 0;
      unit.goalX = -1;
      if (brain.state === AI.COMBAT) {
        unit.aimT = 0;
        unit.burstLeft = 0;
      }
    }

    const toTarget = yawTo(unit.x, unit.z, brain.targetX, brain.targetZ);
    unit.scanT += dt;
    let aim = 0.12;
    let head = 0;

    switch (brain.state) {
      case AI.PATROL: {
        if (unit.route.length === 1) {
          const [px, pz] = unit.route[0];
          if (Math.hypot(px + 0.5 - unit.x, pz + 0.5 - unit.z) > 0.8) goTo(unit, px + 0.5, pz + 0.5, spec.walk, dt);
          else {
            unit.speed = 0;
            unit.yaw = turnTowards(unit.yaw, unit.postYaw + Math.sin(unit.scanT * 0.45) * 0.7, spec.turn * 0.35 * dt);
          }
        } else if (unit.waitT > 0) {
          unit.waitT -= dt;
          unit.speed = 0;
          head = Math.sin(unit.scanT * 1.3) * 0.7;
        } else {
          const [px, pz] = unit.route[unit.routeI];
          if (goTo(unit, px + 0.5, pz + 0.5, spec.walk, dt)) {
            unit.waitT = rnd(1.2, 3);
            nextPost(unit);
          }
        }
        head += Math.sin(unit.scanT * 0.8) * 0.35;
        break;
      }
      case AI.SUSPICIOUS:
        unit.speed = 0;
        unit.yaw = turnTowards(unit.yaw, toTarget, spec.turn * dt);
        aim = 0.5;
        break;
      case AI.INVESTIGATE: {
        const there = goTo(unit, brain.targetX, brain.targetZ, spec.hurry, dt);
        unit.arrived = there || Math.hypot(brain.targetX - unit.x, brain.targetZ - unit.z) < 1.6;
        if (unit.arrived) {
          unit.speed = 0;
          unit.yaw += Math.sin(unit.scanT * 1.1) * dt * 1.2;
        }
        head = Math.sin(unit.scanT * 1.7) * 0.6;
        aim = 0.55;
        break;
      }
      case AI.SEARCH: {
        if (!unit.arrived) unit.arrived = goTo(unit, brain.targetX, brain.targetZ, spec.hurry, dt);
        else {
          unit.moveT -= dt;
          if (unit.moveT <= 0) {
            unit.moveT = rnd(2.5, 4.5);
            const spot = grid.nearestWalkable(
              Math.floor(brain.targetX + rnd(-7, 7)),
              Math.floor(brain.targetZ + rnd(-7, 7)),
              spec.flying,
              3,
            );
            unit.side = spot ? [spot[0] + 0.5, spot[1] + 0.5] : null;
          }
          if (unit.side) {
            if (goTo(unit, unit.side[0], unit.side[1], spec.walk * 1.3, dt)) unit.side = null;
          } else {
            unit.speed = 0;
            unit.yaw += dt * 0.9;
          }
        }
        head = Math.sin(unit.scanT * 1.9) * 0.7;
        aim = 0.6;
        break;
      }
      case AI.COMBAT: {
        aim = 1;
        const toPlayer = yawTo(unit.x, unit.z, player.x, player.z);
        if (unit.sees) {
          unit.yaw = turnTowards(unit.yaw, toPlayer, spec.turn * 1.5 * dt);
          unit.aimT += dt;
          unit.moveT -= dt;
          if (hooks.squad?.(unit, dt, inner)) {
            // the wild build has given it its place in the fight (src/wild/squad.js), and moved it there
          } else if (unit.type === 'drone') {
            unit.orbit += dt * unit.orbitDir * 0.5;
            goTo(
              unit,
              player.x + Math.cos(unit.orbit) * 8,
              player.z + Math.sin(unit.orbit) * 8,
              spec.run,
              dt,
              toPlayer,
            );
            if (unit.stuckT > 0.6) unit.orbitDir = -unit.orbitDir;
          } else if (unit.dist > 17) {
            goTo(unit, player.x, player.z, spec.run, dt, toPlayer);
          } else if (unit.dist < 4.5) {
            const away = Math.max(0.1, unit.dist);
            goTo(
              unit,
              unit.x + ((unit.x - player.x) / away) * 4,
              unit.z + ((unit.z - player.z) / away) * 4,
              spec.hurry,
              dt,
              toPlayer,
            );
          } else {
            if (unit.moveT <= 0) {
              unit.moveT = rnd(1.8, 3.4);
              const side = (Math.random() < 0.5 ? -1 : 1) * rnd(2, 4);
              const sx = unit.x + Math.cos(toPlayer) * side;
              const sz = unit.z - Math.sin(toPlayer) * side;
              const fits =
                grid.walkable(Math.floor(sx), Math.floor(sz)) &&
                grid.sight(sx, spec.eye, sz, player.x, player.eye, player.z);
              unit.side = fits && Math.random() < 0.7 ? [sx, sz] : null;
            }
            if (unit.side) {
              if (goTo(unit, unit.side[0], unit.side[1], spec.hurry, dt, toPlayer)) unit.side = null;
            } else unit.speed = 0;
          }
          fireControl(unit, dt, player, vis, Math.abs(angleDelta(unit.yaw, toPlayer)) < 0.25);
        } else if (!hooks.foe?.(unit, dt, inner)) {
          // (…unless the experiment has found it a turned machine to fight instead: `hooks.foe` says so)
          unit.aimT = Math.max(0, unit.aimT - dt * 0.5);
          // (…or the wild build has a better place for it to go than where the player was last known to be)
          if (!hooks.squad?.(unit, dt, inner) && goTo(unit, brain.targetX, brain.targetZ, spec.run, dt))
            unit.yaw += dt * 1.2;
        }
        break;
      }
    }

    unit.headYaw = damp(unit.headYaw, head, 5, dt);
    unit.aimBlend = damp(unit.aimBlend, aim, 7, dt);
    unit.flinch = Math.max(0, unit.flinch - dt * 4);
  }

  // ---------- how it looks ----------
  /**
   * Is any of this unit in the camera's line of sight? Asked a few times a second per unit, so that machines behind
   * walls — most of them, most of the time — cost nothing to draw. Three lines are tried (middle and both sides),
   * which is enough for a unit half round a corner not to pop in late.
   */
  function inSight(unit, camera) {
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const ix = Math.floor(unit.x);
    const iz = Math.floor(unit.z);
    // looking down from above the roof: whatever is under a ceiling is hidden by it
    if (grid.inside(ix, iz)) {
      const ceil = grid.ceil[iz * grid.w + ix];
      if (ceil > 0 && cy > ceil + 0.5) return false;
    }
    const y = unit.type === 'drone' ? unit.y : unit.dead ? 0.5 : 1.75;
    const dx = unit.x - cx;
    const dz = unit.z - cz;
    const d = Math.hypot(dx, dz) || 1;
    const sx = (-dz / d) * 0.5;
    const sz = (dx / d) * 0.5;
    return (
      grid.sight(cx, cy, cz, unit.x, y, unit.z) ||
      grid.sight(cx, cy, cz, unit.x + sx, y, unit.z + sz) ||
      grid.sight(cx, cy, cz, unit.x - sx, y, unit.z - sz)
    );
  }

  function animate(unit, dt, camera) {
    const parts = unit.parts;
    const root = unit.model.root;
    if (unit.gone) {
      root.visible = false;
      return;
    }
    const far = Math.hypot(camera.position.x - unit.x, camera.position.z - unit.z);
    unit.cullT -= dt > 0 ? dt : 0.016;
    if (unit.cullT <= 0) {
      unit.cullT = 0.12 + (unit.id % 5) * 0.012;
      unit.inSight = far < FAR && (far < 2.5 || inSight(unit, camera));
      // the second look: it stands in the light of a lamp that throws real shadows, so its shadow may be seen
      // where it cannot: it is drawn, and kept in its pose, for the shadow's sake
      unit.casting = !unit.inSight && far < FAR && !!hooks.casts?.(unit.x, unit.z);
    }
    root.visible = (unit.inSight || unit.casting === true) && !unit.piloted;

    // what goes on whether or not anyone is looking: footfalls, flight, a shot-down drone coming to earth
    if (unit.type === 'sentry') {
      if (!unit.dead) {
        const before = Math.sin(unit.walkPhase);
        unit.walkPhase += unit.speed * dt * 3.0;
        if (unit.speed > 0.45 && Math.sin(unit.walkPhase) * before < 0 && far < 28)
          audio.play('stepSentry', { x: unit.x, y: 0.1, z: unit.z, gain: 0.5, muffled: !unit.inSight });
      }
    } else if (!unit.dead) {
      // fly a little higher in the open than under a roof
      if (!unit.carried) unit.y = damp(unit.y, world.indoors(unit.x, unit.z) ? 2.45 : 3.1, 2, dt);
      unit.hum?.set({ x: unit.x, y: unit.y, z: unit.z, muffled: !unit.inSight });
    } else if (unit.y > 0.24) {
      unit.fallV += 9.8 * dt;
      unit.y = Math.max(0.24, unit.y - unit.fallV * dt);
      root.rotation.z += dt * 7;
      root.rotation.x += dt * 3;
      if (unit.y <= 0.24) {
        fx.sparks(unit.x, 0.3, unit.z, 0, 1, 0, 16, 1, 0.8, 0.4, 5);
        fx.dust(unit.x, 0.2, unit.z, 0, 1, 0, 5, 0.5, 0.6);
        audio.play('hitMetal', { x: unit.x, y: 0.2, z: unit.z });
        root.rotation.set(0.25, unit.yaw, 0.4);
      }
    }
    if (!root.visible) return;

    if (unit.type === 'sentry') {
      if (unit.dead) {
        const t = clamp(unit.deathT / 0.85, 0, 1);
        const ease = t * t;
        // it falls forward, the way it faced — and lies that way: dragged, its head comes round to the hand
        root.rotation.y = unit.yaw;
        root.rotation.x = -1.48 * ease;
        root.position.set(unit.x, 0.02 + 0.2 * ease, unit.z);
        if (parts.armR) parts.armR.rotation.x = lerp(parts.armR.rotation.x, 0.5, 0.1);
        if (parts.legL) parts.legL.rotation.x = 0.3 * ease;
        if (parts.shinR) parts.shinR.rotation.x = -0.5 * ease;
        if (parts.head) parts.head.rotation.x = 0.4 * ease;
      } else {
        const stride = clamp(unit.speed / 1.5, 0, 1.2);
        const s = Math.sin(unit.walkPhase);
        const c = Math.cos(unit.walkPhase);
        if (parts.legL) parts.legL.rotation.x = s * 0.5 * stride;
        if (parts.legR) parts.legR.rotation.x = -s * 0.5 * stride;
        if (parts.shinL) parts.shinL.rotation.x = -(0.08 + Math.max(0, c) * 0.85) * stride;
        if (parts.shinR) parts.shinR.rotation.x = -(0.08 + Math.max(0, -c) * 0.85) * stride;
        if (parts.armL) parts.armL.rotation.x = -s * 0.32 * stride + 0.05;
        if (parts.armR) parts.armR.rotation.x = lerp(s * 0.3 * stride + 0.08, 1.45, unit.aimBlend) - unit.flinch * 0.3;
        if (parts.hips) parts.hips.position.y = unit.hipsY + Math.abs(c) * 0.035 * stride;
        if (parts.head) parts.head.rotation.y = unit.headYaw;
        if (parts.torso) parts.torso.rotation.x = -unit.flinch * 0.18 - 0.04 * stride;
        // held, it is where the arm that holds it is (carry()), bent back a little over that arm
        if (unit === held) {
          root.position.set(unit.shownX, 0, unit.shownZ);
          root.rotation.set(0.16, unit.yaw, 0);
        } else {
          root.position.set(unit.x, 0, unit.z);
          root.rotation.set(0, unit.yaw, 0);
        }
      }
    } else if (unit.dead) {
      root.position.set(unit.x, unit.y, unit.z);
    } else {
      if (parts.rotors) for (const rotor of parts.rotors) rotor.rotation.y += dt * 58;
      root.position.set(unit.x, unit.y + Math.sin(clock * 2.2 + unit.id) * 0.09, unit.z);
      root.rotation.set(
        clamp(unit.speed * 0.045, 0, 0.3) - unit.flinch * 0.3,
        unit.yaw,
        Math.sin(clock * 1.3 + unit.id) * 0.05,
      );
    }

    // the eye says what the machine is thinking
    if (unit.eyeMat) {
      const u = unit.eyeMat.uniforms;
      if (unit.dead) {
        u.uIntensity.value = Math.max(0, u.uIntensity.value - dt * 6);
      } else {
        // (a machine the player has turned — the experiment — has the eye of one that is held)
        const c = (unit.turned ? EYE[AI.HELD] : EYE[unit.brain.state]) || EYE[AI.PATROL];
        const pulse = unit.brain.state === AI.PATROL ? 1 : 0.75 + 0.25 * Math.sin(clock * 9 + unit.id);
        u.uColor.value.setRGB(c[0], c[1], c[2]);
        u.uIntensity.value = c[3] * pulse;
      }
    }
    if (parts.tail?.material?.uniforms)
      parts.tail.material.uniforms.uIntensity.value = unit.dead ? 0 : Math.sin(clock * 6 + unit.id) > 0.6 ? 2.5 : 0.3;

    world.probe(unit.x, unit.z, tint, v3);
    // never quite black: a machine in the dark must still be a shape
    tint.r = Math.max(tint.r, 0.05);
    tint.g = Math.max(tint.g, 0.06);
    tint.b = Math.max(tint.b, 0.08);
    setProbe(unit.mats, tint, v3);
  }

  const api = {
    list,
    alarm,

    /**
     * Puts the site's garrison in place: the machines that guard it on this setting (world/map.js garrison()).
     * A machine's number on the roll is its place in that list.
     */
    spawn(site, difficultyName = 'operator') {
      api.clear();
      difficulty = difficultyOf(difficultyName);
      garrison(site, difficulty.tier).forEach((g, n) => {
        const [x, z] = g.route[0];
        let yaw = g.yaw;
        if (yaw === undefined) yaw = g.route.length > 1 ? yawTo(x, z, g.route[1][0], g.route[1][1]) : 0;
        make(g.type, n, x, z, yaw, g.route, g.loop !== false, g.name);
      });
      return list.length;
    },

    /** The machine the map calls `name`, or undefined if it is not on the site on this setting. */
    byName(name) {
      return list.find((unit) => unit.name === name);
    },

    /** The machine the player is holding in front of them as a shield, or null. */
    get held() {
      return held;
    },

    /** The fallen machine the player is dragging (enemies/bodies.js), or null. */
    get dragged() {
      return dragged;
    },

    /**
     * The fallen machine the player could take hold of to drag: the nearest whose middle is within reach and in
     * front of them, with nothing between. Not from the top of a container, and not while a shield is held.
     */
    dragTarget(player) {
      if (held || dragged || player.y > 1.2) return null;
      let best = null;
      let bestD = BODY.reach;
      for (const unit of list) {
        if (!unit.dead || unit.gone) continue;
        // a drone still falling is not there to be taken hold of yet
        if (unit.type === 'drone' && unit.y > 0.3) continue;
        const [mx, mz] = middleOf(unit);
        const d = Math.hypot(mx - player.x, mz - player.z);
        if (d > bestD) continue;
        if (d > 0.6 && Math.abs(angleDelta(player.yaw, yawTo(player.x, player.z, mx, mz))) > BODY.facing) continue;
        if (!grid.sight(player.x, player.eye, player.z, mx, BODY.height, mz)) continue;
        best = unit;
        bestD = d;
      }
      return best;
    },

    /** Takes hold of a fallen machine: from now on it follows the player (update). False if it cannot be. */
    drag(unit) {
      if (!unit || !unit.dead || unit.gone || held || dragged) return false;
      dragged = unit;
      return true;
    },

    /** Lets go of the fallen machine being dragged: it lies where it is. Returns it, or null. */
    drop() {
      const unit = dragged;
      dragged = null;
      return unit;
    },

    /**
     * The site knows what has happened here: every machine that lies fallen at this moment is no news to it, and
     * cannot be found. (The blast: what was standing in the hall went with the cascades, and WARDEN saw it go.)
     */
    known() {
      for (const unit of list) if (unit.dead) unit.found = true;
    },

    /**
     * Takes hold of a machine: from now on it goes where the player goes and can do nothing (ai.js `held`) until
     * it is let go, shut down, shot to pieces by its own side, or breaks free. Returns false if it cannot be held.
     */
    grab(unit) {
      if (!unit || unit.dead || held || unit.type !== 'sentry' || !hold(unit.brain)) return false;
      held = unit;
      unit.stunT = 0;
      unit.empT = 0;
      unit.aimT = 0;
      unit.burstLeft = 0;
      unit.speed = 0;
      audio.play('sentrySuspicious', { x: unit.x, y: 1.6, z: unit.z });
      return true;
    },

    /** Lets the held machine go: it reels for a moment, then turns on the player. Returns the machine, or null. */
    release(player) {
      const unit = held;
      if (!unit) return null;
      held = null;
      letGo(unit.brain, player.x, player.z);
      unit.stunT = SHIELD.stun;
      unit.aimT = 0;
      unit.burstLeft = 0;
      pushOut(grid, unit, unit.spec.radius);
      return unit;
    },

    /**
     * Sends machines that are not on the mission's roll to a place: each stands at the cell it is given, already
     * knows that something is wrong, and goes to look at (to.x, to.z). Drones from outside the wire after the
     * player (the lodestar, the blast); a wave to a charge (src/enemies/wave.js) — guards on foot as well.
     * @param {'sentry' | 'drone'} type
     * @param {number[][]} cells [x, z] where each begins
     * @returns {object[]} the machines
     */
    reinforce(type, cells, to) {
      return cells.map(([x, z]) => {
        const unit = make(type, -1, x, z, yawTo(x, z, to.x, to.z), [[x, z]], true);
        unit.pingP.x = to.x;
        unit.pingP.z = to.z;
        unit.ping = unit.pingP;
        unit.brain.awareness = WAVE.awareness;
        return unit;
      });
    },

    /** Sends drones after the player from outside the wire. They are not on the mission's roll. */
    pursue(points, player) {
      api.reinforce('drone', points, player);
    },

    /**
     * The site itself raises the alarm — its cascades have just gone up, or the lodestar has begun to call — and
     * names the place: every machine that is not already fighting is sent to (x, z). Returns true if the alarm
     * was not already sounding. It is not counted (`alarm.count` is how often a machine FOUND the player), and
     * the `alarm` hook is not called: whoever asked for this knows that they did.
     */
    alert(x, z) {
      const count = alarm.count;
      const fresh = raiseAlarm(alarm, x, z);
      alarm.count = count;
      pingAll();
      return fresh;
    },

    clear() {
      for (const unit of list) dispose(unit);
      list.length = 0;
      turns.length = 0;
      held = null;
      dragged = null;
      bodyT = 0;
      Object.assign(alarm, createAlarm());
      pingT = 0;
      nextId = 0;
      // no drone, no running lights left hanging where one was
      lights?.commit(0);
    },

    /** How many machines are firing at the player right now (never more than the difficulty allows). */
    firing() {
      let taken = 0;
      for (const until of turns) if (until > clock) taken++;
      return taken;
    },

    /** Takes machines off the site as if they had been shut down long ago: no noise, no wreck. For checkpoints. */
    remove(rollIds) {
      const gone = new Set(rollIds);
      for (const unit of list) {
        if (unit.dead || !gone.has(unit.rollId)) continue;
        if (unit === held) held = null;
        kill(unit.brain);
        unit.dead = true;
        unit.gone = true;
        unit.hum?.stop(0);
        unit.hum = null;
        unit.model.root.visible = false;
      }
    },

    /** How many machines on the roll are still running. */
    remaining() {
      let n = 0;
      for (const unit of list) if (!unit.dead && unit.rollId >= 0) n++;
      return n;
    },

    /**
     * @param {object} player
     * @param {number} vis how well lit the player is, 0..1
     * @param {THREE.Camera} camera
     * @param {boolean} frozen draw them, but nobody senses, thinks or moves (menus, the ending)
     */
    update(dt, player, vis, camera, frozen = false) {
      clock += dt;
      if (!frozen) {
        if (stepAlarm(alarm, dt)) hooks.alarm?.(false);
        pingT -= dt;
        let seen = false;
        for (const unit of list) {
          if (unit.dead) {
            unit.deathT += dt;
            continue;
          }
          step(unit, dt, player, vis);
          if (unit.sees && unit.brain.state === AI.COMBAT) seen = true;
        }
        if (seen && alarm.active) {
          sightAlarm(alarm, player.x, player.z);
          if (pingT <= 0 && Math.hypot(alarm.x - pingX, alarm.z - pingZ) > 5) pingAll();
        }
        // the fallen: one in the player's hand follows it — unless it has snagged and been left behind — and
        // every tenth of a second the machines look about them for any that lie where they can see
        if (dragged && !haul(grid, dragged, player, dt)) {
          dragged = null;
          hooks.dragged?.('snagged');
        }
        bodyT -= dt;
        if (bodyT <= 0) {
          bodyT = BODY_TICK;
          lookForBodies(BODY_TICK);
        }
        // keep them from standing inside one another
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (a.dead) continue;
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            if (b.dead || a.spec.flying !== b.spec.flying) continue;
            // a machine in the player's arms is not shoved about by its friends, nor they by it
            if (a === held || b === held) continue;
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > 0.81 || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            const push = (0.9 - d) * 0.5;
            moveBody(grid, a, (-dx / d) * push, (-dz / d) * push, a.spec.radius, a.spec.flying);
            moveBody(grid, b, (dx / d) * push, (dz / d) * push, b.spec.radius, b.spec.flying);
          }
        }
      }
      for (const unit of list) animate(unit, frozen ? 0 : dt, camera);
      if (shadows) {
        let n = 0;
        for (const unit of list) {
          if (n >= SHADOWS || unit.type !== 'sentry' || !unit.model.root.visible) continue;
          shadowMatrix.makeScale(unit.dead ? 1.5 : 1, 1, unit.dead ? 1.5 : 1).setPosition(unit.x, 0.025, unit.z);
          shadows.setMatrixAt(n++, shadowMatrix);
        }
        shadows.count = n;
        shadows.instanceMatrix.needsUpdate = true;
      }
      if (lights) {
        let n = 0;
        const eye = camera.position;
        for (const unit of list) {
          // only a drone the eye has a clear line to (as the drone itself is drawn only then): its lights are
          // drawn a little in front of it, and must not be seen through the wall it is behind
          if (unit.type !== 'drone' || unit.dead || unit.gone || !unit.inSight || n + 2 > LIGHTS) continue;
          const d = Math.hypot(eye.x - unit.x, eye.y - unit.y, eye.z - unit.z);
          const share = d < FAR ? lightShare(d) : 0;
          if (share <= 0) continue;
          const size = lightSize(d);
          // both are drawn a little nearer the eye than the drone is, so that its own body is never in front
          // of them: far off the light is all there is to see of it
          const pull = LIGHT_PROUD / d;
          const x = unit.x + (eye.x - unit.x) * pull;
          const y = unit.y + (eye.y - unit.y) * pull;
          const z = unit.z + (eye.z - unit.z) * pull;
          // its eye, in the colour of what it is thinking — as the eye of the model is
          const c = (unit.turned ? EYE[AI.HELD] : EYE[unit.brain.state]) || EYE[AI.PATROL];
          const pulse = unit.brain.state === AI.PATROL ? 1 : 0.75 + 0.25 * Math.sin(clock * 9 + unit.id);
          const k = c[3] * pulse * share * EYE_SHINE;
          lights.set(n++, x, y, z, size, c[0] * k, c[1] * k, c[2] * k, 1);
          // …and the strobe on its back: white, larger, and gone again in a tenth of a second
          const flash = strobe(clock, unit.id) * share * STROBE_SHINE;
          lights.set(n++, x, y + 0.12, z, size * 1.7, flash, flash, flash * 1.1, 1);
        }
        lights.commit(n);
      }
    },

    /**
     * The first machine a ray meets within maxT, as { unit, t, zone, multiplier }, or null.
     * @param {number} grow widens every hit volume by this factor — the forgiveness a thumb on glass needs
     * @param {object | null} ignore a machine the ray passes straight through (the one held as a shield)
     */
    raycast(ox, oy, oz, dx, dy, dz, maxT, grow = 1, ignore = null) {
      let best = null;
      let bestT = maxT;
      for (const unit of list) {
        if (unit.dead || unit === ignore) continue;
        const ex = unit.x - ox;
        const ez = unit.z - oz;
        // nowhere near the line: skip the spheres
        const along = ex * dx + ez * dz;
        if (along < -1 || along > bestT + 1) continue;
        for (const [h, radius, multiplier, zone] of unit.spec.hit) {
          const r = radius * grow;
          const cy = (unit.type === 'drone' ? unit.y : 0) + h - oy;
          const b = ex * dx + cy * dy + ez * dz;
          const c = ex * ex + cy * cy + ez * ez - r * r;
          const disc = b * b - c;
          if (disc < 0) continue;
          const t = b - Math.sqrt(disc);
          if (t > 0 && t < bestT) {
            bestT = t;
            best = { unit, t, zone, multiplier };
          }
        }
      }
      return best;
    },

    /** A round hits a machine. Returns true if that finished it. */
    damage(unit, amount, fromX, fromZ) {
      if (unit.dead) return false;
      unit.hp -= amount;
      unit.flinch = 1;
      unit.hitP.x = fromX;
      unit.hitP.z = fromZ;
      unit.hit = unit.hitP;
      if (unit.hp <= 0) {
        die(unit);
        return true;
      }
      return false;
    },

    /** Something made a noise at (x, z) that carries `radius` metres in the open, less through walls. */
    noise(x, z, radius) {
      for (const unit of list) {
        if (unit.dead) continue;
        const d = Math.hypot(unit.x - x, unit.z - z);
        if (d > radius) continue;
        if (d > radius * 0.55 && !grid.sight(unit.x, 1.6, unit.z, x, 1.2, z)) continue;
        hear(unit, x, z);
      }
    },

    /**
     * An EMP goes off at (x, y, z). Every machine within `radius` metres of it is stopped for `seconds` — it
     * cannot sense, move or fire, and a sentry can be shut down by hand from any side (takedownTarget) — unless
     * something solid stands between them and it is further off than `close`. None is harmed. The one in the
     * player's arms is passed over: it is doing nothing as it is. Returns how many were stopped.
     */
    stun(x, y, z, radius, seconds, close = 0) {
      let stopped = 0;
      for (const unit of list) {
        if (unit.dead || unit === held) continue;
        const uy = unit.spec.flying ? unit.y : 1.2;
        const d = Math.hypot(unit.x - x, uy - y, unit.z - z);
        if (d > radius) continue;
        if (d > close && !grid.sight(x, Math.max(y, 0.3), z, unit.x, uy, unit.z)) continue;
        unit.stunT = Math.max(unit.stunT, seconds);
        unit.empT = seconds;
        unit.empX = x;
        unit.empZ = z;
        unit.sparkT = 0;
        unit.aimT = 0;
        unit.burstLeft = 0;
        audio.play('machineStun', { x: unit.x, y: uy, z: unit.z, gain: 1.2 });
        stopped++;
      }
      return stopped;
    },

    /** The sentry the player could shut down by hand right now: close, unaware, and with its back turned. */
    takedownTarget(player) {
      // not from the top of a container: you have to be down there with it
      if (player.y > 1.2) return null;
      // looked at from where the eye is — out to one side, if the player is leaning
      const hx = player.headX ?? player.x;
      const hz = player.headZ ?? player.z;
      let best = null;
      let bestD = 2.1;
      for (const unit of list) {
        // one that an EMP has stopped is helpless whatever it knew and whichever way it faces
        const helpless = unit.empT > 0;
        if (unit.dead || unit.type !== 'sentry' || unit === held || unit.turned) continue;
        if (unit.brain.state === AI.COMBAT && !helpless) continue;
        const d = Math.hypot(unit.x - player.x, unit.z - player.z);
        if (d > bestD) continue;
        const behind = Math.abs(angleDelta(unit.yaw, yawTo(unit.x, unit.z, player.x, player.z))) > 1.75;
        const facing = Math.abs(angleDelta(player.yaw, yawTo(player.x, player.z, unit.x, unit.z))) < 1.0;
        if ((!behind && !helpless) || !facing) continue;
        if (!grid.sight(hx, player.eye, hz, unit.x, 1.3, unit.z)) continue;
        best = unit;
        bestD = d;
      }
      return best;
    },

    takedown(unit) {
      die(unit, true);
    },

    /** What the worst-informed-to-best-informed machine knows, for the music and the HUD: calm | tense | combat */
    mood() {
      let mood = 'calm';
      for (const unit of list) {
        // a machine in the player's arms knows nothing and tells nobody
        if (unit.dead || unit === held) continue;
        const s = unit.brain.state;
        if (s === AI.COMBAT) return 'combat';
        if (s !== AI.PATROL) mood = 'tense';
      }
      return alarm.active ? 'combat' : mood;
    },
  };
  return api;
}

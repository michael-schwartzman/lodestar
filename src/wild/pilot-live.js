// Flying a drone the uplink has taken, joined to the game: the eye in the drone, the hands on it, the body left
// standing. The rules are src/wild/pilot.js; the design is docs/WILD.md, "The uplink".
import { PILOT, blastAt, createFlight, heightWithin, stepFlight } from './pilot.js';
import { WITNESS } from './uplink.js';
import { createBrain } from '../enemies/ai.js';

const wall = {};

export function createPilotLive(ctx) {
  const { G } = ctx;
  const { player, enemies, fx, audio } = G;
  const grid = G.world.grid;
  const { moveBody } = ctx.lib;
  /** the drone being flown and its flight, or null and null */
  let unit = null;
  let f = null;
  /** the trigger was down the step before: so its own witnessed-shot noise (PART 2) carries once a burst */
  let firing = false;
  /** the body's health a step ago: less of it now means the body has been hit */
  let health = 0;
  /**
   * What is asked of the BODY while the hands are on the drone: nothing. (The shape of input.js's intent; main.js
   * hands this to the player, the gun and whatever can be used instead of what the player really asked.)
   */
  const idle = {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    lean: 0,
    select: 0,
    cycle: 0,
    run: false,
    fire: false,
    aim: false,
    use: false,
    aimLatched: false,
    usePressed: false,
    grabPressed: false,
    melee: false,
    jump: false,
    reload: false,
    crouchToggle: false,
    nv: false,
    map: false,
    mode: false,
    throw: false,
    down: new Set(),
    hits: new Set(),
  };

  // what the screen says while it lasts: a frame round the picture, and what the keys now do
  const cam = document.createElement('div');
  cam.className = 'w-cam';
  cam.innerHTML =
    '<i></i><i></i><i></i><i></i><b class="w-cam-name">DRONE LINK</b><b class="w-cam-left"></b><b class="w-cam-keys"></b>';
  ctx.overlay.append(cam);
  const left = cam.querySelector('.w-cam-left');
  cam.querySelector('.w-cam-keys').textContent = G.touch
    ? 'STICK FLY · FIRE'
    : 'W A S D FLY · SPACE / C UP / DOWN · FIRE · F BLOW IT UP';
  let shown = -1;

  /** The drone is the player's to fly. Says true: it always can be. (Also for tests, which hold no key.) */
  function fly(machine) {
    unit = machine;
    f = createFlight(player.yaw);
    health = player.health;
    firing = false;
    // it is a turned machine as far as its own kind are concerned — and one the uplink's own stepping leaves alone
    Object.assign(machine, { turned: 1e6, piloted: true, carried: true, stunT: 0, empT: 0, speed: 0, path: null });
    Object.assign(machine.brain, createBrain());
    machine.heard = machine.hit = machine.ping = null;
    ctx.flying = true;
    G.weapon.visible = false;
    G.hud.el.classList.add('w-pilot');
    audio.play('radio', { gain: 0.9, rate: 0.7 });
    audio.play('nvOn', { gain: 0.6 });
    ctx.tally.flights = (ctx.tally.flights || 0) + 1;
    ctx.note('UPLINK — YOU HAVE THE DRONE');
    ctx.say('pilot', machine);
    return true;
  }

  /**
   * The link ends, one way or another: 'blown' (the player's own doing), 'spent' (its battery), 'hit' (the body
   * was), 'lost' (the drone was shot down), 'over' (the mission ended or began again: nothing is said, and the
   * drone is not harmed — it is let go, a machine of WARDEN's again). Whichever it is, nothing of the link is
   * left on the machine.
   */
  function end(why) {
    const machine = unit;
    if (!machine) return;
    unit = f = null;
    machine.piloted = machine.carried = false;
    // (it was the player's only for as long as it was flown: left set, the uplink would run it as a turned
    // machine for the million seconds fly() gave it)
    machine.turned = 0;
    ctx.flying = false;
    G.hud.el.classList.remove('w-pilot');
    if (why === 'over') return;
    if (G.state === 'playing') G.weapon.visible = true;
    audio.play('nvOff', { gain: 0.6 });
    if (why === 'blown') {
      const { x, y, z } = machine;
      fx.explosion(x, y, z, 0.7);
      fx.shake(0.3);
      audio.play('explosion', { x, y, z, gain: 0.9 });
      enemies.noise(x, z, PILOT.blast.noise);
      for (const other of [...enemies.list]) {
        if (other.dead || other === machine) continue;
        const oy = other.spec.flying ? other.y : 1.2;
        const d = Math.hypot(other.x - x, oy - y, other.z - z);
        if (d > PILOT.blast.radius || !grid.sight(x, y, z, other.x, oy, other.z)) continue;
        if (enemies.damage(other, blastAt(d), x, z)) ctx.tally.flownKills = (ctx.tally.flownKills || 0) + 1;
      }
      // …and the body, if it was fool enough to be standing under it
      const near = Math.hypot(player.x - x, player.eye - y, player.z - z);
      if (near <= PILOT.blast.radius) player.damage(blastAt(near) * 0.5, x, z);
    }
    // whichever way it ended, the drone itself is done for: blown apart, burned out, or already falling
    if (!machine.dead) enemies.damage(machine, 1e6, machine.x, machine.z);
    ctx.note(
      why === 'blown'
        ? 'DRONE BLOWN'
        : why === 'spent'
          ? 'LINK SPENT'
          : why === 'hit'
            ? 'YOU ARE HIT — LINK DROPPED'
            : 'DRONE LOST',
      why === 'blown' ? '' : 'warn',
    );
    ctx.say(why === 'blown' ? 'blown' : 'unlinked', machine);
  }

  /** A round from its gun, along the eye's line. */
  function fire() {
    const cp = Math.cos(f.pitch);
    const spread = PILOT.gun.spread;
    let dx = -Math.sin(f.yaw) * cp + (Math.random() - 0.5) * spread;
    let dy = Math.sin(f.pitch) + (Math.random() - 0.5) * spread;
    let dz = -Math.cos(f.yaw) * cp + (Math.random() - 0.5) * spread;
    const len = Math.hypot(dx, dy, dz);
    dx /= len;
    dy /= len;
    dz /= len;
    const ox = unit.x;
    const oy = unit.y - 0.08;
    const oz = unit.z;
    const reach = grid.raycast(ox, oy, oz, dx, dy, dz, PILOT.gun.range, wall) ? wall.t : PILOT.gun.range;
    const met = enemies.raycast(ox, oy, oz, dx, dy, dz, reach, 1, unit);
    const t = met ? met.t : reach;
    const ex = ox + dx * t;
    const ey = oy + dy * t;
    const ez = oz + dz * t;
    // the gun hangs under the eye
    fx.muzzle(ox + dx * 0.6, oy - 0.2, oz + dz * 0.6, dx, dy, dz, 'drone');
    fx.tracer(ox + dx * 0.6, oy - 0.2, oz + dz * 0.6, ex, ey, ez, 'drone');
    audio.play('shotDrone', { gain: 0.8 });
    enemies.noise(ox, oz, PILOT.gun.noise);
    if (met) {
      const killed = enemies.damage(met.unit, PILOT.gun.damage * met.multiplier, ox, oz);
      fx.impact(ex, ey, ez, -dx, -dy, -dz, 'machine');
      audio.play('hitMachine', { x: ex, y: ey, z: ez });
      G.hud.hitmarker(killed);
      audio.play('hitMarker');
      if (killed) ctx.tally.flownKills = (ctx.tally.flownKills || 0) + 1;
      // PART 2: the drone's own gun, firing on a loyal machine, is seen and heard the same as a turned sentry's
      if (!met.unit.turned) {
        if (!firing) enemies.noise(ox, oz, WITNESS.noise);
        ctx.witnessShot?.(unit, met.unit);
      }
    } else if (reach < PILOT.gun.range) fx.impact(wall.x, wall.y, wall.z, wall.nx, wall.ny, wall.nz, wall.what);
  }

  ctx.fly = fly;
  ctx.flying = false;

  return {
    name: 'pilot',
    /** for tests and the curious */
    fly,
    end,
    get flying() {
      return !!unit;
    },
    get flight() {
      return f;
    },
    get unit() {
      return unit;
    },
    brief: (touch) =>
      touch
        ? [['', 'DRONE', 'UPLINK on a drone: you fly it, with its gun']]
        : [['H', 'DRONE', 'hold on a drone: you fly it, and F blows it up']],
    controls: [
      [
        'A drone the uplink took: fly it, fire its gun, blow it up',
        'W A S D, Space and C; the trigger; F blows it up',
        'the stick and FIRE',
      ],
    ],
    tallies: { flights: 'Drones flown', flownKills: 'Shut down from the air' },

    reset() {
      end('over');
      shown = -1;
    },

    step(dt, own, intent) {
      if (!unit) return null;
      // the link ends by itself when the drone is shot down, when the body is hit, when the battery is spent
      f.t -= dt;
      if (unit.dead) end('lost');
      else if (player.health < health - 1e-6) end('hit');
      else if (f.t <= 0) end('spent');
      else if (intent.usePressed) end('blown');
      health = player.health;
      // the body is asked for nothing — nor in the step the link ends in: the key that ended it was the drone's
      idle.lookX = idle.lookY = 0;
      if (!unit) return idle;
      const lift =
        (intent.down.has('Space') ? 1 : 0) - (intent.down.has('KeyC') || intent.down.has('ControlLeft') ? 1 : 0);
      const go = stepFlight(f, {
        dt,
        moveX: intent.moveX,
        moveY: intent.moveY,
        lift,
        lookX: intent.lookX,
        lookY: intent.lookY,
      });
      const bx = unit.x;
      const bz = unit.z;
      moveBody(grid, unit, go.x, go.z, unit.spec.radius, true);
      // a wall takes away the speed that ran into it
      if (dt > 0) {
        f.vx = (unit.x - bx) / dt;
        f.vz = (unit.z - bz) / dt;
      }
      unit.y = heightWithin(unit.y + go.y, grid.ceilingOver(unit.x, unit.z, unit.spec.radius));
      unit.yaw = f.yaw;
      f.fireT -= dt;
      if (intent.fire && f.fireT <= 0) {
        f.fireT = PILOT.gun.interval;
        fire();
      }
      firing = intent.fire;
      return idle;
    },

    view(camera) {
      if (!unit) return false;
      camera.position.set(unit.x, unit.y - 0.08, unit.z);
      camera.rotation.set(f.pitch, f.yaw, f.roll);
      if (camera.fov !== PILOT.fov) {
        camera.fov = PILOT.fov;
        camera.updateProjectionMatrix();
      }
      return true;
    },

    frame() {
      const seconds = unit ? Math.ceil(f.t) : -1;
      if (seconds === shown) return;
      shown = seconds;
      left.textContent = unit ? `LINK ${seconds} s` : '';
    },

    on: {
      // the mission is over, one way or the other
      end() {
        end('over');
      },
    },

    chip() {
      return unit
        ? { key: 'F', name: 'DRONE', text: `${Math.ceil(f.t)} s`, level: f.t / PILOT.seconds, tone: 'busy' }
        : null;
    },
  };
}

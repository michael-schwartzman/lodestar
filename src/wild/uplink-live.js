// The uplink, joined to the game: the key held on a machine in the sights, a turned machine's forty seconds, and
// the loyal ones' answer. The rules are src/wild/uplink.js; the design is docs/WILD.md, "The uplink".
import * as THREE from 'three';
import { UPLINK, WITNESS, createUplink, pickFoe, stepUplink, witnessed, witnessesOf } from './uplink.js';
import { createBrain } from '../enemies/ai.js';
import { angleDelta, damp, turnTowards, yawTo } from '../core/math.js';

/** what a round has met that rings when it is struck: as gfx/fx.js `isMetal` has it (not imported: index.js says why) */
const isMetal = (what) => what === 'prop' || what === 'door' || what === 'wreck' || what === 'casing';

const rnd = (a, b) => a + Math.random() * (b - a);
const v3 = new THREE.Vector3();
const wall = {};

export function createUplinkLive(ctx) {
  const { G } = ctx;
  const { player, enemies, fx, audio } = G;
  const grid = G.world.grid;
  const T = UPLINK.turned;
  const u = createUplink();
  /** the machine in the sights that could be taken, or null */
  let target = null;
  /** on a phone: seconds the second button's press still stands for the key held down */
  let auto = 0;
  /** what the second button on a phone was last told to say */
  let offered = false;
  let tickT = 0;
  /** the shot a witness first saw that has not yet forced the alarm, and who saw it: null while there is none */
  let pendingAlarm = null;

  // the ring round the crosshair, and the word under it
  const link = document.createElement('div');
  link.className = 'w-link';
  link.innerHTML =
    '<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="w-link-rim" cx="22" cy="22" r="19"/><circle class="w-link-fill" cx="22" cy="22" r="19"/></svg><b></b>';
  ctx.overlay.append(link);
  const fill = link.querySelector('.w-link-fill');
  const word = link.querySelector('b');
  const ROUND = 2 * Math.PI * 19;
  fill.style.strokeDasharray = String(ROUND);
  let shown = '';
  function show(state, text) {
    if (state !== link.dataset.state) link.dataset.state = state;
    if (text !== shown) word.textContent = shown = text;
    fill.style.strokeDashoffset = String(ROUND * (1 - u.progress));
  }

  const eyeOf = (m) => (m.spec.flying ? m.y : m.spec.eye);
  const midOf = (m) => (m.spec.flying ? m.y : 1.25);
  /** a clear line from one machine's eye to the middle of another */
  const sees = (a, b) => grid.sight(a.x, eyeOf(a), a.z, b.x, midOf(b), b.z);

  /** The machine the eye is on, if it is one that can be taken: running, within reach, nothing solid between. */
  function sighted() {
    const cp = Math.cos(player.pitch);
    const dx = -Math.sin(player.yaw) * cp;
    const dy = Math.sin(player.pitch);
    const dz = -Math.cos(player.yaw) * cp;
    const ox = player.headX;
    const oy = player.eye;
    const oz = player.headZ;
    const reach = grid.raycast(ox, oy, oz, dx, dy, dz, UPLINK.reach, wall) ? wall.t : UPLINK.reach;
    const met = enemies.raycast(ox, oy, oz, dx, dy, dz, reach, UPLINK.grow, enemies.held);
    return met && !met.unit.turned ? met.unit : null;
  }
  // (the overspeed uses the same key at the firing point: with a machine in the sights it is the uplink's)
  ctx.sighted = () => target;

  /**
   * The site alarm, as a machine calls it (enemies/index.js `lookForBodies`' own pattern): named at (x, z),
   * counted once, the siren and Overwatch's own line heard (the fence's pattern: overspeed-live.js, tripwires-
   * live.js) — fix (the lead, after review, 17 November 2026): `enemies.alert` only names the place and pings
   * every machine; it does not sound anything by itself, and does not call `hooks.alarm` ("whoever asked for
   * this knows that they did") — so the siren and the count are this function's to add, only when it was not
   * already sounding. WARDEN has a line of its own for it (warden.js `witnessed`); the public address reads the
   * alarm out by itself, whatever raised it (voice-live.js watches `G.enemies.alarm.active`).
   */
  function soundAlarm(at) {
    if (enemies.alert(at.x, at.z)) {
      enemies.alarm.count++;
      ctx.act.siren();
      ctx.act.radio('Overwatch', 'They saw your machine fire on their own. The whole site is awake.', 5);
      ctx.say('witnessed');
      // an alarm is an alarm, whoever raised it: machines come for it (src/wild/response.js)
      ctx.respond('alarm', at);
    }
  }

  /**
   * PART 2, 17 November 2026 — the owner: "once other robots see that their friends are being fired at" the
   * alarm must still go up. A machine that is the player's has fired at `victim` (hit or miss): every witness
   * (uplink.js `witnessesOf`) fights the shooter from here on — its mind's hit stimulus placed at it, the shooter
   * its foe, so the existing `foe()` / `alarmAt()` rules run — and the first such shot starts the clock that
   * guarantees the alarm within `WITNESS.alarmDelay` (ticked in `step()`, the machines' own dt), provided a
   * witness from it is still running when that time is up.
   */
  function witnessShot(shooter, victim) {
    const seen = witnessesOf(shooter, victim, enemies.list, sees);
    for (const w of seen) {
      w.hitP.x = shooter.x;
      w.hitP.z = shooter.z;
      w.hit = w.hitP;
      w.foe = shooter;
      w.foeT = 0.3;
    }
    // fix (the lead, after review, 17 November 2026): the clock belongs to the FIRST shot a witness saw — a
    // later shot, from whichever of the player's machines, must not rename it or restart its running `t`
    pendingAlarm = witnessed(pendingAlarm, shooter, seen);
  }
  ctx.witnessShot = witnessShot;

  /**
   * One machine fires a round at another — a turned one at a loyal one, or the other way — as a machine fires at
   * the player: the flash, the line, the report; a hit, or the wall behind.
   */
  function fire(shooter, at, damage, chance) {
    if (shooter.parts.muzzle) shooter.parts.muzzle.getWorldPosition(v3);
    else v3.set(shooter.x, shooter.spec.flying ? shooter.y : 1.4, shooter.z);
    const mx = v3.x;
    const my = v3.y;
    const mz = v3.z;
    let tx = at.x;
    let ty = midOf(at);
    let tz = at.z;
    const hit = Math.random() < chance;
    if (!hit) {
      // a miss goes past it, to one side, and into whatever is behind
      const d = Math.hypot(tx - mx, tz - mz) || 1;
      const side = rnd(0.5, 1.2) * (Math.random() < 0.5 ? -1 : 1);
      tx += (-(tz - mz) / d) * side;
      tz += ((at.x - mx) / d) * side;
      ty += rnd(-0.4, 0.5);
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
    if (!hit && grid.raycast(mx, my, mz, dx, dy, dz, 90, wall)) {
      ex = wall.x;
      ey = wall.y;
      ez = wall.z;
      fx.impact(ex, ey, ez, wall.nx, wall.ny, wall.nz, wall.what);
      audio.play(isMetal(wall.what) ? 'hitMetal' : 'hitWall', { x: ex, y: ey, z: ez, gain: 0.6 });
    }
    fx.muzzle(mx, my, mz, dx, dy, dz, shooter.type);
    fx.tracer(mx, my, mz, ex, ey, ez, shooter.type);
    audio.play(shooter.type === 'drone' ? 'shotDrone' : 'shotSentry', { x: mx, y: my, z: mz });
    if (hit) {
      fx.impact(ex, ey, ez, -dx, -dy, -dz, 'machine');
      audio.play('hitMachine', { x: ex, y: ey, z: ez });
      if (enemies.damage(at, damage, shooter.x, shooter.z) && shooter.turned)
        ctx.tally.turnedKills = (ctx.tally.turnedKills || 0) + 1;
    }
    // PART 2: the player's own firing on a loyal machine — hit or miss — is seen and heard (uplink.js WITNESS)
    if (shooter.turned) {
      if (shooter.burstLeft === shooter.spec.burst) enemies.noise(shooter.x, shooter.z, WITNESS.noise);
      witnessShot(shooter, at);
    }
  }

  /** A burst at a time, as a machine fires: says nothing, and keeps its own count on the machine. */
  function volley(shooter, at, dt, damage, chance, facing) {
    const spec = shooter.spec;
    shooter.aimT += dt;
    shooter.fireT -= dt;
    if (shooter.aimT < T.windup || !facing || shooter.fireT > 0) return;
    if (shooter.burstLeft <= 0) shooter.burstLeft = spec.burst;
    fire(shooter, at, damage, chance);
    shooter.burstLeft--;
    shooter.fireT = shooter.burstLeft > 0 ? T.gap : rnd(T.rest[0], T.rest[1]);
  }

  /** A machine becomes the player's. (Also for tests, which have no hands to hold a key with.) */
  function turn(unit) {
    unit.turned = T.seconds;
    // a fresh mind: nothing of what it knew, and nothing it was doing
    Object.assign(unit.brain, createBrain());
    Object.assign(unit, { stunT: 0, empT: 0, aimT: 0, burstLeft: 0, fireT: 0.4, foe: null, foeT: 0, path: null });
    unit.goalX = -1;
    unit.heard = unit.hit = unit.ping = null;
    const y = midOf(unit);
    fx.sparks(unit.x, y, unit.z, 0, 1, 0, 14, 0.5, 0.8, 1, 5);
    fx.light(unit.x, y, unit.z, 0.4, 0.8, 1.4, 6, 0.3);
    audio.play('machineStun', { x: unit.x, y, z: unit.z, gain: 1.1, rate: 1.2 });
    audio.play('chargeArmed', { gain: 0.8, rate: 0.85 });
    ctx.tally.turned = (ctx.tally.turned || 0) + 1;
    ctx.note('UPLINK — IT IS YOURS');
    ctx.say('turned', unit);
  }

  return {
    name: 'uplink',
    /** for tests and the curious */
    state: u,
    get target() {
      return target;
    },
    turn,
    brief: (touch) =>
      touch
        ? [['', 'UPLINK', 'the button beside USE, three a mission']]
        : [['H', 'UPLINK', 'hold on a machine: three a mission, 40 s each']],
    controls: [
      [
        'Uplink: take a machine, three a mission — fight or fly it',
        'H, held on it for a second',
        'UPLINK, where SHIELD is',
      ],
    ],
    tallies: { turned: 'Machines turned', turnedKills: 'Shut down by your machines' },

    reset() {
      Object.assign(u, createUplink());
      target = null;
      auto = 0;
      pendingAlarm = null;
      show('', '');
    },

    step(dt, own, intent) {
      // PART 2: the clock a witnessed shot started — the machines' own dt, ticking whether or not it is still
      // firing, until the alarm is forced (a witness from it still running) or the window runs out unspent
      if (pendingAlarm) {
        pendingAlarm.t += dt;
        if (pendingAlarm.t >= WITNESS.alarmDelay) {
          const { shooter, witnesses } = pendingAlarm;
          pendingAlarm = null;
          if ([...witnesses].some((w) => !w.dead)) soundAlarm(shooter);
        }
      }
      const can = player.alive && !player.holding && !ctx.flying;
      target = can ? sighted() : null;
      // on a phone the second button, when it says UPLINK, stands for the key: one press holds it for as long as
      // the machine stays in the middle of the screen
      if (G.touch && offered && intent.grabPressed) auto = UPLINK.hold + 0.5;
      auto = target ? Math.max(0, auto - own) : 0;
      const held = can && (intent.down.has('KeyH') || auto > 0);
      const building = u.progress > 0;
      for (const what of stepUplink(u, { dt: own, held, target: target ? target.id : null })) {
        if (what === 'cold') {
          ctx.note('UPLINK RECHARGING', 'warn');
          audio.play('dry', { gain: 0.7 });
        } else if (what === 'none') {
          ctx.note('UPLINK SPENT', 'warn');
          audio.play('dry', { gain: 0.7 });
        } else if (what === 'done') {
          const unit = enemies.list.find((m) => m.id === u.taken);
          auto = 0;
          // a drone is flown, if there is a pilot's seat (src/wild/pilot-live.js); anything else is turned
          if (unit && !unit.dead && !(unit.type === 'drone' && ctx.fly?.(unit))) turn(unit);
          target = null;
        }
      }
      // the link is heard taking hold: a tick, quicker and higher as it goes
      if (u.progress > 0 && (!building || (tickT -= own) <= 0)) {
        tickT = 0.2 - 0.1 * u.progress;
        audio.play('chargeBeep', { gain: 0.5, rate: 0.8 + 0.7 * u.progress });
      }
    },

    frame() {
      if (G.state !== 'playing' || !target) return show('', '');
      if (u.usesLeft <= 0) return show('spent', 'UPLINK SPENT');
      const what = target.type === 'drone' && ctx.fly ? 'FLY IT' : 'TURN IT';
      if (u.cool > 0) show('cold', `UPLINK ${Math.ceil(u.cool)} s`);
      else if (u.progress > 0) show('linking', `UPLINK — ${what}`);
      else show('ready', G.touch ? `UPLINK — ${what}` : `H · UPLINK — ${what}`);
    },

    grab(busy) {
      offered = G.touch && !busy && !!target && u.usesLeft > 0 && u.cool <= 0 && u.progress === 0;
      return offered ? 'UPLINK' : null;
    },

    chip() {
      const spent = u.usesLeft <= 0;
      return {
        key: 'H',
        name: 'UPLINK',
        text: spent ? '×0' : u.cool > 0 ? `${Math.ceil(u.cool)} s` : u.progress > 0 ? 'LINKING' : `×${u.usesLeft}`,
        level: spent ? 0 : u.cool > 0 ? 1 - u.cool / UPLINK.recharge : 1,
        tone: spent ? 'out' : u.cool > 0 ? 'out' : u.progress > 0 ? 'busy' : '',
      };
    },

    save: () => ({ cool: u.cool, usesLeft: u.usesLeft }),
    load(kept) {
      u.cool = kept.cool;
      u.usesLeft = kept.usesLeft ?? UPLINK.uses;
    },

    // ---------- the machines' side of it (enemies/index.js: hooks.turned, hooks.foe, hooks.alarmAt) ----------

    /** A step of a machine that is the player's: it is not run by its own mind (a flown drone: not by this either). */
    turned(unit, dt, inner) {
      if (unit.piloted) return;
      const spec = unit.spec;
      unit.turned -= dt;
      if (unit.turned <= 0) {
        // forty seconds of somebody else's will, and its boards are gone
        unit.turned = 0;
        fx.sparks(unit.x, midOf(unit), unit.z, 0, 1, 0, 22, 0.5, 0.8, 1, 6);
        inner.die(unit);
        ctx.note('YOUR MACHINE HAS BURNED OUT', 'warn');
        ctx.say('burnout', unit);
        return;
      }
      unit.foeT -= dt;
      if (unit.foeT <= 0 || (unit.foe && (unit.foe.dead || unit.foe.turned))) {
        unit.foeT = 0.3;
        unit.foe = pickFoe(unit, enemies.list, sees);
      }
      const foe = unit.foe;
      let aim = 0.12;
      if (foe) {
        const to = yawTo(unit.x, unit.z, foe.x, foe.z);
        unit.yaw = turnTowards(unit.yaw, to, spec.turn * 1.5 * dt);
        aim = 1;
        // it closes in on one that is far off, and stands to fire on one that is not
        if (Math.hypot(foe.x - unit.x, foe.z - unit.z) > 16) inner.goTo(unit, foe.x, foe.z, spec.run, dt, to);
        else unit.speed = 0;
        volley(unit, foe, dt, T.damage, T.chance, Math.abs(angleDelta(unit.yaw, to)) < 0.25);
      } else {
        unit.aimT = 0;
        // nothing to fire on: to heel
        const d = Math.hypot(player.x - unit.x, player.z - unit.z);
        if (d > T.heel) inner.goTo(unit, player.x, player.z, d > 9 ? spec.run : spec.hurry, dt);
        else {
          unit.speed = 0;
          unit.yaw = turnTowards(unit.yaw, player.yaw, spec.turn * 0.6 * dt);
        }
      }
      unit.headYaw = damp(unit.headYaw, 0, 5, dt);
      unit.aimBlend = damp(unit.aimBlend, aim, 7, dt);
      unit.flinch = Math.max(0, unit.flinch - dt * 4);
    },

    /**
     * A loyal machine is fighting and cannot see the player: if it has a turned machine in sight it fights that,
     * where it stands, and this says true. (It was fired on by one of its own; that is how it comes to be here.)
     */
    foe(unit, dt) {
      unit.foeT = (unit.foeT || 0) - dt;
      if (unit.foeT <= 0 || (unit.foe && (unit.foe.dead || !unit.foe.turned))) {
        unit.foeT = 0.25;
        unit.foe = pickFoe(unit, enemies.list, sees, { range: unit.spec.view * 1.3 });
      }
      const foe = unit.foe;
      if (!foe) return false;
      // it has something to fight: it does not go looking for what it has lost
      unit.brain.unseen = 0;
      const to = yawTo(unit.x, unit.z, foe.x, foe.z);
      unit.yaw = turnTowards(unit.yaw, to, unit.spec.turn * 1.5 * dt);
      unit.speed = 0;
      volley(unit, foe, dt, T.back.damage, T.back.chance, Math.abs(angleDelta(unit.yaw, to)) < 0.25);
      return true;
    },

    /** The place an alarm names when the machine that calls it has been fighting a turned one and never saw the player. */
    alarmAt(unit) {
      return unit.foe && unit.foe.turned && !unit.sees ? unit.foe : null;
    },
  };
}

// The operator: where they are, how they stand, how they move, how much they can take.
import { moveBody } from './world/collide.js';
import { clamp, damp } from './core/math.js';

export const PLAYER = {
  radius: 0.32,
  /** how tall the body is: what a ceiling stops */
  height: 1.8,
  eyeStand: 1.62,
  eyeCrouch: 1.02,
  walk: 4.3,
  run: 6.6,
  crouch: 2.1,
  aimWalk: 2.5,
  /** with a machine held in front of you as a shield */
  holdWalk: 2.4,
  /** metres a second straight up at take-off, and what pulls you back: about 1.08 m high, 0.8 s in the air */
  jump: 5.4,
  gravity: 13.5,
  /** a jump asked for this long before the feet touch down still happens when they do */
  jumpBuffer: 0.12,
  /** and one asked for this long after walking off an edge still counts as from the edge */
  coyote: 0.1,
  /** how quickly speed can be changed in the air (on the ground: 11), and how little the air itself slows you */
  airSteer: 2.5,
  airDrag: 0.5,
  /** a drop no deeper than this is walked down, not fallen */
  stepDown: 0.3,
  /** how far a full lean puts the head to one side, in metres; how fast it gets there; how big the head is */
  lean: 0.5,
  leanRate: 9,
  headRadius: 0.16,
  /** how far the view tips over at a full lean, in radians */
  leanRoll: 0.15,
  health: 100,
  /** seconds without being hit before health starts coming back */
  regenDelay: 5,
  regenRate: 13,
  maxPitch: 1.45,
};

export function createPlayer(world) {
  const p = {
    x: 0,
    z: 0,
    /** how high the feet are: 0 on the ground, more in the air or on top of something */
    y: 0,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    grounded: true,
    /** how high the eye is above the feet: standing, crouched, or somewhere between */
    stance: PLAYER.eyeStand,
    /** how high the eye is above the ground — what the camera, the weapon and the guards' eyes all read */
    eye: PLAYER.eyeStand,
    crouched: false,
    running: false,
    /** metres a second over the ground */
    speed: 0,
    /** −1 leaning left … 1 leaning right: how far the body has tipped, whether or not the head got anywhere */
    lean: 0,
    /** how far the head really is to one side, as a fraction of a full lean, signed — less than `lean` at a wall */
    leanK: 0,
    /** where the head is. The body's own x and z unless leaning: the camera, the muzzle and a guard's eye use it */
    headX: 0,
    headZ: 0,
    /** a machine is held in front as a shield (main.js sets it): slow, upright, on the ground */
    holding: false,
    /**
     * the wild branch's slide (src/wild/slide-live.js) sets it, and nothing in the game does: { vx, vz }, metres a
     * second the body is carried over the ground at, whatever is asked of it
     */
    slide: null,
    health: PLAYER.health,
    sinceHit: 99,
    /** where the last hit came from, for the HUD */
    hitYaw: 0,
    hitFlash: 0,
    bob: 0,
    bobY: 0,
    /** set for one frame each time a foot lands */
    stepped: false,
    /** set for the one frame the feet leave the ground in a jump */
    jumped: false,
    /** for the one frame the feet come back down: how fast they were falling, in metres a second */
    landed: 0,
    /** the knees giving a little after a landing, in metres */
    dip: 0,
    // how long since the feet left the ground without a jump, and how much longer a jump that was asked for keeps
    airT: 0,
    jumpT: 0,
    damageTaken: 0,
    /** for tests: nothing can see the player */
    hidden: false,

    reset(start) {
      Object.assign(p, {
        x: start.x,
        z: start.z,
        y: 0,
        yaw: start.yaw,
        pitch: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        grounded: true,
        stance: PLAYER.eyeStand,
        eye: PLAYER.eyeStand,
        crouched: false,
        running: false,
        speed: 0,
        lean: 0,
        leanK: 0,
        headX: start.x,
        headZ: start.z,
        holding: false,
        slide: null,
        health: PLAYER.health,
        sinceHit: 99,
        hitFlash: 0,
        bob: 0,
        bobY: 0,
        stepped: false,
        jumped: false,
        landed: 0,
        dip: 0,
        airT: 0,
        jumpT: 0,
        damageTaken: 0,
        hidden: false,
      });
    },

    get alive() {
      return p.health > 0;
    },

    /**
     * @param {object} intent what the player is asking for this frame (see input.js)
     * @param {number} aiming 0..1 — how far the weapon is raised to the eye
     */
    update(dt, intent, aiming = 0) {
      p.stepped = false;
      p.jumped = false;
      p.landed = 0;
      p.sinceHit += dt;
      p.hitFlash = Math.max(0, p.hitFlash - dt * 1.6);
      p.dip = damp(p.dip, 0, 12, dt);
      if (!p.alive) {
        // down: the view sinks to the floor — and a body that was in the air still comes to earth
        p.stance = damp(p.stance, 0.3, 4, dt);
        p.speed = 0;
        p.jumpT = 0;
        upAndDown(dt);
        p.eye = p.y + p.stance;
        leanTo(0, dt);
        return;
      }

      p.yaw -= intent.lookX;
      p.pitch = clamp(p.pitch - intent.lookY, -PLAYER.maxPitch, PLAYER.maxPitch);
      // with a machine held in front of you there is no ducking and no jumping
      if (p.holding) p.crouched = false;
      else if (intent.crouchToggle) p.crouched = !p.crouched;

      // a jump: asked for now or a moment ago, from the ground or from an edge only just left. It stands you up.
      p.jumpT = intent.jump && !p.holding ? PLAYER.jumpBuffer : Math.max(0, p.jumpT - dt);
      if (p.jumpT > 0 && (p.grounded || p.airT < PLAYER.coyote)) {
        p.vy = PLAYER.jump;
        p.grounded = false;
        p.airT = PLAYER.coyote;
        p.jumpT = 0;
        p.crouched = false;
        p.jumped = true;
      }

      let mx = intent.moveX;
      let my = intent.moveY;
      const push = Math.hypot(mx, my);
      if (push > 1) {
        mx /= push;
        my /= push;
      }
      // running is forward only, on your feet, with the weapon down and your hands free; it also stands you up.
      // In the air you are whatever you were when you left the ground.
      if (p.grounded) {
        p.running = intent.run && my > 0.5 && aiming < 0.3 && push > 0.5 && !p.holding;
        if (p.running && p.crouched) p.crouched = false;
      }
      let top = p.crouched ? PLAYER.crouch : p.running ? PLAYER.run : aiming > 0.5 ? PLAYER.aimWalk : PLAYER.walk;
      if (p.holding) top = Math.min(top, PLAYER.holdWalk);

      const sin = Math.sin(p.yaw);
      const cos = Math.cos(p.yaw);
      const wantX = (-sin * my + cos * mx) * top;
      const wantZ = (-cos * my - sin * mx) * top;
      // feet on something: they grip. In the air there is little to push against, and less to stop you.
      const grip = p.grounded ? (push > 0.01 ? 11 : 14) : push > 0.01 ? PLAYER.airSteer : PLAYER.airDrag;
      p.vx = p.slide ? p.slide.vx : damp(p.vx, wantX, grip, dt);
      p.vz = p.slide ? p.slide.vz : damp(p.vz, wantZ, grip, dt);

      const beforeX = p.x;
      const beforeZ = p.z;
      moveBody(world.grid, p, p.vx * dt, p.vz * dt, PLAYER.radius, false, p.y);
      const moved = Math.hypot(p.x - beforeX, p.z - beforeZ);
      p.speed = dt > 0 ? moved / dt : 0;
      // A wall takes away the speed that ran into it. Only ever takes: being pushed OUT of something solid moves
      // the body further in one frame than it was going, and that is not speed gained.
      if (dt > 0) {
        const vx = (p.x - beforeX) / dt;
        const vz = (p.z - beforeZ) / dt;
        if (vx * vx + vz * vz <= p.vx * p.vx + p.vz * p.vz) {
          p.vx = vx;
          p.vz = vz;
        }
      }

      upAndDown(dt);

      p.stance = damp(p.stance, p.crouched ? PLAYER.eyeCrouch : PLAYER.eyeStand, 10, dt);
      p.eye = p.y + p.stance - p.dip;

      // leaning: standing or walking with your feet on something and your hands free — not at a run
      const want = clamp(intent.lean || 0, -1, 1);
      leanTo(p.grounded && !p.running && !p.holding ? want : 0, dt);

      // the walk: one "step" each time the bob passes a half turn — only while there is ground to step on, and
      // feet under the body to step with
      if (p.grounded && !p.slide) {
        const before = Math.floor(p.bob / Math.PI);
        p.bob += moved * (p.crouched ? 2.6 : p.running ? 1.75 : 2.1);
        if (Math.floor(p.bob / Math.PI) !== before && p.speed > 0.8) p.stepped = true;
        const sway = clamp(p.speed / PLAYER.walk, 0, 1.4);
        p.bobY = Math.sin(p.bob * 2) * 0.028 * sway;
      } else p.bobY = damp(p.bobY, 0, 10, dt);

      if (p.sinceHit > PLAYER.regenDelay && p.health < PLAYER.health)
        p.health = Math.min(PLAYER.health, p.health + PLAYER.regenRate * dt);
    },

    /** Takes a hit that came from (fromX, fromZ). */
    damage(amount, fromX, fromZ) {
      if (!p.alive) return;
      p.health = Math.max(0, p.health - amount);
      p.damageTaken += amount;
      p.sinceHit = 0;
      p.hitFlash = 1;
      // the angle of the shooter relative to where the player looks: 0 ahead, + to the left
      p.hitYaw = Math.atan2(-(fromX - p.x), -(fromZ - p.z)) - p.yaw;
    },

    /** How far a guard can hear the player's feet right now, in metres. Feet in the air make no sound. */
    get footNoise() {
      if (!p.grounded || p.speed < 0.8) return 0;
      if (p.crouched) return 0;
      return p.running ? 9 : 3.5;
    },
  };

  /**
   * Tips the body towards `target` (−1 left … 1 right) and puts the head where that takes it: along the body's
   * right, as far as it can go before it meets something solid at the height of the eye (Grid.reach).
   */
  function leanTo(target, dt) {
    p.lean = damp(p.lean, target, PLAYER.leanRate, dt);
    if (target === 0 && Math.abs(p.lean) < 0.002) p.lean = 0;
    if (p.lean === 0) {
      p.leanK = 0;
      p.headX = p.x;
      p.headZ = p.z;
      return;
    }
    const side = p.lean > 0 ? 1 : -1;
    // right of the way you face: (cos yaw, −sin yaw)
    const dx = Math.cos(p.yaw) * side;
    const dz = -Math.sin(p.yaw) * side;
    const got = world.grid.reach(p.x, p.z, p.eye, dx, dz, Math.abs(p.lean) * PLAYER.lean, PLAYER.headRadius);
    p.headX = p.x + dx * got;
    p.headZ = p.z + dz * got;
    p.leanK = (side * got) / PLAYER.lean;
  }

  /**
   * The feet: resting on whatever is under them, leaving it, falling, and coming back down.
   * What is "under them" is the ground, or the top of anything with a flat top that the body is over and level
   * with (Grid.floorUnder); what is over the head is the lowest ceiling (Grid.ceilingOver).
   */
  function upAndDown(dt) {
    const grid = world.grid;
    const floor = grid.floorUnder(p.x, p.z, PLAYER.radius, p.y);
    if (p.grounded) {
      if (p.y - floor > PLAYER.stepDown) {
        // walked off an edge
        p.grounded = false;
        p.airT = 0;
        p.vy = 0;
      } else {
        p.y = floor;
        p.vy = 0;
        p.airT = 0;
        return;
      }
    }
    p.airT += dt;
    p.y += p.vy * dt - 0.5 * PLAYER.gravity * dt * dt;
    p.vy -= PLAYER.gravity * dt;
    const head = grid.ceilingOver(p.x, p.z, PLAYER.radius) - PLAYER.height;
    if (p.y > head) {
      p.y = Math.max(floor, head);
      if (p.vy > 0) p.vy = 0;
    }
    if (p.y <= floor && p.vy <= 0) {
      p.landed = Math.max(0.01, -p.vy);
      p.dip = Math.min(0.12, p.landed * 0.02);
      p.y = floor;
      p.vy = 0;
      p.grounded = true;
      p.airT = 0;
    }
  }

  return p;
}

// The slide, joined to the game: the body dropped at a run and carried on along the floor, and the sentry in its
// way. The rules are src/wild/slide.js; the design is docs/WILD.md, "The slide".
import { SLIDE, canSlide, inTheWay, speedAt } from './slide.js';
import { SLIDE_SOUNDS } from './slide-sounds.js';
import { clamp01, damp } from '../core/math.js';

export function createSlideLive(ctx) {
  const { G } = ctx;
  const { player, enemies, audio } = G;
  const { moveBody } = ctx.lib;
  /** the slide under way: null, or { t, dir: [x, z] } — how long it has lasted, and which way it goes */
  let slide = null;
  /** seconds before another can begin */
  let rest = 0;
  let fov = 1;
  /** machines being shoved on along a slide that met them: { unit, dx, dz, left } */
  const shoved = [];
  /** what the body is carried at (src/player.js `slide`), and what is asked of it meanwhile: one object each */
  const carry = { vx: 0, vz: 0 };
  const body = {};

  function end() {
    slide = null;
    player.slide = null;
    rest = SLIDE.rest;
  }

  /**
   * A sentry was in the way: it is stopped as an EMP stops one — helpless, sparking — and shoved on; and the body
   * that ran into it stops there, in front of it, with no speed left.
   */
  function knock(unit) {
    enemies.stun(unit.x, 1.2, unit.z, 0.2, SLIDE.knock.stun, 0.2);
    // (when it comes round it looks to where what stopped it came from: enemies/index.js)
    unit.empX = player.x;
    unit.empZ = player.z;
    shoved.push({ unit, dx: slide.dir[0], dz: slide.dir[1], left: SLIDE.knock.shove });
    audio.play('hitMachine', { x: unit.x, y: 0.6, z: unit.z, gain: 1.5, rate: 0.7 });
    G.fx.sparks(unit.x, 0.5, unit.z, -slide.dir[0], 0.6, -slide.dir[1], 8, 1, 0.8, 0.5, 3.5);
    G.fx.shake(0.05);
    ctx.note('SENTRY STAGGERED');
    ctx.tally.knocked = (ctx.tally.knocked || 0) + 1;
    ctx.say('knocked');
  }

  return {
    name: 'slide',
    /** for tests and the curious */
    get sliding() {
      return slide !== null;
    },
    brief: (touch) =>
      touch
        ? [['', 'SLIDE', 'CROUCH at a run: a sentry in the way staggers']]
        : [['C', 'SLIDE', 'at a run: a sentry in the way is staggered']],
    controls: [
      ['Slide: a sentry in the way is staggered, and helpless', 'C at a run. Space jumps out of it', 'CROUCH at a run'],
    ],
    tallies: { knocked: 'Sentries staggered by a slide' },
    sounds: { sounds: SLIDE_SOUNDS },

    reset() {
      slide = null;
      player.slide = null;
      rest = 0;
      fov = 1;
      shoved.length = 0;
    },

    step(dt, own, intent) {
      // a machine a slide has met goes on a little way with it (the world's seconds: it is a machine's motion)
      for (let i = shoved.length - 1; i >= 0; i--) {
        const s = shoved[i];
        const go = Math.min(s.left, 5 * dt);
        if (!s.unit.dead) moveBody(G.world.grid, s.unit, s.dx * go, s.dz * go, s.unit.spec.radius);
        s.left -= go;
        if (s.left <= 1e-6 || s.unit.dead) shoved.splice(i, 1);
      }

      rest = Math.max(0, rest - own);
      if (!slide) {
        if (!intent.crouchToggle || ctx.flying) return;
        const { running, speed, grounded, holding, alive } = player;
        if (!canSlide({ running, speed, grounded, holding, alive, rest })) return;
        const v = Math.hypot(player.vx, player.vz) || 1;
        slide = { t: 0, dir: [player.vx / v, player.vz / v] };
        audio.play('slideGo', { gain: 0.9 });
        ctx.buzz('slide', 1);
        enemies.noise(player.x, player.z, SLIDE.noise);
      } else {
        // it is over when it has run out — or the feet have left the ground (a jump out of it keeps its speed), the
        // hands are full, or a wall has taken the speed off it
        const was = speedAt(slide.t);
        slide.t += own;
        const gone =
          slide.t >= SLIDE.seconds ||
          !player.grounded ||
          !player.alive ||
          player.holding ||
          ctx.flying ||
          player.speed < was * SLIDE.stopped;
        if (gone) return void end();
      }

      // a sentry in the way: one that can be staggered (not the player's own, and not one already stopped)
      const met = enemies.list.filter(
        (unit) =>
          !unit.dead &&
          unit.type === 'sentry' &&
          !unit.turned &&
          unit.stunT <= 0 &&
          inTheWay(player.x, player.z, slide.dir, unit.x, unit.z),
      );
      if (met.length) {
        for (const unit of met) knock(unit);
        player.vx = player.vz = 0;
        return void end();
      }

      const v = speedAt(slide.t);
      carry.vx = slide.dir[0] * v;
      carry.vz = slide.dir[1] * v;
      player.slide = carry;
      player.crouched = true;
      // lower than a crouch: down quickly, and up again as it ends (the knees' own give, src/player.js `dip`)
      const k = clamp01(slide.t / 0.12) * clamp01((SLIDE.seconds - slide.t) / 0.2);
      player.dip = Math.max(player.dip, SLIDE.low * k);

      // what is asked of the body meanwhile: everything the player asks but where to go and how to stand
      Object.assign(body, intent);
      body.moveX = body.moveY = body.lean = 0;
      body.run = body.crouchToggle = false;
      return body;
    },

    frame(real) {
      fov = damp(fov, slide ? SLIDE.fov : 1, 10, real);
      if (Math.abs(fov - 1) < 0.0005 && !slide) fov = 1;
    },

    get fov() {
      return fov;
    },
  };
}

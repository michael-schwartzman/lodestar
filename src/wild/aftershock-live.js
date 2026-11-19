// Aftershocks, joined to the game: the floor that jumps, the dust that comes down off the roof, what goes off in
// the hall behind you. When one comes and how hard is src/wild/aftershock.js; the design is docs/WILD.md,
// "Aftershocks". It hurts nobody and stops nothing: it is what the mountain looks and sounds like, coming apart.
//
// It has no sound of its own. One was made four times (17 November 2026) — a rumble of the rock itself — and a
// model that listens (tools/sound/listen.mjs) never once took it for what it was meant to be: the first two were
// nine-tenths under 60 Hz, where a laptop's speaker says nothing, and were heard as "footsteps" and "twigs";
// the next two, put where they could be heard, as "wind" and "a Geiger counter". So what is heard is what the
// story says is happening: more of the hall coming down (the game's own `cascadeBlast`, from where the hall is,
// lower and smaller), and for the hard ones something going off in it (`explosion`).
import { createAftershock, stepAftershock, urgency } from './aftershock.js';

/** the cascade hall, where what goes off goes off (main.js has the same) */
const HALL = { x: 51, y: 2.5, z: 29 };
/** dust comes off a built ceiling at this height, and is seen leaving the cavern's rock no higher than this */
const CEILING = 3;
const SEEN = 4.5;
/** it comes down in stages, this far apart in height and in seconds, and what it shook loose lands after it */
const STAGE = { down: 0.7, every: 0.16 };

export function createAftershockLive(ctx) {
  const { G } = ctx;
  let missions = 0;
  let a = createAftershock(1);
  /** what the clock stood at when the lodestar went up: how pressed things are is measured against it */
  let clock0 = 0;
  /** dust on its way down, and chips still to land: { at (mission seconds), x, y, z, land } */
  let falling = [];
  /** for tests and the curious: the last one, and how many of its falls found a roof to come off */
  let last = null;

  return {
    name: 'aftershock',
    get state() {
      return { count: a.count, wait: a.wait, clock0, last, falling: falling.length };
    },
    tallies: { aftershocks: 'Aftershocks you ran through' },

    reset() {
      // (a seed a mission: the same from the same, and not the same twice running)
      a = createAftershock(++missions * 7919);
      clock0 = 0;
      falling = [];
      last = null;
    },

    step(dt) {
      const m = G.mission;
      if (!m) return;
      // (a clock nobody saw start — a retry from a checkpoint — is taken as it stands)
      if (m.phase === 'exfil' && !clock0) clock0 = m.clock;
      const shock = stepAftershock(a, dt, urgency(m, clock0));
      if (shock) {
        G.fx.shake(shock.shake);
        ctx.buzz('aftershock', shock.strength);
        // more of the hall coming down, heard from where the hall is — and, when it is a hard one, something
        // going off in it (no two at the same pitch: they are not the same thing falling)
        G.audio.play('cascadeBlast', {
          ...HALL,
          gain: 0.25 + 0.45 * shock.strength,
          rate: 0.75 + 0.2 * Math.random(),
        });
        if (shock.secondary) G.audio.play('explosion', { ...HALL, gain: 0.3 + 0.4 * shock.strength });
        let fell = 0;
        for (const [dx, dz] of shock.falls) {
          const x = G.player.x + dx;
          const z = G.player.z + dz;
          // off a roof — a built ceiling, or the cavern's rock — and into a place there is: not out of the
          // sky, and not inside a wall
          if (G.world.openSky(x, z) || !G.world.grid.walkable(Math.floor(x), Math.floor(z), true)) continue;
          const top = G.world.indoors(x, z) ? CEILING : Math.min(G.world.roofAt(x, z) - 0.3, SEEN);
          let at = m.time;
          for (let y = top; y > 0.6; y -= STAGE.down, at += STAGE.every)
            falling.push({ at, x, y, z, land: false, first: y === top });
          falling.push({ at: at + 0.1, x, y: 0.1, z, land: true });
          fell++;
        }
        if (a.count === 1) ctx.note('THE MOUNTAIN IS MOVING', 'warn');
        ctx.say('aftershock');
        ctx.tally.aftershocks = (ctx.tally.aftershocks || 0) + 1;
        last = { ...shock, fell, at: m.time };
      }
      if (falling.length) {
        const due = falling.filter((f) => f.at <= m.time);
        if (due.length) falling = falling.filter((f) => f.at > m.time);
        for (const f of due) {
          if (f.land) G.audio.play('hitWall', { x: f.x, y: f.y, z: f.z, gain: 0.3 });
          // (where it leaves the roof there is more of it; it is pale, as dust is that has light on it)
          else G.fx.dust(f.x, f.y, f.z, 0, -1, 0, f.first ? 7 : 4, 1.6, f.first ? 1.1 : 0.85);
        }
      }
    },

    on: {
      phase(phase) {
        if (phase === 'exfil' && G.mission) clock0 = G.mission.clock;
      },
    },

    // (a retry from a checkpoint keeps how many there have been — so that the first of them is not announced
    // again — and what the clock started at)
    save: () => ({ count: a.count, clock0 }),
    load(kept) {
      a.count = kept.count;
      clock0 = kept.clock0;
    },
  };
}

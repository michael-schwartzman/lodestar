// A thrown magnet, joined to the game: the key, the throw, the stick, the clamp, the field, the crush. The
// rules are src/wild/lodestone.js; the design is docs/WILD-lodestone.md (docs/WILD.md, "The lodestone", has the short of it).
//
// Only three.js, core/math.js and ctx.lib (src/main.js) are imported here besides the feature's own files — see
// docs/WILD.md and the header of src/wild/index.js for why: this file, and the second look's, must stay the only
// two that pull in the game's drawing modules, or the bundler stops treating the experiment as one script.
import * as THREE from 'three';
import {
  LODESTONE,
  clamps,
  createLodestone,
  crushDamage,
  gainLodestone,
  inField,
  pullDroneY,
  pullStep,
  resetLodestone,
  stepLodestone,
  stickLodestone,
  throwLodestone,
} from './lodestone.js';
import { LODESTONE_LOOPS, LODESTONE_SOUNDS } from './lodestone-sounds.js';

/** cold light: the field while it holds, and the flash/ring the crush leaves (a little brighter, a little whiter) */
const FIELD_COLOR = { r: 0.35, g: 0.78, b: 1 };
const CRUSH_COLOR = { r: 0.6, g: 0.85, b: 1 };
/** while awake, how often a ring pulses in and a held machine sparks (seconds) */
const RING_PERIOD = 0.4;
const SPARK_PERIOD = 0.22;
/** how fast the tether to each held machine flickers (cycles per second) */
const FLICKER_HZ = 9;
/** no farther than this does the crush still rattle the camera (metres) */
const SHAKE_REACH = 15;
/** a machine on its feet is pulled, sighted and crushed as though it stood about this high (the EMP's own stun
 * uses the same) */
const GROUND_EYE = 1.2;
/** the field says how many it has taken this long after it wakes; the crush says its own count the instant it
 * happens */
const WAKE_NOTE_DELAY = 0.5;
/** tethers drawn at once, across every stone alive — generous: never built or thrown away once the pool exists */
const MAX_BEAMS = 24;

/** A stone's look: a dark body, a band that always glows — a little brighter while awake. One mesh pool entry;
 * never more of them than LODESTONE.carry, and never built or thrown away once the pool exists. */
function makeVisual(ctx) {
  const { glow, lit, ownMaterials } = ctx.lib;
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.12, 1),
    lit({ color: 0x24262b, rough: 0.55, metal: 0.3 }),
  );
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.026, 8, 20), glow({ color: 0x55d6ff, intensity: 1.3 }));
  band.rotation.x = Math.PI / 2;
  root.add(body, band);
  root.visible = false;
  ctx.scene.add(root);
  return { root, mats: ownMaterials(root), band, inUse: false };
}

/** One tether of light from a stone to a machine it holds: a thin glowing cylinder, aimed fresh every frame (the
 * stone sits still; the machine is dragged, so the two ends move independently of one another). */
function makeBeam(ctx) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1, 6, 1, true),
    ctx.lib.glow({ color: 0x55d6ff, intensity: 1.6, opacity: 0.55 }),
  );
  mesh.visible = false;
  ctx.scene.add(mesh);
  return mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _dir = new THREE.Vector3();

/** Stands a beam mesh between two points: at their midpoint, as long as they are apart, turned from pointing up
 * to pointing from `a` to `b` — works whichever way the two ends sit relative to one another, not just level. */
function aimBeam(mesh, ax, ay, az, bx, by, bz) {
  _dir.set(bx - ax, by - ay, bz - az);
  const len = _dir.length();
  if (len < 1e-4) {
    mesh.visible = false;
    return;
  }
  _dir.multiplyScalar(1 / len);
  mesh.visible = true;
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  mesh.quaternion.copy(_q.setFromUnitVectors(UP, _dir));
  mesh.scale.set(1, len, 1);
}

/** The height a machine's field, sight and crush are measured to: a drone, where it is; one on its feet, about
 * its middle. */
const eyeHeightOf = (unit) => (unit.spec.flying ? unit.y : GROUND_EYE);

export function createLodestoneLive(ctx) {
  const { G } = ctx;
  const { setProbe, moveBody } = ctx.lib;
  const grid = G.world.grid;
  const solidAt = (x, z, lo, hi) => grid.solidAt(x, z, lo, hi);
  const sight = (ax, ay, az, bx, by, bz) => grid.sight(ax, ay, az, bx, by, bz);
  const lode = createLodestone();
  const pool = Array.from({ length: LODESTONE.carry }, () => makeVisual(ctx));
  const beamPool = Array.from({ length: MAX_BEAMS }, () => makeBeam(ctx));
  /** pure stone object -> { visual, field: loop handle | null, ringT, sparkT, noteAt: seconds left to the
   * delayed "N HELD" note, -1 once said } */
  const live = new Map();
  /** a machine currently held -> the one stone holding it: at most one field has a machine at a time */
  const heldBy = new Map();
  /** a held machine -> seconds it has been held (the ease-in pull law needs its own clock, not the stone's) */
  const heldT = new Map();
  /** a held machine -> the tether mesh drawn to it, while one is spare in the pool */
  const beamOf = new Map();
  /** a stone still in flight, clamped onto a machine -> that machine: it rides there until the machine dies,
   * carried along wherever the machine goes, awake or not (the stone is physically stuck to it) */
  const clampedUnit = new Map();
  const tint = new THREE.Color();

  function take(stone) {
    const slot = pool.find((p) => !p.inUse);
    slot.inUse = true;
    slot.root.visible = true;
    live.set(stone, { visual: slot, field: null, ringT: 0, sparkT: 0, noteAt: -1 });
  }

  function beamFor(unit) {
    let mesh = beamOf.get(unit);
    if (mesh) return mesh;
    const used = new Set(beamOf.values());
    mesh = beamPool.find((m) => !used.has(m));
    if (mesh) beamOf.set(unit, mesh);
    return mesh;
  }

  function dropBeam(unit) {
    const mesh = beamOf.get(unit);
    if (mesh) mesh.visible = false;
    beamOf.delete(unit);
  }

  /** Whether `unit` may ever be taken by a lodestone, clamp or field alike: alive, not the player's own shield,
   * not a drone the player is flying, not a sentry the player has turned (src/wild/uplink-live.js), and not
   * already someone else's — at most one field has a machine at a time. */
  function eligible(unit) {
    return !unit.dead && unit !== G.enemies.held && !unit.piloted && !unit.turned;
  }

  /** A machine starts being held by `stone`, right now — a clamp mid-flight or the field's own scan once awake:
   * bookkept and frozen (stepHeld) from this very step, whichever it was. */
  function holdUnit(stone, unit) {
    heldBy.set(unit, stone);
    heldT.set(unit, 0);
    ctx.tally.pulled = (ctx.tally.pulled || 0) + 1;
  }

  /** A stone still in flight, scanning for a machine to clamp straight onto — the one case the rules file
   * cannot see for itself (lodestone.js knows no machines). The first eligible one close enough wins. */
  function findClamp(stone) {
    for (const unit of G.enemies.list) {
      if (!eligible(unit) || heldBy.has(unit)) continue;
      if (clamps(stone, { x: unit.x, y: eyeHeightOf(unit), z: unit.z, flying: unit.spec.flying })) return unit;
    }
    return null;
  }

  /** A stone clamped onto a machine rides it for as long as both exist: its position copied onto the stone's
   * every step, so the stone's visual, its tether and the field it opens when it wakes all sit where the
   * machine actually is. Once the machine is gone there is nothing left to ride: the stone simply stays put. */
  function trackClamped() {
    for (const [stone, unit] of clampedUnit) {
      if (unit.dead) {
        clampedUnit.delete(stone);
        continue;
      }
      stone.x = unit.x;
      stone.y = eyeHeightOf(unit);
      stone.z = unit.z;
    }
  }

  /**
   * A machine the field holds has become the player's since it was taken — flown (src/wild/pilot-live.js) or
   * turned (uplink-live.js): the field lets go of it there and then, before anything else of this step. (Found
   * in review, 17 November 2026: it would not TAKE such a machine, but went on holding one it had — the crush
   * hurt the drone the player was flying, and a sentry turned in its grip stood stopped, its forty seconds not
   * running, until it was crushed with the rest.) A stone clamped onto it stays where it is and rides no more.
   */
  function handOver() {
    for (const [unit, owner] of heldBy) {
      if (!unit.piloted && !unit.turned) continue;
      // (a flown drone's height and hands are the pilot's; a turned sentry acts at once)
      if (!unit.piloted) {
        unit.carried = false;
        unit.stunT = 0;
      }
      heldBy.delete(unit);
      heldT.delete(unit);
      dropBeam(unit);
      if (clampedUnit.get(owner) === unit) clampedUnit.delete(owner);
    }
  }

  /** Every machine this stone already holds: the one freeze every held machine gets, clamped or captured, awake
   * or not (stunT kept above nought — src/enemies/index.js, the contract above `inner`); a held drone is drawn
   * towards waist height the same way, whether or not the field has woken yet. Only once awake is it also
   * dragged horizontally towards the stone — eased in, never past the stop line, at any frame rate (pullStep).
   * A flown drone is passed over entirely: the hands on it are the player's (src/wild/pilot-live.js). */
  function stepHeld(dt) {
    for (const [unit, owner] of heldBy) {
      if (unit.piloted) continue;
      unit.stunT = 0.25;
      if (unit.spec.flying) {
        unit.carried = true;
        unit.y = pullDroneY(unit.y, dt);
      }
      if (!owner.awake) continue;
      const heldFor = (heldT.get(unit) || 0) + dt;
      heldT.set(unit, heldFor);
      const dx = owner.x - unit.x;
      const dz = owner.z - unit.z;
      const dxz = Math.hypot(dx, dz);
      if (dxz > 1e-4) {
        const step = pullStep(heldFor, dxz, dt);
        moveBody(grid, unit, (dx / dxz) * step, (dz / dxz) * step, unit.spec.radius, unit.spec.flying);
      }
    }
  }

  /** Once awake: every eligible machine newly in reach (inField — close, or a clear line from stone height) is
   * taken. Already-held machines (clamped before waking, or taken on an earlier step) are left alone here. */
  function captureField(stone) {
    for (const unit of G.enemies.list) {
      if (!eligible(unit) || heldBy.has(unit)) continue;
      if (inField(stone, unit.x, eyeHeightOf(unit), unit.z, sight)) holdUnit(stone, unit);
    }
  }

  /**
   * Lets go of every machine this stone holds: `carried` cleared, `stunT` left to decay on its own. Not a drone
   * the player has taken to fly since the field took hold of it: that one's height is the pilot's to keep, and
   * its hands are the player's (src/wild/pilot-live.js) — today's rule, kept.
   */
  function releaseHeld(stone) {
    for (const [unit, owner] of heldBy) {
      if (owner !== stone) continue;
      if (!unit.piloted) {
        unit.carried = false;
        unit.stunT = LODESTONE.releaseStun;
      }
      heldBy.delete(unit);
      heldT.delete(unit);
      dropBeam(unit);
    }
  }

  /** A stone is gone (the crush, a reset, the mission's end): let go, stop its loop, free its visual. */
  function drop(stone) {
    const v = live.get(stone);
    if (!v) return;
    releaseHeld(stone);
    clampedUnit.delete(stone);
    v.field?.stop(0.4);
    v.visual.inUse = false;
    v.visual.root.visible = false;
    live.delete(stone);
  }

  function dropAll() {
    for (const stone of live.keys()) drop(stone);
    heldBy.clear();
    heldT.clear();
    clampedUnit.clear();
    for (const mesh of beamPool) mesh.visible = false;
    beamOf.clear();
  }

  function sayWakeNote(stone) {
    let n = 0;
    for (const owner of heldBy.values()) if (owner === stone) n++;
    ctx.note(n ? `LODESTONE — ${n} HELD` : 'LODESTONE — NOTHING IN REACH', n ? '' : 'warn');
  }

  function sayCrushNote(crushed, hurt) {
    ctx.note(hurt ? `LODESTONE — ${crushed} CRUSHED · ${hurt} HURT` : `LODESTONE — ${crushed} CRUSHED`);
  }

  /** The field's hold ends: every machine it has HELD (not merely reached) is hurt by how close it got — never
   * the player. Dead ones get the destruction FX; survivors are left to releaseHeld (drop(), right after this).
   * Heard noiseRadius off; the camera shakes if the player is close enough. */
  function crush(stone) {
    let crushed = 0;
    let hurt = 0;
    for (const [unit, owner] of heldBy) {
      if (owner !== stone) continue;
      const uy = eyeHeightOf(unit);
      const d = Math.hypot(unit.x - stone.x, uy - stone.y, unit.z - stone.z);
      const died = G.enemies.damage(unit, crushDamage(d), stone.x, stone.z);
      if (died) {
        crushed++;
        G.fx.sparks(unit.x, uy, unit.z, 0, 1, 0, 14, CRUSH_COLOR.r, CRUSH_COLOR.g, CRUSH_COLOR.b, 6);
      } else hurt++;
    }
    ctx.tally.crushed = (ctx.tally.crushed || 0) + crushed;
    const y = Math.max(stone.y, 0.3);
    G.fx.puff('ring', stone.x, y, stone.z, 0, 0, 0, 0.5, 0.3, 7, CRUSH_COLOR.r, CRUSH_COLOR.g, CRUSH_COLOR.b, 0.8);
    G.fx.puff('add', stone.x, stone.y, stone.z, 0, 0, 0, 0.22, 1, 6, CRUSH_COLOR.r, CRUSH_COLOR.g, CRUSH_COLOR.b, 1);
    G.fx.light(stone.x, stone.y + 0.4, stone.z, CRUSH_COLOR.r * 1.6, CRUSH_COLOR.g * 1.6, CRUSH_COLOR.b * 1.6, 15, 0.4);
    G.audio.play('lodestoneBlow', { x: stone.x, y: stone.y, z: stone.z, gain: 1.3 });
    // felt, by how near it was: all of it within arm's reach, nothing past twenty metres
    ctx.buzz('crush', Math.max(0, 1 - Math.hypot(stone.x - G.player.x, stone.z - G.player.z) / 20));
    G.enemies.noise(stone.x, stone.z, LODESTONE.noiseRadius);
    if (Math.hypot(G.player.x - stone.x, G.player.z - stone.z) <= SHAKE_REACH) G.fx.shake(0.35);
    sayCrushNote(crushed, hurt);
  }

  function handleEvent(ev) {
    const v = live.get(ev.stone);
    if (!v) return;
    const { stone } = ev;
    if (ev.type === 'wake') {
      ctx.say('lodestone');
      G.audio.play('lodestoneWake', { x: stone.x, y: stone.y, z: stone.z });
      v.field = G.audio.loop('lodestoneField', { x: stone.x, y: stone.y, z: stone.z, gain: 1 });
      v.noteAt = WAKE_NOTE_DELAY;
      G.fx.puff(
        'ring',
        stone.x,
        Math.max(stone.y, 0.25),
        stone.z,
        0,
        0,
        0,
        0.5,
        0.4,
        LODESTONE.reach * 2,
        FIELD_COLOR.r,
        FIELD_COLOR.g,
        FIELD_COLOR.b,
        0.55,
      );
    } else if (ev.type === 'crush') {
      crush(stone);
      drop(stone);
    }
  }

  // A phone has no 4: there LODESTONE is a button of its own (the game's own `tb`), a row under the pause and
  // NV — it stands for the key (input.js `poke`), with the count on its face, so everything else here is the
  // same whether thrown by a key or a thumb.
  let button = null;
  let shownCount = -1;
  if (G.touch) {
    button = document.createElement('div');
    button.className = 'tb w-lode';
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', 'Lodestone');
    button.innerHTML = '<b>LODE</b><i></i>';
    button.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        G.input.poke('Digit4', true);
        G.input.poke('Digit4', false);
      },
      { passive: false },
    );
    ctx.overlay.append(button);
  }

  function showButton() {
    if (!button || lode.count === shownCount) return;
    shownCount = lode.count;
    button.querySelector('i').textContent = `×${lode.count}`;
    button.classList.toggle('out', lode.count <= 0);
  }

  return {
    name: 'lodestone',
    /** for tests and the curious: how many are carried, and every stone alive in the world — `rides` names the
     * machine a still-flying, clamped stone is riding (acceptance test G), or null */
    get state() {
      return {
        count: lode.count,
        stones: lode.stones.map((s) => ({
          x: s.x,
          y: s.y,
          z: s.z,
          t: s.t,
          stuck: s.stuck,
          awake: s.awake,
          held: [...heldBy.values()].filter((owner) => owner === s).length,
          rides: clampedUnit.get(s)?.name ?? null,
        })),
      };
    },
    brief: (touch) =>
      touch
        ? [['', 'LODESTONE', 'its own button: drags machines in, then crushes']]
        : [['4', 'LODESTONE', 'a thrown magnet: drags machines in, then crushes']],
    controls: [['Lodestone: a thrown magnet drags machines to it, holds them, then crushes', '4', 'LODE, below NV']],
    tallies: { pulled: 'Machines pulled by a lodestone', crushed: 'Machines crushed by a lodestone' },
    sounds: { sounds: LODESTONE_SOUNDS, loops: LODESTONE_LOOPS },

    reset() {
      dropAll();
      resetLodestone(lode);
      showButton();
    },

    step(dt, own, intent) {
      // (not while the hands are on a drone: the 4 is the body's)
      if (intent.hits.has('Digit4') && !ctx.flying) {
        if (lode.count <= 0) ctx.note('NO LODESTONE LEFT', 'warn');
        else {
          const stone = throwLodestone(lode, G.player, solidAt);
          if (stone) {
            take(stone);
            G.audio.play('grenadeThrow', { gain: 1.3 });
          }
        }
      }
      handOver();
      trackClamped();
      for (const ev of stepLodestone(lode, dt, solidAt)) handleEvent(ev);
      for (const stone of lode.stones) {
        if (stone.stuck) continue;
        const hit = findClamp(stone);
        if (!hit) continue;
        stickLodestone(stone, hit.x, eyeHeightOf(hit), hit.z);
        clampedUnit.set(stone, hit);
        holdUnit(stone, hit);
      }
      for (const stone of lode.stones) if (stone.awake) captureField(stone);
      stepHeld(dt);
      for (const [stone, v] of live) {
        if (v.noteAt < 0) continue;
        v.noteAt -= dt;
        if (v.noteAt <= 0) {
          v.noteAt = -1;
          sayWakeNote(stone);
        }
      }
    },

    frame(real) {
      showButton();
      for (const stone of lode.stones) {
        const v = live.get(stone);
        if (!v) continue;
        const { root, mats, band } = v.visual;
        root.position.set(stone.x, stone.y, stone.z);
        root.rotation.y += real * (stone.awake ? 0.6 : 2.4);
        G.world.probe(stone.x, stone.z, tint);
        setProbe(mats, tint);
        band.material.uniforms.uIntensity.value = stone.awake ? 2.2 : 1.3;
        v.field?.set({ x: stone.x, y: stone.y, z: stone.z });
        if (!stone.awake) continue;
        v.ringT -= real;
        if (v.ringT <= 0) {
          v.ringT = RING_PERIOD;
          G.fx.puff(
            'ring',
            stone.x,
            Math.max(stone.y, 0.25),
            stone.z,
            0,
            0,
            0,
            0.5,
            3.2,
            0.3,
            FIELD_COLOR.r,
            FIELD_COLOR.g,
            FIELD_COLOR.b,
            0.5,
          );
        }
        v.sparkT -= real;
        const doSpark = v.sparkT <= 0;
        if (doSpark) v.sparkT = SPARK_PERIOD;
        for (const [unit, owner] of heldBy) {
          if (owner !== stone || unit.piloted) continue;
          const uy = eyeHeightOf(unit);
          if (doSpark) G.fx.sparks(unit.x, uy, unit.z, 0, 1, 0, 4, FIELD_COLOR.r, FIELD_COLOR.g, FIELD_COLOR.b, 3);
          const beam = beamFor(unit);
          if (!beam) continue;
          const flicker = 0.65 + 0.35 * Math.sin(stone.t * FLICKER_HZ * Math.PI * 2 + (unit.rollId || 0));
          beam.material.uniforms.uIntensity.value = 1.6 * flicker;
          aimBeam(beam, stone.x, stone.y, stone.z, unit.x, uy, unit.z);
        }
        G.fx.light(stone.x, stone.y + 0.25, stone.z, FIELD_COLOR.r, FIELD_COLOR.g, FIELD_COLOR.b, 7, 0.35);
      }
    },

    on: {
      cache() {
        gainLodestone(lode);
      },
      // the mission is over: let go of everything, stop every field's loop (ammo is not reset here — reset() does)
      end() {
        dropAll();
        lode.stones.length = 0;
      },
    },

    chip() {
      return {
        key: '4',
        name: 'LODESTONE',
        text: `×${lode.count}`,
        level: lode.count / LODESTONE.carry,
        tone: lode.count ? '' : 'out',
      };
    },

    save: () => ({ count: lode.count }),
    load(kept) {
      lode.count = kept.count;
    },
  };
}

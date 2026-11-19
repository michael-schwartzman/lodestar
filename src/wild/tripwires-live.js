// Threads of light, joined to the game: what they look like, and what happens when one is crossed or shot. The
// rules are src/wild/tripwires.js; the design is docs/WILD.md, "Threads of light".
import * as THREE from 'three';
import { createTripwires } from './tripwires.js';

/** The colour of every thread and emitter, bare: red, the shade a sensor's own light is. */
const COLOR = 0xff2a2a;
/** Faint to the bare eye — the shared night-vision shading (src/gfx/materials.js) brightens it on its own. */
const THREAD_INTENSITY = 0.55;
const EMITTER_INTENSITY = 1.05;
/** A dead or EMP'd emitter's own glow: not gone, just dark. */
const EMITTER_DARK = 0.05;
const THREAD_RADIUS = 0.018;
const EMITTER_SIZE = 0.16;
/** How long a beam flickers once an EMP lets go of it, before it settles to a steady light again. */
const FLICKER_SECONDS = 0.6;
/** How fast it flickers while it does. */
const FLICKER_HZ = 7;

/**
 * @param {object} ctx  G, scene, act, overlay, tally, say, note — and lib: { glow, … } (see src/wild/index.js)
 */
export function createTripwiresLive(ctx) {
  const { G, scene } = ctx;
  const { glow } = ctx.lib;
  const rules = createTripwires();

  const group = new THREE.Group();
  group.name = 'wild-tripwires';
  scene.add(group);

  // one shared shape for every thread, and one for every emitter: each mesh only scales, turns and lights
  // itself differently (the same economy src/markers.js uses for its own repeated shapes)
  const threadGeometry = new THREE.CylinderGeometry(THREAD_RADIUS, THREAD_RADIUS, 1, 8);
  const emitterGeometry = new THREE.BoxGeometry(EMITTER_SIZE, EMITTER_SIZE, EMITTER_SIZE);

  /** beam id -> { thread, emitter, threadMat, emitterMat, flickerT, wasOut } */
  const visuals = new Map();
  for (const def of rules.beams) {
    const dx = def.x1 - def.x0;
    const dz = def.z1 - def.z0;
    const length = Math.hypot(dx, dz);

    const threadMat = glow({ color: COLOR, intensity: THREAD_INTENSITY, additive: true });
    const thread = new THREE.Mesh(threadGeometry, threadMat);
    thread.name = `tripwire-thread-${def.id}`;
    thread.position.set((def.x0 + def.x1) / 2, def.y, (def.z0 + def.z1) / 2);
    thread.scale.y = length;
    // the cylinder's own axis is Y: turned onto Z for a beam that runs north-south, onto X for one east-west
    if (Math.abs(dx) > Math.abs(dz)) thread.rotation.z = Math.PI / 2;
    else thread.rotation.x = Math.PI / 2;
    group.add(thread);

    const emitterMat = glow({ color: COLOR, intensity: EMITTER_INTENSITY, additive: true });
    const emitter = new THREE.Mesh(emitterGeometry, emitterMat);
    emitter.name = `tripwire-emitter-${def.id}`;
    emitter.position.set(def.emitter.x, def.emitter.y, def.emitter.z);
    group.add(emitter);

    visuals.set(def.id, { thread, emitter, threadMat, emitterMat, flickerT: 0, wasOut: false });
  }

  /** Sets a beam's meshes to how it looks right now — live, flickering back, or dark — nothing else. */
  function look(v, b) {
    const out = b.dead || b.empT > 0;
    if (v.flickerT > 0) {
      const on = Math.sin(v.flickerT * FLICKER_HZ * 2 * Math.PI) > 0;
      v.thread.visible = on;
      v.emitter.visible = true;
      v.emitterMat.uniforms.uIntensity.value = on ? EMITTER_INTENSITY : EMITTER_DARK;
    } else if (out) {
      v.thread.visible = false;
      v.emitter.visible = true;
      v.emitterMat.uniforms.uIntensity.value = EMITTER_DARK;
    } else {
      v.thread.visible = true;
      v.emitter.visible = true;
      v.threadMat.uniforms.uIntensity.value = THREAD_INTENSITY;
      v.emitterMat.uniforms.uIntensity.value = EMITTER_INTENSITY;
    }
  }

  return {
    name: 'tripwires',
    brief: [['', 'TRIPWIRES', 'jump the low, duck the high, or shoot them out']],
    controls: [
      [
        'Tripwires: a thread of light across a door calls the alarm',
        'Space over a low one, C under a high one. A round in its emitter, or an EMP, puts it out',
        'JUMP over, CROUCH under. Or shoot its emitter, or an EMP',
      ],
    ],
    tallies: { tripped: 'Tripwires tripped', beamsOut: 'Emitters shot out' },
    /** for tests and the curious */
    get beams() {
      return rules.beams;
    },

    reset() {
      rules.reset(G.player.x, G.player.z);
      for (const b of rules.beams) {
        const v = visuals.get(b.id);
        v.flickerT = 0;
        v.wasOut = false;
        look(v, b);
      }
    },

    step(dt) {
      const tripped = rules.step(dt, {
        x: G.player.x,
        z: G.player.z,
        y: G.player.y,
        crouched: G.player.crouched,
        hidden: G.player.hidden,
        alive: G.player.alive,
        playing: G.state === 'playing',
      });
      for (const { beam } of tripped) {
        const mx = (beam.x0 + beam.x1) / 2;
        const mz = (beam.z0 + beam.z1) / 2;
        if (G.enemies.alert(mx, mz)) {
          G.enemies.alarm.count++;
          ctx.act.siren();
        }
        // …and machines for it, the first time this doorway's thread is broken (src/wild/response.js): the
        // lobby's two beams are one doorway
        const coming = ctx.respond('tripwire', { x: mx, z: mz }, { key: `${mx},${mz}`, why: 'the wire', quiet: true });
        ctx.note('TRIPWIRE', 'bad');
        ctx.act.radio('Overwatch', `Tripwire — ${beam.place}.${coming ? ` ${coming}` : ''}`, coming ? 7 : 5);
        ctx.say('tripwire', beam);
        ctx.tally.tripped = (ctx.tally.tripped || 0) + 1;
      }
    },

    frame(real) {
      for (const b of rules.beams) {
        const v = visuals.get(b.id);
        const out = b.dead || b.empT > 0;
        if (v.wasOut && !out) v.flickerT = FLICKER_SECONDS;
        else if (v.flickerT > 0) v.flickerT = Math.max(0, v.flickerT - real);
        v.wasOut = out;
        look(v, b);
      }
    },

    shot(ox, oy, oz, dx, dy, dz, max) {
      const met = rules.shot(ox, oy, oz, dx, dy, dz, max);
      if (!met) return null;
      return {
        t: met.t,
        hit() {
          rules.markDead(met.beam);
          G.enemies.noise(met.beam.emitter.x, met.beam.emitter.z, 8);
          ctx.note('TRIPWIRE OUT');
          ctx.tally.beamsOut = (ctx.tally.beamsOut || 0) + 1;
        },
      };
    },

    on: {
      emp(x, z, seconds) {
        rules.onEmp(x, z, seconds);
      },
    },

    save: () => rules.save(),
    load(state) {
      rules.load(state);
    },
  };
}

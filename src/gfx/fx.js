// Everything short-lived that you see: flashes, sparks, smoke, tracers, bullet holes, blasts, and the brief
// lights they throw. Nothing here decides anything; the game calls in and this draws.
import * as THREE from 'three';
import { Billboards } from './billboards.js';
import { glow, lit, shared, MAX_DYN_LIGHTS } from './materials.js';

const ADD = 0;
const ALPHA = 1;

/** Is what a round met (world/grid.js `raycast`) made of metal? It sparks and rings; the rest is dust and a thud. */
export const isMetal = (what) => what === 'prop' || what === 'door' || what === 'wreck' || what === 'casing';
/**
 * Does what a round met keep its mark? A mark stays where it was made — and a door slides away from under it,
 * the skin of a casing turns under it, and the heap a round meets where the cascades came down is not the
 * wreckage that is drawn: none of those keeps one.
 */
export const keepsMark = (what) => what !== 'door' && what !== 'wreck' && what !== 'casing';

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {Record<string, THREE.Texture>} o.textures
 * @param {number} o.amount     how many particles to allow, 0.5 … 1.5 (from the detail level)
 * @param {{ probe(x: number, z: number, out: THREE.Color): THREE.Color }} o.world
 */
export function createFx({ scene, textures, amount = 1, world }) {
  const capacity = Math.round(520 * amount);
  const batches = [
    new Billboards({ capacity, map: textures.flare, additive: true }),
    new Billboards({ capacity: Math.round(capacity * 0.6), map: textures.puff, additive: false }),
  ];
  const sparkBatch = new Billboards({ capacity: Math.round(capacity * 0.7), map: textures.spark || textures.flare });
  const ringBatch = new Billboards({ capacity: 12, map: textures.ring || textures.flare });
  for (const b of [...batches, sparkBatch, ringBatch]) scene.add(b.mesh);

  // one flat list of particles; `kind` says which batch draws it
  const P = [];
  const spawn = (kind, x, y, z, vx, vy, vz, life, size0, size1, r, g, b, a, o = {}) => {
    const cap = kind === ALPHA ? batches[1].capacity : kind === 2 ? sparkBatch.capacity : kind === 3 ? 12 : capacity;
    if (P.length > capacity * 2.4 || cap <= 0) return;
    P.push({
      kind,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      life,
      age: 0,
      size0,
      size1,
      r,
      g,
      b,
      a,
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 0,
      rot: o.rot ?? Math.random() * 6.283,
      spin: o.spin ?? 0,
      fadeIn: o.fadeIn ?? 0,
      floor: o.floor ?? false,
    });
  };

  // ---------- short-lived lights ----------
  const lights = Array.from({ length: MAX_DYN_LIGHTS }, () => ({
    x: 0,
    y: -999,
    z: 0,
    r: 0,
    g: 0,
    b: 0,
    radius: 1,
    life: 0,
    span: 1,
  }));
  function light(x, y, z, r, g, b, radius, seconds) {
    let slot = lights[0];
    let weakest = Infinity;
    for (const l of lights) {
      const strength = l.life <= 0 ? 0 : (l.r + l.g + l.b) * (l.life / l.span);
      if (strength < weakest) {
        weakest = strength;
        slot = l;
      }
    }
    Object.assign(slot, { x, y, z, r, g, b, radius, life: seconds, span: seconds });
  }

  // ---------- tracers ----------
  const tracerGeometry = new THREE.BoxGeometry(0.035, 0.035, 1).translate(0, 0, -0.5);
  const tracerMaterials = {
    player: glow({ color: 0xfff0c8, intensity: 0.75, additive: true }),
    sentry: glow({ color: 0xff7a2e, intensity: 1.6, additive: true }),
    drone: glow({ color: 0x5ce8ff, intensity: 1.6, additive: true }),
  };
  const tracers = Array.from({ length: 28 }, () => {
    const mesh = new THREE.Mesh(tracerGeometry, tracerMaterials.player);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, t: 0, span: 0, ax: 0, ay: 0, az: 0, dx: 0, dy: 0, dz: 0, dist: 0, len: 0 };
  });
  const aim = new THREE.Vector3();
  function tracer(ax, ay, az, bx, by, bz, kind = 'player') {
    const tr = tracers.find((t) => !t.mesh.visible) || tracers[0];
    const dist = Math.hypot(bx - ax, by - ay, bz - az);
    if (dist < 1.5) return;
    Object.assign(tr, { ax, ay, az, dx: (bx - ax) / dist, dy: (by - ay) / dist, dz: (bz - az) / dist, dist, t: 0 });
    tr.len = Math.min(dist * 0.5, kind === 'player' ? 7 : 5);
    tr.span = dist / (kind === 'player' ? 340 : 190);
    tr.mesh.material = tracerMaterials[kind] || tracerMaterials.player;
    tr.mesh.visible = true;
    tr.mesh.scale.set(kind === 'player' ? 0.7 : 1.3, kind === 'player' ? 0.7 : 1.3, tr.len);
    aim.set(ax + tr.dx, ay + tr.dy, az + tr.dz);
    tr.mesh.position.set(ax, ay, az);
    tr.mesh.lookAt(aim);
  }

  // ---------- marks left on surfaces ----------
  const up = new THREE.Vector3(0, 0, 1);
  const normal = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const tint = new THREE.Color();
  function decalPool(map, count, size, name) {
    const material = lit({ map, transparent: true });
    material.depthWrite = false;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 5;
    scene.add(mesh);
    let next = 0;
    let used = 0;
    let added = 0;
    /** where each mark takes its light from: a little off the surface it is on (x, z) */
    const lightFrom = new Float32Array(count * 2);
    const takeLight = (n) => {
      // a mark is lit like the wall it is on; the probe is the nearest thing to that
      world.probe(lightFrom[n * 2], lightFrom[n * 2 + 1], tint);
      mesh.setColorAt(n, tint.multiplyScalar(1.5));
    };
    return {
      mesh,
      /** how many marks have ever been left (tests count them) */
      get added() {
        return added;
      },
      add(x, y, z, nx, ny, nz, s = size) {
        added++;
        normal.set(nx, ny, nz);
        quat.setFromUnitVectors(up, normal);
        position.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
        scale.set(s, s, s);
        mesh.setMatrixAt(next, matrix.compose(position, quat, scale));
        lightFrom[next * 2] = x + nx * 0.3;
        lightFrom[next * 2 + 1] = z + nz * 0.3;
        takeLight(next);
        next = (next + 1) % count;
        used = Math.min(count, used + 1);
        mesh.count = used;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      },
      /** The light of the site has changed: every mark there is takes the light of its place again. */
      relight() {
        if (!used) return;
        for (let n = 0; n < used; n++) takeLight(n);
        mesh.instanceColor.needsUpdate = true;
      },
      clear() {
        next = 0;
        used = 0;
        mesh.count = 0;
      },
    };
  }
  const holes = textures.hole ? decalPool(textures.hole, 72, 0.13, 'holes') : null;
  const scorches = textures.scorch ? decalPool(textures.scorch, 10, 5, 'scorches') : null;

  // ---------- recipes ----------
  const rnd = (a, b) => a + Math.random() * (b - a);

  function sparks(x, y, z, nx, ny, nz, count, r = 1, g = 0.75, b = 0.4, speed = 5) {
    const n = Math.max(1, Math.round(count * amount));
    for (let i = 0; i < n; i++) {
      const vx = nx * rnd(0.3, 1) * speed + rnd(-1, 1) * speed * 0.55;
      const vy = ny * rnd(0.3, 1) * speed + rnd(-0.3, 1) * speed * 0.55;
      const vz = nz * rnd(0.3, 1) * speed + rnd(-1, 1) * speed * 0.55;
      spawn(2, x, y, z, vx, vy, vz, rnd(0.18, 0.5), rnd(0.05, 0.11), 0.01, r, g, b, 1, {
        gravity: 9,
        drag: 1.2,
        floor: true,
      });
    }
  }

  function dust(x, y, z, nx, ny, nz, count, shade = 0.5, size = 0.35) {
    world.probe(x + nx * 0.4, z + nz * 0.4, tint);
    const lum = 0.25 + (tint.r + tint.g + tint.b) * 0.5;
    const n = Math.max(1, Math.round(count * amount));
    for (let i = 0; i < n; i++)
      spawn(
        ALPHA,
        x + nx * 0.05,
        y + ny * 0.05,
        z + nz * 0.05,
        nx * rnd(0.3, 1.2) + rnd(-0.4, 0.4),
        ny * rnd(0.3, 1.2) + rnd(0, 0.5),
        nz * rnd(0.3, 1.2) + rnd(-0.4, 0.4),
        rnd(0.5, 1.1),
        size * rnd(0.5, 0.9),
        size * rnd(2, 3.2),
        shade * lum * tint.r,
        shade * lum * tint.g,
        shade * lum * tint.b,
        rnd(0.25, 0.42),
        { drag: 2.2, spin: rnd(-1, 1) },
      );
  }

  /** A bullet meets something. what: wall | floor | ceiling | prop | door | casing | wreck | machine */
  function impact(x, y, z, nx, ny, nz, what) {
    if (what === 'machine') {
      sparks(x, y, z, nx, ny, nz, 9, 1, 0.8, 0.45, 6);
      spawn(ADD, x, y, z, 0, 0, 0, 0.07, 0.5, 0.9, 1, 0.75, 0.4, 0.9);
      return;
    }
    const metal = isMetal(what);
    if (metal) sparks(x, y, z, nx, ny, nz, 6, 1, 0.82, 0.5, 4.5);
    dust(x, y, z, nx, ny, nz, metal ? 1 : 3, metal ? 0.55 : 0.8);
    spawn(ADD, x, y, z, 0, 0, 0, 0.05, 0.25, 0.5, 1, 0.8, 0.5, metal ? 0.7 : 0.35);
    if (keepsMark(what)) holes?.add(x, y, z, nx, ny, nz, rnd(0.1, 0.16));
  }

  /** The flash at a gun's mouth. */
  function muzzle(x, y, z, dx, dy, dz, kind = 'player') {
    const big = kind === 'player' ? 0.5 : 1.25;
    const [r, g, b] = kind === 'drone' ? [0.45, 0.9, 1] : [1, 0.72, 0.38];
    spawn(
      ADD,
      x + dx * 0.15,
      y + dy * 0.15,
      z + dz * 0.15,
      dx,
      dy,
      dz,
      0.045,
      big,
      big * 1.7,
      r,
      g,
      b,
      kind === 'player' ? 0.55 : 1,
    );
    if (kind !== 'player') {
      spawn(
        ADD,
        x + dx * 0.5,
        y + dy * 0.5,
        z + dz * 0.5,
        dx * 3,
        dy * 3,
        dz * 3,
        0.05,
        big * 0.6,
        big * 0.9,
        r,
        g,
        b,
        0.8,
      );
      light(x, y, z, r * 2.2, g * 2.2, b * 2.2, 9, 0.07);
    } else {
      light(x, y, z, r * 0.9, g * 0.9, b * 0.9, 5, 0.05);
      spawn(
        ALPHA,
        x + dx * 0.3,
        y + dy * 0.3,
        z + dz * 0.3,
        dx * 1.5,
        dy * 1.5 + 0.2,
        dz * 1.5,
        0.5,
        0.08,
        0.5,
        0.5,
        0.5,
        0.5,
        0.1,
        { drag: 3 },
      );
    }
  }

  /** A machine breaking down: sparks and a puff of smoke. */
  function breakdown(x, y, z) {
    sparks(x, y, z, 0, 1, 0, 22, 0.7, 0.9, 1, 5);
    sparks(x, y, z, 0, 1, 0, 10, 1, 0.8, 0.4, 3);
    for (let i = 0; i < Math.round(5 * amount); i++)
      spawn(
        ALPHA,
        x + rnd(-0.2, 0.2),
        y + rnd(-0.1, 0.3),
        z + rnd(-0.2, 0.2),
        rnd(-0.3, 0.3),
        rnd(0.5, 1.2),
        rnd(-0.3, 0.3),
        rnd(1.2, 2.2),
        0.3,
        rnd(1, 1.6),
        0.12,
        0.12,
        0.13,
        0.4,
        { drag: 1, spin: rnd(-0.6, 0.6), fadeIn: 0.15 },
      );
    spawn(ADD, x, y, z, 0, 0, 0, 0.12, 0.8, 2.2, 0.6, 0.85, 1, 1);
    light(x, y + 0.3, z, 0.9, 1.5, 2.2, 9, 0.22);
  }

  let trauma = 0;
  const eye = new THREE.Vector3();

  /**
   * A blast.
   * @param {number} size 1 = a demolition charge; the strike is far bigger
   */
  function explosion(x, y, z, size = 1) {
    const n = (k) => Math.max(2, Math.round(k * amount));
    // the light is capped: a blast far bigger than a charge should warm the site, not turn it white
    const glare = Math.min(size, 1.4);
    light(x, y + 1, z, 3 * glare, 1.7 * glare, 0.7 * glare, Math.min(46, 26 * Math.sqrt(size)), 0.55 + 0.2 * glare);
    spawn(ADD, x, y + 0.6 * size, z, 0, 0, 0, 0.16, 5 * size, 13 * size, 1, 0.86, 0.6, 1);
    for (let i = 0; i < n(12); i++) {
      const a = rnd(0, 6.283);
      const s = rnd(1, 5) * size;
      spawn(
        ADD,
        x + Math.cos(a) * size * 0.5,
        y + rnd(0.2, 1.5) * size,
        z + Math.sin(a) * size * 0.5,
        Math.cos(a) * s,
        rnd(1, 5) * size,
        Math.sin(a) * s,
        rnd(0.45, 0.95),
        1.6 * size,
        rnd(3.5, 5.5) * size,
        1,
        rnd(0.4, 0.62),
        0.16,
        0.9,
        { drag: 2.2, spin: rnd(-1, 1) },
      );
    }
    for (let i = 0; i < n(14); i++) {
      const a = rnd(0, 6.283);
      const s = rnd(0.5, 3.5) * size;
      spawn(
        ALPHA,
        x + Math.cos(a) * size,
        y + rnd(0.3, 2) * size,
        z + Math.sin(a) * size,
        Math.cos(a) * s,
        rnd(1.5, 4.5) * size,
        Math.sin(a) * s,
        rnd(2.2, 4.2),
        2 * size,
        rnd(5, 8) * size,
        0.1,
        0.095,
        0.09,
        rnd(0.45, 0.7),
        { drag: 1.1, spin: rnd(-0.5, 0.5), fadeIn: 0.12 },
      );
    }
    sparks(x, y + 0.5, z, 0, 1, 0, 40, 1, 0.7, 0.3, 13 * Math.sqrt(size));
    spawn(3, x, y + 0.4, z, 0, 0, 0, 0.5, 2 * size, 26 * size, 1, 0.8, 0.6, 0.55);
    scorches?.add(x, 0.02, z, 0, 1, 0, 5 * size);
    const d = Math.hypot(eye.x - x, eye.z - z);
    trauma = Math.min(1.4, trauma + (1.1 * size) / (1 + d * 0.06));
  }

  const shakeState = { yaw: 0, pitch: 0, roll: 0 };
  let clock = 0;

  return {
    light,
    tracer,
    impact,
    muzzle,
    sparks,
    dust,
    breakdown,
    explosion,
    /** One glowing particle or smoke puff, for the game's own set pieces. kind: 'add' | 'smoke' | 'ring' */
    puff(kind, x, y, z, vx, vy, vz, life, size0, size1, r, g, b, a, o) {
      spawn(
        kind === 'smoke' ? ALPHA : kind === 'ring' ? 3 : ADD,
        x,
        y,
        z,
        vx,
        vy,
        vz,
        life,
        size0,
        size1,
        r,
        g,
        b,
        a,
        o,
      );
    },
    /** Rattles the camera: 0.2 is a near miss, 1 is a blast at your feet. */
    shake(amountOfShake) {
      trauma = Math.min(1.4, trauma + amountOfShake);
    },
    shakeState,
    get particles() {
      return P.length;
    },

    update(dt, camera) {
      clock += dt;
      eye.copy(camera.position);

      // particles
      const counts = [0, 0, 0, 0];
      let alive = 0;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        p.age += dt;
        if (p.age >= p.life) continue;
        const drag = Math.max(0, 1 - p.drag * dt);
        p.vx *= drag;
        p.vy = p.vy * drag - p.gravity * dt;
        p.vz *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.floor && p.y < 0.03) {
          p.y = 0.03;
          p.vy = -p.vy * 0.35;
          p.vx *= 0.6;
          p.vz *= 0.6;
        }
        p.rot += p.spin * dt;
        const t = p.age / p.life;
        const size = p.size0 + (p.size1 - p.size0) * (p.kind === ALPHA ? 1 - (1 - t) * (1 - t) : t);
        let fade = p.kind === ALPHA ? 1 - t : 1 - t * t;
        if (p.fadeIn > 0 && t < p.fadeIn) fade *= t / p.fadeIn;
        const batchFor = p.kind === 2 ? sparkBatch : p.kind === 3 ? ringBatch : batches[p.kind];
        const n = counts[p.kind];
        if (n < batchFor.capacity) {
          if (p.kind === ALPHA) batchFor.set(n, p.x, p.y, p.z, size, p.r, p.g, p.b, p.a * fade, p.rot);
          else batchFor.set(n, p.x, p.y, p.z, size, p.r * fade * p.a, p.g * fade * p.a, p.b * fade * p.a, 1, p.rot);
          counts[p.kind]++;
        }
        P[alive++] = p;
      }
      P.length = alive;
      batches[0].commit(counts[0]);
      batches[1].commit(counts[1]);
      sparkBatch.commit(counts[2]);
      ringBatch.commit(counts[3]);

      // tracers fly from the gun to where the round went
      for (const tr of tracers) {
        if (!tr.mesh.visible) continue;
        tr.t += dt;
        const head = Math.min(1, tr.t / tr.span) * tr.dist;
        if (tr.t >= tr.span + 0.03) {
          tr.mesh.visible = false;
          continue;
        }
        const tail = Math.max(0, head - tr.len);
        tr.mesh.position.set(tr.ax + tr.dx * tail, tr.ay + tr.dy * tail, tr.az + tr.dz * tail);
        tr.mesh.scale.z = Math.max(0.05, head - tail);
      }

      // lights
      for (let i = 0; i < MAX_DYN_LIGHTS; i++) {
        const l = lights[i];
        if (l.life > 0) {
          l.life -= dt;
          const k = Math.max(0, l.life / l.span);
          shared.uDynPos.value[i].set(l.x, l.y, l.z, l.radius);
          shared.uDynCol.value[i].set(l.r * k, l.g * k, l.b * k);
        } else {
          shared.uDynCol.value[i].set(0, 0, 0);
        }
      }

      // shake
      trauma = Math.max(0, trauma - dt * 1.5);
      const s = trauma * trauma;
      shakeState.yaw = s * 0.035 * Math.sin(clock * 47.3);
      shakeState.pitch = s * 0.03 * Math.sin(clock * 53.1 + 1.7);
      shakeState.roll = s * 0.03 * Math.sin(clock * 41.7 + 4.2);
    },

    /** Clears everything, for a new attempt. */
    reset() {
      P.length = 0;
      for (const b of [...batches, sparkBatch, ringBatch]) b.commit(0);
      for (const tr of tracers) tr.mesh.visible = false;
      for (const l of lights) l.life = 0;
      holes?.clear();
      scorches?.clear();
      trauma = 0;
    },

    /** How many bullet marks have been left since the page opened. */
    get marks() {
      return holes ? holes.added : 0;
    },
    /**
     * The light of the site has changed — a lamp went out, or came back (main.js, "lamps that go out"): the marks
     * rounds and blasts have left take the light of their place again. (They took it once, when they were made.)
     */
    relight() {
      holes?.relight();
      scorches?.relight();
    },
    /** Takes away every mark left on things (they are about to move, or be gone). */
    clearMarks() {
      holes?.clear();
    },
  };
}

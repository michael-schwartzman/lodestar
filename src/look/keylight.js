// Key lights that throw real shadows (the second look; docs/DESIGN.md, "The second look").
//
// The site has some two dozen strong lamps (look/keys.js). For a lamp that burns, the site is drawn once more
// from where it hangs, into a picture that keeps only how far away the nearest thing is in every direction. The
// program of every lit surface (look/glsl.js, LODE_KEY) then asks that picture, for the pixel it is drawing: is
// there something nearer the lamp than I am? If so it is in shadow.
//
// Not all of them burn at once. A surface's program can do the sums for a handful, and so there are a handful of
// SLOTS (look/slots.js says which lamps hold them, from where the eye is). The depth pictures are tiles of two
// larger pictures, a tile to a slot:
//
//   the STILL picture   what does not move — walls, roofs, furniture, the cascades. A tile is drawn when a lamp
//                       takes the slot, and after that only when something that never moves has moved.
//   the MOVING picture  machines and the leaves of doors, alone: drawn every frame, for every lamp that burns.
//                       Only where there is one (a desk). A phone has no moving picture: there a machine throws
//                       no shadow, and a door's leaf is in the still picture, which is drawn again when a door
//                       opens or shuts.
//
// A pixel is in shadow if either picture says so. Until 16 November 2026 there were two lamps and each had a
// picture of everything, drawn again every frame — half a million triangles a frame for the two.
//
// Loop contract: `render(eye)` is called at most once a frame. It draws at most ONE still tile a call — unless the
// eye has jumped (a start, a cut, a test), when every slot that needs one gets it at once — and one moving tile
// for each lamp that burns.
import * as THREE from 'three';
import { MAX_KEYS, beam, glow, lit, shared } from '../gfx/materials.js';
import { Billboards } from '../gfx/billboards.js';
import { KIND } from '../world/grid.js';
import { lightReaches, shaftOf } from './key.js';
import { createSlots, keyGain, shortSighted, surveyKeys } from './slots.js';

/** the layer of what stands still and throws a shadow, beside the one everything is drawn from */
export const CASTER_LAYER = 3;
/** …and of what moves and throws one (look/mirror.js has 4) */
export const MOVING_LAYER = 5;

/** Whether a mesh of the site stands still and throws a shadow, by the name world/build.js gives each mesh. */
const standsStill = (mesh) => {
  if (!mesh.isMesh) return false;
  const name = mesh.name || '';
  return (
    name === 'props' ||
    name === 'cascade' ||
    name === 'roof' ||
    name.startsWith('wall:') ||
    name.startsWith('ceiling:') ||
    name.startsWith('roof:')
  );
};
/** …or is the leaf of a door: unnamed, opaque, lit. */
const isLeaf = (mesh) =>
  mesh.isMesh && !mesh.name && mesh.material?.userData?.lode === 'lit' && !mesh.material.transparent;

/** the eye has jumped, not walked, if it is this far from where it was a frame ago (metres) */
const JUMP = 6;
/** how bright the air a lamp lights is drawn (the site's own lamps' haze is 0.11, in world/build.js) */
const SHAFT_LIGHT = 0.1;

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {object} o.world       what world/build.js made: its `group` is tagged, its `keys` is filled in
 * @param {object[]} o.keys      look/keys.js
 * @param {number} o.slots       how many of them can burn at once (what the materials were told: LODE_KEY)
 * @param {number} o.size        pixels across a tile of the still picture
 * @param {boolean} o.moving     there is a moving picture: machines and doors throw shadows, kept up every frame
 * @param {number} [o.reach=1]   below 1: lamps begin to matter, and cease to, that much nearer (a phone)
 * @param {number} [o.taps]      how many points of a depth picture each pixel asks (what the materials were told)
 * @param {Record<string, THREE.Texture>} [o.textures] for the lamp's own shine (`flare`, `glint`)
 * @param {boolean} [o.shafts=true] the air under each lamp is lit (a cone of haze along its beam)
 * @param {{ x: number, z: number }} [o.eye] where the eye is before anything has been drawn
 */
export function createKeyLights({
  renderer,
  scene,
  world,
  keys,
  slots: count,
  size,
  moving,
  reach = 1,
  taps = 0,
  textures = {},
  shafts = true,
  eye: firstEye = null,
}) {
  count = Math.max(1, Math.min(MAX_KEYS, count | 0));
  const grid = world.grid;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const movingSize = Math.max(256, size >> 1);

  /** One of the two pictures: a depth picture that answers "nearer than this?", `tile` pixels to a slot. */
  const atlas = (tile) => {
    const depth = new THREE.DepthTexture(cols * tile, rows * tile);
    // sixteen bits are enough between a lamp and the end of its reach, and half the memory of twenty-four
    depth.type = THREE.UnsignedShortType;
    depth.compareFunction = THREE.LessEqualCompare;
    depth.minFilter = THREE.LinearFilter;
    depth.magFilter = THREE.LinearFilter;
    const target = new THREE.WebGLRenderTarget(cols * tile, rows * tile, {
      depthTexture: depth,
      depthBuffer: true,
      stencilBuffer: false,
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    target.scissorTest = true;
    return { target, depth, tile };
  };
  const still = atlas(size);
  const stir = moving ? atlas(movingSize) : null;
  shared.uKeyStill.value = still.depth;
  shared.uKeyMoving.value = stir ? stir.depth : null;
  // one pixel of a still tile, as a share of the tile; how far a surface is lifted off itself before it is looked
  // up, in metres; how soft a shadow's edge is, in pixels; one pixel of a moving tile
  shared.uKeyTex.value.set(1 / size, 0.05, moving ? 2.2 : 1.6, 1 / movingSize);
  shared.uKeyGrid.value.set(cols, 1 / cols, 1 / rows);

  const lights = keys.map((key) => {
    const far = key.range;
    // nothing hangs nearer a lamp than this; the moon is a long way off, and what is near it is nothing
    const near = key.kind === 'moon' ? far * 0.35 : Math.min(2, Math.max(0.3, far * 0.04));
    const camera = new THREE.PerspectiveCamera(key.outer * 2 + 4, 1, near, far);
    camera.position.set(key.x, key.y, key.z);
    const axis = new THREE.Vector3(key.tx - key.x, key.ty - key.y, key.tz - key.z).normalize();
    // a lamp aimed straight down has no "up" to hold on to
    if (Math.abs(axis.y) > 0.98) camera.up.set(0, 0, -1);
    camera.lookAt(key.tx, key.ty, key.tz);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const info = {
      name: key.name,
      x: key.x,
      y: key.y,
      z: key.z,
      map: size,
      taps,
      casters: 0,
      /** triangles in its still tile the last time it was drawn (0: it has never held a slot) */
      drawn: 0,
      /** how many times its still tile has been drawn */
      draws: 0,
      moving,
      slot: -1,
      level: 0,
    };
    world.keys.push(info);
    return { key, axis, camera, matrix, info };
  });

  const survey = shortSighted(surveyKeys(grid, keys, world.keySheets), reach);
  const slots = createSlots(count);
  const gains = new Float32Array(lights.length);

  // what is drawn into the depth pictures: nothing but depth, of both faces, pushed a little away from the lamp
  // so that a surface does not shade itself. Only a little: a lamp that shines along a passage sees its floor at
  // a slant, and what is pushed away by the slant is pushed a long way — a shadow then starts a stride behind
  // the thing that throws it. The surface is also looked up a little off itself (the program's own doing).
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  depthOnly.polygonOffset = true;
  depthOnly.polygonOffsetFactor = 1.1;
  depthOnly.polygonOffsetUnits = 2;

  let casters = 0;
  const leaves = [];
  world.group.traverse((mesh) => {
    if (standsStill(mesh)) {
      mesh.layers.enable(CASTER_LAYER);
      casters++;
    } else if (isLeaf(mesh)) {
      // a door's leaf moves: among the moving things where there is a picture of them, among the still otherwise
      mesh.layers.enable(moving ? MOVING_LAYER : CASTER_LAYER);
      leaves.push(mesh);
      casters++;
    }
  });
  for (const l of lights) l.info.casters = casters;
  // the mountain's outside is lit by the moon it was worked out with, all over: a key light's round patch on a
  // hillside would be a lamp, not the moon
  world.group.traverse((mesh) => {
    if (mesh.isMesh && (mesh.name || '').startsWith('terrain') && mesh.material?.uniforms?.uKeyGain)
      mesh.material.uniforms.uKeyGain.value = 0;
  });

  /** Puts a moving thing — a machine — among what throws shadows. Only where there is a moving picture. */
  function cast(root) {
    if (!moving) return root;
    root.traverse((mesh) => {
      if (mesh.isMesh && mesh.material?.userData?.lode === 'lit' && !mesh.material.transparent) {
        mesh.layers.enable(MOVING_LAYER);
        casters++;
      }
    });
    for (const l of lights) l.info.casters = casters;
    return root;
  }

  // ---------- the lamps themselves, and their shine ----------
  const fittings = new THREE.Group();
  fittings.name = 'key lights';
  const housing = lit({ color: 0x23272b, rough: 0.6, metal: 0.4 });
  housing.uniforms.uProbe.value.setRGB(0.5, 0.52, 0.56);
  /** how brightly a lamp's lens is drawn when it is lit — and when it is out: glass, with the place's light on it */
  const LENS_LIT = 3.2;
  const LENS_OUT = 0.035;
  /** the box a round must enter to break a lamp is the fitting's own, grown this much: a lens is a small thing to hit */
  const BOX_GROW = 0.1;
  const shine = [];
  for (const light of lights) {
    const { key, axis } = light;
    // the moon is not a thing that hangs anywhere
    if (key.kind === 'moon') continue;
    const peak = Math.max(key.r, key.g, key.b);
    const fitting = new THREE.Group();
    fitting.position.set(key.x, key.y, key.z);
    fitting.lookAt(key.x + axis.x, key.y + axis.y, key.z + axis.z);
    const face = glow({ color: new THREE.Color(key.r / peak, key.g / peak, key.b / peak), intensity: LENS_LIT });
    // a flood is a bank of four heads on a bar; a work light is one
    const heads = key.kind === 'flood' ? 4 : 1;
    for (let n = 0; n < heads; n++) {
      const x = (n - (heads - 1) / 2) * 0.46;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.2), housing);
      body.position.set(x, 0, -0.05);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), face);
      lens.position.set(x, 0, 0.056);
      fitting.add(body, lens);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(heads * 0.5, 0.06, 0.06), housing);
    bar.position.set(0, -0.2, -0.1);
    fitting.add(bar);
    fittings.add(fitting);
    // what a round must enter to break it: the box round the fitting as it hangs
    fitting.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fitting).expandByScalar(BOX_GROW);
    light.box = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
    light.face = face;
    light.shineAt = shine.length;
    shine.push({ x: key.x + axis.x * 0.2, y: key.y + axis.y * 0.2, z: key.z + axis.z * 0.2, key, peak, heads });
  }
  let flareBoard = null;
  let glintBoard = null;
  /** A lamp's shine — its two flares and its glint — as it is when lit, or nothing. */
  function setShine(n, on) {
    if (!flareBoard) return;
    const { x, y, z, key, peak, heads } = shine[n];
    const k = on ? 1 : 0;
    const c = [(key.r / peak) * k, (key.g / peak) * k, (key.b / peak) * k];
    const big = heads > 1 ? 1 : 0.6;
    flareBoard.set(n * 2, x, y, z, 5.5 * big, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1);
    flareBoard.set(n * 2 + 1, x, y, z, 1.3 * big, c[0] * 5, c[1] * 5, c[2] * 5, 1);
    glintBoard?.set(n, x, y, z, 11 * big, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 1);
  }
  if (textures.flare && shine.length) {
    const flares = new Billboards({ capacity: shine.length * 2, map: textures.flare });
    const glints = textures.glint ? new Billboards({ capacity: shine.length, map: textures.glint }) : null;
    flareBoard = flares;
    glintBoard = glints;
    shine.forEach((_, n) => setShine(n, true));
    flares.commit(shine.length * 2);
    // named as the site's own are (world/build.js): they turn to face the eye, and are left out of a capture
    flares.mesh.name = 'flares';
    fittings.add(flares.mesh);
    if (glints) {
      glints.commit(shine.length);
      glints.mesh.name = 'glints';
      fittings.add(glints.mesh);
    }
  }
  // ---------- the air a lamp lights (look/key.js shaftOf) ----------
  // One cone to a lamp, all of them one mesh, drawn as the site's own lamps' haze is (gfx/materials.js `beam`):
  // added to the picture, both sides, brightest looked at through the thick of it. Its colour is on its corners
  // and fades along it, so that a cone that ends in mid-air has nothing left to end with.
  let shaftMesh = null;
  /** the cones' colours as they are when every lamp is lit */
  let shaftWas = null;
  if (shafts) {
    const AROUND = 24;
    const RINGS = 5;
    const pos = [];
    const nor = [];
    const col = [];
    const uv = [];
    const idx = [];
    const u = new THREE.Vector3();
    const v = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (const light of lights) {
      const { key } = light;
      const shaft = shaftOf(key);
      if (!shaft) continue;
      d.set(shaft.dir[0], shaft.dir[1], shaft.dir[2]);
      // two directions across the beam
      u.set(0, 1, 0);
      if (Math.abs(d.y) > 0.9) u.set(1, 0, 0);
      u.cross(d).normalize();
      v.crossVectors(d, u);
      const peak = Math.max(key.r, key.g, key.b, 1e-6);
      const widens = (shaft.radius(shaft.to) - shaft.radius(shaft.from)) / (shaft.to - shaft.from);
      const base = pos.length / 3;
      // which corners of the mesh are this lamp's cone: it is darkened when the lamp goes out
      light.cone = [base, RINGS * (AROUND + 1)];
      for (let ring = 0; ring < RINGS; ring++) {
        const f = ring / (RINGS - 1);
        const along = shaft.from + (shaft.to - shaft.from) * f;
        const r = shaft.radius(along);
        const left = shaft.strength * (shaft.keeps + (1 - shaft.keeps) * (1 - f) ** 1.5);
        for (let s = 0; s <= AROUND; s++) {
          const a = (s / AROUND) * Math.PI * 2;
          const cx = u.x * Math.cos(a) + v.x * Math.sin(a);
          const cy = u.y * Math.cos(a) + v.y * Math.sin(a);
          const cz = u.z * Math.cos(a) + v.z * Math.sin(a);
          pos.push(key.x + d.x * along + cx * r, key.y + d.y * along + cy * r, key.z + d.z * along + cz * r);
          // the side of a cone leans outwards, and back towards the lamp by as much as it widens
          const lean = Math.hypot(1, widens);
          nor.push((cx - d.x * widens) / lean, (cy - d.y * widens) / lean, (cz - d.z * widens) / lean);
          col.push((key.r / peak) * left, (key.g / peak) * left, (key.b / peak) * left);
          // the fading is in the colour: the material is told there is none of its own to add
          uv.push(s / AROUND, 0);
        }
      }
      for (let ring = 0; ring < RINGS - 1; ring++)
        for (let s = 0; s < AROUND; s++) {
          const i = base + ring * (AROUND + 1) + s;
          idx.push(i, i + AROUND + 1, i + 1, i + 1, i + AROUND + 1, i + AROUND + 2);
        }
    }
    if (idx.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
      geometry.setIndex(idx);
      geometry.computeBoundingSphere();
      const shafts = new THREE.Mesh(geometry, beam({ intensity: SHAFT_LIGHT }));
      shafts.name = 'shafts';
      shafts.matrixAutoUpdate = false;
      shafts.renderOrder = 3;
      // one mesh the size of the site: it is always somewhere in view
      shafts.frustumCulled = false;
      fittings.add(shafts);
      shaftMesh = shafts;
      shaftWas = Float32Array.from(col);
    }
  }
  scene.add(fittings);

  // ---------- a lamp that is out ----------
  // Shot, or tripped by an EMP (world/lamps.js keeps which, and for how long; main.js tells this file). A lamp
  // that is out has no gain wherever the eye is, so it holds no slot, lights nothing and throws no shadow; its
  // lens is dull glass, and it has no shine and no lit air under it.
  const out = new Uint8Array(lights.length);
  /**
   * @param {number} i the lamp's place in look/keys.js
   * @param {boolean} dead it is out — or alight again
   * @returns {boolean} whether that changed anything
   */
  function setOut(i, dead) {
    const light = lights[i];
    if (!light || !!out[i] === !!dead) return false;
    out[i] = dead ? 1 : 0;
    // out at once: a lamp that is shot does not fade. (Coming back, it comes up as any lamp new to a slot does.)
    if (dead) slots.cut(i);
    if (light.face) light.face.uniforms.uIntensity.value = dead ? LENS_OUT : LENS_LIT;
    if (light.shineAt !== undefined && flareBoard) {
      setShine(light.shineAt, !dead);
      flareBoard.commit(flareBoard.count);
      glintBoard?.commit(glintBoard.count);
    }
    if (light.cone && shaftMesh) {
      const colour = shaftMesh.geometry.attributes.color;
      const [from, count] = light.cone;
      for (let k = from * 3; k < (from + count) * 3; k++) colour.array[k] = dead ? 0 : shaftWas[k];
      colour.addUpdateRange(from * 3, count * 3);
      colour.needsUpdate = true;
    }
    return true;
  }

  // lit or not: put out by the game (the strike puts every lamp out), or while the ground is being moved
  let on = true;
  let dark = false;
  /** for tests: the one key light left burning while the picture is read, or −1 for all of them */
  let only = -1;

  /** Draws one slot's tile of a picture: what is on `layer`, as its holder sees it. */
  function drawTile(picture, slot, light, layer) {
    const x = (slot % cols) * picture.tile;
    const y = Math.floor(slot / cols) * picture.tile;
    picture.target.viewport.set(x, y, picture.tile, picture.tile);
    picture.target.scissor.set(x, y, picture.tile, picture.tile);
    renderer.setRenderTarget(picture.target);
    // the renderer is told never to clear by itself (gfx/renderer.js): what was in the tile must go by hand
    renderer.clear(true, true, false);
    light.camera.layers.set(layer);
    const before = renderer.info.render.triangles;
    renderer.render(scene, light.camera);
    return renderer.info.render.triangles - before;
  }

  /** whether each door stood open (enough to see through) the last time it was looked at: a phone's still tiles */
  const stoodOpen = grid.doors.map((door) => door.open >= 0.5);
  const last = { x: NaN, z: NaN, time: 0 };
  let primed = false;

  /**
   * Decides which lamps burn for an eye at (x, z), draws the depth pictures that need drawing, and tells the
   * materials. Once a frame.
   * @param {{ x: number, z: number }} [eye] left out, where it was last (or where the game starts)
   * @param {boolean} [snap=false] set everything at once: nothing creeps, every tile that is owed is drawn
   */
  function render(eye, snap = false) {
    if (!lights.length) return;
    const at = eye || (Number.isNaN(last.x) ? firstEye || world.site.start : last);
    const now = performance.now();
    const dt = primed ? Math.min(0.1, Math.max(0, (now - last.time) / 1000)) : 0;
    const jumped = !primed || Math.hypot(at.x - last.x, at.z - last.z) > JUMP;
    last.x = at.x;
    last.z = at.z;
    last.time = now;
    primed = true;

    // while the mountain comes down the ground is moved by the shader, which a depth picture knows nothing of:
    // the key lights are out for as long as that lasts
    const wrecked = shared.uRuin.value > 0 || shared.uCraterGo.value > 0;
    const went = wrecked !== dark;
    dark = wrecked;
    const burning = on && !dark;
    const zone = world.zoneAt(at.x, at.z);
    for (let i = 0; i < lights.length; i++) {
      // a lamp that has been shot out, or tripped, burns for nobody
      if (!burning || out[i]) gains[i] = 0;
      else if (only >= 0) gains[i] = only === i ? 1 : 0;
      else gains[i] = keyGain(survey[i], grid, at.x, at.z, zone);
    }
    // a phone has no picture of moving things: its still tiles hold the doors, and are drawn again when one moves
    if (!moving)
      grid.doors.forEach((door, n) => {
        const open = door.open >= 0.5;
        if (open !== stoodOpen[n]) {
          stoodOpen[n] = open;
          slots.dirty();
        }
      });
    const owed = slots.update(gains, dt, snap || jumped || went);

    const target = renderer.getRenderTarget();
    const override = scene.overrideMaterial;
    scene.overrideMaterial = depthOnly;
    try {
      for (const slot of owed) {
        const light = lights[slots.holder[slot]];
        light.info.drawn = drawTile(still, slot, light, CASTER_LAYER);
        light.info.draws++;
      }
      if (stir)
        for (let slot = 0; slot < count; slot++) {
          const holder = slots.holder[slot];
          if (holder >= 0 && slots.level[holder] > 0) drawTile(stir, slot, lights[holder], MOVING_LAYER);
        }
    } finally {
      // whatever happened, the picture itself must not be drawn with the depth-only material
      scene.overrideMaterial = override;
      renderer.setRenderTarget(target);
    }

    for (let slot = 0; slot < MAX_KEYS; slot++) {
      const holder = slot < count ? slots.holder[slot] : -1;
      const level = holder >= 0 ? slots.level[holder] : 0;
      if (holder < 0 || level <= 0) {
        // nobody home: a lamp of no reach, a long way under the floor
        shared.uKeyPos.value[slot].set(0, -999, 0, 1);
        shared.uKeyCol.value[slot].set(0, 0, 0, 2);
        continue;
      }
      const { key, axis, matrix } = lights[holder];
      shared.uKeyPos.value[slot].set(key.x, key.y, key.z, key.even ? -key.range : key.range);
      shared.uKeyAxis.value[slot].set(axis.x, axis.y, axis.z, Math.cos((key.outer * Math.PI) / 180));
      shared.uKeyCol.value[slot].set(
        key.r * level,
        key.g * level,
        key.b * level,
        Math.cos((key.inner * Math.PI) / 180),
      );
      shared.uKeyMat.value[slot].copy(matrix);
    }
    lights.forEach((l, i) => {
      l.info.slot = slots.slotOf[i];
      l.info.level = slots.level[i];
    });
    fittings.visible = on;
  }

  /** Whether a straight line from a point to a lamp is clear — against the true shapes of things, as a round is. */
  const clearTo = (key, x, y, z) => lightReaches(grid, key, x, y, z, true);

  /**
   * For tests: points on the ground in front of a camera and well inside a key light's beam, each with where it
   * falls on the screen and whether a straight line from it to the lamp is clear — worked out here, on the
   * processor, against the true shapes of things, as a round's flight is. A test then reads the picture at those
   * points: the depth map and this must agree. Points whose neighbours disagree (a shadow's edge) are left out.
   * @returns {{ x: number, z: number, px: number, py: number, lit: boolean, chest: boolean, reach: number, others: number }[]}
   *   px, py in CSS pixels; lit: the ground there is in this lamp's light; chest: so is the chest of somebody
   *   standing there; reach: how much of this lamp's light gets that far, shadows apart; others: how much of the
   *   OTHER key lights arrives there, their shadows counted
   */
  function samples(camera, reachOf, k = 0) {
    const light = lights[k];
    if (!light) return [];
    const { key } = light;
    const rest = lights.filter((l) => l !== light);
    const sight = {};
    const seen = (ax, ay, az, bx, by, bz) => {
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const length = Math.hypot(dx, dy, dz);
      return !grid.raycast(ax, ay, az, dx / length, dy / length, dz / length, length - 0.3, sight);
    };
    const lit = (x, z) => clearTo(key, x, 0.08, z);
    // wire does not stop the eye, but it is in the picture, and a lamp lights it: ground seen through a fence
    // is not ground a picture can be read at
    const throughWire = (ax, az, bx, bz) => {
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 3);
      for (let n = 1; n < steps; n++) {
        const cx = Math.floor(ax + ((bx - ax) * n) / steps);
        const cz = Math.floor(az + ((bz - az) * n) / steps);
        if (grid.inside(cx, cz) && grid.kind[cz * grid.w + cx] === KIND.FENCE) return true;
      }
      return false;
    };
    const forward = camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const eye = camera.position;
    const v = new THREE.Vector3();
    const out = [];
    for (let ahead = 2; ahead <= 26; ahead += 0.7)
      for (let across = -14; across <= 14; across += 0.7) {
        const x = eye.x + forward.x * ahead + right.x * across;
        const z = eye.z + forward.z * ahead + right.z * across;
        if (!grid.inside(Math.floor(x), Math.floor(z)) || !grid.walkable(Math.floor(x), Math.floor(z))) continue;
        const reach = reachOf(key, x, 0.05, z);
        if (reach < 0.2) continue;
        v.set(x, 0.02, z).project(camera);
        if (Math.abs(v.x) > 0.92 || v.y > 0.92 || v.y < -0.92 || v.z > 1) continue;
        if (!seen(eye.x, eye.y, eye.z, x, 0.05, z)) continue;
        if (throughWire(eye.x, eye.z, x, z)) continue;
        const here = lit(x, z);
        if ([lit(x + 0.45, z), lit(x - 0.45, z), lit(x, z + 0.45), lit(x, z - 0.45)].some((n) => n !== here)) continue;
        let others = 0;
        for (const other of rest) {
          const theirs = reachOf(other.key, x, 0.05, z);
          if (theirs > 0.002 && clearTo(other.key, x, 0.08, z)) others += theirs;
        }
        out.push({
          x: +x.toFixed(2),
          z: +z.toFixed(2),
          px: Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
          py: Math.round((0.5 - v.y * 0.5) * window.innerHeight),
          lit: here,
          // the same question asked from the chest of somebody standing there: a low lamp's shadow is long on
          // the ground and half as long at that height
          chest: clearTo(key, x, 1.3, z),
          reach: +reach.toFixed(3),
          others: +others.toFixed(3),
        });
      }
    return out;
  }

  /**
   * What of the key lights arrives at a point in the air — for what is not drawn in the world's space and so
   * cannot ask the depth pictures (the gun in the hands): each burning lamp's light there, as brightly as it is
   * being drawn, if a straight line to it is clear — worked out on the processor against the true shapes of things.
   * @param {(key: object, x: number, y: number, z: number) => number} reachOf look/key.js keyReach
   * @param {{ r: number, g: number, b: number, x: number, y: number, z: number }} out r, g, b: the light; x, y, z:
   *   the way it comes from, as long as it is bright
   */
  function arriving(reachOf, x, y, z, out) {
    out.r = out.g = out.b = out.x = out.y = out.z = 0;
    if (!on || dark) return out;
    for (const [i, { key }] of lights.entries()) {
      const level = slots.level[i] || 0;
      if (level <= 0) continue;
      const reachHere = reachOf(key, x, y, z) * level;
      if (reachHere < 0.002) continue;
      if (!clearTo(key, x, y, z)) continue;
      out.r += key.r * reachHere;
      out.g += key.g * reachHere;
      out.b += key.b * reachHere;
      const dx = key.x - x;
      const dy = key.y - y;
      const dz = key.z - z;
      const length = Math.hypot(dx, dy, dz);
      const bright = (key.r * 0.3 + key.g * 0.59 + key.b * 0.11) * reachHere;
      out.x += (dx / length) * bright;
      out.y += (dy / length) * bright;
      out.z += (dz / length) * bright;
    }
    return out;
  }

  /**
   * For tests: where to stand to look at lamp `k`'s light AND its shadows. Places round the edge of its pool, each
   * looking in towards the middle, are tried, and the one from which the most ground in its light and in its
   * shadow can both be seen is the one (a lamp looked at from under itself throws its shadows away from the eye,
   * behind the things that throw them).
   * @param {(key: object, x: number, y: number, z: number) => number} reachOf look/key.js keyReach
   * @param {{ fov: number, aspect: number }} lens the game's camera
   * @returns {{ x: number, z: number, yaw: number, pitch: number } | null}
   */
  function station(k, reachOf, lens) {
    const light = lights[k];
    const s = survey[k];
    if (!light || !s || !s.samples.length) return null;
    const camera = new THREE.PerspectiveCamera(lens.fov, lens.aspect, 0.06, 500);
    camera.rotation.order = 'YXZ';
    const pitch = light.key.kind === 'moon' ? -0.5 : -0.32;
    let best = null;
    let bestScore = -1;
    const tried = new Set();
    for (const share of [0.75, 0.4])
      for (let turn = 0; turn < 8; turn++) {
        const wantX = s.pool.x + Math.cos((turn * Math.PI) / 4) * s.pool.r * share;
        const wantZ = s.pool.z + Math.sin((turn * Math.PI) / 4) * s.pool.r * share;
        // the lit cell nearest that place
        let n = 0;
        for (let m = 2; m < s.samples.length; m += 2)
          if (
            Math.hypot(s.samples[m] - wantX, s.samples[m + 1] - wantZ) <
            Math.hypot(s.samples[n] - wantX, s.samples[n + 1] - wantZ)
          )
            n = m;
        if (tried.has(n)) continue;
        tried.add(n);
        const x = s.samples[n];
        const z = s.samples[n + 1];
        const dx = s.pool.x - x;
        const dz = s.pool.z - z;
        if (Math.hypot(dx, dz) < 1) continue;
        // yaw as the player's is kept: 0 looks north (−z), growing anticlockwise seen from above
        const yaw = Math.atan2(-dx, -dz);
        camera.position.set(x, 1.6, z);
        camera.rotation.set(pitch, yaw, 0);
        camera.updateMatrixWorld(true);
        const points = samples(camera, reachOf, k);
        const lit = points.filter((p) => p.lit).length;
        const shaded = points.length - lit;
        const score = Math.min(lit, shaded * 3) * 1000 + lit;
        if (score > bestScore) {
          bestScore = score;
          best = { x, z, yaw: +yaw.toFixed(4), pitch };
        }
      }
    return best;
  }

  return {
    lights,
    fittings,
    cast,
    /**
     * Whether something standing at (x, z) throws a shadow just now: there is a picture of moving things, and
     * the light of a lamp that is burning reaches chest height there (the sheets world/build.js keeps).
     */
    casts(x, z) {
      if (!moving || !on || dark) return false;
      for (let slot = 0; slot < count; slot++) {
        const holder = slots.holder[slot];
        if (holder >= 0 && slots.level[holder] > 0 && world.keyAt(x, z, holder) > 0.02) return true;
      }
      return false;
    },
    render,
    samples,
    arriving,
    station,
    /** The slots and who holds them (look/slots.js). */
    slots,
    /** Every lamp is as bright as it is going to be for where the eye is: nothing is coming up or going out. */
    settled() {
      for (let i = 0; i < lights.length; i++) {
        const want = slots.slotOf[i] >= 0 ? Math.min(1, gains[i]) : 0;
        if (Math.abs((slots.level[i] || 0) - want) > 0.05) return false;
      }
      return true;
    },
    /** Something that does not move has moved all the same (the cascades came down): every still tile again, in turn. */
    dirty() {
      slots.dirty();
    },
    /** Lights the lamps or puts them out (the ending puts every lamp out) — at once: the power has gone. */
    setOn(next) {
      if (next === on) return;
      on = next;
      render(null, true);
    },
    /**
     * For tests: leaves key light `k` alone burning, so that its shadows can be read — −1: all of them again; a
     * number no lamp has: none of them. At once, wherever the eye is.
     */
    solo(k) {
      only = k;
      render(null, true);
    },
    /** Puts lamp `i` out, or lights it again (see "a lamp that is out", above). */
    setOut,
    /** What a round must enter to break lamp `i`: x0, y0, z0, x1, y1, z1 — null for the moon, which hangs nowhere. */
    boxOf: (i) => lights[i]?.box || null,
  };
}

// What metal mirrors (the second look; docs/DESIGN.md, "The second look"): the place itself, captured.
//
// From one point in a space (look/keys.js MIRROR) the site is drawn six times — once out of each face of a cube —
// in linear light, by the light of its lamps and with the key lights' shadows in it. The shader of every lit
// surface inside the box that goes with the capture (gfx/materials.js, LODE_ENVCUBE) then reads what it reflects
// out of that cube instead of out of the sum that stood in for it: sharply where it is smooth, out of the cube's
// smaller copies where it is rough. The box is taken for the room — the ray is followed to its wall and the cube
// read towards the place it lands — so that a reflection lies about where it belongs although the capture was
// made from somewhere else.
//
// What is in it is what TAKES light and stands still: floors, walls, rock, props. Not in it:
//   - the lamps themselves, and anything else that gives off light. Every surface already shows its lamps'
//     highlights, by the sums that know where each lamp is; with the lamps in the capture as well they were
//     counted twice — and a lamp's face is several times brighter than white, so a few of them, blurred over the
//     cube's smaller copies, turned everything dark that mirrors it the colour of the nearest lamp. The first
//     pictures had a red gun (15 November 2026);
//   - machines and smoke, which move;
//   - the streaks on the skins of the casings, which turn (world/spin.js). The casings themselves are in it —
//     they are what the hall is full of — but plain, as a drum looks wherever it has got to: a capture is kept,
//     and a streak in it would stand still beside a skin that turns (`still`, below; found in review the day
//     the turning was built, 16 November 2026);
//   - the shine that turns to face the eye, which seen from somewhere else would be a lie.
//
// Loop contract: `render()` is called at most once a frame and captures at most once a call — the first time, and
// again only after `dirty()` (the lamps went out, or came back). A capture is six draws of the site, `size`
// pixels across. One that fails is tried again on the next frame, TRIES times at most; then nothing is mirrored
// but the sum that stood in before there was a capture, until `dirty()` asks again.
import * as THREE from 'three';
import { shared } from '../gfx/materials.js';
import { mirrorAt, mirrorReached } from './keys.js';

/** the layer of what is in a capture, beside the one everything is drawn from (the key lights' is 3) */
export const MIRROR_LAYER = 4;

/** how many times a capture that fails is tried before the game goes on without one */
export const TRIES = 2;

/** meshes that turn to face whoever looks at them: drawn from somewhere else they would be lies */
const FACES_THE_EYE = new Set(['flares', 'glints', 'beams']);

/** Whether a mesh takes light (gfx/materials.js `lit`), as against giving it off: only such are captured. */
const takesLight = (o) => {
  const kind = o.material?.userData?.lode;
  return kind === 'lit' || kind === 'baked';
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One captured place.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {object} o.at             look/keys.js MIRRORS: x, y, z of the capture, `box` [x0, z0, x1, z1], `top`,
 *   and `fade` — over how many metres inside the box's edge it fades in (2 where the edge is a line across open
 *   ground, a few tenths where it is a wall)
 * @param {number} o.size           pixels across a face of the cube
 * @param {(on: boolean) => void} [o.still] puts what turns as it is to be captured — the casings' skins without
 *   their streaks (world/build.js `cascade.still`) — for as long as a capture is drawn (true), and back (false)
 */
export function createMirror({ renderer, scene, at, size, still }) {
  // light is kept as light — a floor under a flood is brighter than white paper — wherever the card can draw to it
  const deep =
    renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const target = new THREE.WebGLCubeRenderTarget(size, {
    type: deep ? THREE.HalfFloatType : THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const camera = new THREE.CubeCamera(0.25, 150, target);
  camera.position.set(at.x, at.y, at.z);
  camera.layers.set(MIRROR_LAYER);

  const [x0, z0, x1, z1] = at.box;
  const fade = at.fade ?? 2;
  /**
   * What a test, and anyone curious, may know of it. `mean` — how bright it is on average — is worked out only
   * when it is asked for: it means reading the capture back from the graphics card, which stops the card while
   * it is done and which some phones will not do for a picture of this kind. The game never asks.
   */
  const info = { name: at.name || '', size, box: at.box.slice(), captures: 0 };
  let measured = -1;
  let mean = null;
  Object.defineProperty(info, 'mean', {
    enumerable: true,
    get() {
      if (measured !== info.captures) {
        mean = info.captures ? measure() : null;
        measured = info.captures;
      }
      return mean;
    },
  });
  /** whether its smaller copies — what a rough surface mirrors — are made anew with each capture (for tests) */
  Object.defineProperty(info, 'blurred', { enumerable: true, get: () => target.texture.generateMipmaps === true });

  /** How bright the capture is on average (linear), or null where the card will not hand its pixels back. */
  function measure() {
    try {
      const half = target.texture.type === THREE.HalfFloatType;
      const pixels = half ? new Uint16Array(size * size * 4) : new Uint8Array(size * size * 4);
      const value = half ? THREE.DataUtils.fromHalfFloat : (v) => v / 255;
      let sum = 0;
      for (let face = 0; face < 6; face++) {
        renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels, face);
        for (let i = 0; i < pixels.length; i += 4)
          sum += value(pixels[i]) * 0.3 + value(pixels[i + 1]) * 0.59 + value(pixels[i + 2]) * 0.11;
      }
      const mean = sum / (6 * size * size);
      return Number.isFinite(mean) ? mean : null;
    } catch {
      return null;
    }
  }

  let stale = true;
  /** there is a capture, of the place as it is: it may be mirrored */
  let valid = false;
  /** how many times in a row the capture has failed since one was asked for */
  let failed = 0;
  /**
   * Captures the place, if that is owed: six draws of the site. While it is being done — and afterwards, until
   * somebody calls `bind` — nothing mirrors any capture.
   * @returns {boolean} there is a capture that may be mirrored
   */
  function capture() {
    if (!stale) return valid;
    const was = { target: renderer.getRenderTarget(), clear: renderer.autoClear, post: shared.uPost.value };
    // every face starts from black (the renderer is told never to clear by itself, gfx/renderer.js); light is
    // written as light, not as display colour; and a surface cannot mirror the picture it is being drawn into —
    // nor, if the drawing fails, one that was never finished
    renderer.autoClear = true;
    shared.uPost.value = 1;
    shared.uEnvCube.value = null;
    shared.uEnvBox.value.set(0, 0, 0, 0);
    valid = false;
    let made = false;
    try {
      still?.(true);
      camera.update(renderer, scene);
      made = true;
    } catch (error) {
      // What metal mirrors is not worth a frame, let alone the game: say so and go on. It is tried again on the
      // next frame, TRIES times at most; after that the sum that stood in before there was a capture stands in
      // again (nothing is bound), until a capture is asked for once more.
      failed++;
      if (failed >= TRIES) stale = false;
      console.warn(`the place could not be captured for metal to mirror (try ${failed} of ${TRIES}): ${error}`);
    } finally {
      // made or not, what the eye is shown next has its streaks
      still?.(false);
      renderer.autoClear = was.clear;
      shared.uPost.value = was.post;
      renderer.setRenderTarget(was.target);
      // three's cube camera stops the smaller copies being made while it draws five of the faces, and lets them
      // be made with the sixth: a draw that failed in between would have left them stopped for good
      target.texture.generateMipmaps = true;
    }
    if (!made) return false;
    stale = false;
    failed = 0;
    valid = true;
    info.captures++;
    return true;
  }

  /**
   * Makes this the capture that surfaces mirror — or, if there is none that may be, makes them mirror nothing.
   * @param {number} [presence=1] 0..1: how much of it is shown (it is faded out before another takes its place)
   * @returns {boolean} it is bound
   */
  function bind(presence = 1) {
    if (!valid) {
      shared.uEnvCube.value = null;
      shared.uEnvBox.value.set(0, 0, 0, 0);
      return false;
    }
    shared.uEnvCube.value = target.texture;
    shared.uEnvBox.value.set(x0, z0, x1, z1);
    shared.uEnvAt.value.set(at.x, at.y, at.z, at.top);
    // x: the smallest copy a wholly rough surface reads (one pixel to a face); y: how bright it is mirrored;
    // z: over how many metres inside the box's edge it fades in; w: how much of it is shown just now
    shared.uEnvInfo.value.set(Math.log2(size), 1, fade, presence);
    return true;
  }

  /**
   * For tests: how bright the capture is (linear) where it is looked into towards a point of the world, read back
   * from the card — the pixel the direction falls on, or the brightest within `reach` pixels of it (a lamp's face
   * is a pixel tall: looked for, it is looked for round about). Which face of the cube and which pixel of it a
   * direction falls on is the graphics card's own rule, written out here; that the capture then shows there what
   * really lies that way is what a test holds it to.
   * @returns {number | null} null where there is no capture yet, or the card will not hand its pixels back
   */
  function toward(x, y, z, reach = 0) {
    if (!info.captures) return null;
    const d = [x - at.x, y - at.y, z - at.z];
    const size_ = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])];
    const major = size_[0] >= size_[1] && size_[0] >= size_[2] ? 0 : size_[1] >= size_[2] ? 1 : 2;
    const ma = size_[major];
    if (ma < 1e-6) return null;
    const positive = d[major] > 0;
    // face: +x −x +y −y +z −z; across (sc) and up (tc) on it
    const face = major * 2 + (positive ? 0 : 1);
    const sc = major === 0 ? (positive ? -d[2] : d[2]) : major === 1 ? d[0] : positive ? d[0] : -d[0];
    const tc = major === 1 ? (positive ? d[2] : -d[2]) : -d[1];
    const px = Math.min(size - 1, Math.max(0, Math.floor(((sc / ma + 1) / 2) * size)));
    const py = Math.min(size - 1, Math.max(0, Math.floor(((tc / ma + 1) / 2) * size)));
    const x0_ = Math.max(0, px - reach);
    const y0_ = Math.max(0, py - reach);
    const w = Math.min(size, px + reach + 1) - x0_;
    const h = Math.min(size, py + reach + 1) - y0_;
    try {
      const half = target.texture.type === THREE.HalfFloatType;
      const pixels = half ? new Uint16Array(w * h * 4) : new Uint8Array(w * h * 4);
      const value = half ? THREE.DataUtils.fromHalfFloat : (v) => v / 255;
      renderer.readRenderTargetPixels(target, x0_, y0_, w, h, pixels, face);
      let most = 0;
      for (let i = 0; i < pixels.length; i += 4)
        most = Math.max(most, value(pixels[i]) * 0.3 + value(pixels[i + 1]) * 0.59 + value(pixels[i + 2]) * 0.11);
      return Number.isFinite(most) ? most : null;
    } catch {
      return null;
    }
  }

  return {
    at,
    info,
    capture,
    bind,
    toward,
    /** whether there is a capture that may be mirrored, and whether one is owed */
    get valid() {
      return valid;
    },
    get owed() {
      return stale;
    },
    /** What is in it has changed (the lamps went out): it is not to be mirrored until it has been captured again. */
    dirty() {
      stale = true;
      valid = false;
      failed = 0;
    },
    /** Whether a point on the map is in its box at all. */
    holds(x, z) {
      return x >= x0 && x < x1 && z >= z0 && z < z1;
    },
    /**
     * How far inside the captured box a point on the map is, 0 outside … 1 well inside: the same fading-in at its
     * edges as the shader's. For what is not drawn in the world's space (the gun in the hands).
     */
    inside(x, z) {
      // only a capture that is there just now: while one is being made again, or after one has failed, nothing
      if (shared.uEnvCube.value !== target.texture) return 0;
      return (
        smooth(x0, x0 + fade, x) *
        (1 - smooth(x1 - fade, x1, x)) *
        smooth(z0, z0 + fade, z) *
        (1 - smooth(z1 - fade, z1, z))
      );
    },
  };
}

/** how fast a capture is faded out, and the next in, when the eye goes from one place to another: full in 0.2 s */
const FADE_RATE = 5;
/** the eye has jumped, not walked, if it is this far from where it was a frame ago (metres) */
const JUMP = 6;

/**
 * A captured place for every space (look/keys.js MIRRORS), and the one of them that is mirrored: the one whose
 * box the eye is in.
 *
 * A place is captured the first time the eye is in its box — not before: its key lights burn only when the eye
 * is near (look/slots.js), and a capture is of the place as it is lit — and is kept. It is captured again only
 * after `dirty()` (the lamps went out, or came back). Going from one box into the next, the old capture is faded
 * out and the new one in; an eye that jumps gets the new one at once.
 *
 * Loop contract: `render` is called at most once a frame, and captures at most one place in a call.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {object} o.world            what world/build.js made
 * @param {object[]} o.spaces         look/keys.js MIRRORS
 * @param {number} o.size             pixels across a face of a cube
 * @param {THREE.Object3D[]} [o.also] things outside the world's own group that stand still and belong in a capture
 */
export function createMirrors({ renderer, scene, world, spaces, size, also = [] }) {
  const tag = (root) =>
    root.traverse((o) => {
      if (o.isMesh && takesLight(o) && !FACES_THE_EYE.has(o.name)) o.layers.enable(MIRROR_LAYER);
    });
  tag(world.group);
  also.forEach(tag);

  // a cube for a place is made when the place is first wanted: most visits to the site do not go everywhere
  const made = new Map();
  // what turns, and is captured as it looks wherever it has got to: the casings' skins, without their streaks
  const still = (on) => world.cascade?.still?.(on);
  const mirrorOf = (space) => {
    if (!made.has(space)) made.set(space, createMirror({ renderer, scene, at: space, size, still }));
    return made.get(space);
  };
  const spaceAt = (x, z) => mirrorAt(x, z, spaces);

  /** the place that is mirrored (or being faded out), and how much of it is shown */
  let active = null;
  let presence = 0;
  const last = { x: NaN, z: NaN, time: 0 };

  /**
   * What a test, and anyone curious, may know: of the place that is mirrored just now — `size`, `box`, `mean`
   * (read back from the card: see createMirror), `blurred` — and of all of them: how many captures have been made
   * in all, and which places have one.
   */
  const info = {
    size,
    get name() {
      return active ? active.info.name : null;
    },
    get box() {
      return active ? active.info.box : null;
    },
    get mean() {
      return active ? active.info.mean : null;
    },
    get blurred() {
      return active ? active.info.blurred : true;
    },
    get captures() {
      let n = 0;
      for (const m of made.values()) n += m.info.captures;
      return n;
    },
    get captured() {
      return [...made.values()].filter((m) => m.valid).map((m) => m.info.name);
    },
    get presence() {
      return presence;
    },
    toJSON() {
      return {
        size,
        name: info.name,
        box: info.box,
        mean: info.mean,
        blurred: info.blurred,
        captures: info.captures,
        captured: info.captured,
        presence,
      };
    },
  };

  /**
   * @param {{ x: number, z: number }} [eye] where the eye is; left out, where it was
   * @param {boolean} [ready=true] the key lights are as they are going to be: a place may be captured
   */
  function render(eye, ready = true) {
    const at = eye || (Number.isNaN(last.x) ? world.site.start : last);
    const now = performance.now();
    const dt = last.time ? Math.min(0.1, Math.max(0, (now - last.time) / 1000)) : 0;
    const jumped = Number.isNaN(last.x) || Math.hypot(at.x - last.x, at.z - last.z) > JUMP;
    last.x = at.x;
    last.z = at.z;
    last.time = now;

    const space = spaceAt(at.x, at.z);
    // the eye is where no place was captured from (the drone bay; outside the map): what was mirrored stays
    const wanted = space ? mirrorOf(space) : active;
    if (wanted !== active) {
      // out with the old; and when it is out, the new takes its place, dark, to be faded in
      presence = jumped ? 0 : Math.max(0, presence - dt * FADE_RATE);
      if (presence <= 0) active = wanted;
    }
    if (wanted === active && active) {
      if (active.owed && ready) active.capture();
      presence = active.valid ? (jumped ? 1 : Math.min(1, presence + dt * FADE_RATE)) : 0;
    }
    if (!active || !active.bind(presence)) {
      shared.uEnvCube.value = null;
      shared.uEnvBox.value.set(0, 0, 0, 0);
    }
  }

  return {
    info,
    render,
    /** the capture of the place the eye is in, if there is one (for tests) */
    get active() {
      return active;
    },
    /**
     * What is in them has changed (the lamps went out, or came back): each is captured again when next it is
     * wanted.
     * @param {{ x: number, z: number, reach: number }[] | null} [lamps] only the places these lamps' light reaches
     *   (look/keys.js mirrorReached); left out, every place
     */
    dirty(lamps = null) {
      for (const [space, m] of made)
        if (!lamps || lamps.some((lamp) => mirrorReached(space, lamp.x, lamp.z, lamp.reach))) m.dirty();
    },
    /** How much of the captured place somebody at (x, z) mirrors: for what is in the hands. */
    inside(x, z) {
      return active ? active.inside(x, z) * presence : 0;
    },
    /** For tests: how bright the capture that is mirrored is, looked into towards a point of the world. */
    toward(x, y, z, reach = 0) {
      return active ? active.toward(x, y, z, reach) : null;
    },
  };
}

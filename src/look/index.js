// The second look: everything that is switched on by `?look=2` in the address, and nothing that is not.
//
// main.js fetches this file — and through it everything in src/look and src/gfx/next — only when the address asks
// for it. A game started without the switch still carries the fenced lines of shader and the hooks in
// world/build.js that the second look uses, but none of them runs (gfx/materials.js `setLook`), and neither this
// code nor the pictures are fetched. docs/DESIGN.md, "The second look", says what it is for.
//
// Each piece can be left out in the address, so that the phone test page (look/bench.js) can time them one at a
// time: `mats=0` no materials on objects (`mats=cheap`: laid on from one side only, not three), `key=0` no key
// light, `env=0` nothing captured for metal to mirror, `shapes=0` the models as they were, `marks=0` nothing
// painted or spilt on the floors and no dark under things, `shafts=0` no lit air under the lamps.
import * as THREE from 'three';
import { setLook, shared } from '../gfx/materials.js';
import { buildCarbine } from '../gfx/next/carbine.js';
import { buildDrone } from '../gfx/next/drone.js';
import { buildKnife } from '../gfx/next/knife.js';
import { buildBeacon, buildCentrifugeGeometry, buildCharge } from '../gfx/next/mission.js';
import { buildConsole, buildForklift, buildSwitchgear } from '../gfx/next/gear.js';
import { buildContainer, buildTruck } from '../gfx/next/props.js';
import { buildDesk, buildGenerator, buildLocker, buildRack, buildTransformer } from '../gfx/next/rooms.js';
import { buildSentry } from '../gfx/next/sentry.js';
import { buildGrenade, buildGrenadeBody, buildPistol, buildShotgun } from '../gfx/next/sidearms.js';
import {
  buildBarrel,
  buildBarrier,
  buildCrate,
  buildCrateTall,
  buildCylinder,
  buildPallet,
  buildPipeRun,
  buildTank,
} from '../gfx/next/yard.js';
import { createExposure, sceneLight } from './exposure.js';
import { LOOK_GLSL } from './glsl.js';
import { keyLampsOf, keyReach, shadowTaps } from './key.js';
import { KEYS, MIRRORS, ROOM_FILL } from './keys.js';
import { createKeyLights } from './keylight.js';
import { layMarks } from './marks.js';
import { drawMarkSheet } from './marksheet.js';
import { loadMatter } from './matter.js';
import { createMirrors } from './mirror.js';
import { shadowFilter } from './probe.js';

/**
 * The furniture that has been built again, by kind (gfx/next). VIEW: what stood in the one view of 15 November —
 * and all a device held in the hand is given: its owner's phone drew that view at thirty frames a second with
 * nothing to spare, and the rest has not been timed on one. SITE: the rest of the site, of 16 November.
 */
const VIEW = { truck: buildTruck, container: buildContainer };
const SITE = {
  forklift: buildForklift,
  console: buildConsole,
  switchgear: buildSwitchgear,
  crate: buildCrate,
  crateTall: buildCrateTall,
  barrel: buildBarrel,
  barrier: buildBarrier,
  pallet: buildPallet,
  cylinder: buildCylinder,
  tank: buildTank,
  pipeRun: buildPipeRun,
  rack: buildRack,
  locker: buildLocker,
  desk: buildDesk,
  transformer: buildTransformer,
  generator: buildGenerator,
};

/**
 * How much of the look a device is given. Two things decide it, and they are not the same thing:
 *   - whether it is HELD IN THE HAND (`touch`). A phone gets the lean level whatever detail its owner has chosen:
 *     four key lights at once, not six; their depth pictures smaller; no picture of moving things; and four
 *     points asked of a shadow's edge where its card is known to blend them. Decision of 16 November 2026: the
 *     owner's iPhone, with Detail set to High, had until then been given the desk's level — because "a phone"
 *     was taken to mean "Detail: Low" — and drew it at 30 frames a second with nothing to spare.
 *   - the detail level. `low` on anything is lean too, and has the smaller pictures of what things are made of.
 * @param {object} o
 * @param {'low'|'medium'|'high'} o.quality
 * @param {boolean} o.touch
 */
export function levelOf({ quality, touch }) {
  const lean = !!touch || quality === 'low';
  return {
    lean,
    /** how many key lights burn at once (look/slots.js), and how much nearer they must be to matter */
    slots: lean ? 4 : 6,
    reach: lean ? 0.6 : 1,
    /** pixels across a tile of the still depth picture */
    shadow: lean ? 1024 : quality === 'high' ? 2048 : 1536,
    /** machines and doors throw shadows, kept up every frame */
    moving: !lean,
    /**
     * the air under each lamp is lit. Not on what is held in the hand: a cone of haze is a second and third
     * layer over much of the picture, and a phone that draws the rest at thirty frames a second has none to
     * spare for it (16 November 2026 — not measured on one; left out until it has been).
     */
    shafts: !lean,
    /** pixels across a material's picture, and a face of a captured place */
    matter: quality === 'low' ? 256 : 512,
    cube: lean ? 64 : 128,
  };
}

/**
 * Decides what is on, tells the materials, and fetches the pictures things are made of — before anything is built.
 * @param {object} o
 * @param {'low'|'medium'|'high'} o.quality the detail level
 * @param {object} o.level the row of gfx/renderer.js QUALITY for it
 * @param {boolean} [o.touch] the device is held in the hand
 * @param {URLSearchParams} o.params
 */
export async function prepare({ quality, level, touch = false, params }) {
  const tier = levelOf({ quality, touch });
  const phone = tier.lean;
  const want = {
    matter: params.get('mats') !== '0',
    keys: params.get('key') !== '0',
    env: params.get('env') !== '0',
  };
  const keys = want.keys ? KEYS : [];
  // how many points of a key light's depth picture each pixel asks (look/key.js): a phone's card is asked how it
  // samples one — and only where there is a key light to ask about
  const taps = shadowTaps({ phone, filter: phone && keys.length ? shadowFilter() : 'unknown' });
  setLook({
    on: true,
    // the look's own shader text, which the materials carry none of (look/glsl.js)
    glsl: LOOK_GLSL,
    matter: want.matter,
    cheap: params.get('mats') === 'cheap',
    keys: keys.length ? tier.slots : 0,
    taps,
    moving: tier.moving,
    env: want.env,
  });
  const matter = want.matter
    ? await loadMatter({
        size: tier.matter,
        anisotropy: level?.anisotropy ?? 4,
        // `?mats=miss` asks for pictures that are not there: what a failed download looks like to the game
        address: params.get('mats') === 'miss' ? () => '/a-picture-that-is-not-there.webp' : undefined,
      })
    : null;

  const shapes = params.get('shapes') !== '0';
  // the one picture every mark on the floors and walls is a square of, drawn now (look/marksheet.js)
  const sheet = params.get('marks') === '0' ? null : drawMarkSheet({ anisotropy: level?.anisotropy ?? 4 });
  return {
    phone,
    tier,
    keys,
    /** how far the worked-out light under a roof is turned down beside the key lights (world/build.js) */
    roomFill: keys.length ? ROOM_FILL : 1,
    matter: want.matter,
    /** what is painted, spilt and worn on the site, and the dark under things: the picture, and where each goes */
    marks: sheet ? { map: sheet, lay: layMarks } : null,
    /**
     * What has been built again for the one view, each to the contract of the builder it stands in for
     * (docs/DESIGN.md, section 8). `models`: the carbine in the hands and the sentry, as gfx/models.js builds
     * them. `props`: furniture by kind, as gfx/propModels.js buildProp does — and with it `letters`, what is
     * written on the thing and where. A kind that is not here is built as it always was.
     */
    models: shapes
      ? {
          buildCarbine,
          buildSentry,
          buildDrone,
          buildCharge,
          buildBeacon,
          // there are 512 casings in the hall: a device held in the hand keeps the eight-sided one
          ...(tier.lean ? {} : { buildCentrifugeGeometry }),
        }
      : {},
    /** …and what else is held in the hands: the pistol, the shotgun, the grenade and the knife (weapon.js) */
    arms: shapes ? { buildPistol, buildShotgun, buildGrenade, buildGrenadeBody, buildKnife } : {},
    props: shapes ? (tier.lean ? VIEW : { ...VIEW, ...SITE }) : {},
    /**
     * Once the world stands: the key lights' depth pictures, the capture metal mirrors, and what moving things and
     * the gun in the hands need of both.
     */
    attach({ renderer, scene, world, textures }) {
      world.matter = matter;
      const keyLights = keys.length
        ? createKeyLights({
            renderer,
            scene,
            world,
            keys,
            slots: tier.slots,
            size: tier.shadow,
            moving: tier.moving,
            reach: tier.reach,
            taps,
            textures,
            shafts: tier.shafts && params.get('shafts') !== '0',
          })
        : null;
      const mirror = want.env
        ? createMirrors({
            renderer,
            scene,
            world,
            spaces: MIRRORS,
            size: tier.cube,
            also: keyLights ? [keyLights.fittings] : [],
          })
        : null;
      world.env = mirror ? mirror.info : null;
      /** @param {{ x: number, z: number }} [eye] where the eye is: which lamps burn is decided from it */
      const beforeRender = (eye) => {
        // in this order: a capture has the key lights' shadows in it — and is not taken while a lamp is still
        // coming up
        keyLights?.render(eye);
        mirror?.render(eye, !keyLights || keyLights.settled());
      };
      // both are made now, of the site as it stands, so that the first frame anyone sees already has them
      beforeRender(world.site.start);
      // the picture's exposure follows the place — only where there are key lights to make one place so much
      // brighter than the next (look/exposure.js)
      const exposure = keyLights ? createExposure() : null;
      const forward = new THREE.Vector3();
      const stood = { x: NaN, z: NaN };
      // the site's lamps are alight when it is built; the place is captured again only when that changes
      let alight = true;
      // the key lights as lamps that can be put out (world/lamps.js; main.js joins them to the site's own): where
      // each hangs, the room it is the lamp of, and the box round its fitting that a round must enter
      const lampList = keyLampsOf(keys, world.grid);
      lampList.forEach((lamp, k) => {
        lamp.box = keyLights ? keyLights.boxOf(k) : null;
      });
      return {
        keyLights,
        mirror,
        beforeRender,
        /**
         * Lamps that go out (main.js, "lamps that go out").
         * list:   the key lights, as world/lamps.js `createLamps` wants them, in the order of look/keys.js
         * sync:   (indices, isOut) puts out, or lights again, those of them that have changed — the lamp itself,
         *         its light and shadows, and what the game counts of it
         * relit:  (lamps) the site's light has changed and has been worked out again — its own lamps, or these:
         *         what metal mirrors is captured again, in the places those lamps' light reaches, when each is
         *         next looked at
         */
        lamps: {
          list: lampList,
          sync(indices, isOut) {
            let changed = 0;
            for (const k of indices) {
              const dead = !!isOut(k);
              if (!keyLights?.setOut(k, dead)) continue;
              world.setKeyOut(k, dead);
              changed++;
            }
            return changed;
          },
          /** @param {{ x: number, z: number, reach: number }[]} lamps the lamps that went out or came back */
          relit(lamps) {
            mirror?.dirty(lamps);
          },
        },
        cast: (root) => (keyLights ? keyLights.cast(root) : root),
        /**
         * How the picture is to be exposed this frame, beside the player's own brightness: 1 is as it always was.
         * @param {THREE.Camera} camera the eye
         * @param {number} dt seconds since the last frame
         */
        expose(camera, dt) {
          if (!exposure) return 1;
          const eye = camera.position;
          camera.getWorldDirection(forward);
          // an eye that has jumped (a start, a cut) is exposed for where it is at once
          const jumped = Number.isNaN(stood.x) || Math.hypot(eye.x - stood.x, eye.z - stood.z) > 6;
          stood.x = eye.x;
          stood.z = eye.z;
          return exposure.update(sceneLight(world, eye, forward), dt, jumped);
        },
        /** For tests: the exposure just now, and the light it was worked out from. */
        exposure: (camera) =>
          exposure
            ? { value: exposure.value, light: sceneLight(world, camera.position, camera.getWorldDirection(forward)) }
            : null,
        /** Whether something standing at (x, z) throws a shadow just now: a burning lamp's light reaches it. */
        casts: (x, z) => (keyLights ? keyLights.casts(x, z) : false),
        setLamps(on) {
          keyLights?.setOn(on);
          if (on !== alight) mirror?.dirty();
          alight = on;
        },
        /**
         * For what is in the hands, which is drawn in a space of its own: `key` — the key light arriving at a
         * point in the air (look/keylight.js arriving); `mirror` — how far inside the captured place a point is.
         */
        hand: {
          key: (x, y, z, out) => {
            if (keyLights) return keyLights.arriving(keyReach, x, y, z, out);
            out.r = out.g = out.b = out.x = out.y = out.z = 0;
            return out;
          },
          mirror: (x, z) => (mirror ? mirror.inside(x, z) : 0),
        },
        /** For tests: draw every lit surface in a flat colour that says whether it has a material. */
        classes(on) {
          shared.uLookDebug.value = on ? 1 : 0;
        },
        /** For tests: ground points in view of `camera`, and whether key light `k` reaches each (look/keylight.js). */
        keySamples: (camera, k = 0) => (keyLights ? keyLights.samples(camera, keyReach, k) : []),
        /**
         * For tests: key light `k` alone (−1: all of them again; a number no lamp has: none). The place is
         * captured again by that light at the next frame, so that what is mirrored is what is lit — unless
         * `held`: then what is mirrored stays as it was, and the only thing that changes in the picture is the
         * lamp's own light (which is how its shadows are read off it).
         */
        keySolo(k, held = false) {
          keyLights?.solo(k);
          if (!held) mirror?.dirty();
        },
        /** For tests: where to stand to look at key light `k`'s light and shadows (look/keylight.js station). */
        keyStation: (k, lens) => (keyLights ? keyLights.station(k, keyReach, lens) : null),
        /** The eye has been put somewhere else: which lamps burn is settled for there at once, not crept to. */
        settle(eye) {
          keyLights?.render(eye, true);
        },
        /** For tests: how bright the capture is, looked into towards a point of the world (look/mirror.js toward). */
        mirrorToward: (x, y, z, reach) => (mirror ? mirror.toward(x, y, z, reach) : null),
      };
    },
  };
}

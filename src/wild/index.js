// The wild branch's experiment: what joins its features to the game.
//
// Decision of 16 November 2026 — the owner: "… just go wild and make it maximum fun of a game and maximum
// creative don't holdback … but allow me to rollback if i wouldn't like it". This file and everything beside it
// is fetched only when the experiment is on (src/wild/switch.js; main.js asks for it at the end of boot). Off,
// none of it exists for the game: `wild` is null there, and every place that would have called in here is a
// `wild?.…` that does nothing. docs/WILD.md is the design of it.
//
// A FEATURE is one thing the experiment adds — bent time, the uplink, the tripwires. Each has its rules in a file
// of its own with no drawing and no browser in it (held by test/unit/wild-*.test.mjs), and a `create…(ctx)` that
// joins those rules to the game and returns an object of the shape below. Every member is optional. This file
// only passes things on: it knows no feature's rules.
//
//   name       its name: what a checkpoint files its state under
//   brief      its lines in the briefing: [[key, name, a few words], …] — each is one line there, so the words are
//              few (fifty letters) — or a function of whether this is a phone, which returns them: a phone has
//              buttons where a desk has keys, and the key is then left empty
//   controls   rows for the Controls screen: [what, on a desk, on a phone]. `what` says the thing in a line no longer
//              than the game's own longest (76 letters): that column is never wrapped, and a longer one squeezes
//              the others off the panel. The other two are a key and a button, and a few words at most
//   tallies    { counter: 'what the debrief calls it' } — counters it keeps in ctx.tally
//   sounds     { sounds, loops }: recipes of its own, of the shape src/audio/sounds.js and loops.js have
//   reset()    a mission begins, or the title is shown: everything as it was built
//   step(dt, own, intent)   one step of the world while the mission is played. `dt` is the world's seconds,
//              `own` the player's (they differ while time is bent), `intent` what the player asks (input.js).
//              A feature that takes the player's hands off the body (flying a drone) returns the intent the
//              BODY is to act on instead; anything else returns nothing.
//   frame(real)             once every drawn frame whatever the state of the game: what it shows. Real seconds.
//   pace(real, pace)        time: multiplies pace.world and pace.own (both 1 unless something bends them)
//   view(camera, aspect)    puts the camera somewhere else, and says true
//   fov                     a number the field of view is multiplied by
//   on         { kill(unit, how), spotted(unit, how), alarm(on), found(body), hurt(), hit(what), knife(what),
//              lamp(i), emp(x, z, seconds), cache(n), charge(c), blast(), beacon(), phase(phase), end(),
//              fired(unit, { hit }) }:
//              things that happen in the game (main.js says when)
//   shot(ox, oy, oz, dx, dy, dz, max)   a round is flying: null, or { t, hit() } — how far along it meets
//              something of this feature's, and what to do if that is where the round stops
//   save() / load(state)    what a checkpoint keeps of it (plain data), and puts back
//   chip()     its piece of the bar at the foot of the screen: null, or { key, name, text, level, tone }
//   screen(name, layer, data)   a menu screen has been built: a word to add to it
//   grab(busy) on a phone, what the second button should say when the game has no use for it — or null
//   turned(unit, dt, inner) / foe(unit, dt, inner) / alarmAt(unit)   the machines' side of it (enemies/index.js)
//   squad(unit, dt, inner)      a machine in a fight: true if this has moved it to its place (it fires all the same)
//   plate(struck)               a round of the player's struck a machine: how much it is to count, or nothing —
//                               `struck.multiplier` is what it counts so far (each feature is asked in turn)
//   ctx.plenty = () => n        (a feature may put its own here) how many times the rounds there are
//
// WHAT THIS FILE AND ITS FEATURES MAY IMPORT FROM THE GAME. Only `three`, and modules that stand alone:
// core/math.js, enemies/ai.js, audio/synth.js, ui/menus.js. Everything else of the game's that a feature needs —
// the materials (`glow`, `lit`, `ownMaterials`, `setProbe`), the moving of bodies (`moveBody`, `pushOut`) — is
// handed over by main.js as `ctx.lib`. The reason is the bundler, not taste: a module that both this file and the
// second look's file import, and that is not free of side effects, is moved out of the script everybody
// downloads into a third file, and three.js goes with it (seen 16 November 2026 with gfx/fx.js and with
// gfx/materials.js: 199 kB left the main script). test/wild/wild.test.mjs holds the build to the files it has.
import './wild.css';
import { CONTROLS_ROWS } from '../ui/menus.js';
import { createMixLive } from './mix-live.js';
import { createMusicLive } from './music-live.js';
import { createVoiceLive } from './voice-live.js';
import { createHapticsLive } from './haptics-live.js';
import { createAftershockLive } from './aftershock-live.js';
import { createFocusLive } from './focus-live.js';
import { createUplinkLive } from './uplink-live.js';
import { createSquadLive } from './squad-live.js';
import { createPilotLive } from './pilot-live.js';
import { createOperatorLive } from './operator-live.js';
import { createOverspeedLive } from './overspeed-live.js';
import { createWardenLive } from './warden-live.js';
import { createSlideLive } from './slide-live.js';
import { createTripwiresLive } from './tripwires-live.js';
import { createResponseLive } from './response-live.js';
import { createVisorLive } from './visor-live.js';
import { createArmourLive } from './armour-live.js';
import { createLodestoneLive } from './lodestone-live.js';
import { createPackALive } from './pack-a-live.js';
import { createSfxLive } from './sfx-live.js';
import { createBoardLive } from './board-live.js';

/**
 * The features, in the order they are stepped — which is also the order of their lines in the briefing, their rows
 * on the Controls screen and their counts at a mission's end. A feature is added by importing its `create…` and
 * naming it here — one line each, and nothing else in this file changes. (WARDEN is last because what it says of
 * the others reads last; a feature calls `ctx.say` when something happens, never keeps hold of it, so that it
 * does not matter which was made first.)
 * @type {((ctx: object) => object | null)[]}
 */
const FEATURES = [
  // (what is heard rather than done comes first: it has no line in the briefing and no row of its own)
  createMixLive,
  createMusicLive,
  createVoiceLive,
  createHapticsLive,
  createAftershockLive,
  createFocusLive,
  createUplinkLive,
  createSquadLive,
  createPilotLive,
  createOperatorLive,
  createOverspeedLive,
  createSlideLive,
  createLodestoneLive,
  createTripwiresLive,
  createResponseLive,
  createVisorLive,
  // (after the visor: the plating is asked about what the visor made of a round — `plate`, below)
  createArmourLive,
  createPackALive,
  createSfxLive,
  createWardenLive,
  createBoardLive,
];

/**
 * @param {object} base  what main.js hands over
 * @param {object} base.G        the game's state: G.player, G.enemies, G.weapon, G.world, G.site, G.fx, G.audio,
 *                               G.hud, G.input, G.menus, G.camera, G.mission, G.settings, G.touch, G.look …
 * @param {HTMLElement} base.ui  the layer every screen and the HUD are in
 * @param {THREE.Scene} base.scene
 * @param {URLSearchParams} base.params
 * @param {Storage | null} base.store
 * @param {object} base.act      what only main.js can do: radio(who, text, seconds), siren(), wave(at, turn),
 *                               bringDown(), dark(x, z), loop(name)
 * @param {object} base.lib      the game's own, handed over (see above): glow, lit, ownMaterials, setProbe,
 *                               moveBody, pushOut
 */
export function createWild(base) {
  const { G } = base;
  // everything the experiment shows is in one element inside the HUD: it comes and goes with it
  const overlay = document.createElement('div');
  overlay.className = 'wild';
  const bar = document.createElement('div');
  bar.className = 'w-bar';
  overlay.append(bar);
  G.hud.el.append(overlay);

  /**
   * What a feature is given: what main.js handed over, and what the features share —
   *   overlay   the element its own pieces of the screen go into
   *   tally     counters for the debrief (a feature names its own in `tallies`); kept by checkpoints
   *   say(event, data)   WARDEN has something to say about it (src/wild/warden.js), if it speaks at all
   *   voice(who, line)   a line is said aloud (src/wild/voice-live.js): true if there is a clip of it to be heard
   *   buzz(kind, strength)   something is felt (src/wild/haptics-live.js), where a browser can make it felt
   *   note(text, tone)   the line under the crosshair
   */
  const ctx = {
    ...base,
    overlay,
    tally: {},
    say() {},
    voice: () => false,
    buzz() {},
    note: (text, tone) => G.hud.note(text, tone),
    /**
     * Something has brought the site down on the player — a wire broken, an alarm raised, a task done: the
     * feature that answers with machines (response-live.js) puts itself here. Until it has, nobody comes.
     * @param {string} _cause 'tripwire' | 'alarm' | 'task'
     * @param {{x: number, z: number}} [_at] where it happened
     */
    respond(_cause, _at) {},
    /**
     * How many times the rounds there are: in reserve when a mission starts, in a cache, from a wave shut down.
     * One, until a feature that makes rounds count for less (armour-live.js) puts its own figure here.
     */
    plenty: () => 1,
  };
  const features = FEATURES.map((make) => make(ctx)).filter(Boolean);
  for (const feature of features) for (const row of feature.controls || []) CONTROLS_ROWS.push(row);
  // the sounds the features bring with them are rendered now, after the game's own (they are not waited for:
  // a sound asked for before it is ready is a sound not played, as it is for the game's own)
  const extra = { sounds: {}, loops: {} };
  for (const feature of features) {
    Object.assign(extra.sounds, feature.sounds?.sounds);
    Object.assign(extra.loops, feature.sounds?.loops);
  }
  /** resolves when the experiment's sounds can be played (for tests) */
  const ready = Promise.resolve(G.audio.extend?.(extra)).catch((error) =>
    console.warn(`the experiment's sounds could not be made: ${error?.message || error}`),
  );

  const pace = { world: 1, own: 1 };
  const chips = new Map();
  let chipT = 0;

  /** The bar at the foot of the screen: one chip a feature that has one, redrawn a few times a second. */
  function drawBar() {
    for (const feature of features) {
      const chip = feature.chip?.() || null;
      let el = chips.get(feature);
      if (!chip) {
        if (el) el.hidden = true;
        continue;
      }
      if (!el) {
        el = document.createElement('div');
        el.className = 'w-chip';
        el.innerHTML = '<kbd></kbd><b></b><span></span><i></i>';
        bar.append(el);
        chips.set(feature, el);
      }
      el.hidden = false;
      el.dataset.tone = chip.tone || '';
      const [key, name, text, level] = el.children;
      if (key.textContent !== chip.key) key.textContent = chip.key;
      if (name.textContent !== chip.name) name.textContent = chip.name;
      if (text.textContent !== chip.text) text.textContent = chip.text;
      level.style.setProperty('--level', String(Math.max(0, Math.min(1, chip.level ?? 0))));
    }
  }

  const tallied = () => features.flatMap((feature) => Object.entries(feature.tallies || {}));

  return {
    features,
    tally: ctx.tally,
    ready,
    /** for tests and the curious: a feature by its name */
    feature: (name) => features.find((feature) => feature.name === name) || null,

    reset() {
      for (const key of Object.keys(ctx.tally)) delete ctx.tally[key];
      for (const feature of features) feature.reset?.();
      chipT = 0;
    },

    step(dt, own, intent) {
      let body = intent;
      for (const feature of features) body = feature.step?.(dt, own, intent) || body;
      return body;
    },

    frame(real) {
      for (const feature of features) feature.frame?.(real);
      chipT -= real;
      if (chipT <= 0) {
        chipT = 0.1;
        drawBar();
      }
    },

    pace(real) {
      pace.world = pace.own = 1;
      for (const feature of features) feature.pace?.(real, pace);
      return pace;
    },

    view(camera, aspect) {
      for (const feature of features) if (feature.view?.(camera, aspect)) return true;
      return false;
    },

    get fov() {
      let k = 1;
      for (const feature of features) k *= feature.fov ?? 1;
      return k;
    },

    emit(name, a, b, c) {
      for (const feature of features) feature.on?.[name]?.(a, b, c);
    },

    /** A round is flying: how far along it stops at something of the experiment's (and that is told), or −1. */
    shot(ox, oy, oz, dx, dy, dz, max) {
      let best = null;
      for (const feature of features) {
        const met = feature.shot?.(ox, oy, oz, dx, dy, dz, max);
        if (met && met.t <= max && (!best || met.t < best.t)) best = met;
      }
      if (!best) return -1;
      best.hit();
      return best.t;
    },

    save() {
      const kept = { tally: { ...ctx.tally }, features: {} };
      for (const feature of features) if (feature.save) kept.features[feature.name] = feature.save();
      return kept;
    },

    load(kept) {
      if (!kept) return;
      Object.assign(ctx.tally, kept.tally);
      for (const feature of features)
        if (feature.load && kept.features[feature.name] !== undefined) feature.load(kept.features[feature.name]);
    },

    screen(name, layer, data) {
      if (name === 'briefing') {
        // what there is to use and to look out for: a line a thing — the key it is on, its name, a few words
        const lines = features.flatMap(
          (feature) => (typeof feature.brief === 'function' ? feature.brief(!!G.touch) : feature.brief) || [],
        );
        if (lines.length) {
          const kit = document.createElement('div');
          kit.className = 'w-kit';
          const head = document.createElement('h3');
          head.textContent = 'KIT AND HAZARDS';
          const list = document.createElement('ul');
          for (const [key, what, words] of lines) {
            const line = document.createElement('li');
            for (const [tag, text] of [
              ['kbd', key],
              ['b', what],
              ['span', words],
            ]) {
              const part = document.createElement(tag);
              part.textContent = text;
              line.append(part);
            }
            list.append(line);
          }
          const foot = document.createElement('p');
          foot.textContent = 'Each is spelled out under CONTROLS.';
          kit.append(head, list, foot);
          layer.querySelector('.m-tasks')?.after(kit);
        }
      } else if (name === 'debrief' || name === 'failed') {
        const rows = tallied().filter(([key]) => ctx.tally[key]);
        if (rows.length) {
          // the menus' own rows (ui/menus.js statRow), under a line that says whose they are
          const list = document.createElement('dl');
          list.className = 'm-stats w-tally';
          for (const [key, label] of rows) {
            const row = document.createElement('div');
            row.className = 'm-stats__row';
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = String(ctx.tally[key]);
            row.append(dt, dd);
            list.append(row);
          }
          layer.querySelector('.m-stats')?.after(list);
        }
      }
      for (const feature of features) feature.screen?.(name, layer, data);
    },

    grab(busy) {
      for (const feature of features) {
        const label = feature.grab?.(busy);
        if (label) return label;
      }
      return null;
    },

    turned(unit, dt, inner) {
      for (const feature of features) feature.turned?.(unit, dt, inner);
    },

    foe(unit, dt, inner) {
      for (const feature of features) if (feature.foe?.(unit, dt, inner)) return true;
      return false;
    },

    alarmAt(unit) {
      for (const feature of features) {
        const at = feature.alarmAt?.(unit);
        if (at) return at;
      }
      return null;
    },

    /** A machine in a fight (enemies/index.js, COMBAT): true if a feature has moved it to its place in it. */
    squad(unit, dt, inner) {
      for (const feature of features) if (feature.squad?.(unit, dt, inner)) return true;
      return false;
    },

    /**
     * A round of the player's has struck a machine (weapon.js): how much the place it struck is to count. Every
     * feature that has a word on it is asked in turn, and told what the place counts SO FAR — the machine's own
     * figure, or what a feature before it made of that — so that a visor and the plating behind it are both
     * counted (until 18 November 2026 the first answer was the last: the round that cracks a visor would have
     * gone through the plating in full). No feature answering, the machine's own stands.
     * @param {{unit: object, zone: string, multiplier: number, t: number}} struck
     * @returns {number | undefined}
     */
    plate(struck) {
      let by;
      for (const feature of features) {
        if (!feature.plate) continue;
        const next = feature.plate(by === undefined ? struck : { ...struck, multiplier: by });
        if (typeof next === 'number') by = next;
      }
      return by;
    },

    /** How many times the rounds there are (main.js: what a mission starts with, what a cache gives). */
    plenty: () => ctx.plenty(),
  };
}

// Lodestar — the conductor. This file owns the frame loop and the state of the game, and is the only one that
// knows about every other module. Read docs/DESIGN.md first; section 2 has the map of what is what.
import * as THREE from 'three';
import { createSettings } from './settings.js';
import { buildSite, ZONE, ZONE_NAMES } from './world/map.js';
import { buildWorld, MOON_DIR } from './world/build.js';
import { createLamps } from './world/lamps.js';
import { BLAST } from './world/blast.js';
import { CRATER, FORECOURT, SHAFT, STATIONS } from './world/mountain.js';
import { airOf } from './audio/air.js';
import { glow, lit, ownMaterials, setProbe, shared } from './gfx/materials.js';
import { moveBody, pushOut } from './world/collide.js';
import { createRenderer, resolveQuality, QUALITY } from './gfx/renderer.js';
import { createPost } from './gfx/post.js';
import { setGeoDetail } from './gfx/geo.js';
import { makeTextures } from './gfx/textures.js';
import { loadArt } from './gfx/art.js';
import { createSky } from './gfx/sky.js';
import { buildProp } from './gfx/propModels.js';
import * as models from './gfx/models.js';
import * as sidearms from './gfx/sidearms.js';
import { createFx } from './gfx/fx.js';
import { PLAYER, createPlayer } from './player.js';
import { createWeapon } from './weapon.js';
import { ARMS, GUNS, GUN_ORDER } from './arms.js';
import { createEnemies } from './enemies/index.js';
import { AI } from './enemies/ai.js';
import {
  PHASE,
  createMission,
  plantCharge,
  canDetonate,
  detonate,
  hostileDown,
  placeBeacon,
  canPlaceBeacon,
  step as stepMission,
  objectives,
} from './mission.js';
import { createInput } from './input.js';
import { createHud } from './ui/hud.js';
import { createMenus } from './ui/menus.js';
import { createMarkers } from './markers.js';
import { createSilence } from './core/silence.js';
import { difficultyOf } from './difficulty.js';
import { waveEntries, waveBays } from './enemies/wave.js';
import { BODY, bodyView } from './enemies/bodies.js';
import { POINT_WORDS, bearingOf, contacts, metres, pointOf } from './bearing.js';
import { clamp, damp, lerp, smooth } from './core/math.js';
import { lookWanted, wildWanted } from './wild/switch.js';

// the sound engine is looked for rather than required, so that the game still starts if it is missing or broken
const audioModule = Object.values(import.meta.glob('./audio/audio.js', { eager: true }))[0];

const params = new URLSearchParams(location.search);
const RECORD_KEY = 'lodestar.record.v1';
const CHARGE_HOLD = 2;
/** firing the charges is a decision, not a job of work: a short hold, long enough not to be done by a slip */
const BLOW_HOLD = 1.2;
const BEACON_HOLD = 3;
/** the middle of the cascade hall: where its sounds come from */
const HALL = { x: 51, y: 2.5, z: 29 };
/** seconds after the charges are fired at which Overwatch says what they did */
const BLAST_TOLD = 4.6;
/** how far Overwatch sees machines for you on the settings where it does (difficulty.js `radar`) */
const RADAR_REACH = 34;
/** Overwatch names a contact no more often than this, in seconds of the mission */
const CALLOUT_GAP = 6;
const FOG_PLAY = 0.013;
const FOG_WIDE = 0.0062;
/** how long in a frame may go on lighting the level again after a lamp went out or came back (milliseconds) */
const RELIGHT_MS = 4;
/** the facility, as the box the strike brings down round you if you are still in it: x0, z0, x1, z1 */
const RUIN_BOX = [29.5, 15.5, 101.5, 55.5];
/** the mouth of the road tunnel, where what goes off inside the mountain is seen from outside */
const PORTAL = { x: 64, y: 2.6, z: FORECOURT.z0 + 0.5 };
/** where the exhaust shaft comes out on the mountain */
const VENT = { x: (SHAFT.x0 + SHAFT.x1) / 2, y: SHAFT.top + SHAFT.collar, z: (SHAFT.z0 + SHAFT.z1) / 2 };

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.error?.stack || e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason?.stack || e.reason)));

const bootEl = document.getElementById('boot');
const nextFrame = () => new Promise((done) => requestAnimationFrame(() => done()));
async function progress(label, fraction) {
  document.getElementById('boot-line').textContent = label;
  document.getElementById('boot-fill').style.width = `${Math.round(fraction * 100)}%`;
  await nextFrame();
}

function storage() {
  try {
    const s = window.localStorage;
    s.getItem(RECORD_KEY);
    return s;
  } catch {
    return null;
  }
}

async function boot() {
  // The phone test page (`bench=1`; look/bench.js) loads the game once for each of its set-ups. It is fetched only
  // when asked for, and an address that does not yet say which set-up it is on is sent to the first.
  const bench = params.get('bench') === '1' ? await import('./look/bench.js') : null;
  if (bench?.route(params)) return;
  const canvas = document.getElementById('view');
  const ui = document.getElementById('ui');
  const store = storage();
  const settings = createSettings(store);
  const touch = params.has('touch')
    ? params.get('touch') === '1'
    : window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  const quality = QUALITY[params.get('q')]
    ? params.get('q')
    : resolveQuality(settings.get('quality'), { touch, width: window.innerWidth, height: window.innerHeight });

  const wantPost = params.get('post') !== '0';
  const view = createRenderer({ canvas, quality, dynamic: params.get('dynres') !== '0', post: wantPost });
  const renderer = view.renderer;
  // The wild build (src/wild; docs/WILD.md) is fetched and switched on unless the address says `wild=0` — and
  // never on the phone test page. Off, nothing from here on knows that it exists: `wild` stays null, and so
  // does everything hung on it. (It is made at the end of this function, when everything it works with stands.)
  const wildOn = wildWanted(params);
  let wild = null;
  // The second look (src/look): a material on every object, a key light that throws real shadows, the place
  // captured for metal to mirror. It is fetched and switched on only by `look=2` in the address — or, with the
  // experiment, on a desk whose address does not say `look=1`; without that, nothing from here on knows that it
  // exists — `second` is null and so is everything hung on it.
  const look = lookWanted(params, { wild: wildOn, touch });
  // how finely models are built, and whether the picture gets its finishing passes: both follow the detail level
  // (and only in the second look do models carry what each part is made of)
  setGeoDetail({ bevel: view.level.bevel, round: view.level.round, matter: look === 2 });
  const post = createPost(renderer, { level: view.level, wanted: wantPost });
  view.post = post;
  const second =
    look === 2 ? await (await import('./look/index.js')).prepare({ quality, level: view.level, touch, params }) : null;

  // the pictures some surfaces are made from: asked for all at once; any that cannot be had is painted instead
  await progress('Fetching the surfaces', 0.03);
  const art = await loadArt({
    size: view.level.artSize,
    enabled: params.get('art') !== '0',
    // `?art=miss` asks for pictures that are not there: what a failed download looks like to the game
    address: params.get('art') === 'miss' ? () => '/a-picture-that-is-not-there.webp' : undefined,
  });

  await progress('Painting the surfaces', 0.08);
  const textures = makeTextures({ size: view.level.textureSize, anisotropy: view.level.anisotropy, art: art.images });

  await progress('Surveying the site', 0.25);
  const site = buildSite();
  // What the second look has built again — the carbine, the sentry, the truck, the container (src/gfx/next) —
  // stands in for the builder of the same name; everything else, and everything without the switch, is built as
  // it always was.
  const built = second ? { ...models, ...second.models } : models;
  const propOf = second
    ? (kind, variant) => (second.props[kind] ? second.props[kind](variant) : buildProp(kind, variant))
    : buildProp;
  const world = buildWorld(site, {
    textures,
    buildProp: propOf,
    centrifugeGeometry: built.buildCentrifugeGeometry(),
    detail: view.level.detail,
    look: second && { matter: second.matter, keys: second.keys, roomFill: second.roomFill, marks: second.marks },
  });

  await progress('Waking the guards', 0.5);
  const scene = new THREE.Scene();
  scene.add(world.group);
  const sky = createSky({ moonDir: MOON_DIR });
  scene.add(sky.mesh);
  const camera = new THREE.PerspectiveCamera(settings.get('fov'), view.size.aspect, 0.06, 500);
  camera.rotation.order = 'YXZ';
  /** the second look, once the world stands: its key lights' depth pictures, and what a moving thing needs to throw a shadow */
  const lookLive = second ? second.attach({ renderer, scene, world, textures }) : null;
  /** everything that shines of its own accord, shown or hidden at once (the mountain coming down) */
  const shine = (on) => {
    world.setLamps(on);
    lookLive?.setLamps(on);
  };

  let audio;
  try {
    audio = audioModule?.createAudio
      ? audioModule.createAudio({ enabled: params.get('noaudio') !== '1' })
      : createSilence();
  } catch (error) {
    console.warn(`sound could not start: ${error.message}`);
    audio = createSilence();
  }
  // a phone only lets sound start from inside a touch or key handler: do it there, at once, before anything else
  for (const type of ['pointerdown', 'touchend', 'mousedown', 'keydown'])
    window.addEventListener(type, () => audio.unlock(), { capture: true, passive: true });

  const fx = createFx({ scene, textures, amount: view.level.particles, world });
  const player = createPlayer(world);

  // ---------- lamps that go out ----------
  // Which lamps are out is kept in one place (world/lamps.js): the site's own first, in the site's order, and
  // after them the second look's key lights. What a lamp going out does to the picture and to the light a
  // machine sees you by is the business of whoever draws it — the level, the second look — and they are told
  // here.
  const siteLamps = world.lamps.list.length;
  const lamps = createLamps([...world.lamps.list, ...(lookLive ? lookLive.lamps.list : [])]);
  /**
   * The lamps that have gone out or come back since the level's surfaces were last lit to match — empty when
   * nothing waits (world.lamps.step). They are what the second look is told when it has been done.
   */
  const relighting = [];
  /** The lamps in `changed` have just gone out or come back: the level, and the second look, are made to agree. */
  function relight(changed) {
    if (!changed.length) return;
    world.lamps.sync(
      changed.filter((i) => i < siteLamps),
      lamps.isOut,
    );
    lookLive?.lamps.sync(
      changed.filter((i) => i >= siteLamps).map((i) => i - siteLamps),
      (k) => lamps.isOut(k + siteLamps),
    );
    // the light at chest height is right from this moment: what stands about the site takes it at once (the
    // charges, the lodestar, the caches), and so do the marks rounds have left; machines and what is in the
    // hands ask for it every frame as it is
    markers.relight();
    fx.relight();
    for (const i of changed) relighting.push(lamps.list[i]);
  }
  /**
   * Once a frame: a few milliseconds of lighting the level's surfaces again (`ms`: Infinity finishes it now) —
   * and when that is done, the second look is told which lamps it was, so that what metal mirrors is captured
   * again in the places their light reaches.
   */
  function relightStep(ms) {
    if (!relighting.length || world.lamps.step(ms) > 0) return;
    lookLive?.lamps.relit(relighting);
    relighting.length = 0;
  }

  // ---------- the state of the game ----------
  const G = {
    state: 'boot',
    time: 0,
    frames: 0,
    /** how many times MORE the world is drawn in a frame than it needs to be: the phone test page's weight (look/bench.js) */
    extraDraws: 0,
    /** 1: the game as it is. 2: the second look (`look=2` in the address; src/look) */
    look,
    settings,
    quality,
    touch,
    site,
    world,
    view,
    /** which surfaces are pictures (src/assets/art), which pictures could not be had, and the size asked for */
    art: { names: Object.keys(art.images).sort(), failed: art.failed.slice().sort(), size: art.size },
    player,
    audio,
    fx,
    camera,
    mission: null,
    nv: false,
    hold: 0,
    holdBeep: 0,
    prompt: null,
    kills: 0,
    takedowns: 0,
    stragglers: false,
    cine: null,
    lowHealthSaid: false,
    record: null,
    mood: 'calm',
    moodT: 0,
    zone: '',
    drawCalls: 0,
    /** the setting this mission is being played on, by name and as its row of the table in difficulty.js */
    difficulty: 'operator',
    level: difficultyOf('operator'),
    /** the machines that are after you, nearest first (bearing.js) */
    contacts: [],
    calloutAt: -1e9,
    /** which ammunition caches (indexes into site.ammo) have been emptied this mission: each gives once */
    caches: new Set(),
    /** the sight was being kept up by a click or a key last frame (for the one-line note when that starts) */
    latched: false,
    /** the cascades going up, from the moment the charges are fired: { t, told, … } — null until then */
    blast: null,
  };
  window.__G = G;
  try {
    G.record = JSON.parse(store?.getItem(RECORD_KEY) || 'null');
  } catch {
    G.record = null;
  }

  const hud = createHud({ root: ui, touch, site });

  const enemies = createEnemies({
    scene,
    world,
    // in the second look a machine throws a shadow: each one is put among the things that do, as it is built
    models: lookLive
      ? {
          ...built,
          buildSentry: () => {
            const m = built.buildSentry();
            lookLive.cast(m.root);
            return m;
          },
          buildDrone: () => {
            const m = built.buildDrone();
            lookLive.cast(m.root);
            return m;
          },
        }
      : models,
    fx,
    audio,
    textures,
    hooks: {
      // the second look: a machine standing in a burning key light is drawn although the eye cannot see it —
      // its shadow may fall where the eye can
      casts: lookLive ? (x, z) => lookLive.casts(x, z) : undefined,
      kill(unit, { silent }) {
        // a machine of a wave, or one that chases you out, is not on the roll: shutting it down is not a kill
        const counted = unit.rollId >= 0 && hostileDown(G.mission, unit.rollId);
        if (counted) G.kills++;
        const what = unit.type === 'drone' ? 'DRONE DOWN' : silent ? 'SHUT DOWN — SILENT' : 'SENTRY DOWN';
        hud.note(what);
        audio.play('killConfirm');
        const left = enemies.remaining();
        // Said of the first machine on the roll to go down while the site is quiet — not of one that was standing
        // in the hall when it went up, nor of one shut down with the alarm sounding: WARDEN has noticed those.
        // Once: it is how the player is told that a wreck can be found, and can be dragged.
        if (counted && !G.hideSaid && !G.mission?.blown && !enemies.alarm.active) {
          G.hideSaid = true;
          radio(
            'Overwatch',
            `${G.kills === 1 ? 'First one down' : 'That one is down'}. WARDEN has not noticed — and will, if one of its own finds it lying there. ${touch ? 'DRAG' : 'G'} drags it: put it in the dark, or behind something.`,
            7,
          );
        }
        if (left === 4 && !G.stragglers) {
          G.stragglers = true;
          radio('Overwatch', 'Four machines left. I am marking them on your map.');
        }
        wild?.emit('kill', unit, { silent, counted });
      },
      alarm(on) {
        if (on) {
          audio.play('alarmHit');
          loops.alarm = loops.alarm || audio.loop('alarm', { gain: 0.5 });
          if (G.mission?.phase !== PHASE.EXFIL)
            radio('Overwatch', 'WARDEN has you. The whole site is awake — break contact or finish it.');
        } else {
          loops.alarm?.stop(1.2);
          loops.alarm = null;
          if (G.state === 'playing') radio('Overwatch', 'They have lost you. Alarm is standing down.');
        }
        wild?.emit('alarm', on);
      },
      // a machine has found a fallen one, and raised the alarm for it (enemies/bodies.js): said after `alarm`,
      // so that this is the line that is read
      found(body) {
        hud.note('A WRECK HAS BEEN FOUND', 'bad');
        if (G.state !== 'playing') return;
        const where = POINT_WORDS[pointOf(bearingOf(body.x - player.x, body.z - player.z))];
        radio(
          'Overwatch',
          `One of them has found the ${body.type} you left to the ${where}. The whole site is awake. Next time, hide what you shut down.`,
          7,
        );
        wild?.emit('found', body);
      },
      // the fallen machine that was being dragged caught on something, and the hand went on without it
      dragged() {
        player.holding = false;
        hud.note('IT CAUGHT — LET GO', 'warn');
      },
      playerHit() {
        audio.play('hurt');
        fx.shake(0.22);
        wild?.emit('hurt');
      },
      // every round a machine fires at the player, and whether it struck (src/wild: one that goes by is heard to)
      fired: (unit, shot) => wild?.emit('fired', unit, shot),
      // a machine has made up its mind that it is you: Overwatch says where it is, by the compass.
      // Not when you shot it first — you know where that one is.
      spotted(unit, { provoked }) {
        wild?.emit('spotted', unit, { provoked });
        const m = G.mission;
        if (provoked || G.state !== 'playing' || !m || m.time - G.calloutAt < CALLOUT_GAP) return;
        G.calloutAt = m.time;
        const dx = unit.x - player.x;
        const dz = unit.z - player.z;
        const where = POINT_WORDS[pointOf(bearingOf(dx, dz))];
        radio('Overwatch', `Contact — ${unit.type} to the ${where}, ${metres(Math.hypot(dx, dz))} metres.`, 4);
      },
      // the machine held as a shield is held no longer, and not because the player chose it
      shield(unit, why) {
        player.holding = false;
        if (why === 'destroyed') hud.note('SHIELD DESTROYED', 'warn');
        else {
          hud.note('IT BROKE FREE', 'bad');
          fx.shake(0.25);
          radio('Overwatch', 'It is loose and it is on you. Move.', 3);
        }
      },
      // The wild build (src/wild): a machine the player has turned is run from there, not by its own mind;
      // a loyal one that is fighting and cannot see the player may find a turned one to fight instead; an
      // alarm raised over a turned machine names where IT is; and one in a fight may be given its place in it.
      // Nothing sets `unit.turned` but the wild build.
      turned: (unit, dt, inner) => wild?.turned(unit, dt, inner),
      foe: (unit, dt, inner) => wild?.foe(unit, dt, inner),
      alarmAt: (unit) => wild?.alarmAt(unit),
      squad: (unit, dt, inner) => wild?.squad(unit, dt, inner),
    },
  });

  const weapon = createWeapon({
    // the side arms as they were, unless the second look has built them again (its `arms`)
    models: { ...built, ...sidearms, ...(second ? second.arms : {}) },
    scene,
    fx,
    audio,
    // a thumb on glass is not a mouse: on a phone a near miss counts
    assist: touch ? 1.4 : 1,
    world,
    enemies,
    hooks: {
      hit({ killed, zone }) {
        hud.hitmarker(killed);
        audio.play('hitMarker');
        if (killed && zone === 'head') hud.note('HEAD SHOT');
        wild?.emit('hit', { killed, zone });
      },
      knife({ killed, takedown }) {
        if (takedown) G.takedowns++;
        else if (killed) hud.note('SHUT DOWN — KNIFE');
        wild?.emit('knife', { killed, takedown });
      },
      note: (text, tone) => hud.note(text, tone),
      plate: (struck) => wild?.plate(struck),
      /**
       * A round is flying from (ox, oy, oz) along (dx, dy, dz) and nothing stops it for `max` metres: a lamp in
       * its way is broken by it. Says how far off that lamp was, or −1 if there was none.
       * (The experiment may have put something of its own in the round's way — a tripwire's emitter — and that
       * is broken by it as a lamp is, if it is the nearer.)
       */
      lamp(ox, oy, oz, dx, dy, dz, max) {
        const met = lamps.hit(ox, oy, oz, dx, dy, dz, max);
        const own = wild ? wild.shot(ox, oy, oz, dx, dy, dz, met ? met.t : max) : -1;
        if (own >= 0) return own;
        if (!met) return -1;
        relight(lamps.shoot(met.i));
        hud.note('LAMP OUT');
        wild?.emit('lamp', met.i);
        return met.t;
      },
      /**
       * An EMP has gone off at (x, z): the lamps of the room it went off in — in the open, those near it — are
       * out for a while. Says how many went dark.
       */
      emp(x, z) {
        const D = ARMS.grenades.dark;
        const dark = lamps.trip(lamps.reach(x, z, world.grid, D), D.seconds);
        relight(dark);
        if (dark.length) audio.play('lightsOut', { x, y: 2, z, gain: 1.2 });
        wild?.emit('emp', x, z, D.seconds);
        return dark.length;
      },
    },
  });
  // the second look: what is in the hands is told of the key light and of the captured place where the eye is
  if (lookLive) weapon.look = lookLive.hand;
  const markers = createMarkers({ scene, site, models: built, world, fx, audio });
  const loops = { wind: null, hum: null, cascade: null, alarm: null, heart: null, fire: null };

  const input = createInput({
    canvas,
    layer: ui,
    settings,
    touch,
    on: {
      pause: () => pause(),
    },
  });
  hud.el.querySelector('.mini').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (G.state === 'playing') hud.toggleMap();
  });
  hud.el.querySelector('.bigmap').addEventListener('touchstart', (e) => {
    e.preventDefault();
    hud.toggleMap(false);
  });
  hud.el.querySelector('.bigmap').style.pointerEvents = 'auto';

  const menus = createMenus({
    root: ui,
    settings,
    touch,
    on: {
      deploy: () => menus.show('briefing'),
      begin: () => startMission(),
      resume: () => resume(),
      // from the failed screen: back to the last charge that was set, if there is one. From anywhere else
      // (the pause menu, the debrief): the whole mission again.
      restart: () => startMission(G.state === 'over' && G.cine?.kind !== 'win'),
      quit: () => toTitle(),
      sound: (name) => audio.play(name),
      // Every screen, once it is built: the wild build, when it is on, has a word to add to some of them.
      screen: (name, layer, data) => wild?.screen(name, layer, data),
    },
  });

  Object.assign(G, { enemies, weapon, input, hud, menus, markers });

  // ---------- settings that take effect at once ----------
  function applySettings() {
    shared.uExposure.value = settings.get('brightness');
    audio.setVolume({
      master: settings.get('volume'),
      music: settings.get('music'),
      ambience: settings.get('ambience'),
    });
  }
  settings.onChange(applySettings);
  applySettings();

  view.onResize((size) => {
    camera.aspect = size.aspect;
    camera.updateProjectionMatrix();
    weapon.resize(size.aspect);
  });

  await progress('Tuning the radio', 0.72);
  await audio.init((f) => {
    document.getElementById('boot-fill').style.width = `${Math.round(72 + f * 26)}%`;
  });
  await progress('Ready', 1);

  // ---------- small helpers ----------
  function radio(who, text, seconds = 5.5) {
    hud.radio(who.toUpperCase(), text, seconds);
    audio.play('radio', { gain: 0.6 });
  }

  function startLoops() {
    // the three background beds play through the Ambience volume (0.6 unless the player moves it)
    loops.wind = loops.wind || audio.loop('wind', { gain: 0.55 });
    loops.hum = loops.hum || audio.loop('hum', { gain: 0 });
    loops.cascade = loops.cascade || audio.loop('cascade', { ...HALL, gain: 0.5 });
  }
  function stopLoop(name, fadeSeconds = 0.4) {
    loops[name]?.stop(fadeSeconds);
    loops[name] = null;
  }

  function setNight(on) {
    if (G.nv === on) return;
    G.nv = on;
    shared.uNight.value = on ? 1 : 0;
    audio.play(on ? 'nvOn' : 'nvOff');
  }

  function stats() {
    const m = G.mission;
    return {
      seconds: Math.round(m?.time || 0),
      shots: weapon.shots,
      hits: weapon.hits,
      accuracy: weapon.shots ? Math.round((weapon.hits / weapon.shots) * 100) : 0,
      kills: G.kills,
      total: m?.hostilesTotal || 0,
      charges: m?.chargesPlanted || 0,
      chargesTotal: m?.chargesTotal || site.charges.length,
      blown: !!m?.blown,
      takedowns: G.takedowns,
      alarms: enemies.alarm.count,
      damage: Math.round(player.damageTaken),
    };
  }
  G.stats = stats;

  function grade(s) {
    let score =
      100 -
      s.alarms * 18 -
      Math.min(30, s.damage * 0.15) -
      Math.max(0, (s.seconds - 600) / 30) +
      Math.min(15, s.takedowns * 3);
    score = clamp(score, 0, 115);
    if (score >= 95 && s.alarms === 0) return 'S';
    return score >= 78 ? 'A' : score >= 55 ? 'B' : 'C';
  }

  // ---------- moving between states ----------
  /**
   * What had been done when the last charge went on — or when the charges were fired — so that a death after it
   * does not cost the whole run.
   * Machines are remembered by NAME, not by their number on the roll: the roll depends on the setting, and the
   * setting can be changed from the pause menu between the charge and the retry.
   */
  let checkpoint = null;
  /**
   * @param {{ name: string, x: number, z: number, wave?: string }} place where a retry begins, and how the
   *   failed screen says it; `wave`: the charge (its id) whose setting this is — its wave comes again on a retry
   */
  function saveCheckpoint(place) {
    const m = G.mission;
    checkpoint = {
      down: enemies.list.filter((unit) => unit.rollId >= 0 && m.down.has(unit.rollId)).map((unit) => unit.name),
      charges: Object.keys(m.charges).filter((id) => m.charges[id]),
      blown: m.blown,
      name: place.name,
      x: place.x,
      z: place.z,
      wave: place.wave || null,
      yaw: player.yaw,
      // every gun's rounds, the grenades, which gun was in hand and how the carbine was set
      weapon: weapon.save(),
      time: m.time,
      takedowns: G.takedowns,
      alarms: enemies.alarm.count,
      damage: player.damageTaken,
      // a copy: what is emptied after this must be full again on a retry
      caches: [...G.caches],
      // the lamps that have been shot out: one shot after this is whole again on a retry
      lamps: lamps.save(),
      // what the experiment keeps (src/wild): nothing, without it
      wild: wild?.save() ?? null,
    };
  }
  function loadCheckpoint() {
    const c = checkpoint;
    const m = G.mission;
    // only machines that are on the site on the setting being played now can be down
    const gone = [];
    for (const name of c.down) {
      const unit = enemies.byName(name);
      if (unit && hostileDown(m, unit.rollId)) gone.push(unit.rollId);
    }
    enemies.remove(gone);
    for (const id of c.charges) if (plantCharge(m, id)) markers.arm(id);
    // the cascades that were down are down: the hall is put straight into the state the blast left it in
    if (c.blown && detonate(m)) blastDone();
    Object.assign(player, { x: c.x, z: c.z, headX: c.x, headZ: c.z, yaw: c.yaw, damageTaken: c.damage });
    // The wave that the last charge brought is on its way again — as the drones the blast brought are — from
    // doors the player cannot see from where the retry begins. The alarm is not raised again: that was then.
    const charge = c.wave && !c.blown && site.charges.find((at) => at.id === c.wave);
    if (charge) sendWave(charge, true);
    weapon.load(c.weapon);
    G.caches = new Set(c.caches);
    markers.setCaches(G.caches);
    m.time = c.time;
    enemies.alarm.count = c.alarms;
    Object.assign(G, {
      kills: gone.length,
      takedowns: Math.min(c.takedowns, gone.length),
      stragglers: enemies.remaining() <= 4,
    });
    wild?.load(c.wild);
  }

  function toTitle() {
    G.state = 'title';
    input.setActive(false);
    input.exitLock();
    hud.setVisible(false);
    hud.fade(0);
    hud.flash(0);
    weapon.visible = false;
    setNight(false);
    shared.uAlarm.value = 0;
    shared.uRuin.value = 0;
    shared.uCraterGo.value = 0;
    shine(true);
    // every lamp that was shot or tripped is alight again
    relight(lamps.reset());
    relightStep(Infinity);
    shared.uFogDensity.value = FOG_WIDE;
    markers.showAll();
    markers.reset();
    world.cascade.reset();
    G.blast = null;
    stopLoop('alarm');
    stopLoop('heart');
    stopLoop('fire');
    fx.reset();
    enemies.spawn(site, settings.get('difficulty'));
    wild?.reset();
    startLoops();
    audio.music('calm');
    menus.show('title', { record: G.record });
  }

  /** @param {boolean} resume pick up from the last charge that was set, if any, instead of from the adit */
  function startMission(resume = false) {
    const difficulty = settings.get('difficulty');
    const level = difficultyOf(difficulty);
    fx.reset();
    player.reset(site.start);
    // (the wild build's machines are plated, and it carries as many times the rounds: src/wild/armour.js)
    weapon.reset(wild?.plenty() ?? 1);
    weapon.visible = true;
    const count = enemies.spawn(site, difficulty);
    G.mission = createMission({
      charges: site.charges.map((c) => c.id),
      hostiles: count,
      exfilSeconds: level.exfilSeconds,
    });
    Object.assign(G, {
      difficulty,
      level,
      contacts: [],
      calloutAt: -1e9,
      caches: new Set(),
      latched: false,
      hold: 0,
      kills: 0,
      takedowns: 0,
      stragglers: false,
      cine: null,
      lowHealthSaid: false,
      prompt: null,
      mood: 'calm',
      moodT: 0,
      zone: '',
      speed: 1,
      blast: null,
    });
    markers.showAll();
    markers.reset();
    world.cascade.reset();
    for (const door of world.grid.doors) door.open = 0;
    world.updateDoors(0, []);
    setNight(false);
    shared.uAlarm.value = 0;
    shared.uRuin.value = 0;
    shared.uCraterGo.value = 0;
    shine(true);
    // every lamp alight again — or, on a retry, those that had been shot when the checkpoint was kept still out
    // (what an EMP tripped is back: world/lamps.js)
    relight(lamps.load(resume === true && checkpoint ? checkpoint.lamps : []));
    relightStep(Infinity);
    shared.uFogDensity.value = FOG_PLAY;
    stopLoop('alarm');
    stopLoop('heart');
    stopLoop('fire');
    startLoops();
    audio.music('calm');
    menus.hide();
    hud.el.classList.remove('cine');
    hud.setVisible(true);
    hud.fade(0);
    hud.flash(0);
    G.state = 'playing';
    input.setActive(true);
    input.requestLock();
    // the experiment starts every mission from nothing; a retry then puts back what its checkpoint kept
    wild?.reset();
    if (resume === true && checkpoint) {
      loadCheckpoint();
      radio(
        'Overwatch',
        checkpoint.blown
          ? 'Back in the control room, Wraith. The cascades are still down, and what you had done is still done.'
          : 'Back at your last charge, Wraith. What you had done is still done.',
        6,
      );
    } else {
      checkpoint = null;
      radio(
        'Overwatch',
        'Wraith, you are inside the mountain. The grating is cut dead ahead of you, to the east. Stay out of the light.',
        7,
      );
    }
  }

  function pause() {
    if (G.state !== 'playing') return;
    G.state = 'paused';
    input.setActive(false);
    input.exitLock();
    menus.show('pause', { objectives: objectives(G.mission), phase: G.mission.phase });
  }

  function resume() {
    if (G.state !== 'paused') return;
    menus.hide();
    G.state = 'playing';
    input.setActive(true);
    input.requestLock();
  }

  function endPlay() {
    // whatever the experiment had in hand — a drone being flown, time bent — is let go of
    wild?.emit('end');
    input.setActive(false);
    input.exitLock();
    weapon.visible = false;
    weapon.stow();
    hud.toggleMap(false);
    hud.el.classList.add('cine');
    setNight(false);
    stopLoop('alarm', 1);
    stopLoop('heart');
    audio.music('none');
  }

  // ---------- one frame of play ----------
  const bodies = [];
  let shownT = 0;

  function interact(intent, dt) {
    const m = G.mission;
    let prompt = null;
    // what the second contextual button on a phone says, if it is there at all
    let grab = null;
    const key = (name) => (touch ? '' : `[${name}] `);

    const shield = enemies.held;
    // a fallen machine in the hand (enemies/bodies.js): one hand is full, as it is with a shield
    const load = shield ? null : enemies.dragged;
    const victim = shield || load ? null : enemies.takedownTarget(player);
    player.holding = !!shield || !!load;
    if (shield) {
      // a machine is held in front of you: shut it down, or let it go. Its own side shoots it to get at you.
      prompt = {
        text: `SHIELD — ${key('F')}SHUT DOWN · ${key('G')}LET GO`,
        label: 'SHUT DOWN',
        progress: clamp(shield.hp / shield.hpMax, 0, 1),
      };
      grab = 'LET GO';
      if (intent.usePressed || intent.melee) {
        enemies.takedown(shield);
        player.holding = false;
        weapon.lowerFor(0.6);
        G.takedowns++;
        fx.shake(0.12);
      } else if (intent.grabPressed) {
        enemies.release(player);
        player.holding = false;
        hud.note('LET GO');
      }
      G.hold = 0;
    } else if (load) {
      // A fallen machine is being dragged. Where it is let go of is where it will lie — and how far off it can
      // be seen there goes by the light on it, which is what the line under the crosshair says. The bar fills
      // while a machine has it in sight: a second of that and it is found.
      const reach = Math.round(bodyView(world.visibility(load.x, load.z), G.level.bodies));
      const watched = !load.found && (load.noticeT || 0) > 0;
      prompt = {
        text: `DRAGGING — ${key('G')}LET GO · ${watched ? 'IT IS BEING LOOKED AT' : `HERE IT IS SEEN FROM ${reach} m`}`,
        label: null,
        progress: load.found ? 0 : clamp((load.noticeT || 0) / BODY.notice, 0, 1),
      };
      // On a phone there is no line under the crosshair — its buttons carry the words — so what that line says is
      // said as a note instead, each time it changes: walking into the dark, the figure is seen to fall.
      const told = watched ? -1 : reach;
      if (touch && told !== G.dragTold) {
        G.dragTold = told;
        hud.note(watched ? 'IT IS BEING LOOKED AT' : `HERE IT IS SEEN FROM ${reach} m`, watched ? 'bad' : '');
      }
      grab = 'LET GO';
      if (intent.grabPressed) {
        enemies.drop();
        player.holding = false;
        hud.note(`LEFT WHERE IT IS SEEN FROM ${reach} m`);
      }
      G.hold = 0;
    } else if (victim) {
      prompt = { text: `${key('F')}TAKE DOWN · ${key('G')}SHIELD`, label: 'TAKE DOWN', progress: 0 };
      grab = 'SHIELD';
      if (intent.usePressed) {
        enemies.takedown(victim);
        weapon.lowerFor(0.7);
        G.takedowns++;
        fx.shake(0.12);
      } else if (intent.grabPressed && enemies.grab(victim)) {
        player.holding = true;
        input.dropAim();
        weapon.lowerFor(0.35);
        fx.shake(0.1);
        hud.note('SHIELD UP');
        if (!G.shieldSaid) {
          G.shieldSaid = true;
          radio('Overwatch', 'It cannot call for help while you hold it. Its own side will shoot it to reach you.', 6);
        }
      }
      G.hold = 0;
    } else {
      let target = null;
      for (const c of site.charges)
        if (!m.charges[c.id] && Math.hypot(player.x - c.x, player.z - c.z) < 1.9)
          target = { kind: 'charge', c, need: CHARGE_HOLD, word: 'SET CHARGE', label: 'SET CHARGE' };
      if (
        !target &&
        canDetonate(m) &&
        Math.hypot(player.x - site.firing.x, player.z - site.firing.z) < site.firing.radius
      )
        target = { kind: 'blow', need: BLOW_HOLD, word: 'BLOW THE CASCADES', label: 'BLOW' };
      if (
        !target &&
        canPlaceBeacon(m) &&
        Math.hypot(player.x - site.beacon.x, player.z - site.beacon.z) < site.beacon.radius
      )
        target = { kind: 'beacon', need: BEACON_HOLD, word: 'RAISE THE LODESTAR', label: 'RAISE' };
      if (target) {
        if (intent.use) {
          G.hold += dt;
          weapon.lowerFor(0.25);
          G.holdBeep -= dt;
          if (G.holdBeep <= 0) {
            G.holdBeep = 0.32;
            audio.play('chargeBeep');
          }
        } else G.hold = Math.max(0, G.hold - dt * 3);
        prompt = {
          text: `HOLD ${key('F')}${target.word}`,
          label: target.label,
          progress: clamp(G.hold / target.need, 0, 1),
        };
        if (G.hold >= target.need) {
          G.hold = 0;
          if (target.kind === 'charge' && plantCharge(m, target.c.id)) {
            markers.arm(target.c.id);
            saveCheckpoint({
              name: `at the charge you set on ${target.c.name.toLowerCase()}`,
              x: target.c.stand[0] + 0.5,
              z: target.c.stand[1] + 0.5,
              wave: target.c.id,
            });
            audio.play('chargeArmed');
            hud.note(`CHARGE SET — ${target.c.name.toUpperCase()}`, 'warn');
            // the site has felt it: the alarm, and a wave of machines for the charge
            const coming = sendWave(target.c);
            wild?.emit('charge', target.c);
            radio(
              'Overwatch',
              `${
                m.chargesPlanted === m.chargesTotal
                  ? 'That is all four: every cascade is rigged. Fire them from the control room, at the window on the hall.'
                  : `Charge ${m.chargesPlanted} is live.`
              } WARDEN felt it go on — ${coming}.`,
              7,
            );
          } else if (target.kind === 'blow' && detonate(m)) beginBlast();
          else if (target.kind === 'beacon' && placeBeacon(m)) {
            markers.raiseBeacon();
            audio.play('beaconDeploy', { x: site.beacon.x, y: 1, z: site.beacon.z });
            audio.play('objective');
            // the site throws what it has left at you; these are pursuers, not part of the count that had to reach zero
            const from = site.reinforcements.slice(0, G.level.pursuers);
            enemies.pursue(from, player);
            // where they are coming from, and where you are going, by the compass
            const mid = from.reduce((sum, [x, z]) => [sum[0] + x / from.length, sum[1] + z / from.length], [0, 0]);
            const inbound = POINT_WORDS[pointOf(bearingOf(mid[0] - player.x, mid[1] - player.z))];
            const out = POINT_WORDS[pointOf(bearingOf(site.pickup.x - player.x, site.pickup.z - player.z))];
            radio(
              'Overwatch',
              `Lodestar is talking. Hammerfall in ${Math.round(m.clock)} seconds. Drones inbound from the ${inbound} — the pickup is ${out}. Run.`,
              8,
            );
            G.calloutAt = m.time;
            if (enemies.alert(player.x, player.z)) {
              audio.play('alarmHit');
              loops.alarm = loops.alarm || audio.loop('alarm', { gain: 0.5 });
            }
            wild?.emit('beacon');
          }
        }
      } else {
        G.hold = 0;
        // On a phone there is no knife key: when a machine is within the blade's reach, USE is the knife.
        // (Not while a grenade is leaving the other hand, or one gun is going down for another.)
        if (touch && !weapon.knife.busy && !weapon.lob && !weapon.swap && knifeInReach()) {
          prompt = { text: '', label: 'KNIFE', progress: 0 };
          if (intent.usePressed) weapon.stab();
        }
      }
      // A fallen machine within reach can be taken hold of, to be dragged out of the others' sight: G — the
      // second button on a phone — whatever F is offering at the same time (a charge is set with F).
      const wreck = enemies.dragTarget(player);
      if (wreck) {
        grab = 'DRAG';
        const offer = `${key('G')}DRAG`;
        if (!prompt) prompt = { text: offer, label: null, progress: 0 };
        else if (!touch) prompt.text = prompt.text ? `${prompt.text} · ${offer}` : offer;
        if (intent.grabPressed && enemies.drag(wreck)) {
          player.holding = true;
          input.dropAim();
          weapon.lowerFor(0.35);
          // (on a phone the note that follows says how far off it is seen: main.js, the `load` branch above)
          G.dragTold = null;
          if (!touch) hud.note('DRAGGING');
          G.hold = 0;
        }
      }
    }

    // ammunition: each cache gives a little for every gun, and a grenade if there is room for one — once, and
    // then it is empty for the rest of the mission
    site.ammo.forEach(([x, z], n) => {
      if (G.caches.has(n) || Math.hypot(player.x - x, player.z - z) >= 1.3) return;
      G.caches.add(n);
      const got = weapon.takeCache(wild?.plenty() ?? 1);
      markers.setCaches(G.caches);
      hud.note(`AMMUNITION — EVERY GUN${got.grenades ? ' · EMP +1' : ''}`);
      // magazines into the pouches: a rustle of kit, and one going home
      audio.play('kitRustle');
      audio.play('reloadIn', { gain: 0.8 });
      wild?.emit('cache', n);
    });

    G.prompt = prompt;
    input.setUse(prompt ? prompt.label : null, prompt ? prompt.progress : 0);
    // (on a phone the experiment may have a use for the second button when nothing else has: UPLINK)
    input.setGrab(grab || (wild ? wild.grab(!!prompt) : null));
  }

  /** Is there a machine in front of the eye that the knife would reach? */
  function knifeInReach() {
    const cp = Math.cos(player.pitch);
    return !!enemies.raycast(
      player.headX,
      player.eye,
      player.headZ,
      -Math.sin(player.yaw) * cp,
      Math.sin(player.pitch),
      -Math.cos(player.yaw) * cp,
      ARMS.knife.reach,
      ARMS.knife.grow * (touch ? 1.4 : 1),
      enemies.held,
    );
  }

  // ---------- the cascades go up ----------
  /** So many a second, whatever the frame rate: how many are due this frame. What is left over is kept in `store`. */
  function due(store, name, perSecond, dt, most = 6) {
    store[name] = (store[name] || 0) + dt * perSecond;
    const n = Math.floor(store[name]);
    store[name] -= n;
    return Math.min(n, most);
  }
  /** from the first casing of the cascades to the last, along the rows */
  const ROWS = site.centrifuges.reduce(([lo, hi], [x]) => [Math.min(lo, x), Math.max(hi, x)], [Infinity, -Infinity]);
  /** where the hall is left burning: by each charge, and part of the way down the same rows */
  const FIRES = site.charges.flatMap((c, k) => [
    [c.x - c.nx * 1.5, c.z],
    [lerp(ROWS[0], ROWS[1], k % 2 ? 0.2 : 0.78), c.z],
  ]);

  /** Drones up from the bay and after you, as many as the setting sends. Returns how many. */
  function respond() {
    const from = site.reinforcements.slice(0, G.level.responders);
    if (from.length) enemies.pursue(from, player);
    return from.length;
  }

  /**
   * A charge has gone on a cascade, and the site has felt it. Decision of 16 November 2026 — the owner: "every
   * time you rig a centrifuge fire an alarm with new guards and drones that are coming to you". The alarm is the
   * site's own — it is not counted against the grade, as the blast's and the lodestar's are not — and with it
   * comes a wave of machines that are not on the mission's roll, as many as the setting sends (difficulty.js
   * `wave`): guards on foot, by the doors of the building nobody standing at the charge can see, and drones up
   * from the bay. They are sent to the charge. Returns what Overwatch says of it.
   * @param {boolean} [again] a retry from the checkpoint this charge kept: the wave is sent again, as the
   *   blast's drones are; the alarm is not raised again — that was then
   * @param {number} [turn] whose turn it is among the bays the drones come up from: the charge's own number
   *   (the experiment's overspeed, which is not a charge, says for itself)
   */
  function sendWave(c, again = false, turn = site.charges.indexOf(c)) {
    const { guards, drones } = G.level.wave;
    const sees = (x, z) => world.grid.sight(player.x, player.eye, player.z, x + 0.5, 1.6, z + 0.5);
    const doors = waveEntries(site.entries, player, guards, sees);
    const bays = waveBays(site.reinforcements, turn, drones);
    enemies.reinforce('sentry', doors, c);
    enemies.reinforce('drone', bays, c);
    if (!again && enemies.alert(c.x, c.z)) {
      audio.play('alarmHit');
      loops.alarm = loops.alarm || audio.loop('alarm', { gain: 0.5 });
    }
    const from = [...doors, ...bays];
    if (!from.length) return 'the alarm is up';
    // where they are coming from, by the compass
    const mid = from.reduce((sum, [x, z]) => [sum[0] + x / from.length, sum[1] + z / from.length], [0, 0]);
    const inbound = POINT_WORDS[pointOf(bearingOf(mid[0] - player.x, mid[1] - player.z))];
    const count = (n, one, many) => (n === 1 ? `one ${one}` : `${n === 2 ? 'two' : n} ${many}`);
    const what = [guards && count(guards, 'guard', 'guards'), drones && count(drones, 'drone', 'drones')]
      .filter(Boolean)
      .join(' and ');
    return `the alarm is up, and ${what} ${guards + drones === 1 ? 'is' : 'are'} coming for it from the ${inbound}`;
  }

  /**
   * The charges are fired. The cascades come down over the next few seconds (world/build.js `cascade`), whatever
   * was standing among them goes with them, and the site — which may not have known you were there — knows.
   */
  function beginBlast() {
    for (const unit of [...enemies.list])
      if (!unit.dead && world.zoneAt(unit.x, unit.z) === ZONE.HALL) enemies.damage(unit, 1e6, unit.x, unit.z);
    // what went with the cascades is no news to the site, and neither is anything else that lies fallen: a
    // machine that comes on a wreck after this does not raise an alarm for it (enemies/bodies.js)
    enemies.known();
    // a checkpoint: a retry from here begins where you stand, with the cascades down
    saveCheckpoint({ name: 'in the control room, with the cascades blown', x: player.x, z: player.z });
    G.blast = { t: 0, told: false, glow: 0, sent: respond() };
    world.cascade.begin();
    markers.blow();
    // a mark stays where it was made, and what many of them were made on is about to move
    fx.clearMarks();
    stopLoop('cascade', 0.6);
    audio.play('detonator');
    audio.play('cascadeBlast', HALL);
    loops.fire = loops.fire || audio.loop('fire', { ...HALL, gain: 0.9 });
    hud.note('CHARGES FIRED', 'warn');
    if (enemies.alert(site.firing.x, site.firing.z)) {
      audio.play('alarmHit');
      loops.alarm = loops.alarm || audio.loop('alarm', { gain: 0.5 });
    }
    wild?.emit('blast');
  }

  /**
   * The hall as the blast left it, at once and without the blast: for a retry from the checkpoint above. The
   * drones that were sent are sent again; the alarm is not raised again — that was then.
   */
  function blastDone() {
    G.blast = { t: 1e6, told: true, glow: 0, sent: respond() };
    world.cascade.wreck();
    markers.blow();
    stopLoop('cascade', 0);
    loops.fire = loops.fire || audio.loop('fire', { ...HALL, gain: 0.9 });
  }

  function updateBlast(dt) {
    const b = G.blast;
    if (!b) return;
    const before = b.t;
    b.t += dt;
    const drift = () => Math.random() - 0.5;
    if (before < world.cascade.duration) {
      world.cascade.pose(b.t);
      site.charges.forEach((c, k) => {
        const at = BLAST.first + k * BLAST.gap;
        if (b.t < at) return;
        if (before < at) {
          // the charge itself: smaller the nearer it is to the window you are watching through
          const far = Math.hypot(c.x - player.x, c.z - player.z);
          fx.explosion(c.x, 1.2, c.z, clamp(far / 14, 1, 1.9));
        }
        // and the wave it sends down its row, both ways: every few metres something tears
        const from = Math.floor((Math.max(0, before - at) * BLAST.speed) / 2.5);
        const to = Math.floor(((b.t - at) * BLAST.speed) / 2.5);
        for (let s = from + 1; s <= to; s++)
          for (const way of [-1, 1]) {
            const x = c.x + way * s * 2.5;
            if (x < ROWS[0] || x > ROWS[1]) continue;
            fx.sparks(x, 1 + Math.random() * 1.5, c.z + drift(), 0, 1, 0, 7, 1, 0.72, 0.36, 8);
            fx.puff(
              'smoke',
              x,
              1.2 + Math.random(),
              c.z + drift(),
              drift() * 1.5,
              0.8 + Math.random() * 1.2,
              drift() * 1.5,
              2.6,
              1.2,
              4.5,
              0.1,
              0.095,
              0.09,
              0.4,
              { drag: 0.9, fadeIn: 0.1 },
            );
          }
      });
    }
    // what is left burns for as long as you are in there to see it
    for (let n = due(b, 'fires', 30, dt); n > 0; n--) {
      const [x, z] = FIRES[(Math.random() * FIRES.length) | 0];
      fx.puff(
        'add',
        x + drift() * 1.6,
        0.3 + Math.random() * 0.5,
        z + drift() * 1.2,
        drift() * 0.4,
        1.3 + Math.random() * 1.7,
        drift() * 0.4,
        0.85,
        0.55,
        1.7,
        1,
        0.44,
        0.1,
        0.5,
        { drag: 0.7 },
      );
    }
    for (let n = due(b, 'smokes', 7, dt); n > 0; n--) {
      const [x, z] = FIRES[(Math.random() * FIRES.length) | 0];
      fx.puff(
        'smoke',
        x + drift() * 1.5,
        1.4,
        z + drift(),
        drift() * 0.5,
        1.1 + Math.random(),
        drift() * 0.5,
        5.5,
        1.3,
        5.2,
        0.06,
        0.056,
        0.052,
        0.4,
        { drag: 0.22, fadeIn: 0.15 },
      );
    }
    // the light of it on the wreck and the walls: the fire nearest the eye, flickering — if it is near enough to see
    b.glow -= dt;
    if (b.glow <= 0) {
      b.glow = 0.22 + Math.random() * 0.2;
      const away = (f) => Math.hypot(f[0] - player.x, f[1] - player.z);
      let near = FIRES[0];
      for (const f of FIRES) if (away(f) < away(near)) near = f;
      const k = 0.7 + Math.random() * 0.6;
      if (away(near) < 40) fx.light(near[0], 1.4, near[1], 1.5 * k, 0.62 * k, 0.2 * k, 15, 0.6);
    }

    if (!b.told && b.t >= BLAST_TOLD && G.state === 'playing') {
      b.told = true;
      const m = G.mission;
      const left = enemies.remaining();
      const drones = b.sent ? ' Drones are up from the bay.' : '';
      if (m.phase === PHASE.MARK)
        radio(
          'Overwatch',
          `Good effect: every cascade is down.${drones} Now the lodestar — the pad under the exhaust shaft, the one place in there that can see the sky.`,
          8,
        );
      else
        radio(
          'Overwatch',
          `Good effect: every cascade is down. WARDEN knows where you are, and ${left} of its machines ${left === 1 ? 'is' : 'are'} still running.${drones} Finish them, then the lodestar.`,
          8,
        );
    }
  }

  /**
   * @param {number} dt the world's seconds
   * @param {number} [own] the player's own seconds: the same, unless the experiment has bent time (src/wild/focus.js)
   */
  function updatePlaying(dt, intent, own = dt) {
    const m = G.mission;
    if (intent.nv) setNight(!G.nv);
    if (intent.map) hud.toggleMap();
    // the experiment: its own step of the world — and, while a drone is being flown, the hands are on the drone:
    // what the player asks goes there, and nothing is asked of the body that stands where it was left
    if (wild) intent = wild.step(dt, own, intent);

    // look slower with the sight at the eye
    const slow = lerp(1, 0.5, weapon.aim);
    intent.lookX *= slow;
    intent.lookY *= slow;
    player.update(own, intent, weapon.aim);
    weapon.update(own, intent, player);
    if (weapon.reloading) input.dropAim();
    // the lamps an EMP tripped come back when their time is up
    const back = lamps.update(dt);
    if (back.length) {
      relight(back);
      const at = lamps.list[back[0]];
      audio.play('lightsOn', { x: at.x, y: at.y, z: at.z, gain: 1.2 });
      hud.note('LIGHTS BACK ON', 'warn');
    }
    // a sight kept up by a click or a key, not by a held button: say so once, so that it is not a mystery
    if (!touch && intent.aimLatched && !G.latched) hud.note('SIGHT UP — RIGHT CLICK OR Z LOWERS IT');
    G.latched = intent.aimLatched;

    if (player.stepped || player.jumped || player.landed > 0) {
      const surface = world.surfaceAt(player.x, player.z);
      const step = surface === 'metal' ? 'stepMetal' : surface === 'dirt' ? 'stepDirt' : 'stepConcrete';
      if (player.landed > 0) {
        // coming down is heard: the harder the landing, the further it carries
        audio.play(step, { gain: clamp(player.landed * 0.45, 1, 2.6), rate: 0.78 });
        enemies.noise(player.x, player.z, clamp(player.landed * 1.1, 3.5, 9));
        if (player.landed > 4) fx.shake(Math.min(0.12, player.landed * 0.012));
      } else if (player.jumped) audio.play(step, { gain: 1.1, rate: 1.22 });
      else {
        audio.play(step, { gain: player.crouched ? 0.7 : player.running ? 2 : 1.3 });
        if (player.footNoise > 0) enemies.noise(player.x, player.z, player.footNoise);
      }
    }

    // your own muzzle flash shows you up for a moment
    const vis = Math.max(world.visibility(player.x, player.z), weapon.flash * 0.7);
    enemies.update(dt, player, vis, camera);
    G.visibility = vis;

    bodies.length = 0;
    bodies.push(player);
    for (const unit of enemies.list) if (!unit.dead) bodies.push(unit);
    world.updateDoors(dt, bodies, (door, opening) =>
      audio.play(opening ? 'doorOpen' : 'doorClose', { x: door.x, y: 1.3, z: door.z, gain: 0.7 }),
    );

    interact(intent, dt);
    updateBlast(dt);
    // the casings turn — and run down once the charges are fired (world/spin.js)
    world.cascade.spin(dt);

    const inPickup =
      player.x >= site.pickup.x0 &&
      player.x < site.pickup.x1 &&
      player.z >= site.pickup.z0 &&
      player.z < site.pickup.z1;
    const clockBefore = m.clock;
    for (const phase of stepMission(m, { dt, health: player.health, inPickup })) onPhase(phase);
    if (m.phase === PHASE.EXFIL) {
      for (const mark of [30, 10]) if (clockBefore > mark && m.clock <= mark) radio('Overwatch', `${mark} seconds.`, 3);
      if (m.clock <= 10 && Math.ceil(clockBefore) !== Math.ceil(m.clock)) audio.play('tick');
    }

    markers.update(dt, canPlaceBeacon(m), canDetonate(m));
    shared.uAlarm.value = damp(shared.uAlarm.value, enemies.alarm.active ? 1 : 0, 3, dt);

    if (player.health < 35 && !G.lowHealthSaid) {
      G.lowHealthSaid = true;
      radio('Overwatch', 'You are hit. Get behind something and stay there.', 4);
    } else if (player.health > 80) G.lowHealthSaid = false;
    if (player.health < 35 && player.alive) loops.heart = loops.heart || audio.loop('heartbeat', { gain: 0.7 });
    else if (loops.heart) stopLoop('heart', 0.8);

    // what the machines know sets the music; it changes no more than once every couple of seconds
    G.moodT -= dt;
    const mood = m.phase === PHASE.EXFIL ? 'exfil' : enemies.mood();
    if (mood !== G.mood && G.moodT <= 0) {
      G.mood = mood;
      G.moodT = 2.5;
      audio.music(mood);
    }

    // which machines the small map may show: ones you can see, ones that are fighting you, the last few — and,
    // on the settings where Overwatch watches for you, every one within reach and every one that is after you
    shownT -= dt;
    if (shownT <= 0) {
      shownT = 0.1;
      const radar = G.level.radar;
      for (const unit of enemies.list) {
        if (unit.dead) continue;
        const d = Math.hypot(unit.x - player.x, unit.z - player.z);
        unit.shown =
          (G.stragglers && unit.rollId >= 0) ||
          unit.brain.state === AI.COMBAT ||
          (radar && (d < RADAR_REACH || unit.brain.state !== AI.PATROL || unit.rollId < 0)) ||
          (d < RADAR_REACH &&
            world.grid.sight(player.x, player.eye, player.z, unit.x, unit.type === 'drone' ? unit.y : 1.4, unit.z));
      }
      // who is after you, and from where. Without the radar that is only the ones you know about.
      G.contacts = contacts(enemies.list, player, 8, radar ? null : (unit) => unit.shown);
    }
  }

  function onPhase(phase) {
    wild?.emit('phase', phase);
    if (phase === PHASE.MARK) {
      audio.play('objective');
      // if the cascades are going up this very moment, Overwatch says it all in one breath when they are down
      if (!G.blast || G.blast.told)
        radio(
          'Overwatch',
          'Site is clear and the cascades are down. Get the lodestar up on the pad under the exhaust shaft — the one place in there that can see the sky.',
          7,
        );
    } else if (phase === PHASE.EXTRACTED) beginEnding('win');
    else if (phase === PHASE.LOST) beginEnding('lost');
    else if (phase === PHASE.DOWN) {
      // whatever was in your arms is not held any more
      if (enemies.held) enemies.release(player);
      enemies.drop();
      player.holding = false;
      endPlay();
      G.state = 'dying';
      G.cine = { t: 0, kind: 'down' };
      audio.play('hurt');
    }
  }

  // ---------- endings ----------
  function beginEnding(kind) {
    // whatever was in your arms is not held any more, however the mission ended
    if (enemies.held) enemies.release(player);
    enemies.drop();
    player.holding = false;
    endPlay();
    G.state = 'ending';
    // the count is taken now: once the picture cuts away the machines are cleared off, and their alarm with them
    G.cine = { t: 0, kind, cut: false, hit: false, said: 0, done: false, stats: stats() };
    if (kind === 'lost') strikeInside();
  }

  /** You were still inside when it landed: the mountain comes down round you, and the last thing you see is white. */
  function strikeInside() {
    hud.flash(1);
    G.cine.flash = 1;
    shared.uRuinBox.value.set(...RUIN_BOX);
    shared.uRuin.value = 1;
    shared.uAlarm.value = 0;
    markers.hideAll();
    enemies.clear();
    audio.play('strike');
    loops.fire = loops.fire || audio.loop('fire', { x: 65, y: 3, z: 36, gain: 1 });
    stopLoop('cascade', 0.1);
    stopLoop('hum', 0.1);
    fx.explosion(65, 4, 36, 7);
    fx.shake(1.4);
  }

  /** Seen from the valley: the weapon has gone down the shaft, and the mountain over the facility begins to sink. */
  function strikeOutside() {
    hud.flash(1);
    G.cine.flash = 1;
    G.cine.sink = 0;
    shared.uCrater.value.set(CRATER.x, CRATER.z, CRATER.radius, CRATER.depth);
    shared.uAlarm.value = 0;
    markers.hideAll();
    // every lamp inside is out — and none must be left hanging in the air where the mountain was
    shine(false);
    audio.play('strike');
    // far off, and all round: the whole mountain is burning
    loops.fire = loops.fire || audio.loop('fire', { gain: 0.3 });
    stopLoop('cascade', 0.1);
    stopLoop('hum', 0.1);
    fx.explosion(VENT.x, VENT.y + 4, VENT.z, 9);
    fx.explosion(PORTAL.x, PORTAL.y, PORTAL.z + 3, 4);
    fx.shake(1.2);
  }

  /** How high the ground outside is at (x, z) now — less, over the facility, once the mountain has begun to sink. */
  function groundNow(x, z) {
    const from = Math.hypot(x - CRATER.x, z - CRATER.z) / CRATER.radius;
    const bowl = 1 - smooth(clamp((from - 0.12) / 0.88, 0, 1));
    return world.mountainAt(x, z) - CRATER.depth * shared.uCraterGo.value * bowl;
  }
  /** A point somewhere in the hollow, on the ground as it now is: [x, y, z]. */
  function inTheHollow() {
    const a = Math.random() * Math.PI * 2;
    const r = CRATER.radius * 0.85 * Math.sqrt(Math.random());
    const x = CRATER.x + Math.cos(a) * r;
    const z = CRATER.z + Math.sin(a) * r;
    return [x, groundNow(x, z), z];
  }
  /**
   * What is left burning where the mountain went in, and at the mouth of the tunnel. So much a second, whatever
   * the frame rate: the hollow is seen from a long way off, so its fires are broad and few rather than many.
   */
  function burn(dt) {
    const c = G.cine;
    const dueNow = (name, perSecond) => due(c, name, perSecond, dt);
    const drift = () => Math.random() - 0.5;
    // broad low fire over the broken ground
    for (let n = dueNow('fires', 34); n > 0; n--) {
      const [x, y, z] = inTheHollow();
      fx.puff(
        'add',
        x,
        y + 2 + Math.random() * 3,
        z,
        drift(),
        2 + Math.random() * 4,
        drift(),
        2.6,
        15,
        40,
        1,
        0.4,
        0.09,
        0.17,
        {
          drag: 0.4,
        },
      );
    }
    // a brighter heart to some of it
    for (let n = dueNow('hearts', 9); n > 0; n--) {
      const [x, y, z] = inTheHollow();
      fx.puff('add', x, y + 1.5, z, 0, 4, 0, 1.2, 5, 13, 1, 0.68, 0.28, 0.42, { drag: 0.6 });
    }
    // and the smoke of all of it, going up in one slow column
    for (let n = dueNow('smokes', 5); n > 0; n--) {
      const [x, y, z] = inTheHollow();
      fx.puff(
        'smoke',
        x,
        y + 6,
        z,
        drift() * 2,
        7 + Math.random() * 6,
        drift() * 2,
        8,
        18,
        74,
        0.07,
        0.062,
        0.056,
        0.55,
        {
          drag: 0.16,
          fadeIn: 0.12,
        },
      );
    }
    for (let n = dueNow('mouth', 22); n > 0; n--)
      fx.puff(
        'add',
        PORTAL.x + (Math.random() - 0.5) * 6,
        1 + Math.random() * 3,
        PORTAL.z + Math.random() * 2,
        0,
        2 + Math.random() * 3,
        1 + Math.random() * 2,
        1,
        2.5,
        5,
        1,
        0.45,
        0.12,
        0.5,
        { drag: 0.6 },
      );
  }

  function updateEnding(dt) {
    const c = G.cine;
    c.t += dt;
    const t = c.t;
    if (c.flash > 0) {
      c.flash = Math.max(0, c.flash - dt / 2.4);
      hud.flash(c.flash * c.flash);
    }

    if (c.kind === 'lost') {
      // you were still inside: the last thing you see is white
      player.update(dt, input.intent, 0);
      if (t > 2.2 && !c.done) {
        c.done = true;
        menus.show('failed', { reason: 'lost', stats: c.stats, checkpoint: checkpoint?.name });
        hud.fade(0);
        hud.flash(0);
        G.state = 'over';
      }
      return;
    }

    // out: watch it from down the valley
    if (t < 0.5) hud.fade(t / 0.5);
    else if (!c.cut) {
      c.cut = true;
      enemies.clear();
      fx.reset();
      shared.uFogDensity.value = FOG_WIDE;
      shared.uAlarm.value = 0;
      markers.hidePickup();
    } else if (t < 1.3) hud.fade(1 - (t - 0.5) / 0.8);
    else if (t < 12.6) hud.fade(0);

    const say = (at, who, text, seconds) => {
      if (t >= at && c.said < at) {
        c.said = at;
        radio(who, text, seconds);
      }
    };
    say(1.2, 'Wraith', 'Wraith is on the road. Send it.', 3);
    say(4.6, 'Overwatch', 'Hammerfall. Look away.', 3);
    say(
      9.4,
      'Overwatch',
      'Good effect on target. Site Hollow Nine is gone: the mountain has it. Come home, Wraith.',
      6,
    );

    // The cascades went up while you were still in there. What is seen of that from the valley is what the hall
    // is still breathing out of the mountain's two mouths: smoke standing over the shaft, smoke and a dull glow
    // rolling out of the tunnel.
    if (c.cut && !c.hit) {
      const drift = () => Math.random() - 0.5;
      for (let n = due(c, 'shaft', 7, dt); n > 0; n--)
        fx.puff(
          'smoke',
          VENT.x + drift() * 3,
          VENT.y + Math.random() * 2,
          VENT.z + drift() * 3,
          drift() * 1.5,
          5 + Math.random() * 4,
          drift() * 1.5,
          6,
          5,
          22,
          0.085,
          0.08,
          0.076,
          0.5,
          { drag: 0.25, fadeIn: 0.15 },
        );
      for (let n = due(c, 'tunnel', 5, dt); n > 0; n--)
        fx.puff(
          'smoke',
          PORTAL.x + drift() * 6,
          2 + Math.random() * 2,
          PORTAL.z + 1,
          drift(),
          1 + Math.random() * 1.5,
          3 + Math.random() * 3,
          5,
          4,
          15,
          0.09,
          0.085,
          0.08,
          0.5,
          { drag: 0.4, fadeIn: 0.12 },
        );
      for (let n = due(c, 'embers', 6, dt); n > 0; n--)
        fx.puff(
          'add',
          PORTAL.x + drift() * 5,
          1 + Math.random() * 2.5,
          PORTAL.z - 1,
          0,
          0.6,
          0.8,
          1.1,
          2.5,
          5,
          1,
          0.4,
          0.1,
          0.3,
          { drag: 0.5 },
        );
    }

    // the weapon comes in over the mountain's shoulder, down the lodestar's line, and into the mouth of the shaft
    if (t >= 4.7 && !c.incoming) {
      c.incoming = true;
      audio.play('incoming');
    }
    if (t >= 5.6 && t < 7.2 && !c.hit) {
      const k = (t - 5.6) / 1.6;
      const x = lerp(VENT.x - 200, VENT.x, k);
      const y = lerp(VENT.y + 88, VENT.y, k);
      const z = VENT.z;
      fx.puff('add', x, y, z, 0, 0, 0, 0.14, 9, 4, 1, 0.92, 0.75, 1);
      // and leaves a line across the sky behind it for a moment
      fx.puff('add', x, y, z, 0, 0, 0, 0.9, 3.2, 0.8, 1, 0.62, 0.3, 0.75);
    }
    if (t >= 7.2 && !c.hit) {
      c.hit = true;
      strikeOutside();
    }
    if (c.hit) {
      // the ground over the facility goes down: fast at first, then settling
      c.sink = Math.min(1, c.sink + dt / 3.4);
      shared.uCraterGo.value = 1 - (1 - c.sink) ** 3;
      if (c.sink < 1) fx.shake(dt * 0.9);
      // blasts across the hollow while it is still going down, then fire in the bottom of it and smoke over it
      c.next = (c.next || 0) - dt;
      if (c.next <= 0 && t < 11) {
        c.next = 0.2;
        const [x, y, z] = inTheHollow();
        fx.explosion(x, y + 2, z, 2.5 + Math.random() * 3);
      }
      burn(dt);
    }

    const at = STATIONS.ending(smooth(clamp((t - 1) / 12, 0, 1)));
    camera.position.set(at.x, at.y, at.z);
    camera.lookAt(at.tx, at.ty, at.tz);
    camera.rotation.z += fx.shakeState.roll;
    camera.rotation.x += fx.shakeState.pitch;
    if (camera.fov !== at.fov) {
      camera.fov = at.fov;
      camera.updateProjectionMatrix();
    }

    if (t > 12.6 && t <= 13.4) hud.fade(((t - 12.6) / 0.8) * 0.55);
    if (t > 13.4 && !c.done) {
      c.done = true;
      const s = c.stats;
      s.grade = grade(s);
      const better = !G.record || s.seconds < G.record.seconds;
      if (better) {
        G.record = { seconds: s.seconds, grade: s.grade };
        try {
          store?.setItem(RECORD_KEY, JSON.stringify(G.record));
        } catch {
          // the run still counts for this visit
        }
      }
      menus.show('debrief', { stats: s, record: G.record, newRecord: better });
      // the menu brings its own shade; ours would dim the menu too
      hud.fade(0);
      G.state = 'over';
    }
  }

  function updateDying(dt) {
    const c = G.cine;
    c.t += dt;
    player.update(dt, input.intent, 0);
    enemies.update(dt, player, 0, camera);
    // if the cascades were going over when you went down, they go on going over
    updateBlast(dt);
    hud.fade(clamp((c.t - 1.2) / 1.2, 0, 0.75));
    if (c.t > 2.6 && !c.done) {
      c.done = true;
      menus.show('failed', { reason: 'down', stats: stats(), checkpoint: checkpoint?.name });
      hud.fade(0);
      G.state = 'over';
    }
  }

  // ---------- drawing ----------
  /** Puts the camera at one of the stations outside the mountain (world/mountain.js). */
  function standAt(at) {
    camera.position.set(at.x, at.y, at.z);
    camera.lookAt(at.tx, at.ty, at.tz);
    if (camera.fov !== at.fov) {
      camera.fov = at.fov;
      camera.updateProjectionMatrix();
    }
  }
  function placeCamera() {
    if (G.state === 'title' || G.state === 'boot') {
      // from the road, outside: the portal, and the mountain the site is under
      standAt(STATIONS.title(G.time));
      return;
    }
    if (G.state === 'ending' && G.cine.kind === 'win' && G.cine.cut) return;
    if (G.state === 'over' && G.cine?.kind === 'win') {
      // the debrief sits over what is left of the mountain, swinging slowly across the south of it
      standAt(STATIONS.debrief(G.time));
      return;
    }
    // the experiment: while a drone is being flown, the eye is the drone's (src/wild)
    if (wild?.view(camera, view.size.aspect)) return;
    const bob = settings.get('headBob') ? player.bobY : 0;
    // the eye is where the head is: out to one side when leaning, and tipped over with it
    camera.position.set(player.headX, player.eye + bob, player.headZ);
    camera.rotation.set(
      player.pitch + fx.shakeState.pitch,
      player.yaw + fx.shakeState.yaw,
      fx.shakeState.roll -
        player.leanK * PLAYER.leanRoll +
        (player.alive ? 0 : 0.5 * smooth(clamp(G.cine?.t || 0, 0, 1))),
    );
    // held upright a phone shows a narrow slice of the world: open the view up so that it is not a keyhole
    const tall = view.size.aspect < 1 ? 1.22 : 1;
    const fov =
      Math.min(104, settings.get('fov') * tall) * lerp(1, weapon.zoom, smooth(weapon.aim)) * (wild ? wild.fov : 1);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  const hudState = {
    markers: [],
    units: enemies.list,
    alarm: enemies.alarm,
    contacts: [],
    guns: GUN_ORDER.map((key) => ({ key, slot: GUNS[key].slot, short: GUNS[key].short, total: 0 })),
  };
  function updateHud(dt) {
    const m = G.mission;
    const s = hudState;
    s.time = G.time;
    s.contacts = G.state === 'playing' ? G.contacts : [];
    s.health = player.health;
    s.dead = !player.alive;
    s.crouched = player.crouched;
    s.light = G.visibility || 0;
    // the two counters are the gun in hand's; the line under them is everything else that is carried
    const inHand = weapon.gun;
    s.mag = weapon.mag;
    s.total = weapon.total;
    s.magLow = weapon.mag <= Math.ceil(inHand.mag * 0.2);
    s.scarce = weapon.total <= inHand.mag;
    s.out = weapon.out;
    s.gun = inHand.key;
    s.gunLabel = `${inHand.name} · ${inHand.modes.length > 1 ? weapon.mode.toUpperCase() : inHand.note}`;
    for (const row of s.guns) row.total = weapon.arms.guns[row.key].mag + weapon.arms.guns[row.key].reserve;
    s.grenades = weapon.grenades;
    s.held = enemies.held;
    s.reloading = weapon.reloading;
    s.aim = weapon.aim;
    s.spread = weapon.spread;
    s.x = player.x;
    s.z = player.z;
    s.yaw = player.yaw;
    s.hitFlash = player.hitFlash;
    s.hitYaw = player.hitYaw;
    s.nv = G.nv;
    s.prompt = G.prompt;
    s.wantsMouse = input.wantsMouse;
    s.objectives = objectives(m);
    s.clock = m.phase === PHASE.EXFIL ? m.clock : null;
    s.zone = ZONE_NAMES[world.zoneAt(player.x, player.z)];
    s.markers.length = 0;
    for (const c of site.charges)
      if (!m.charges[c.id]) s.markers.push({ x: c.x, z: c.z, kind: 'charge', label: c.name });
    if (canDetonate(m)) s.markers.push({ x: site.firing.x, z: site.firing.z, kind: 'charge', label: 'Firing point' });
    if (m.phase === PHASE.MARK)
      s.markers.push({ x: site.beacon.x, z: site.beacon.z, kind: 'beacon', label: 'Lodestar pad' });
    if (m.phase === PHASE.EXFIL)
      s.markers.push({ x: site.pickup.x, z: site.pickup.z, kind: 'pickup', label: 'Pickup' });
    if (G.stragglers)
      for (const u of enemies.list) if (!u.dead && u.rollId >= 0) s.markers.push({ x: u.x, z: u.z, kind: 'hostile' });
    // ammunition that has not been taken yet: on the maps where it lies, never on the compass
    site.ammo.forEach(([x, z], n) => {
      if (!G.caches.has(n)) s.markers.push({ x, z, kind: 'ammo', label: 'Ammunition', quiet: true });
    });
    hud.update(s, dt);
    input.setToggles({ aim: input.intent.aim, crouch: player.crouched, nv: G.nv });
    input.setArms({ gun: inHand.short, grenades: weapon.grenades });
  }

  let dripT = 3;
  function ambience(dt) {
    const eye = camera.position;
    // wind is for the outside; inside there is the air of the place, and water coming through bare rock
    // (audio/air.js). The pictures of the outside are taken from under the sky, so they have the wind too.
    const air = airOf({
      sky: world.skyAt(eye.x, eye.z),
      room: world.indoors(eye.x, eye.z),
      zone: world.zoneAt(eye.x, eye.z),
    });
    loops.wind?.set({ gain: air.wind });
    loops.hum?.set({ gain: air.hum });
    if (air.drips && G.state === 'playing') {
      dripT -= dt;
      if (dripT <= 0) {
        dripT = 2.5 + Math.random() * 5;
        const a = Math.random() * Math.PI * 2;
        const d = 5 + Math.random() * 9;
        audio.play('drip', { x: eye.x + Math.cos(a) * d, y: 0.3, z: eye.z + Math.sin(a) * d, gain: 0.9 });
      }
    }
    audio.setListener(camera.position.x, camera.position.y, camera.position.z, camera.rotation.y);
    audio.update(dt);
  }

  let last = performance.now();
  let slowFor = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const ms = now - last;
    last = now;
    const dt = Math.min(0.05, ms / 1000);
    view.frame(ms);
    view.fit();
    G.time += dt;
    shared.uTime.value = G.time % 3600;

    const intent = input.frame();
    let sim = dt;
    switch (G.state) {
      case 'playing': {
        // The experiment may have bent time (src/wild/focus.js): the world's clock runs at `pace.world` of real
        // time and the player's own at `pace.own`. Without it both are 1, and this is the loop it always was.
        const pace = wild ? wild.pace(dt) : null;
        if (pace) sim = dt * pace.world;
        // G.speed > 1 runs the world several steps a frame: tests use it to get through a long wait quickly
        for (let k = 0; k < (G.speed || 1) && G.state === 'playing'; k++) {
          updatePlaying(sim, intent, pace ? dt * pace.own : dt);
          intent.lookX = intent.lookY = 0;
          intent.usePressed = intent.jump = intent.reload = intent.crouchToggle = intent.nv = intent.map = false;
          intent.grabPressed = intent.melee = false;
          intent.hits.clear();
        }
        updateHud(dt);
        break;
      }
      case 'paused':
        sim = 0;
        break;
      case 'dying':
        updateDying(dt);
        updateHud(dt);
        break;
      case 'ending':
        updateEnding(dt);
        updateHud(dt);
        break;
      case 'over':
        // what is left of the mountain goes on burning behind the debrief
        if (G.cine?.kind === 'win') burn(dt);
        updateHud(dt);
        break;
      default:
        enemies.update(dt, player, 0, camera, true);
        markers.update(dt, false);
    }

    // the experiment, once a drawn frame, whatever the state of the game: what it shows (real seconds)
    wild?.frame(dt);
    placeCamera();
    fx.update(sim, camera);
    sky.update(camera, G.time);
    // surfaces within reach of a lamp that has gone out or come back are lit again, a few milliseconds a frame
    relightStep(RELIGHT_MS);
    world.updateGlints(camera.position, dt);
    ambience(dt);

    // The finishing passes are dropped, once and for good, on a device that cannot afford them: if the picture
    // has been held at its smallest for six seconds running they go, and every material finishes itself from
    // then on. One way only — they never come back in the same visit, so the two cannot chase each other.
    if (post.enabled) {
      slowFor = view.dynres.scale <= view.dynres.min + 1e-6 ? slowFor + dt : 0;
      if (slowFor > 6) {
        post.disable();
        console.warn('finishing passes switched off: the picture was at its smallest for six seconds');
      }
    }

    renderer.info.reset();
    // the second look: which key lights burn is decided from where the eye is, and what each can see is drawn
    // first, so that the picture can ask it about shadows
    lookLive?.beforeRender(camera.position);
    // …and the picture is exposed for the place the eye is looking at, beside the player's own setting
    if (lookLive) shared.uExposure.value = settings.get('brightness') * lookLive.expose(camera, dt);
    post.resize(view.size.pixelWidth, view.size.pixelHeight);
    post.begin();
    renderer.clear();
    renderer.render(scene, camera);
    // the phone test page: the same world over again, to find how much room a device has left
    for (let again = 0; again < G.extraDraws; again++) renderer.render(scene, camera);
    if (weapon.visible && G.state !== 'title') weapon.render(renderer);
    post.end();
    G.drawCalls = renderer.info.render.calls;
    G.frames++;
  }

  // ---------- things tests and the curious can poke ----------
  G.debug = {
    start: startMission,
    pause,
    resume,
    title: toTitle,
    teleport(x, z, yaw = player.yaw) {
      player.x = player.headX = x;
      player.z = player.headZ = z;
      player.yaw = yaw;
      player.vx = player.vz = player.vy = 0;
      player.y = 0;
      player.lean = player.leanK = 0;
      player.grounded = true;
    },
    /** Shuts down every machine on the roll, as if each had been shot. */
    clearSite() {
      for (const unit of [...enemies.list])
        if (!unit.dead && unit.rollId >= 0) enemies.damage(unit, 1e6, player.x, player.z);
    },
    /**
     * Sets every charge, as if each had been held on — for the tests of what comes AFTER the charges. It is the
     * mission's book-keeping alone: no checkpoint, and none of the alarm and the wave a charge set by hand brings.
     */
    rig() {
      for (const c of site.charges) if (plantCharge(G.mission, c.id)) markers.arm(c.id);
    },
    /** Fires the charges from wherever the player is standing, as if they had held the firing point. */
    blow() {
      if (detonate(G.mission)) beginBlast();
    },
    hurt(amount) {
      player.damage(amount, player.x, player.z - 1);
    },
    /** Runs the world n steps a frame (1 = real time). */
    speed(n) {
      G.speed = Math.max(1, Math.round(n));
    },
    /** The second look, for tests: draw surfaces by whether they have a material; ask where a key light reaches. */
    classes(on) {
      lookLive?.classes(on);
    },
    keySamples: (k = 0) => (lookLive ? lookLive.keySamples(camera, k) : []),
    /** …and leave one key light alone burning (−1: all of them again), so that its shadows can be read off the picture. */
    keySolo: (k, held) => lookLive?.keySolo(k, held),
    /** …and where to stand to look at one key light's light and shadows. */
    keyStation: (k) => (lookLive ? lookLive.keyStation(k, { fov: camera.fov, aspect: camera.aspect }) : null),
    /** …and how the picture is exposed just now, and for how much light. */
    exposure: () => (lookLive ? lookLive.exposure(camera) : null),
    /** …and how bright the captured place is, looked into from where it was captured towards a point of the world. */
    mirrorToward: (x, y, z, reach) => (lookLive ? lookLive.mirrorToward(x, y, z, reach) : null),
    /**
     * Lamps that go out, for tests: which are out (their places in the one list: the site's own, then the second
     * look's key lights); break one as a round would; and finish at once the lighting-again that is otherwise
     * spread over frames, so that a picture can be read straight after.
     */
    lamps: {
      count: lamps.count,
      site: siteLamps,
      at: (i) => lamps.list[i],
      out: () => Array.from({ length: lamps.count }, (_, i) => i).filter((i) => lamps.isOut(i)),
      shoot: (i) => relight(lamps.shoot(i)),
      /** as an EMP going off at (x, z) does: the lamps it reaches are tripped; says which went dark */
      trip(x, z) {
        const D = ARMS.grenades.dark;
        const dark = lamps.trip(lamps.reach(x, z, world.grid, D), D.seconds);
        relight(dark);
        return dark;
      },
      /** what a round from (ox, oy, oz) along (dx, dy, dz) would break, were nothing else in its way for `max` metres */
      hit: (ox, oy, oz, dx, dy, dz, max) => lamps.hit(ox, oy, oz, dx, dy, dz, max),
      settle: () => relightStep(Infinity),
      /** how many surfaces and things still wait to be lit again */
      waiting: () => world.lamps.waiting(),
    },
  };

  // ---------- the experiment (src/wild; docs/WILD.md) ----------
  // Fetched now, when everything it works with stands — and only if it is wanted (the top of this function). If
  // it cannot be had, the game is the locked one, and says so once in the console.
  if (wildOn)
    try {
      wild = (await import('./wild/index.js')).createWild({
        G,
        ui,
        scene,
        params,
        store,
        // What of the game's own the experiment must be HANDED rather than import for itself. Were its file to
        // import these — or anything that imports them (gfx/fx.js) — the bundler would move them, and three.js
        // with them, out of the script everybody downloads into a third file. test/wild/wild.test.mjs holds the
        // build to the files it has. (`zone`: the name of the place at (x, z) — world/map.js ZONE_NAMES.)
        lib: { glow, lit, ownMaterials, setProbe, moveBody, pushOut, zone: (x, z) => ZONE_NAMES[world.zoneAt(x, z)] },
        // what only this file can do, for the experiment to ask for
        act: {
          radio,
          /** the site's own alarm is up, raised by something that is not a machine: the stroke, and the horn */
          siren() {
            audio.play('alarmHit');
            loops.alarm = loops.alarm || audio.loop('alarm', { gain: 0.5 });
          },
          /** a wave of machines to a place (as a charge brings); `turn`: which bays the drones come up from */
          wave: (at, turn) => sendWave(at, false, turn),
          /** the cascades come down without a hand on the firing point: every charge counts as set, and they go */
          bringDown() {
            G.debug.rig();
            G.debug.blow();
          },
          /** the lamps an EMP at (x, z) would put out are out, for as long as it would put them out */
          dark: (x, z) => G.debug.lamps.trip(x, z),
          /** one of the loops that are always there (wind, hum, cascade, alarm, …), or null */
          loop: (name) => loops[name],
        },
      });
    } catch (error) {
      console.warn(`the experiment could not be had, and the game goes on without it: ${error?.message || error}`);
    }
  G.wild = wild;

  toTitle();
  requestAnimationFrame(frame);
  bootEl.classList.add('done');
  setTimeout(() => bootEl.remove(), 700);
  if (params.get('autostart') === '1') startMission();
  window.__ready = true;
  // the phone test page times this set-up and goes on to the next; it ends on a table, over the game
  bench?.run({ G, renderer, quality, params }).catch((error) => {
    window.__errors.push(`the test page: ${error?.stack || error}`);
    console.error(error);
  });
}

boot().catch((error) => {
  window.__fatal = String(error?.stack || error);
  window.__errors.push(window.__fatal);
  console.error(error);
  bootEl.classList.add('failed');
  document.getElementById('boot-line').textContent = `Lodestar could not start: ${error?.message || error}`;
});

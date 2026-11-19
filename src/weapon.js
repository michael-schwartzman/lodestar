// What is in your hands: three guns, a grenade and a knife — firing, recoil, reloading, raising a sight to the
// eye, changing from one gun to another — and the model of it at the bottom of the screen.
// The rules (how many rounds, what each gun is for) are in arms.js; this file carries them out and draws them.
// What is held is drawn in a little scene of its own, after the world, so that it never pokes through a wall.
import * as THREE from 'three';
import { glow, ownMaterials, setEnvRotation, setInHand, setProbe } from './gfx/materials.js';
import { isMetal } from './gfx/fx.js';
import { buildKnife } from './gfx/knife.js';
import {
  ARMS,
  GUNS,
  GUN_ORDER,
  allDry,
  canReload,
  createArms,
  createKnife,
  gunOf,
  isDry,
  loadShell,
  modeOf,
  nextGun,
  pelletDamage,
  reloadMag,
  selectGun,
  spendRound,
  takeCache,
  toggleMode,
  totalRounds,
} from './arms.js';
import { blankPose, reloadCues, reloadPose } from './reload.js';
import { clamp, damp, lerp, smooth } from './core/math.js';

export const WEAPON = {
  /** seconds for the gun in hand to go down out of the picture, and as long again for the next to come up */
  swap: 0.22,
  /** a pull of the trigger that comes a moment too soon (the gun is still cycling) is not lost: it waits this long */
  early: 0.22,
  /** seconds from asking for a grenade to its leaving the hand, and for the hand to go away again */
  windUp: 0.26,
  followThrough: 0.24,
};

/**
 * How each gun sits in the hands and how it kicks: where it is held at the hip, how far out the sight is kept
 * from the eye, how far its bolt (slide, pump) travels, and what a shot does to the picture.
 * `climb` and `drift` are radians a shot, from the hip and with the sight at the eye. `palm` is where the
 * support hand's palm is, in the space of the part it is fixed to: what the hand turns about when a reload
 * moves it (src/reload.js).
 */
const FEEL = {
  carbine: {
    hip: [0.2, -0.215, -0.47],
    turn: 0.04,
    eye: 0.3,
    bolt: 0.035,
    palm: [-0.01, 0.035, -0.3],
    kick: 0.55,
    climb: [0.0105, 0.0065],
    drift: [0.0045, 0.0025],
    bloom: 0.0034,
    flash: 1,
    sound: 'shot',
    muzzle: 'player',
  },
  pistol: {
    hip: [0.17, -0.19, -0.42],
    turn: 0.12,
    eye: 0.22,
    bolt: 0.03,
    palm: [-0.02, -0.06, 0.02],
    kick: 0.5,
    climb: [0.013, 0.008],
    drift: [0.004, 0.002],
    bloom: 0.0045,
    // a suppressed sidearm shows you up far less than the carbine does
    flash: 0.55,
    sound: 'pistolShot',
    muzzle: 'player',
  },
  shotgun: {
    hip: [0.17, -0.2, -0.42],
    turn: 0.1,
    eye: 0.2,
    bolt: 0.09,
    palm: [0, -0.03, 0],
    kick: 1.3,
    climb: [0.05, 0.036],
    drift: [0.012, 0.008],
    bloom: 0,
    flash: 1.4,
    sound: 'shotgunShot',
    muzzle: 'shotgun',
  },
};
/** how fast what is left of a reload that stopped where it stood is let go of (1/s): nothing snaps back */
const RELOAD_EASE = 11;
const RELOAD_PARTS = ['gun', 'hand', 'mag'];
/**
 * On a picture taller than it is wide (a phone held upright) the middle of the gun is off its right-hand edge,
 * and a reload brought only as far across as on a wide one would be done out of sight: the shotgun's port most
 * of all. There it is brought this many times as far.
 */
const RELOAD_SLIM = 2;

const rnd = (a, b) => a + Math.random() * (b - a);
const hit = {};
const tint = new THREE.Color();
const arrow = new THREE.Vector3();
const view = new THREE.Euler();
const turn = new THREE.Quaternion();
const turnMatrix = new THREE.Matrix4();
const envTurn = new THREE.Matrix3();
/** the second look: the key light at the eye just now, and the same eased — stepping out of a shadow is no switch */
const keyNow = { r: 0, g: 0, b: 0, x: 0, y: 0, z: 0 };
const KEY_PARTS = ['r', 'g', 'b', 'x', 'y', 'z'];
/** how much of a key light falls on what is in the hands, against what falls on the ground: it is held low, in the body's own shade */
const KEY_ON_HANDS = 0.7;

/**
 * @param {object} o
 * @param {object} o.models   { buildCarbine, buildPistol?, buildShotgun?, buildGrenade?, buildGrenadeBody? } — a
 *                            gun whose model is missing is drawn as the carbine, so that the game still plays
 * @param {THREE.Scene} o.scene the world's scene: a thrown grenade is out there, not in the hands
 * @param {number} [o.assist=1] how much wider a machine's hit volumes count for the player's rounds (touch: 1.4)
 * @param {object} o.hooks    hit({ unit, zone, killed }) — a round or the knife found a machine;
 *                            knife({ unit, killed, takedown }) — what a knife blow did;
 *                            note(text, tone) — something the player should be told in a word or two
 */
export function createWeapon({ models, scene: worldScene, fx, audio, world, enemies, assist = 1, hooks }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 8);
  const arms = createArms();

  // ---------- the three guns, each a model in the hands ----------
  const BUILDERS = { carbine: models.buildCarbine, pistol: models.buildPistol, shotgun: models.buildShotgun };
  const views = {};
  for (const key of GUN_ORDER) {
    const gun = (BUILDERS[key] || models.buildCarbine)();
    const feel = FEEL[key];
    gun.root.visible = key === arms.current;
    scene.add(gun.root);
    gun.root.updateWorldMatrix(true, true);
    const sight = gun.parts.sight
      ? gun.parts.sight.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(0, 0.14, -0.1);
    // the sight's dot is a pinpoint, not a lamp
    gun.parts.dot?.scale.setScalar(0.42);
    views[key] = {
      key,
      gun,
      feel,
      mats: ownMaterials(gun.root),
      // two poses: at the hip, and with the sight on the eye's own line — far enough out that the gun's back
      // does not wall off the lower half of the view
      hip: new THREE.Vector3(...feel.hip),
      aimed: new THREE.Vector3(-sight.x, -sight.y, -feel.eye - sight.z),
      magHome: gun.parts.mag ? gun.parts.mag.position.clone() : null,
      boltHome: gun.parts.bolt ? gun.parts.bolt.position.clone() : null,
      // where the support hand rests, what it turns about, and the loose shell at the shotgun's port — for a
      // reload, which moves them (src/reload.js)
      armHome: gun.parts.armL ? gun.parts.armL.position.clone() : null,
      armTurn: gun.parts.armL ? gun.parts.armL.quaternion.clone() : null,
      palm: new THREE.Vector3(...feel.palm),
      shellHome: gun.parts.shell
        ? { at: gun.parts.shell.position.clone(), turn: gun.parts.shell.rotation.clone() }
        : null,
    };
  }
  /** what a reload is doing to the gun in hand just now, and what is left of one that stopped where it stood */
  const doing = blankPose();
  const left = blankPose();
  let wasReloading = false;
  const turned = new THREE.Quaternion();
  const turns = new THREE.Euler();
  const pivot = new THREE.Vector3();
  function restReload() {
    for (const pose of [doing, left]) {
      for (const part of RELOAD_PARTS) pose[part].fill(0);
      pose.bolt = 0;
      pose.shown = false;
    }
    wasReloading = false;
  }

  // the knife lives in the same little scene: out of sight until it is swung, or until there is nothing else
  // (the second look hands over a builder of its own for it, as it does for the guns)
  const blade = (models.buildKnife || buildKnife)();
  blade.root.visible = false;
  scene.add(blade.root);
  const bladeMats = ownMaterials(blade.root);
  const knife = createKnife();

  // the grenade: in the left hand for the moment it takes to throw, and then out in the world
  const fist = models.buildGrenade ? models.buildGrenade() : null;
  let fistMats = null;
  if (fist) {
    fist.root.visible = false;
    scene.add(fist.root);
    fistMats = ownMaterials(fist.root);
  }
  // nothing in this little scene is in the world: none of it takes the light that is worked out from where a
  // surface stands there (the second look's key lights). It is added to their probe by hand, in pose()
  for (const mats of [...GUN_ORDER.map((key) => views[key].mats), bladeMats, fistMats]) if (mats) setInHand(mats);
  const thrown = [];
  function grenadeBody() {
    const spare = thrown.find((g) => !g.live);
    if (spare) return spare;
    let root;
    if (models.buildGrenadeBody) root = models.buildGrenadeBody().root;
    else {
      root = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.13, 8), glow({ color: 0x8dffcf, intensity: 1.2 }));
    }
    root.visible = false;
    worldScene?.add(root);
    const body = { root, mats: ownMaterials(root), live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0 };
    thrown.push(body);
    return body;
  }

  const w = {
    scene,
    camera,
    /**
     * The second look (main.js sets it; null without): `key(x, y, z, out)` — the key light arriving at a point in
     * the air — and `mirror(x, z)` — how far inside the captured place a point is (look/index.js `hand`).
     */
    look: null,
    /** the key light on what is in the hands just now: r, g, b and the way it comes from, eased (for tests too) */
    keyHeld: { r: 0, g: 0, b: 0, x: 0, y: 0, z: 0 },
    /** everything carried (arms.js): the gun in hand, the carbine's selector, each gun's rounds, the grenades */
    arms,
    cooldown: 0,
    /** seconds left of a reload (or of the shell going in), 0 when not reloading; and how long it was to take */
    reloadT: 0,
    reloadLen: 1,
    /**
     * How the reload under way is going (src/reload.js), fixed when it starts — the magazine is full again on the
     * very frame the bolt is to be let go, so "was it dry" cannot be asked then. dry: the gun had run dry, and its
     * bolt stands open (the shotgun: its chamber is empty, and it is pumped afterwards). held: a machine is held
     * on the other arm. first: the shotgun's first shell, for which the hand comes off the pump.
     */
    reloadHow: { dry: false, held: false, first: false },
    /** for the tools that take pictures of a reload: `{ t, dry, held, first }` holds it still at that moment */
    reloadHold: null,
    /** 0 at the hip … 1 at the eye */
    aim: 0,
    kick: 0,
    bloom: 0,
    swayX: 0,
    swayY: 0,
    lower: 0,
    lowerT: 0,
    run: 0,
    flash: 0,
    dry: false,
    visible: true,
    /** pulls of the trigger that fired, and how many of those found a machine (a shotgun's blast is one of each) */
    shots: 0,
    hits: 0,
    /** the knife's clock (arms.js): `knife.busy` while it is being swung */
    knife,
    /** 0 … 1: how far the knife is out in the hand because there is no round left anywhere */
    knifeOut: 0,
    /** 0 … 1: how far the gun has been taken into one hand because the other holds a machine */
    hold: 0,
    /** the cone of fire right now, in radians — the HUD draws its crosshair from this */
    spread: 0.02,
    /** changing guns: { to, t, done } — null when not */
    swap: null,
    /** a grenade on its way out of the hand: { t, released } — null when not */
    lob: null,
    /** the trigger was held last frame (a pull is the frame it goes from not held to held) */
    triggerWas: false,
    /** seconds for which a pull that came too soon is still owed its round */
    early: 0,
    /** seconds since the shotgun was last fired, for its pump */
    sinceShot: 9,
    pumped: true,

    // The two numbers the screen shows are the gun IN HAND's: what is in it, and every round there is for it.
    // (`total` was every round the player owned while there was one gun. It is not that any more: for all of
    // them together there is `everything`.)
    get mag() {
      return arms.guns[arms.current].mag;
    },
    set mag(n) {
      arms.guns[arms.current].mag = n;
    },
    get reserve() {
      return arms.guns[arms.current].reserve;
    },
    set reserve(n) {
      arms.guns[arms.current].reserve = n;
    },
    get total() {
      return totalRounds(arms.guns[arms.current]);
    },
    /** every round for every gun */
    get everything() {
      return GUN_ORDER.reduce((sum, key) => sum + totalRounds(arms.guns[key]), 0);
    },
    /** not a round left for any gun: the trigger now swings the knife */
    get out() {
      return allDry(arms);
    },
    /** the gun in hand: its key, and its row of the table in arms.js */
    get current() {
      return arms.current;
    },
    get gun() {
      return gunOf(arms);
    },
    /** …and what is drawn of it: `root`, and its `parts` by name (for tests, and the tools that measure a reload) */
    get model() {
      return views[arms.current].gun;
    },
    /** how the gun in hand fires right now: 'auto' or 'semi' */
    get mode() {
      return modeOf(arms);
    },
    get grenades() {
      return arms.grenades;
    },
    /** how much the view narrows when this gun's sight is at the eye */
    get zoom() {
      return gunOf(arms).zoom;
    },
    get swapping() {
      return w.swap !== null;
    },

    /** @param {number} [rounds] how many times the table's reserve a mission starts with (arms.js) */
    reset(rounds = 1) {
      knife.stop();
      Object.assign(arms, createArms(rounds));
      for (const body of thrown) {
        body.live = false;
        body.root.visible = false;
      }
      Object.assign(w, {
        cooldown: 0,
        reloadT: 0,
        aim: 0,
        kick: 0,
        bloom: 0,
        lower: 0,
        lowerT: 0,
        flash: 0,
        dry: false,
        shots: 0,
        hits: 0,
        knifeOut: 0,
        hold: 0,
        swap: null,
        lob: null,
        triggerWas: false,
        early: 0,
        sinceShot: 9,
        pumped: true,
        visible: true,
        reloadHold: null,
      });
      restReload();
      show();
    },

    /** What a checkpoint has to remember of all this. */
    save() {
      return { arms: JSON.parse(JSON.stringify(arms)), shots: w.shots, hits: w.hits };
    },
    /** Puts back what save() gave. Anything under way — a reload, a change of guns, a throw — is not. */
    load(state) {
      Object.assign(arms, JSON.parse(JSON.stringify(state.arms)));
      Object.assign(w, { shots: state.shots, hits: state.hits, reloadT: 0, swap: null, lob: null, cooldown: 0 });
      restReload();
      show();
    },

    get reloading() {
      return w.reloadT > 0;
    },

    /**
     * Empties a cache into what is carried — `rounds` times the table's rounds for every gun. Returns what it
     * gave: { carbine, pistol, shotgun, grenades }.
     */
    takeCache(rounds = 1) {
      return takeCache(arms, rounds);
    },

    /** Drops the gun out of the way for a moment (a takedown, setting a charge). */
    lowerFor(seconds) {
      w.lowerT = Math.max(w.lowerT, seconds);
    },

    /**
     * Play has stopped (an ending, going down): a grenade still in the air is not left hanging there, and one
     * half thrown is not thrown.
     */
    stow() {
      w.lob = null;
      for (const body of thrown) {
        body.live = false;
        body.root.visible = false;
      }
    },

    startReload() {
      const gun = gunOf(arms);
      const a = arms.guns[arms.current];
      if (w.reloadT > 0 || w.swap || !canReload(a, gun.mag)) return false;
      w.reloadT = w.reloadLen = gun.reload;
      // how it will go is settled now, and not asked again while it lasts (see `reloadHow`)
      w.reloadHow = { dry: a.mag <= 0, held: w.hold > 0.5, first: true };
      return true;
    },

    /** Takes a gun in hand by its key. Returns false if it is in hand already, or cannot be just now. */
    select(key, player) {
      if (!GUNS[key] || key === arms.current || w.swap || knife.busy) return false;
      if (player?.holding && GUNS[key].twoHands) {
        hooks.note?.(`THE ${GUNS[key].short} TAKES BOTH HANDS`, 'warn');
        return false;
      }
      beginSwap(key);
      return true;
    },

    /** Swings the knife, if it is not already being swung. A reload under way is given up. */
    stab() {
      if (!knife.start()) return false;
      w.reloadT = 0;
      audio.play('knifeSwing', { gain: 1.4 });
      return true;
    },

    update(dt, intent, player) {
      const holding = !!player.holding;
      const ready = player.alive && w.lowerT <= 0;
      w.lowerT = Math.max(0, w.lowerT - dt);
      const pulled = intent.fire && !w.triggerWas;
      w.triggerWas = intent.fire;

      // the knife: asked for, or all that is left when the trigger is pulled and no gun has a round.
      // Not with a machine in the other arm: there V shuts that machine down (main.js), and nothing is swung.
      const out = allDry(arms);
      if (player.alive && !holding && !w.lob && (intent.melee || (intent.fire && out))) w.stab();
      if (knife.step(dt) && player.alive) strike(player);
      const knifing = knife.busy;

      // a machine on your arm: the shotgun cannot be pumped, so something else comes to hand — the sidearm, which
      // is made for one hand, if there is anything in it
      if (holding && gunOf(arms).twoHands && !w.swap)
        beginSwap(isDry(arms.guns.pistol) ? nextGun(arms, { holding }) || 'pistol' : 'pistol');

      // changing guns: by number, or round the three of them — one change at a time
      if (ready && !knifing && !w.swap && !w.lob) {
        if (intent.select)
          w.select(
            GUN_ORDER.find((key) => GUNS[key].slot === intent.select),
            player,
          );
        else if (intent.cycle) {
          const to = nextGun(arms, { holding, step: intent.cycle });
          if (to) beginSwap(to);
          else hooks.note?.(out ? 'NO ROUNDS — KNIFE' : 'NOTHING ELSE IS LOADED', 'warn');
        }
      }
      if (w.swap) stepSwap(dt, holding);
      const swapping = w.swap !== null;
      // from here on: the gun that is in hand now
      const gun = gunOf(arms);
      const a = arms.guns[arms.current];

      if (intent.mode && ready && !swapping) {
        const mode = toggleMode(arms);
        if (mode) {
          audio.play('selector', { gain: 1.4 });
          hooks.note?.(mode === 'semi' ? 'SEMI — ONE ROUND A PULL' : 'AUTO');
        }
      }

      if (intent.throw && ready && !knifing && !swapping && !w.lob) {
        // the arm that throws is the arm that holds a machine
        if (holding) hooks.note?.('YOUR OTHER HAND IS FULL', 'warn');
        else if (arms.grenades > 0) {
          w.lob = { t: 0, released: false };
          w.reloadT = 0;
          audio.play('grenadePin', { gain: 1.5 });
        } else hooks.note?.('NO GRENADES', 'warn');
      }
      if (w.lob) stepLob(dt, player);
      const busy = knifing || swapping || w.lob !== null;

      w.aim = damp(w.aim, intent.aim && ready && !w.reloading && !player.running && !busy && !holding ? 1 : 0, 13, dt);
      w.bloom = Math.max(0, w.bloom - dt * 0.05);
      // set to SEMI the carbine is steadier from the hip: that is what the selector buys
      const steady = arms.current === 'carbine' && arms.mode === 'semi' ? 0.75 : 1;
      w.spread =
        (lerp(gun.hip * steady, gun.aimed, w.aim) +
          w.bloom +
          (player.speed > 1 ? 0.012 * (1 - w.aim * 0.7) : 0) +
          // nothing to brace against in the air, and only one hand on the gun with a machine in the other
          (player.grounded === false ? 0.028 : 0) +
          (holding ? 0.008 : 0)) *
        (player.crouched ? 0.75 : 1);
      w.cooldown = Math.max(0, w.cooldown - dt);
      w.flash = Math.max(0, w.flash - dt * 14);
      w.early = pulled ? WEAPON.early : Math.max(0, w.early - dt);

      // the shotgun is pumped a moment after it is fired — the sound of it timed to the fore-end: back at 0.42 s,
      // home at 0.58 (pose(), below)
      w.sinceShot += dt;
      if (!w.pumped && w.sinceShot >= 0.38) {
        w.pumped = true;
        if (arms.current === 'shotgun') audio.play('shotgunPump', { gain: 1 });
      }

      if (intent.reload && ready && !busy) w.startReload();
      if (w.reloadT > 0) {
        const before = w.reloadLen - w.reloadT;
        w.reloadT = Math.max(0, w.reloadT - dt);
        const now = w.reloadLen - w.reloadT;
        // each sound of it in its moment (src/reload.js): every one whose moment this step has passed, so that a
        // long frame loses none
        for (const [at, sound, gain, rate] of reloadCues(arms.current, w.reloadHow))
          if (before < at * w.reloadLen && now >= at * w.reloadLen) audio.play(sound, { gain, rate });
        if (gun.shells) {
          // one shell at a time, and then the next — until it is full, there are none, or the trigger says stop
          if (w.reloadT === 0 && loadShell(a, gun.mag)) {
            if (canReload(a, gun.mag)) {
              w.reloadT = w.reloadLen = gun.reload;
              w.reloadHow.first = false;
            } else if (w.reloadHow.dry) {
              // it had been fired empty: nothing is in the chamber until it is pumped — as the gun comes back
              w.sinceShot = 0.1;
              w.pumped = false;
            }
          }
        } else if (w.reloadT === 0) reloadMag(a, gun.mag);
      }

      // The trigger. AUTO goes on for as long as it is held; SEMI gives one round for each pull, and a pull that
      // comes a moment too soon is kept for that moment rather than lost.
      const wants = modeOf(arms) === 'auto' ? intent.fire : w.early > 0;
      if (wants && ready && !busy && !out) {
        if (isDry(a)) {
          // not a round for this gun anywhere: on the pull — once, not every frame the trigger stays down —
          // turn to the next gun that has something in it
          if (pulled) {
            const to = nextGun(arms, { holding });
            w.early = 0;
            if (to) {
              hooks.note?.(`${gun.short} EMPTY — ${GUNS[to].short}`, 'warn');
              beginSwap(to);
            } else {
              audio.play('dry');
              hooks.note?.('NOTHING YOU CAN FIRE WITH ONE HAND', 'warn');
            }
          }
        } else if (w.reloadT > 0) {
          // shells are going in: a fresh pull, with one in the tube, stops that and fires it
          if (gun.shells && pulled && a.mag > 0) {
            w.reloadT = 0;
            w.cooldown = Math.max(w.cooldown, 0.12);
          }
        } else if (a.mag > 0) {
          if (w.cooldown <= 0) {
            fire(player, gun, a);
            w.cooldown = gun.interval;
            w.early = 0;
          }
        } else if (!w.dry) {
          w.dry = true;
          w.early = 0;
          audio.play('dry');
          w.startReload();
        }
      }
      if (!intent.fire) w.dry = false;

      stepThrown(dt);
      pose(dt, intent, player, knifing, out);
    },

    /** Draws what is in the hands over the picture of the world. */
    render(renderer) {
      if (!w.visible) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },

    resize(aspect) {
      camera.aspect = aspect;
      // on a tall screen the gun would crowd the middle: pull the view back
      camera.fov = aspect < 1 ? 70 : 55;
      camera.updateProjectionMatrix();
    },
  };

  /** Only the gun in hand is drawn. */
  function show() {
    for (const key of GUN_ORDER) views[key].gun.root.visible = key === arms.current;
  }

  function beginSwap(to) {
    w.swap = { to, t: 0, done: false };
    w.reloadT = 0;
    w.early = 0;
    audio.play('weaponSwap', { gain: 1.3 });
  }
  /** Down goes the one in hand; at the bottom the other takes its place; up it comes. */
  function stepSwap(dt, holding) {
    const s = w.swap;
    s.t += dt;
    if (!s.done && s.t >= WEAPON.swap) {
      s.done = true;
      // (a machine taken hold of while the shotgun was on its way up: it does not come up)
      if (!selectGun(arms, s.to, { holding })) {
        w.swap = null;
        return;
      }
      w.cooldown = 0;
      w.bloom = 0;
      w.pumped = true;
      // what was left of a reload was the other gun's
      restReload();
      show();
    }
    if (s.t >= WEAPON.swap * 2) w.swap = null;
  }

  /** The forward, right and up of the eye, as nine numbers. */
  function eyeAxes(player) {
    const cp = Math.cos(player.pitch);
    const fx_ = -Math.sin(player.yaw) * cp;
    const fy = Math.sin(player.pitch);
    const fz = -Math.cos(player.yaw) * cp;
    const rx = Math.cos(player.yaw);
    const rz = -Math.sin(player.yaw);
    // up = right × forward
    return [fx_, fy, fz, rx, rz, -rz * fy, rz * fx_ - rx * fz, rx * fy];
  }

  function fire(player, gun, a) {
    if (!spendRound(a)) return;
    w.shots++;
    const feel = FEEL[gun.key];
    const [fxn, fyn, fzn, rx, rz, ux, uy, uz] = eyeAxes(player);
    // the round leaves from where the eye is — out to one side when leaning — and passes a machine held in front
    const ox = player.headX ?? player.x;
    const oy = player.eye + player.bobY;
    const oz = player.headZ ?? player.z;
    const side = lerp(0.13, 0, w.aim);
    const drop = lerp(0.13, 0.045, w.aim);
    /** what this pull of the trigger did to a machine, if it found one: the best of its pellets */
    let landed = null;
    let mx = 0;
    let my = 0;
    let mz = 0;
    let ax = fxn;
    let ay = fyn;
    let az = fzn;
    for (let p = 0; p < gun.pellets; p++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * w.spread;
      let dx = fxn + (rx * Math.cos(angle) + ux * Math.sin(angle)) * r;
      let dy = fyn + uy * Math.sin(angle) * r;
      let dz = fzn + (rz * Math.cos(angle) + uz * Math.sin(angle)) * r;
      const len = Math.hypot(dx, dy, dz);
      dx /= len;
      dy /= len;
      dz /= len;
      if (p === 0) {
        ax = dx;
        ay = dy;
        az = dz;
        mx = ox + dx * 0.8 + rx * side - ux * drop;
        my = oy + dy * 0.8 - uy * drop;
        mz = oz + dz * 0.8 + rz * side - uz * drop;
      }

      const wall = world.grid.raycast(ox, oy, oz, dx, dy, dz, gun.range, hit);
      const reach = wall ? hit.t : gun.range;
      const struck = enemies.raycast(ox, oy, oz, dx, dy, dz, reach, assist, enemies.held);
      // A lamp in the round's way — nearer than the machine, if it found one — is broken by it, and the round
      // goes no further. A fitting is fixed to the wall or the ceiling the round would have stopped at, a hand's
      // breadth in front of it: it is looked for that much past where the wall is.
      const lamp = hooks.lamp?.(ox, oy, oz, dx, dy, dz, struck ? struck.t : reach + ARMS.lamp.proud) ?? -1;
      let ex = ox + dx * reach;
      let ey = oy + dy * reach;
      let ez = oz + dz * reach;
      if (lamp >= 0) {
        const at = Math.min(lamp, reach);
        ex = ox + dx * at;
        ey = oy + dy * at;
        ez = oz + dz * at;
        fx.sparks(ex, ey, ez, -dx, -dy, -dz, 26, 1, 0.86, 0.6, 7);
        fx.dust(ex, ey, ez, 0, -1, 0, 5, 0.75, 0.22);
        fx.light(ex, ey, ez, 1.5, 1.2, 0.8, 7, 0.12);
        audio.play('lampBreak', { x: ex, y: ey, z: ez, gain: 1.3 });
        enemies.noise(ex, ez, ARMS.lamp.noise);
      } else if (struck) {
        ex = ox + dx * struck.t;
        ey = oy + dy * struck.t;
        ez = oz + dz * struck.t;
        const amount = gun.pellets > 1 ? pelletDamage(struck.t) : gun.damage * (struck.zone === 'head' ? gun.head : 1);
        // (how much the place it struck counts is the machine's to say — unless the wild build has plated it)
        const by = hooks.plate?.(struck) ?? struck.multiplier;
        const killed = enemies.damage(struck.unit, amount * by, player.x, player.z);
        fx.impact(ex, ey, ez, -dx, -dy, -dz, 'machine');
        audio.play('hitMachine', { x: ex, y: ey, z: ez });
        if (!landed) landed = { unit: struck.unit, zone: struck.zone, killed };
        else {
          if (killed) Object.assign(landed, { unit: struck.unit, killed: true });
          if (struck.zone === 'head' && landed.unit === struck.unit) landed.zone = 'head';
        }
      } else if (wall) {
        fx.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.what);
        audio.play(isMetal(hit.what) ? 'hitMetal' : 'hitWall', {
          x: hit.x,
          y: hit.y,
          z: hit.z,
          gain: 0.6,
        });
        // a round landing near a guard gets its attention
        if (p === 0) enemies.noise(hit.x, hit.z, 5);
      }
      // every other pellet draws its line: eight would be a white fan
      if (p % 2 === 0) fx.tracer(mx, my, mz, ex, ey, ez, 'player');
    }
    if (landed) {
      w.hits++;
      hooks.hit?.(landed);
    }

    fx.muzzle(mx, my, mz, ax, ay, az, feel.muzzle);
    audio.play(feel.sound);
    enemies.noise(player.x, player.z, gun.noise);

    w.kick = Math.min(1.3, w.kick + feel.kick);
    // one round at a time opens the cone half as much as a burst does
    const careful = gun.key === 'carbine' && arms.mode === 'semi' ? 0.5 : 1;
    w.bloom = Math.min(0.03, w.bloom + feel.bloom * careful);
    w.flash = feel.flash;
    w.sinceShot = 0;
    w.pumped = !gun.shells;
    player.pitch = clamp(player.pitch + lerp(feel.climb[0], feel.climb[1], w.aim), -1.45, 1.45);
    player.yaw += rnd(-1, 1) * lerp(feel.drift[0], feel.drift[1], w.aim);
  }

  // ---------- the EMP grenade ----------
  /** The throw: the pin, the arm coming up, and — a quarter of a second in — the canister leaving the hand. */
  function stepLob(dt, player) {
    const lob = w.lob;
    lob.t += dt;
    if (!lob.released && lob.t >= WEAPON.windUp) {
      lob.released = true;
      if (player.alive && arms.grenades > 0) {
        arms.grenades--;
        const [fxn, fyn, fzn, rx, rz] = eyeAxes(player);
        const body = grenadeBody();
        const speed = ARMS.grenades.speed;
        const hx = player.headX ?? player.x;
        const hz = player.headZ ?? player.z;
        // it leaves from the left hand, out in front — unless that is inside a wall you are standing against:
        // then from where the head is, which never is
        let x = hx + fxn * 0.45 - rx * 0.18;
        const y = player.eye - 0.12 + fyn * 0.45;
        let z = hz + fzn * 0.45 - rz * 0.18;
        if (world.grid.solidAt(Math.floor(x), Math.floor(z), y - 0.06, y + 0.06)) {
          x = hx;
          z = hz;
        }
        Object.assign(body, {
          live: true,
          x,
          y,
          z,
          // thrown along the eye's line, and a little up: an arm is not a gun
          vx: fxn * speed + (player.vx || 0),
          vy: fyn * speed + 2.6,
          vz: fzn * speed + (player.vz || 0),
          fuse: ARMS.grenades.fuse,
        });
        body.root.visible = true;
        audio.play('grenadeThrow', { gain: 1.4 });
      }
    }
    if (lob.t >= WEAPON.windUp + WEAPON.followThrough) w.lob = null;
  }

  /** Every grenade in the air: it falls, it bounces off what is solid, and when its time is up it goes off. */
  function stepThrown(dt) {
    const grid = world.grid;
    const R = 0.06;
    for (const g of thrown) {
      if (!g.live) continue;
      g.fuse -= dt;
      // short steps: it must not pass through a wall one cell thick in one of them
      let left = dt;
      while (left > 1e-6) {
        const h = Math.min(left, 0.02);
        left -= h;
        g.vy -= 12 * h;
        let knock = 0;
        const nx = g.x + g.vx * h;
        if (grid.solidAt(Math.floor(nx), Math.floor(g.z), g.y - R, g.y + R)) {
          knock = Math.abs(g.vx);
          g.vx = -g.vx * 0.35;
        } else g.x = nx;
        const nz = g.z + g.vz * h;
        if (grid.solidAt(Math.floor(g.x), Math.floor(nz), g.y - R, g.y + R)) {
          knock = Math.max(knock, Math.abs(g.vz));
          g.vz = -g.vz * 0.35;
        } else g.z = nz;
        const ny = g.y + g.vy * h;
        if (ny < R || grid.solidAt(Math.floor(g.x), Math.floor(g.z), ny - R, ny + R)) {
          knock = Math.max(knock, Math.abs(g.vy));
          g.vy = -g.vy * 0.35;
          // what it lands on takes the run out of it
          g.vx *= 0.72;
          g.vz *= 0.72;
          if (ny < R) g.y = R;
        } else g.y = ny;
        if (knock > 1.5) audio.play('grenadeBounce', { x: g.x, y: g.y, z: g.z, gain: clamp(knock / 6, 0.4, 1.4) });
      }
      g.root.position.set(g.x, g.y, g.z);
      g.root.rotation.x += dt * 9;
      g.root.rotation.z += dt * 5;
      world.probe(g.x, g.z, tint);
      setProbe(g.mats, tint.multiplyScalar(1.2));
      if (g.fuse <= 0) burst(g);
    }
  }

  /** It goes off: nothing is broken, and every machine near enough stops where it stands for a few seconds. */
  function burst(g) {
    const E = ARMS.grenades;
    g.live = false;
    g.root.visible = false;
    const stopped = enemies.stun(g.x, g.y, g.z, E.radius, E.stun, E.close);
    fx.puff('ring', g.x, Math.max(g.y, 0.3), g.z, 0, 0, 0, 0.45, 1, E.radius * 2, 0.5, 0.9, 1, 0.7);
    fx.puff('add', g.x, g.y, g.z, 0, 0, 0, 0.2, 1, 7, 0.6, 0.9, 1, 1);
    fx.sparks(g.x, g.y, g.z, 0, 1, 0, 34, 0.55, 0.85, 1, 10);
    fx.light(g.x, g.y + 0.6, g.z, 0.5, 1.0, 1.6, 16, 0.45);
    audio.play('empBurst', { x: g.x, y: g.y, z: g.z, gain: 1.4 });
    enemies.noise(g.x, g.z, E.noise);
    // …and the lamps of the room it went off in are out for a while (main.js: "lamps that go out")
    const dark = hooks.emp?.(g.x, g.z) ?? 0;
    const lights = dark ? ' · LIGHTS OUT' : '';
    if (stopped) hooks.note?.(`EMP — ${stopped} STOPPED${lights}`);
    else if (dark) hooks.note?.('EMP — LIGHTS OUT');
    else hooks.note?.('EMP — NOTHING IN REACH', 'warn');
  }

  /**
   * The moment the knife lands. A sentry that could be shut down by hand (close, unaware, its back to you) is
   * shut down — silently, as it always could be. Anything else within reach along the line of the eye is cut.
   */
  function strike(player) {
    const K = ARMS.knife;
    const victim = enemies.takedownTarget(player);
    if (victim) {
      enemies.takedown(victim);
      fx.shake(0.12);
      hooks.hit?.({ unit: victim, zone: 'body', killed: true });
      hooks.knife?.({ unit: victim, killed: true, takedown: true });
      return;
    }
    const cp = Math.cos(player.pitch);
    const dx = -Math.sin(player.yaw) * cp;
    const dy = Math.sin(player.pitch);
    const dz = -Math.cos(player.yaw) * cp;
    const ox = player.headX ?? player.x;
    const oy = player.eye;
    const oz = player.headZ ?? player.z;
    const wall = world.grid.raycast(ox, oy, oz, dx, dy, dz, K.reach, hit);
    const reach = wall ? Math.min(hit.t + 0.05, K.reach) : K.reach;
    const struck = enemies.raycast(ox, oy, oz, dx, dy, dz, reach, K.grow * assist, enemies.held);
    if (struck) {
      const x = ox + dx * struck.t;
      const y = oy + dy * struck.t;
      const z = oz + dz * struck.t;
      const killed = enemies.damage(struck.unit, K.damage * struck.multiplier, player.x, player.z);
      fx.impact(x, y, z, -dx, -dy, -dz, 'machine');
      fx.shake(0.1);
      audio.play('knifeHit', { x, y, z, gain: 1.3 });
      // steel on steel is heard, but not far
      enemies.noise(player.x, player.z, K.noise);
      hooks.hit?.({ unit: struck.unit, zone: struck.zone, killed });
      hooks.knife?.({ unit: struck.unit, killed, takedown: false });
    } else if (wall) {
      fx.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.what);
      audio.play(isMetal(hit.what) ? 'hitMetal' : 'hitWall', {
        x: hit.x,
        y: hit.y,
        z: hit.z,
        gain: 0.35,
      });
    }
  }

  // Where the knife hand is, in the eye's own space: out of the picture; low on the left when the knife is all
  // there is; and at the end of the thrust, where the point comes up to the middle of the picture. The blade is
  // kept tipped up and turned in at the blow — pointed straight away from the eye it would be a dot.
  const KNIFE_REST = { x: -0.24, y: -0.22, z: -0.5, rx: 0.35, ry: -0.35, rz: 0.15 };
  const KNIFE_AWAY = { x: -0.3, y: -0.55, z: -0.3, rx: 0.9, ry: -0.5, rz: 0.3 };
  const KNIFE_BLOW = { x: -0.04, y: -0.15, z: -0.6, rx: 0.42, ry: -0.32, rz: -0.25 };
  // the grenade hand, which is built like the knife's and sits where the knife's does: away below the picture,
  // drawn back low on the left, and out in front at the end of the throw
  const LOB_AWAY = KNIFE_AWAY;
  const LOB_BACK = { x: -0.27, y: -0.2, z: -0.46, rx: 0.55, ry: -0.4, rz: 0.2 };
  const LOB_OUT = { x: -0.07, y: -0.1, z: -0.66, rx: 0.18, ry: -0.25, rz: -0.2 };
  // for the tools that take pictures of it: the three poses, and a way to hold the knife still at a chosen point
  w.knifePoses = { rest: KNIFE_REST, away: KNIFE_AWAY, blow: KNIFE_BLOW };
  /** @type {{ blow: number, rest: number } | null} */
  w.frozen = null;

  function pose(dt, intent, player, knifing, out) {
    const v = views[arms.current];
    const gun = v.gun;
    const spec = gunOf(arms);
    const k = smooth(w.aim);
    w.kick = damp(w.kick, 0, 15, dt);
    // out of the way: for a takedown or a charge, when down, while the knife is swung or a grenade thrown, while
    // one gun goes down for another to come up, and for good once every round is gone
    const changing = w.swap !== null && !w.swap.done;
    w.lower = damp(
      w.lower,
      w.lowerT > 0 || !player.alive || knifing || out || w.frozen || changing || w.lob ? 1 : 0,
      changing || (w.swap && w.swap.done) ? 16 : 10,
      dt,
    );
    w.knifeOut = damp(w.knifeOut, out && player.alive ? 1 : 0, 6, dt);
    w.hold = damp(w.hold, player.holding ? 1 : 0, 8, dt);
    const lean = player.leanK || 0;
    w.run = damp(w.run, player.running ? 1 : 0, 8, dt);
    w.swayX = damp(w.swayX, clamp(intent.lookX * 1.4, -0.05, 0.05), 9, dt);
    w.swayY = damp(w.swayY, clamp(intent.lookY * 1.4, -0.05, 0.05), 9, dt);
    const stride = clamp(player.speed / 4.3, 0, 1.5) * (1 - k * 0.85);

    // ---------- a reload (src/reload.js) ----------
    // What it is doing to the gun, the support hand, the magazine and the bolt just now — or, for the tools that
    // take pictures of it, at the moment they name. And what is LEFT of one that stopped where it stood (a change
    // of gun, the knife, a grenade, the shotgun's trigger or its last shell): that is let go of over a few tenths
    // of a second, so that nothing snaps back — and a reload begun again meanwhile is simply added to it.
    const held = w.reloadHold;
    const reloading = !!held || w.reloadT > 0;
    if (reloading) {
      reloadPose(arms.current, held ? held.t : 1 - w.reloadT / w.reloadLen, held || w.reloadHow, doing);
      wasReloading = true;
    } else if (wasReloading) {
      wasReloading = false;
      for (const part of RELOAD_PARTS) {
        for (let n = 0; n < 6; n++) left[part][n] += doing[part][n];
        doing[part].fill(0);
      }
      doing.bolt = 0;
      doing.shown = false;
    }
    const fade = Math.exp(-RELOAD_EASE * dt);
    for (const part of RELOAD_PARTS) for (let n = 0; n < 6; n++) left[part][n] *= fade;
    const moved = (part, n) => doing[part][n] + left[part][n];
    // A magazine gun that has fired its last round holds its bolt — its slide — open, and a reload from empty
    // keeps it so until the moment it is let go. The pump: back and forward again, a moment after the shot.
    let bolt = Math.max(doing.bolt, !spec.shells && !reloading && arms.guns[arms.current].mag <= 0 ? 1 : 0);
    if (spec.shells) bolt = Math.max(bolt, Math.max(0, 1 - Math.abs(w.sinceShot - 0.42) / 0.16));

    const root = gun.root;
    root.position.set(
      lerp(v.hip.x, v.aimed.x, k) +
        w.swayX * 0.4 +
        Math.sin(player.bob) * 0.011 * stride -
        w.run * 0.07 +
        w.hold * 0.045 +
        lean * 0.02 * (1 - k) +
        moved('gun', 0) * (camera.aspect < 1 ? RELOAD_SLIM : 1),
      lerp(v.hip.y, v.aimed.y, k) +
        w.swayY * 0.3 -
        Math.abs(Math.cos(player.bob)) * 0.012 * stride +
        moved('gun', 1) -
        w.lower * 0.3 -
        w.run * 0.05 -
        w.hold * 0.02,
      lerp(v.hip.z, v.aimed.z, k) + w.kick * lerp(0.05, 0.028, k) + moved('gun', 2),
    );
    root.rotation.set(
      w.kick * lerp(0.06, 0.02, k) + w.swayY * 0.6 + moved('gun', 3) - w.lower * 0.9 - w.run * 0.25,
      (1 - k) * v.feel.turn + w.swayX * 0.8 + moved('gun', 4) + w.run * 0.55 - w.hold * 0.1,
      // the gun tips over with the head when leaning, a little less than the view does
      moved('gun', 5) - w.swayX * 0.5 + Math.sin(player.bob) * 0.012 * stride - lean * 0.09 + w.hold * 0.12,
    );
    const arm = gun.parts.armL;
    if (arm) {
      // with a machine in the other hand, that hand is not on the gun
      arm.visible = w.hold < 0.5;
      // a reload carries it, turned about its own palm
      turned.setFromEuler(turns.set(moved('hand', 3), moved('hand', 4), moved('hand', 5)));
      pivot.copy(v.palm).applyQuaternion(turned);
      arm.position.set(
        v.armHome.x + v.palm.x - pivot.x + moved('hand', 0),
        v.armHome.y + v.palm.y - pivot.y + moved('hand', 1),
        v.armHome.z + v.palm.z - pivot.z + moved('hand', 2),
      );
      arm.quaternion.copy(turned).multiply(v.armTurn);
    }
    if (v.magHome) {
      gun.parts.mag.position.set(
        v.magHome.x + moved('mag', 0),
        v.magHome.y + moved('mag', 1),
        v.magHome.z + moved('mag', 2),
      );
      gun.parts.mag.rotation.set(moved('mag', 3), moved('mag', 4), moved('mag', 5));
    }
    if (v.shellHome) {
      // the shell that is going in: in the hand, then into the tube — and not to be seen otherwise
      const shell = gun.parts.shell;
      const { at, turn } = v.shellHome;
      shell.visible = doing.shown;
      shell.position.set(at.x + doing.mag[0], at.y + doing.mag[1], at.z + doing.mag[2]);
      shell.rotation.set(turn.x + doing.mag[3], turn.y + doing.mag[4], turn.z + doing.mag[5]);
    }
    // a bolt and a slide are thrown back by the shot; a pump only by the hand
    const recoil = spec.shells ? 0 : w.kick * 0.5;
    if (v.boltHome) gun.parts.bolt.position.z = v.boltHome.z + Math.min(1, bolt + recoil) * v.feel.bolt;
    camera.zoom = 1 + k * 0.25;
    camera.updateProjectionMatrix();

    // the knife: away below the picture; in the hand when it is all there is; across the picture when swung —
    // out to the blow in the first quarter of the swing, back in the rest of it
    const u = knife.progress;
    let blow = knifing ? (u < 0.28 ? smooth(u / 0.28) : 1 - smooth(clamp((u - 0.4) / 0.6, 0, 1))) : 0;
    let rest = w.knifeOut;
    if (w.frozen) ({ blow, rest } = w.frozen);
    const from = (key) => lerp(KNIFE_AWAY[key], KNIFE_REST[key], rest);
    const at = (key) => lerp(from(key), KNIFE_BLOW[key], blow);
    blade.root.visible = knifing || rest > 0.02 || !!w.frozen;
    if (blade.root.visible) {
      blade.root.position.set(
        at('x') + w.swayX * 0.3,
        at('y') + w.swayY * 0.2 - Math.abs(Math.cos(player.bob)) * 0.01 * stride - (player.alive ? 0 : 0.4),
        at('z'),
      );
      blade.root.rotation.set(at('rx'), at('ry'), at('rz') - lean * 0.09);
    }

    // the grenade hand: up and back while the arm is drawn, out as it lets go, and away
    if (fist) {
      const lob = w.lob;
      fist.root.visible = !!lob;
      if (lob) {
        const back = smooth(clamp(lob.t / (WEAPON.windUp * 0.7), 0, 1));
        const outK = smooth(clamp((lob.t - WEAPON.windUp * 0.7) / (WEAPON.windUp * 0.5), 0, 1));
        const gone = smooth(clamp((lob.t - WEAPON.windUp - 0.05) / (WEAPON.followThrough - 0.05), 0, 1));
        const place = (key) =>
          lerp(lerp(lerp(LOB_AWAY[key], LOB_BACK[key], back), LOB_OUT[key], outK), LOB_AWAY[key], gone);
        fist.root.position.set(place('x'), place('y'), place('z'));
        fist.root.rotation.set(place('rx'), place('ry'), place('rz'));
        // once it has left the hand, the hand is empty
        if (fist.parts.band) fist.parts.band.visible = !lob.released;
      }
    }

    // lit by where you stand — but less coloured by it than the world is, never quite black, and for a blink
    // by its own flash
    world.probe(player.x, player.z, tint, arrow);
    const grey = (tint.r * 0.3 + tint.g * 0.59 + tint.b * 0.11) * 0.5;
    const f = w.flash * 0.6;
    tint.setRGB(
      Math.max(tint.r * 0.5 + grey, 0.06) * 1.15 + f,
      Math.max(tint.g * 0.5 + grey, 0.07) * 1.15 + f * 0.8,
      Math.max(tint.b * 0.5 + grey, 0.09) * 1.15 + f * 0.5,
    );
    // The second look. A key light is worked out pixel by pixel from where a surface is in the world, and what is
    // in the hands is not in the world: what of it reaches the eye — a sight line to the lamp, as a round flies —
    // is added to this light instead, and the arrow turned towards the lamp by as much as it adds.
    let mirror = 0;
    if (w.look) {
      w.look.key(player.x, player.eye, player.z, keyNow);
      const ease = 1 - Math.exp(-dt * 9);
      const held = w.keyHeld;
      for (const part of KEY_PARTS) held[part] += (keyNow[part] - held[part]) * ease;
      const added = (held.r * 0.3 + held.g * 0.59 + held.b * 0.11) * KEY_ON_HANDS;
      if (added > 1e-4) {
        const before = tint.r * 0.3 + tint.g * 0.59 + tint.b * 0.11;
        arrow.multiplyScalar(before);
        arrow.x += held.x * KEY_ON_HANDS;
        arrow.y += held.y * KEY_ON_HANDS;
        arrow.z += held.z * KEY_ON_HANDS;
        arrow.multiplyScalar(1 / (before + added));
        tint.r += held.r * KEY_ON_HANDS;
        tint.g += held.g * KEY_ON_HANDS;
        tint.b += held.b * KEY_ON_HANDS;
      }
      mirror = w.look.mirror(player.headX, player.headZ);
    }
    // What is in the hands is drawn in a space of its own, in which the eye sits at the middle looking down −Z.
    // The light's arrow is the world's: turn it into that space. What the gun reflects is turned the other way,
    // back out.
    view.set(player.pitch, player.yaw, 0, 'YXZ');
    turn.setFromEuler(view);
    envTurn.setFromMatrix4(turnMatrix.makeRotationFromQuaternion(turn));
    // never lit from nowhere: in the dark the arrow is short, and the gun would be a flat shape
    if (arrow.lengthSq() < 0.09) arrow.set(0.25, 0.5, 0.2);
    arrow.applyQuaternion(turn.invert());
    for (const mats of [v.mats, bladeMats, fistMats]) {
      if (!mats) continue;
      setProbe(mats, tint, arrow);
      setEnvRotation(mats, envTurn);
      if (w.look) setInHand(mats, mirror, player.headX, player.eye, player.headZ);
    }
  }

  return w;
}

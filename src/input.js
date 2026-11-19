// Everything the player does with their hands — keys, mouse, fingers — turned into one small object, `intent`,
// that the rest of the game reads each frame. Nothing else in the game knows what a key or a touch is.
//
// Touch follows the table in docs/DESIGN.md §7 ("What each finger becomes"): raw touch events, one role per finger,
// and the trigger is pulled while ANY of left FIRE, right FIRE or a double-tap press is held.

const MOUSE_SPEED = 0.0022;
const TOUCH_SPEED = 0.0056;
const STICK_RADIUS = 56;
/** the left part of the view that makes a new finger the walking stick */
const STICK_ZONE = 0.45;
const TAP_MAX_MS = 300;
const TAP_MAX_TRAVEL = 20;
const DOUBLE_TAP_GAP_MS = 350;
const DOUBLE_TAP_REACH = 80;
/** how far a thumb must slide off a FIRE button before it also walks or aims */
const SLIDE_DEAD = 12;
/** a right-button press shorter than this is a click: it leaves the sight up instead of lowering it on release */
const AIM_CLICK_MS = 250;

const BUTTONS = [
  ['fireL', 'FIRE', 'fire fire-l'],
  ['fireR', 'FIRE', 'fire fire-r'],
  ['aim', 'AIM', 'aim'],
  ['jump', 'JUMP', 'jump'],
  ['reload', 'RELOAD', 'reload'],
  ['crouch', 'CROUCH', 'crouch'],
  ['use', 'USE', 'use'],
  ['grab', 'SHIELD', 'grab'],
  ['swap', 'CARBINE', 'swap'],
  ['emp', 'EMP', 'emp'],
  ['nv', 'NV', 'nv'],
  ['pause', '', 'pause'],
];
/** SWAP held this long works the carbine's selector instead of changing guns */
const SWAP_HOLD_MS = 380;
/** how far the wheel must turn to change guns, and how soon it may do so again (a trackpad sends a flood) */
const WHEEL_STEP = 50;
const WHEEL_GAP_MS = 280;

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {HTMLElement} o.layer      where the touch controls are built (#ui)
 * @param {object} o.settings
 * @param {boolean} o.touch          build and use the touch controls
 * @param {object} o.on              pause() — the player asked to pause, or the game lost the mouse or the screen
 *                                   map() — the player asked for the big map
 */
export function createInput({ canvas, layer, settings, touch, on }) {
  const intent = {
    /** -1 … 1: right is +X, forward is +Y */
    moveX: 0,
    moveY: 0,
    /** radians to turn this frame: + turns right / looks down, before the player's own inversion */
    lookX: 0,
    lookY: 0,
    run: false,
    fire: false,
    aim: false,
    /** held */
    use: false,
    /** −1 leaning left … 1 leaning right (held) */
    lean: 0,
    /** the sight is being kept up by a click, a key or the AIM button rather than by a held button */
    aimLatched: false,
    // true for the one frame they were asked for
    usePressed: false,
    grabPressed: false,
    melee: false,
    jump: false,
    reload: false,
    crouchToggle: false,
    nv: false,
    map: false,
    /** a gun was asked for by its number this frame: 1 … 3, else 0 */
    select: 0,
    /** the next gun (+1) or the one before (−1) was asked for this frame, else 0 */
    cycle: 0,
    /** the carbine's selector was worked this frame */
    mode: false,
    /** a grenade was thrown this frame */
    throw: false,
    /**
     * Every key that is down (by its code: 'KeyH', 'Space', …), and every key that went down since the last
     * frame — for whoever has a use for a key this file gives no name to (the experiment, src/wild).
     */
    down: null,
    hits: new Set(),
  };

  let active = false;
  const keys = new Set();
  intent.down = keys;
  /** the keys that have gone down since the last frame: handed over, emptied, a frame at a time */
  const struck = new Set();
  const edges = {
    reload: false,
    crouch: false,
    nv: false,
    map: false,
    use: false,
    jump: false,
    melee: false,
    grab: false,
    select: 0,
    cycle: 0,
    mode: false,
    throw: false,
  };
  let wheelSum = 0;
  let wheelAt = -1e9;
  /** when a finger went down on SWAP, or 0: a tap changes guns, a hold works the selector */
  let swapAt = 0;
  let mouseDX = 0;
  let mouseDY = 0;
  let mouseFire = false;
  /** one frame of trigger owed to a press, however quickly it was let go (a tap on a trackpad) */
  let firePulse = false;
  let mouseAim = false;
  /**
   * The sight kept up without holding anything: set by a quick right click, the Z key or the touch AIM button,
   * cleared by the same, by Shift (you cannot run with it up), by a reload and by anything that stops play.
   */
  let aimLatch = false;
  let aimDownAt = 0;
  let aimWasLatched = false;
  let locked = false;
  /** the mouse has been captured at least once on this page, so we know it can be */
  let everLocked = false;

  // ---------- touch state ----------
  const stick = { id: null, ax: 0, ay: 0, x: 0, y: 0, run: false };
  const look = { id: null, x: 0, y: 0, startX: 0, startY: 0, startT: 0, travel: 0, firing: false };
  const lastTap = { t: -1e9, x: 0, y: 0 };
  const triggers = {
    fireL: { id: null, sx: 0, sy: 0, x: 0, y: 0, walkX: 0, walkY: 0, run: false },
    fireR: { id: null, sx: 0, sy: 0, x: 0, y: 0 },
  };
  let touchDX = 0;
  let touchDY = 0;
  let touchUse = false;

  // ---------- keys and mouse ----------
  const GAME_KEYS = new Set([
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ShiftLeft',
    'ShiftRight',
    'Space',
    'Tab',
    'KeyR',
    'KeyC',
    'KeyQ',
    'KeyE',
    'KeyF',
    'KeyG',
    'KeyV',
    'KeyZ',
    'KeyX',
    'KeyN',
    'KeyM',
    'KeyB',
    'KeyT',
    'Digit1',
    'Digit2',
    'Digit3',
  ]);
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    struck.add(e.code);
    if (e.code === 'KeyR') edges.reload = true;
    else if (e.code === 'Space') edges.jump = true;
    else if (e.code === 'KeyC' || e.code === 'ControlLeft') edges.crouch = true;
    else if (e.code === 'KeyN') edges.nv = true;
    else if (e.code === 'Tab' || e.code === 'KeyM') edges.map = true;
    else if (e.code === 'KeyF') edges.use = true;
    else if (e.code === 'KeyG') edges.grab = true;
    else if (e.code === 'KeyV') edges.melee = true;
    else if (e.code === 'KeyB') edges.mode = true;
    else if (e.code === 'KeyT') edges.throw = true;
    else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') edges.select = +e.code.slice(5);
    else if (e.code === 'KeyZ') aimLatch = !aimLatch;
    else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') aimLatch = false;
    // While the mouse is captured the browser keeps Escape for itself (it frees the mouse, and losing the mouse
    // pauses the game). Without capture the key arrives here. Either way the pause waits for this event to finish,
    // so that the menu it opens does not see the same key press and close again.
    else if (e.code === 'KeyP' || (e.code === 'Escape' && !locked)) setTimeout(() => active && on.pause?.(), 0);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  canvas.addEventListener('mousedown', (e) => {
    if (!active || touch) return;
    if (!locked) {
      requestLock();
      // where the mouse can be captured, the click that takes it back must not also fire a round
      if (everLocked) return;
    }
    if (e.button === 0) {
      mouseFire = true;
      firePulse = true;
    } else if (e.button === 2) {
      // Held, the right button aims for as long as it is down. Clicked, it leaves the sight up — so that a hand
      // on a trackpad, which cannot hold one button and press the other, is free to fire — and the next press
      // takes it down again.
      mouseAim = true;
      aimDownAt = e.timeStamp;
      aimWasLatched = aimLatch;
      aimLatch = false;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseFire = false;
    else if (e.button === 2) {
      if (mouseAim && !aimWasLatched && e.timeStamp - aimDownAt <= AIM_CLICK_MS) aimLatch = true;
      mouseAim = false;
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!active || !locked) return;
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // the wheel changes guns: one notch, one gun. A trackpad sends a flood of small turns for one stroke of two
  // fingers; they are added up, and a second change has to wait a moment.
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!active || touch) return;
      e.preventDefault();
      if (e.timeStamp - wheelAt < WHEEL_GAP_MS) {
        wheelSum = 0;
        return;
      }
      wheelSum += e.deltaY;
      if (Math.abs(wheelSum) < WHEEL_STEP) return;
      edges.cycle = wheelSum > 0 ? 1 : -1;
      wheelSum = 0;
      wheelAt = e.timeStamp;
    },
    { passive: false },
  );

  function requestLock() {
    if (touch || !canvas.requestPointerLock) return;
    try {
      const asked = canvas.requestPointerLock({ unadjustedMovement: true });
      // older browsers refuse the option rather than ignore it: ask again without
      asked?.catch?.(() => canvas.requestPointerLock()?.catch?.(() => {}));
    } catch {
      // no mouse capture here: the game still runs, the mouse just does not turn the view
    }
  }
  document.addEventListener('pointerlockchange', () => {
    const now = document.pointerLockElement === canvas;
    const lost = locked && !now;
    locked = now;
    if (now) everLocked = true;
    if (lost && active) on.pause?.();
  });
  window.addEventListener('blur', () => {
    release();
    if (active) on.pause?.();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    release();
    if (active) on.pause?.();
  });

  /** Lets go of everything that is held. */
  function release() {
    keys.clear();
    mouseFire = false;
    firePulse = false;
    mouseAim = false;
    mouseDX = 0;
    mouseDY = 0;
    touchDX = 0;
    touchDY = 0;
    stick.id = null;
    stick.x = 0;
    stick.y = 0;
    stick.run = false;
    look.id = null;
    look.firing = false;
    for (const t of Object.values(triggers)) {
      t.id = null;
      t.walkX = 0;
      t.walkY = 0;
      t.run = false;
    }
    touchUse = false;
    swapAt = 0;
    wheelSum = 0;
    for (const key in edges) edges[key] = false;
    if (ui) {
      ui.stick.hidden = true;
      syncFire();
    }
  }

  // ---------- touch controls ----------
  let ui = null;
  if (touch) {
    const root = document.createElement('div');
    root.id = 'touch';
    root.hidden = true;
    const buttons = {};
    for (const [name, label, cls] of BUTTONS) {
      const b = document.createElement('div');
      b.className = `tb ${cls}`;
      b.dataset.btn = name;
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', name === 'pause' ? 'Pause' : label);
      b.innerHTML =
        name === 'pause'
          ? '<i></i><i></i>'
          : name === 'use'
            ? '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18"/></svg><b>USE</b>'
            : `<b>${label}</b>`;
      root.appendChild(b);
      buttons[name] = b;
    }
    buttons.use.hidden = true;
    buttons.grab.hidden = true;
    const stickEl = document.createElement('div');
    stickEl.className = 'stick';
    stickEl.hidden = true;
    stickEl.innerHTML = '<i></i>';
    root.appendChild(stickEl);
    layer.appendChild(root);
    ui = { root, buttons, stick: stickEl, knob: stickEl.firstChild };

    const applySide = () => {
      root.dataset.fire = settings.get('fireButton');
    };
    applySide();
    settings.onChange((key) => key === 'fireButton' && applySide());

    const find = (list, id) => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
      return null;
    };

    // --- the view: stick on the left, look (and double-tap fire) everywhere else
    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (!active) return;
        e.preventDefault();
        const box = canvas.getBoundingClientRect();
        for (const t of e.changedTouches) {
          if (stick.id === null && t.clientX - box.left < box.width * STICK_ZONE) {
            stick.id = t.identifier;
            stick.ax = t.clientX;
            stick.ay = t.clientY;
            stick.x = 0;
            stick.y = 0;
            stick.run = false;
            stickEl.hidden = false;
            stickEl.style.left = `${t.clientX}px`;
            stickEl.style.top = `${t.clientY}px`;
            ui.knob.style.transform = 'translate(-50%, -50%)';
          } else if (look.id === null) {
            const now = performance.now();
            look.id = t.identifier;
            look.x = look.startX = t.clientX;
            look.y = look.startY = t.clientY;
            look.startT = now;
            look.travel = 0;
            look.firing =
              settings.get('tapFire') &&
              now - lastTap.t <= DOUBLE_TAP_GAP_MS &&
              Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) <= DOUBLE_TAP_REACH;
            // a tap is used up by the press that follows it
            if (look.firing) lastTap.t = -1e9;
            syncFire();
          }
        }
      },
      { passive: false },
    );
    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (!active) return;
        e.preventDefault();
        for (const t of e.changedTouches) {
          if (t.identifier === stick.id) {
            let dx = (t.clientX - stick.ax) / STICK_RADIUS;
            let dy = (t.clientY - stick.ay) / STICK_RADIUS;
            const len = Math.hypot(dx, dy);
            stick.run = len > 1.25 && dy < -0.6;
            if (len > 1) {
              dx /= len;
              dy /= len;
            }
            stick.x = dx;
            stick.y = -dy;
            ui.knob.style.transform = `translate(calc(-50% + ${dx * STICK_RADIUS}px), calc(-50% + ${dy * STICK_RADIUS}px))`;
          } else if (t.identifier === look.id) {
            touchDX += t.clientX - look.x;
            touchDY += t.clientY - look.y;
            look.travel = Math.max(look.travel, Math.hypot(t.clientX - look.startX, t.clientY - look.startY));
            look.x = t.clientX;
            look.y = t.clientY;
          }
        }
      },
      { passive: false },
    );
    const viewEnd = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === stick.id) {
          stick.id = null;
          stick.x = 0;
          stick.y = 0;
          stick.run = false;
          stickEl.hidden = true;
        } else if (t.identifier === look.id) {
          const wasFiring = look.firing;
          look.id = null;
          look.firing = false;
          // only a real, clean lift of an aiming finger counts as a tap
          if (
            e.type === 'touchend' &&
            !wasFiring &&
            performance.now() - look.startT <= TAP_MAX_MS &&
            look.travel <= TAP_MAX_TRAVEL
          ) {
            lastTap.t = performance.now();
            lastTap.x = t.clientX;
            lastTap.y = t.clientY;
          }
          syncFire();
        }
      }
    };
    canvas.addEventListener('touchend', viewEnd, { passive: false });
    canvas.addEventListener('touchcancel', viewEnd, { passive: false });

    // --- the two triggers: hold to fire, slide to walk (left) or aim (right)
    for (const name of ['fireL', 'fireR']) {
      const trig = triggers[name];
      const el = buttons[name];
      el.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          if (!active || trig.id !== null) return;
          const t = e.changedTouches[0];
          trig.id = t.identifier;
          trig.sx = trig.x = t.clientX;
          trig.sy = trig.y = t.clientY;
          syncFire();
        },
        { passive: false },
      );
      el.addEventListener(
        'touchmove',
        (e) => {
          e.preventDefault();
          const t = find(e.changedTouches, trig.id);
          if (!t) return;
          if (name === 'fireR') {
            touchDX += t.clientX - trig.x;
            touchDY += t.clientY - trig.y;
          } else {
            const ox = t.clientX - trig.sx;
            const oy = t.clientY - trig.sy;
            const len = Math.hypot(ox, oy);
            if (len <= SLIDE_DEAD) {
              trig.walkX = 0;
              trig.walkY = 0;
              trig.run = false;
            } else {
              const k = Math.min(1, (len - SLIDE_DEAD) / STICK_RADIUS) / len;
              trig.walkX = ox * k;
              trig.walkY = -oy * k;
              trig.run = len - SLIDE_DEAD > STICK_RADIUS * 1.25 && oy < 0;
            }
          }
          trig.x = t.clientX;
          trig.y = t.clientY;
        },
        { passive: false },
      );
      const end = (e) => {
        e.preventDefault();
        if (!find(e.changedTouches, trig.id)) return;
        trig.id = null;
        trig.walkX = 0;
        trig.walkY = 0;
        trig.run = false;
        syncFire();
      };
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
    }

    // --- everything else is a press
    const press = (name, down, up) => {
      const el = buttons[name];
      let last = 0;
      const start = (e) => {
        e.preventDefault();
        // a touch is followed by a made-up mouse press: let only one of the pair through
        if (e.timeStamp - last < 400 && e.type === 'mousedown') return;
        last = e.timeStamp;
        if (active || name === 'pause') down();
      };
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('mousedown', start);
      if (up) {
        const stop = (e) => {
          e.preventDefault();
          up();
        };
        el.addEventListener('touchend', stop, { passive: false });
        el.addEventListener('touchcancel', stop, { passive: false });
        el.addEventListener('mouseup', stop);
        el.addEventListener('mouseleave', stop);
      }
    };
    press('aim', () => {
      aimLatch = !aimLatch;
    });
    press('grab', () => {
      edges.grab = true;
    });
    press('jump', () => {
      edges.jump = true;
    });
    press('reload', () => {
      edges.reload = true;
    });
    press('crouch', () => {
      edges.crouch = true;
    });
    press('nv', () => {
      edges.nv = true;
    });
    press('emp', () => {
      edges.throw = true;
    });
    // SWAP: a tap takes the next gun in hand; held, it works the carbine's selector (frame() sees the hold)
    press(
      'swap',
      () => {
        swapAt = performance.now();
      },
      () => {
        if (swapAt > 0 && active) edges.cycle = 1;
        swapAt = 0;
      },
    );
    press('pause', () => on.pause?.());
    press(
      'use',
      () => {
        touchUse = true;
        edges.use = true;
      },
      () => {
        touchUse = false;
      },
    );

    // the page must never zoom or scroll under the game
    for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
      document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
    root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  function touchFire() {
    return triggers.fireL.id !== null || triggers.fireR.id !== null || look.firing;
  }
  function syncFire() {
    ui?.root.classList.toggle('firing', touchFire());
  }

  const axis = (plus, minus) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);

  return {
    intent,
    touch,
    get locked() {
      return locked;
    },
    get active() {
      return active;
    },
    /** True on a desk when the game is running but the mouse has got away: one click on the picture takes it back. */
    get wantsMouse() {
      return active && !touch && everLocked && !locked;
    },
    requestLock,
    exitLock() {
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    },

    /** Turns play input on or off. Off, everything held is let go and the touch controls are put away. */
    setActive(on_) {
      if (active === on_) return;
      active = on_;
      release();
      if (!on_) aimLatch = false;
      if (ui) ui.root.hidden = !on_;
    },

    /** Shows the USE button with this label, or hides it (null). `progress` 0..1 fills its ring. */
    setUse(label, progress = 0) {
      if (!ui) return;
      const b = ui.buttons.use;
      if (!label) {
        if (!b.hidden) {
          b.hidden = true;
          touchUse = false;
        }
        return;
      }
      if (b.hidden) b.hidden = false;
      if (b.dataset.label !== label) {
        b.dataset.label = label;
        b.querySelector('b').textContent = label;
      }
      b.style.setProperty('--fill', progress.toFixed(3));
    },

    /** Shows the second contextual button (take a machine as a shield / let it go) with this label, or hides it. */
    setGrab(label) {
      if (!ui) return;
      const b = ui.buttons.grab;
      if (!label) {
        if (!b.hidden) b.hidden = true;
        return;
      }
      if (b.hidden) b.hidden = false;
      if (b.dataset.label !== label) {
        b.dataset.label = label;
        b.querySelector('b').textContent = label;
      }
    },

    /** Lights the toggles that are on. */
    setToggles({ aim, crouch, nv }) {
      if (!ui) return;
      ui.buttons.aim.classList.toggle('on', aim);
      ui.buttons.crouch.classList.toggle('on', crouch);
      ui.buttons.nv.classList.toggle('on', nv);
    },

    /**
     * Says on the phone's two weapon buttons what is in hand and what is left to throw: SWAP carries the name of
     * the gun (a phone has no room for it anywhere else), EMP its count — and goes away when there is none.
     */
    setArms({ gun, grenades }) {
      if (!ui) return;
      const swap = ui.buttons.swap;
      if (swap.dataset.label !== gun) {
        swap.dataset.label = gun;
        swap.querySelector('b').textContent = gun;
      }
      const emp = ui.buttons.emp;
      if (emp.hidden !== grenades <= 0) emp.hidden = grenades <= 0;
      const label = `EMP ${grenades}`;
      if (emp.dataset.label !== label) {
        emp.dataset.label = label;
        emp.querySelector('b').textContent = label;
      }
    },

    /** Lowers a sight that was being kept up by a click, a key or the AIM button (a reload starts, …). */
    dropAim() {
      aimLatch = false;
    },

    /**
     * A key goes down, or comes up, that no keyboard sent: a button of the experiment's own on a phone's screen
     * (src/wild) stands for a key, by its code.
     */
    poke(code, down = true) {
      if (!active) return;
      if (down) {
        keys.add(code);
        struck.add(code);
      } else keys.delete(code);
    },

    /** Works out `intent` for this frame. Call once a frame, before anything reads it. */
    frame() {
      intent.hits.clear();
      if (!active) {
        struck.clear();
        intent.moveX = intent.moveY = intent.lookX = intent.lookY = intent.lean = 0;
        intent.run = intent.fire = intent.aim = intent.use = intent.aimLatched = false;
        intent.usePressed = intent.jump = intent.reload = intent.crouchToggle = intent.nv = intent.map = false;
        intent.grabPressed = intent.melee = intent.mode = intent.throw = false;
        intent.select = intent.cycle = 0;
        return intent;
      }
      // a finger that has stayed down on SWAP is working the selector, not changing guns
      if (swapAt > 0 && performance.now() - swapAt >= SWAP_HOLD_MS) {
        edges.mode = true;
        swapAt = 0;
      }
      const speed = settings.get('sensitivity');
      const flip = settings.get('invertY') ? -1 : 1;
      intent.moveX = axis('KeyD', 'KeyA') + axis('ArrowRight', 'ArrowLeft') + stick.x + triggers.fireL.walkX;
      intent.moveY = axis('KeyW', 'KeyS') + axis('ArrowUp', 'ArrowDown') + stick.y + triggers.fireL.walkY;
      intent.run = keys.has('ShiftLeft') || keys.has('ShiftRight') || stick.run || triggers.fireL.run;
      intent.lookX = (mouseDX * MOUSE_SPEED + touchDX * TOUCH_SPEED) * speed;
      intent.lookY = (mouseDY * MOUSE_SPEED + touchDY * TOUCH_SPEED) * speed * flip;
      intent.fire = mouseFire || firePulse || keys.has('KeyX') || touchFire();
      intent.aim = mouseAim || aimLatch;
      intent.aimLatched = aimLatch;
      intent.use = keys.has('KeyF') || touchUse;
      intent.lean = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
      intent.usePressed = edges.use;
      intent.grabPressed = edges.grab;
      intent.melee = edges.melee;
      intent.jump = edges.jump;
      intent.reload = edges.reload;
      intent.crouchToggle = edges.crouch;
      intent.nv = edges.nv;
      intent.map = edges.map;
      intent.select = edges.select || 0;
      intent.cycle = edges.cycle || 0;
      intent.mode = edges.mode;
      intent.throw = edges.throw;
      for (const code of struck) intent.hits.add(code);
      struck.clear();
      mouseDX = mouseDY = touchDX = touchDY = 0;
      firePulse = false;
      for (const key in edges) edges[key] = false;
      return intent;
    },

    /** What the fingers are doing right now — for tests. */
    debug() {
      return {
        active,
        stick: stick.id !== null,
        stickX: stick.x,
        stickY: stick.y,
        look: look.id !== null,
        firingPress: look.firing,
        fireL: triggers.fireL.id !== null,
        fireR: triggers.fireR.id !== null,
        fire: touchFire(),
        aim: aimLatch,
        use: touchUse,
      };
    },
  };
}

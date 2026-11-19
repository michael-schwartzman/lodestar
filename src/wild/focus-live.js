// Bent time, joined to the game: the key, the two clocks, what is seen and heard of it. The rules are
// src/wild/focus.js; the design is docs/WILD.md, "Bent time".
import { FOCUS, bent, createFocus, earn, reflex, stepFocus } from './focus.js';
import { FOCUS_SOUNDS } from './focus-sounds.js';
import { lerp } from '../core/math.js';

/** how much slower everything SOUNDS at the hardest bend: far less than it runs, or a shot would be a groan */
const SLOWEST_SOUND = 0.62;

export function createFocusLive(ctx) {
  const { G } = ctx;
  const f = createFocus();
  /** FOCUS was asked for since the clocks were last worked out */
  let asked = false;
  /** how far time was bent when the sound was last told (it is told only when that changes) */
  let told = -1;
  let heart = null;
  /** seconds of FOCUS this mission, to the frame: the debrief's count is this, rounded */
  let focused = 0;

  const veil = document.createElement('div');
  veil.className = 'w-focus';
  ctx.overlay.append(veil);

  // A phone has no Y: there FOCUS is a button of its own, beside NV, with the meter along its foot and the uses
  // left in its corner. It stands for the key (input.js `poke`), so that everything else here is the same on a
  // phone as on a desk.
  let button = null;
  let count = null;
  let level = '';
  let shown = -1;
  if (G.touch) {
    button = document.createElement('div');
    button.className = 'tb w-btn';
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', 'Focus');
    button.innerHTML = '<b>FOCUS</b><i></i><u></u>';
    count = button.querySelector('u');
    button.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        G.input.poke('KeyY', true);
        G.input.poke('KeyY', false);
      },
      { passive: false },
    );
    ctx.overlay.append(button);
  }

  function show() {
    if (button) {
      button.classList.toggle('on', f.on || f.reflexT > 0);
      button.classList.toggle('out', !f.on && f.usesLeft <= 0);
      const now = f.meter.toFixed(2);
      if (now !== level) button.style.setProperty('--level', (level = now));
      if (f.usesLeft !== shown) count.textContent = `×${(shown = f.usesLeft)}`;
    }
    const k = bent(f);
    veil.style.opacity = k.toFixed(3);
    if (Math.abs(k - told) < 0.004) return;
    told = k;
    G.audio.warp?.(lerp(1, SLOWEST_SOUND, k));
    // a heart, while it lasts — the one the game beats when the player is badly hurt
    if (k > 0.3 && !heart) heart = G.audio.loop('heartbeat', { gain: 0.5 });
    else if (k < 0.1 && heart) {
      heart.stop(0.5);
      heart = null;
    }
  }

  return {
    name: 'focus',
    /** for tests and the curious */
    state: f,
    brief: (touch) =>
      touch
        ? [
            ['', 'FOCUS', 'its own button, beside NV: three uses a mission'],
            ['', 'REFLEX', 'and by itself, when a machine makes you out'],
          ]
        : [
            ['Y', 'FOCUS', 'time bends, three a mission, five seconds each'],
            ['', 'REFLEX', 'and by itself, when a machine makes you out'],
          ],
    controls: [
      [
        'Focus: the world runs slow and you less so, three uses a mission',
        'Y, and Y again to stop',
        'FOCUS, beside NV',
      ],
    ],
    tallies: { reflexes: 'Reflex moments', focused: 'Seconds of focus' },
    sounds: { sounds: FOCUS_SOUNDS },

    reset() {
      Object.assign(f, createFocus());
      asked = false;
      focused = 0;
      show();
    },

    step(dt, own, intent) {
      if (intent.hits.has('KeyY')) asked = true;
    },

    /** The two clocks, for this frame: worked out here, once a frame, in real seconds. */
    pace(real, pace) {
      const can = G.state === 'playing' && G.player.alive;
      for (const what of stepFocus(f, { dt: real, toggle: asked, can })) {
        if (what === 'on') {
          ctx.note('FOCUS');
          G.audio.play('focusIn');
        } else if (what === 'refused') ctx.note('NO FOCUS LEFT', 'warn');
        else if (what === 'spent') ctx.note('FOCUS SPENT', 'warn');
        if (what === 'off' || what === 'spent' || what === 'reflex-over') G.audio.play('focusOut');
      }
      asked = false;
      if (f.on) {
        focused += real;
        ctx.tally.focused = Math.round(focused * 10) / 10;
      }
      pace.world *= f.world;
      pace.own *= f.own;
    },

    frame() {
      show();
    },

    get fov() {
      return lerp(1, FOCUS.fov, bent(f));
    },

    on: {
      // a machine has made the player out — by itself, not because it was shot — while the site is quiet
      spotted(unit, { provoked }) {
        if (provoked || G.enemies.alarm.active || !reflex(f)) return;
        ctx.tally.reflexes = (ctx.tally.reflexes || 0) + 1;
        ctx.note('REFLEX', 'warn');
        G.audio.play('focusIn');
        ctx.say('reflex');
      },
      hit({ killed, zone }) {
        if (killed) earn(f, zone === 'head' ? 'head' : 'kill');
      },
      kill(unit, { silent }) {
        if (silent) earn(f, 'takedown');
      },
      // the mission is over, one way or the other: nothing is bent any more
      end() {
        stepFocus(f, { dt: 0, toggle: false, can: false });
        show();
      },
    },

    chip() {
      const bending = f.on || f.reflexT > 0;
      return {
        key: 'Y',
        name: 'FOCUS',
        text: f.reflexT > 0 ? 'REFLEX' : f.on ? 'ON' : `×${f.usesLeft}`,
        level: f.on ? f.meter : f.usesLeft / FOCUS.uses,
        tone: bending ? 'busy' : f.usesLeft <= 0 ? 'out' : '',
      };
    },

    save: () => ({ meter: f.meter, usesLeft: f.usesLeft }),
    load(kept) {
      f.meter = kept.meter;
      f.usesLeft = kept.usesLeft ?? FOCUS.uses;
      focused = ctx.tally.focused || 0;
    },
  };
}

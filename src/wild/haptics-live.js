// Haptics, joined to the game: what src/wild/haptics.js decides is felt, actually asked of this browser — on the
// handful that can (Chromium on Android: `navigator.vibrate`), harmlessly nowhere else. The design, and why an
// iPhone is not among them, is docs/WILD-haptics.md.
//
// The owner, 18 November 2026: "i want sounds and when availible heptic feedback like on the iphone if
// possible". Checked that night: Safari on iOS has never implemented `navigator.vibrate`, and the one page
// trick that ever stood in for it — a hidden native `<input type="checkbox" switch>` toggled from script — was
// closed by Apple in iOS 26.5 (his phone is 26.7.3): only the user's own tap on a visible switch plays a tick
// now, which is useless to a game. So this feature asks the one real API there is, never throws when it is
// missing, and says plainly in the Settings row and in the docs why his phone feels nothing.
//
// `on.hit({ killed, zone })` is not wired to a kind of its own: every pellet that reaches here already ticks
// through `shot()` below (the gun firing is what is felt), and a hit that kills says so more plainly through
// `on.kill` instead — a buzz for every non-lethal hit as well, on top of the gun's own tick, would be noise
// doubled for nothing new felt.
import { ask, createHaptics, near, PATTERNS } from './haptics.js';

/** where the player's own choice is kept: '0' is off, exactly as src/wild/switch.js keeps WILD_KEY */
const KEY = 'lodestar.haptics.v1';
/** the cascade hall (main.js's own HALL; duplicated here as aftershock-live.js duplicates it too — see its
 * header comment: a module fenced to three.js and its siblings cannot import a sibling's unexported constant
 * across a feature boundary it has no other reason to know about) */
const HALL = { x: 51, z: 29 };
/** how far an EMP or the cascades blowing can still be felt, in metres (near(), src/wild/haptics.js) */
const REACH = { emp: 18, blast: 45 };
/** the settings row's own demo buzz, played the instant the row is turned on — not a kind, not rate-limited */
const DEMO_MS = 20;
/** a landing is felt from this many metres a second down (a jump lands at 5.4), and in full at this many */
const LAND = { from: 4, full: 10 };

/** whether `navigator.vibrate` exists — looked up fresh every time, never cached: see the header of the test
 * that depends on this, test/wild/haptics.test.mjs, for why it must be live and not decided once at boot */
function canVibrate() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/**
 * Whether the player has touched the page yet. Chromium refuses a vibration asked for before any tap, and says
 * so in the console as an error, once a call ("Blocked call to navigator.vibrate because user hasn't tapped on
 * the frame") — so nothing is asked for until they have. A browser that cannot say whether they have is asked
 * anyway: `vibrate` below does not throw.
 */
function touched() {
  return navigator.userActivation?.hasBeenActive !== false;
}

/** asks this browser to vibrate; never throws (a refusal — no user gesture yet, a denied permission — is not
 * this feature's to handle, only to survive) */
function vibrate(pattern) {
  try {
    if (canVibrate()) navigator.vibrate(pattern);
  } catch {
    // (see above: silence, not a crash)
  }
}

export function createHapticsLive(ctx) {
  const { G } = ctx;
  // `?haptics=0`: the feature does not exist at all, exactly as `?voice=0` leaves no voice-live.js behind it
  if (ctx.params.get('haptics') === '0') return null;

  const h = createHaptics();
  /** the player's own choice; capability is never folded into this — it is checked live, separately, wherever
   * it matters (fire, the Settings row) — so a default made here holds true the moment a browser does gain it */
  let enabled = (ctx.store?.getItem(KEY) ?? null) !== '0';
  /** one step of the world may hand `shot()` several pellets (a shotgun shell: eight) — only the first of a
   * step is felt, so a shell is one buzz and not eight fighting over the same 45 ms */
  let stepId = 0;
  let lastShotStep = -1;
  /** how fast the player was last falling while the feet were off the ground: a landing is felt by it */
  let falling = 0;

  function persist(value) {
    enabled = value;
    try {
      ctx.store?.setItem(KEY, value ? '1' : '0');
    } catch {
      // a full or blocked store: the choice still holds for the rest of this visit
    }
  }

  /** The one door every feeling comes through: wired to the game's own events below, and handed out as
   * `ctx.buzz` so any other feature can ask to be felt without knowing whether this browser can do it. */
  function fire(kind, strength = 1) {
    if (!enabled || !canVibrate() || !touched() || G.state !== 'playing') return;
    const pattern = ask(h, kind, strength, performance.now());
    if (pattern) vibrate(pattern);
  }
  ctx.buzz = fire;

  /** The Settings row: a switch of this feature's own making (docs/WILD-haptics.md, "The setting"), since the
   * game's own `settingRow`/`buildToggle` (src/ui/menus.js) are not exported for a feature to call. */
  function buildRow() {
    const row = document.createElement('div');
    row.className = 'm-row';
    const top = document.createElement('div');
    top.className = 'm-row__top';
    const label = document.createElement('span');
    label.className = 'm-row__label';
    label.textContent = 'Haptics';
    top.append(label);
    row.append(top);

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'm-switch';
    b.setAttribute('role', 'switch');
    const track = document.createElement('span');
    track.className = 'm-switch__track';
    const thumb = document.createElement('span');
    thumb.className = 'm-switch__thumb';
    track.append(thumb);
    const text = document.createElement('span');
    text.className = 'm-switch__label';
    b.append(track, text);

    function apply(value) {
      b.classList.toggle('is-on', value);
      b.setAttribute('aria-checked', String(value));
      text.textContent = value ? 'ON' : 'OFF';
    }
    apply(enabled);

    const able = canVibrate();
    if (able) {
      b.tabIndex = 0;
      b.dataset.stop = '';
      const choose = (value) => {
        persist(value);
        apply(value);
        if (value) vibrate(DEMO_MS); // felt it took — bypasses fire()'s gates: this is not play, and always on
      };
      b.addEventListener('click', () => choose(!enabled));
      // menus.js's own keydown handler (on `layer`, src/ui/menus.js) sends every [role=switch] it finds through
      // `settings.set(dataset.setting, …)` against the game's own schema (src/settings.js), which has never
      // heard of this row and throws for a key it does not know. Stopped here, before it bubbles that far, so
      // the one real switch outside that schema does not crash it — and Left/Right still does what every other
      // switch on this screen does.
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        e.stopPropagation();
        choose(e.key === 'ArrowRight');
      });
    } else {
      b.disabled = true;
      b.tabIndex = -1;
      b.setAttribute('aria-disabled', 'true');
    }
    row.append(b);

    if (!able) {
      const hint = document.createElement('div');
      hint.className = 'm-row__hint';
      hint.textContent = G.touch ? 'Safari on iPhone does not let a web page vibrate' : 'not available in this browser';
      row.append(hint);
    }
    return row;
  }

  return {
    name: 'haptics',
    /** for tests and the curious */
    get state() {
      return { can: canVibrate(), on: enabled, last: h.last, count: h.count };
    },
    /** `ctx.buzz`'s own self, reachable from a test through `G.wild.feature('haptics').buzz` without going
     * through `ctx` at all (test/wild/haptics.test.mjs) */
    buzz: fire,

    step() {
      stepId++;
      // the feet were off the ground and are on it: felt by how hard they came down
      const p = G.player;
      if (!p.grounded) falling = Math.max(falling, -p.vy);
      else if (falling > 0) {
        fire('land', near(1, LAND.full - falling, LAND.full - LAND.from));
        falling = 0;
      }
    },

    /** A round is flying, cast by the player's own gun: claims nothing of it (lamps and the rest still see it),
     * only feels it — once a step, however many pellets the shell was. */
    shot() {
      const kind = G.weapon?.current;
      if (!PATTERNS[kind] || stepId === lastShotStep) return null;
      lastShotStep = stepId;
      fire(kind, 1);
      return null;
    },

    on: {
      hurt() {
        fire('hurt', 1);
      },
      knife() {
        fire('knife', 1);
      },
      kill() {
        fire('kill', 1);
      },
      charge() {
        fire('charge', 1);
      },
      alarm(up) {
        // the alarm standing down is not among the kinds asked for: only its being raised is felt
        if (up) fire('alarm', 1);
      },
      emp(x, z) {
        fire('emp', near(1, Math.hypot(x - G.player.x, z - G.player.z), REACH.emp));
      },
      blast() {
        fire('blast', near(1, Math.hypot(HALL.x - G.player.x, HALL.z - G.player.z), REACH.blast));
      },
    },

    screen(name, layer) {
      if (name !== 'settings') return;
      const body = layer.querySelector('.m-panel__body');
      if (!body) return;
      const group = document.createElement('div');
      group.className = 'm-group';
      const title = document.createElement('div');
      title.className = 'm-group__title';
      title.textContent = 'Feel';
      group.append(title, buildRow());
      body.append(group);
    },
  };
}

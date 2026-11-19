// The overspeed, joined to the game: the key at the firing point, the hall that shakes and glows, the site that
// answers, and the end. The rules are src/wild/overspeed.js; the design is docs/WILD.md, "The overspeed".
import { OVERSPEED, begin, createOverspeed, hzAt, needFor, spinAt, stepOverspeed, strainAt } from './overspeed.js';
import { OVERSPEED_SOUNDS } from './overspeed-sounds.js';

/** seconds H must be held at the firing point for it to begin: a decision, not a slip */
const START_HOLD = 1.2;
/** the middle of the cascade hall: where its sounds come from, and its lamps hang (main.js has the same) */
const HALL = { x: 51, y: 2.5, z: 29 };
/** how far along WARDEN has something to say about it (src/wild/warden.js) */
const SAID_AT = [0.25, 0.6, 0.9];

/** 1064 → "1 064": a thin space between the thousands, as the briefing writes numbers */
const spaced = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ' ');

export function createOverspeedLive(ctx) {
  const { G } = ctx;
  const { player, enemies, audio, fx, site } = G;
  const fire = site.firing;
  const o = createOverspeed();
  /** seconds H has been held at the firing point; the sound of the drives; which wave is next; what has been said */
  let hold = 0;
  let whine = null;
  let wave = 0;
  let said = 0;
  let tickT = 0;
  let shakeT = 0;
  /** it can be begun where the player stands, this step; on a phone, seconds a press still stands for the key */
  let offered = false;
  let auto = 0;

  // the line that offers it, and the bar while it runs
  const offer = document.createElement('div');
  offer.className = 'w-offer';
  offer.hidden = true;
  offer.innerHTML = '<span></span><i><u></u></i>';
  const bar = document.createElement('div');
  bar.className = 'w-over';
  bar.hidden = true;
  bar.innerHTML = '<b>OVERSPEED</b><span></span><i><u></u></i><em></em>';
  ctx.overlay.append(offer, bar);
  const [offerText, offerBar] = [offer.querySelector('span'), offer.querySelector('u')];
  const [barHz, barFill, barSays] = [bar.querySelector('span'), bar.querySelector('u'), bar.querySelector('em')];
  let shown = '';

  const near = (reach) => Math.hypot(player.x - fire.x, player.z - fire.z) <= reach;
  const inTheRoom = () => player.alive && near(OVERSPEED.reach);
  /** Whether it could be begun at all just now: charges still unset, the cascades standing, hands free. */
  function possible() {
    const m = G.mission;
    return (
      !!m &&
      m.phase === 'infil' &&
      !m.blown &&
      m.chargesPlanted < m.chargesTotal &&
      !o.running &&
      !o.done &&
      player.alive &&
      !player.holding &&
      !ctx.flying
    );
  }

  function quiet() {
    whine?.stop(0.6);
    whine = null;
    ctx.act.loop('cascade')?.set({ rate: 1 });
  }

  function start() {
    begin(o, G.mission.chargesPlanted);
    wave = said = 0;
    // WARDEN feels it at once: the site's own alarm, as a charge raises it — not counted against the grade
    if (enemies.alert(fire.x, fire.z)) ctx.act.siren();
    whine = audio.loop('overspeedWhine', { ...HALL, gain: 0.25, rate: 0.75 });
    audio.play('chargeArmed', { gain: 0.9, rate: 0.8 });
    ctx.note('OVERSPEED — HOLD THE ROOM', 'warn');
    ctx.act.radio(
      'Overwatch',
      `You are in their drives. Hold that room for ${o.need} seconds, Wraith — WARDEN will send everything it has.`,
      7,
    );
    ctx.say('overspeed-begin');
  }

  return {
    name: 'overspeed',
    /** for tests and the curious */
    state: o,
    brief: (touch) =>
      touch
        ? [['', 'OVERSPEED', 'the button at the firing point: no charges']]
        : [['H', 'OVERSPEED', 'hold at the firing point: no charges needed']],
    controls: [
      [
        'Overspeed: bring the cascades down without charges',
        'H, held at the firing point. Then hold the room',
        'OVERSPEED, where SHIELD is',
      ],
    ],
    tallies: { overspeed: 'Cascades torn apart by overspeed' },
    sounds: OVERSPEED_SOUNDS,

    reset() {
      Object.assign(o, createOverspeed());
      hold = auto = 0;
      offered = false;
      quiet();
      // (the cascade itself has been stood up again by the game before this is called)
    },

    step(dt, own, intent) {
      if (!o.running) {
        offered = possible() && near(fire.radius);
        // H is the uplink's key too: with a machine in the sights it is the uplink that is meant
        if (G.touch && offered && intent.grabPressed) auto = START_HOLD + 0.3;
        auto = offered ? Math.max(0, auto - own) : 0;
        const asking = offered && !ctx.sighted?.() && (intent.down.has('KeyH') || auto > 0);
        if (asking) {
          hold += own;
          G.weapon.lowerFor(0.25);
          if ((tickT -= own) <= 0) {
            tickT = 0.3;
            audio.play('chargeBeep');
          }
        } else hold = Math.max(0, hold - own * 3);
        if (hold >= START_HOLD) {
          hold = auto = 0;
          start();
        }
        return;
      }
      const here = inTheRoom();
      for (const what of stepOverspeed(o, { dt, near: here })) {
        if (what === 'wave') {
          const coming = ctx.act.wave(fire, wave++);
          ctx.act.radio('Overwatch', `WARDEN is answering: ${coming}.`, 6);
        } else if (what === 'dark') {
          // the drives pull the hall's own lamps down, for as long as an EMP would
          if (ctx.act.dark(HALL.x, HALL.z).length) audio.play('lightsOut', { ...HALL, gain: 1.2 });
          ctx.note('THE DRIVES ARE PULLING THE HALL DARK', 'warn');
          ctx.say('overspeed-dark');
        } else if (what === 'done') {
          quiet();
          ctx.tally.overspeed = 1;
          // every charge counts as set, and they go: from here it is the blast the game always had
          ctx.act.bringDown();
          ctx.note('THE CASCADES HAVE TORN THEMSELVES APART', 'warn');
          ctx.say('overspeed-done');
        } else if (what === 'abandoned') {
          quiet();
          G.world.cascade.strain(0, 0);
          ctx.note('THE DRIVES SETTLE — IT IS LOST', 'bad');
          ctx.act.radio('Overwatch', 'You let it go, and the drives have settled. It can be begun again.', 5);
          ctx.say('overspeed-lost');
        }
      }
      if (!o.running) return;
      const p = o.progress;
      const strain = strainAt(p);
      // the skins are seen to turn faster (the game turns them once already: this is the rest), the casings shake
      // in their seats and glow, and the drives are heard climbing
      G.world.cascade.spin(dt * (spinAt(p) - 1));
      G.world.cascade.strain(strain, G.mission.time);
      whine?.set({ rate: 0.75 + 1.1 * p, gain: 0.25 + 0.65 * p });
      ctx.act.loop('cascade')?.set({ rate: 1 + 0.8 * p });
      if (strain > 0 && (shakeT -= dt) <= 0) {
        shakeT = 0.4;
        fx.shake(0.03 + 0.1 * strain);
      }
      if (said < SAID_AT.length && p >= SAID_AT[said]) ctx.say(`overspeed-${++said}`);
    },

    frame() {
      const playing = G.state === 'playing';
      // the offer, with the hold filling under it
      const want = playing && offered && !o.running;
      if (offer.hidden === want) offer.hidden = !want;
      if (want) {
        // (a phone is not told to hold anything: its button, once pressed, holds for it)
        const what = `OVERSPEED THE DRIVES · ${needFor(G.mission.chargesPlanted)} s IN THIS ROOM`;
        const text = G.touch ? what : `HOLD H — ${what}`;
        if (text !== shown) offerText.textContent = shown = text;
        offerBar.style.width = `${Math.min(100, (hold / START_HOLD) * 100).toFixed(1)}%`;
      }
      // the bar, while it runs
      const running = playing && o.running;
      if (bar.hidden === running) bar.hidden = !running;
      if (!running) return;
      const here = inTheRoom();
      bar.classList.toggle('weak', !here);
      barHz.textContent = `${spaced(hzAt(o.progress))} Hz`;
      barFill.style.width = `${(o.progress * 100).toFixed(1)}%`;
      barSays.textContent = here
        ? `HOLD THE ROOM · ${Math.ceil((1 - o.progress) * o.need)} s`
        : G.touch
          ? 'OUT OF THE ROOM'
          : 'OUT OF THE ROOM — IT IS RUNNING DOWN';
    },

    grab(busy) {
      return G.touch && offered && !busy && !o.running ? 'OVERSPEED' : null;
    },

    on: {
      // the cascades went up some other way while it ran: there is nothing left to push
      blast() {
        if (!o.running) return;
        o.running = false;
        quiet();
      },
      // the mission is over, one way or the other: nothing runs any more
      end() {
        o.running = false;
        quiet();
      },
    },
  };
}

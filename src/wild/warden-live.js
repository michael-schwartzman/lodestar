// WARDEN speaks, joined to the game: its lines on the radio, in its own colour, with its own sound. The lines and
// when it holds its tongue are src/wild/warden.js; the design is docs/WILD.md, "WARDEN speaks".
import { createWarden, speak } from './warden.js';

export function createWardenLive(ctx) {
  const { G } = ctx;
  let w = createWarden();
  /** how many lamps have been shot out this mission: it speaks of the third */
  let lamps = 0;

  /** Something has happened that WARDEN may have a word about: every feature of the experiment calls this. */
  ctx.say = (event) => {
    if (G.state !== 'playing' || !G.mission) return;
    const line = speak(w, event, G.mission.time);
    if (!line) return;
    ctx.act.radio('WARDEN', line, 6);
    // the line the game has just put on the screen is WARDEN's: in its colour — and said aloud, when there is a
    // clip of it (src/wild/voice-live.js). Under it the blare a sentry gives when it has made you out, an octave
    // down: all of its voice when nothing is said, and only the line opening when something is
    G.hud.el.querySelector('.radio')?.lastElementChild?.classList.add('w-warden');
    const heard = ctx.voice('warden', `${event}-${w.told[event] - 1}`);
    G.audio.play('sentryAlert', { gain: heard ? 0.14 : 0.45, rate: 0.5 });
    ctx.tally.warden = (ctx.tally.warden || 0) + 1;
  };

  return {
    name: 'warden',
    /** for tests and the curious */
    get state() {
      return w;
    },
    brief: [['', 'WARDEN', 'has things to say about all of it']],
    tallies: { warden: 'Times WARDEN spoke to you' },

    reset() {
      w = createWarden();
      lamps = 0;
      // what it said in the mission before is not left on the screen of this one
      for (const line of G.hud.el.querySelectorAll('.radio .w-warden')) line.remove();
    },

    on: {
      alarm(on) {
        if (on) ctx.say('alarm');
      },
      found() {
        ctx.say('found');
      },
      lamp() {
        if (++lamps === 3) ctx.say('lamp');
      },
      charge() {
        ctx.say('charge');
      },
      beacon() {
        ctx.say('beacon');
      },
      hurt() {
        if (G.player.health < 35) ctx.say('hurt');
      },
      kill() {
        const left = G.enemies.remaining();
        if (left > 0 && left <= 3) ctx.say('few');
      },
    },

    save: () => ({ told: { ...w.told }, lamps }),
    load(kept) {
      w.told = { ...kept.told };
      lamps = kept.lamps;
    },
  };
}

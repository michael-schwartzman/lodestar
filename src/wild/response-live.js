// The site answers, joined to the game: which things that happen are causes, where the machines they bring walk
// in, what the player is told, and what a wave shut down gives back. The rules — how many, how fast, how many at
// once — are src/wild/response.js; the design is docs/WILD.md, "The site answers".
import {
  RESPONSE,
  call,
  capOf,
  createResponse,
  fallen,
  how,
  keep,
  nextDoor,
  pointWord,
  restore,
  step as stepResponse,
  tierOf,
  words,
} from './response.js';

/** seconds after a cause before its note goes up, and before Overwatch speaks of it: whatever the game says of the
 * cause itself is said first, and read */
const NOTE_AFTER = 2.5;
const RADIO_AFTER = 4.5;
/** …and before WARDEN has its word: after its own line for the cause, and the silence it keeps between two */
const WARDEN_AFTER = 8;
/** how often the fallen are looked over for clearing away, in seconds */
const SWEEP = 2;

/**
 * @param {object} ctx G, params, act, tally, note, say — and `respond`, which this puts itself in (src/wild/index.js)
 */
export function createResponseLive(ctx) {
  // (a switch for comparing with and without, and for the suites written before this)
  if (ctx.params.get('response') === '0') return null;
  const { G } = ctx;
  const r = createResponse();
  /** what is still to be said: { t, note?, radio?, say? } */
  let later = [];
  /** the doors each wave has been given, by its id */
  const doors = new Map();
  let sweepT = 0;
  /** the last wave called, for tests and the curious */
  let last = null;

  const tier = () => tierOf(G.settings.get('difficulty'));
  const cap = () => capOf(tier(), !!G.touch);
  const ofWaves = (unit) => unit.rollId < 0 && !unit.dead;
  const sees = (x, z) => G.world.grid.sight(G.player.x, G.player.eye, G.player.z, x + 0.5, 1.6, z + 0.5);

  /** The machines the game itself has just sent that belong to no wave yet: they are this cause's. */
  const unclaimed = () => G.enemies.list.filter((unit) => ofWaves(unit) && unit.wave === undefined);

  /**
   * A cause. Returns what Overwatch would say of the wave — for a caller that would rather say it itself, in its
   * own line — or '' when nobody comes.
   * @param {'tripwire' | 'alarm' | 'task'} cause
   * @param {{ x: number, z: number }} at where it happened: where they are sent
   * @param {object} [o]
   * @param {string} [o.key] a wire's name
   * @param {string} [o.why] what Overwatch calls the cause: 'the wire', 'the charge' …
   * @param {string} [o.lead] …or a sentence of its own to begin with, in place of "N coming for …"
   * @param {boolean} [o.quiet] the caller says the line itself
   * @param {boolean} [o.again] a retry: nothing is said of it, and the alarm is not raised for it — that was then
   */
  function respond(cause, at, { key, why = `the ${cause}`, lead = '', quiet = false, again = false } = {}) {
    if (G.state !== 'playing' || !G.player.alive) return '';
    // what the game has sent for a task counts towards its figure; a wire and an alarm it sends nobody for
    const own = cause === 'task' ? unclaimed() : [];
    const already = {
      sentries: own.filter((unit) => unit.type === 'sentry').length,
      drones: own.filter((unit) => unit.type === 'drone').length,
    };
    const wave = call(r, cause, { tier: tier(), cap: cap(), to: at, already, key });
    if (!wave) return '';
    for (const unit of own) unit.wave = wave.id;
    last = { ...wave, at: { x: at.x, z: at.z } };
    if (!wave.total || again) return '';
    // Machines do not walk into a quiet site: if nothing has raised the alarm for this, this does — uncounted,
    // as a charge's is. (And then a machine of the wave that falls is no news to the rest: enemies/bodies.js.)
    if (G.enemies.alert(at.x, at.z)) ctx.act.siren();
    ctx.tally.waves = (ctx.tally.waves || 0) + 1;
    const n = wave.sentries + wave.drones;
    if (!n) return '';
    const door = wave.sentries ? nextDoor(G.site.entries, G.player, at, [], sees) : null;
    const from = door ? pointWord(door[0] + 0.5 - G.player.x, door[1] + 0.5 - G.player.z) : null;
    const line = lead ? `${lead} ${how(wave, from)}.` : words(wave, why, from, already.sentries + already.drones > 0);
    later.push({ t: NOTE_AFTER, note: `INBOUND — ${n}` });
    if (!quiet) later.push({ t: RADIO_AFTER, radio: line });
    later.push({ t: WARDEN_AFTER, say: 'response' });
    ctx.buzz('wave', 1);
    return line;
  }
  ctx.respond = respond;

  /** One machine of a wave walks in by a door, or comes up from the bay. */
  function bring(order) {
    let cell;
    if (order.type === 'sentry') {
      const used = doors.get(order.wave) || [];
      cell = nextDoor(G.site.entries, G.player, order.to, used, sees);
      if (cell) doors.set(order.wave, [...used, cell]);
    } else {
      const bays = G.site.reinforcements;
      cell = bays.length ? bays[(order.wave + r.sent) % bays.length] : null;
    }
    const unit = cell ? G.enemies.reinforce(order.type, [cell], order.to)[0] : null;
    if (unit) unit.wave = order.wave;
    // nowhere to come in by: it does not come, and the wave is one machine the fewer
    else down(order.wave);
  }

  /** A machine of a wave is down: if it was the last, the wave's rounds are the player's. */
  function down(id) {
    const wave = fallen(r, id);
    if (!wave) return;
    doors.delete(id);
    if (G.state !== 'playing' || !G.player.alive) return;
    // (as many times a cache's rounds as there are times the rounds: armour-live.js)
    G.weapon.takeCache(ctx.plenty());
    G.audio.play('kitRustle');
    G.audio.play('reloadIn', { gain: 0.8 });
    ctx.note('WAVE DOWN — AMMUNITION FROM THE WRECKS');
    ctx.tally.salvaged = (ctx.tally.salvaged || 0) + 1;
    ctx.buzz('salvage', 1);
  }

  /**
   * The fallen of the waves are cleared away once nobody is looking: a mission can bring a great many, and each
   * is a thing to draw. (The machines of the roll lie where they fell, as they always did: they can be found.)
   */
  function sweep() {
    const { after, off } = RESPONSE.wreck;
    const now = G.mission.time;
    for (const unit of G.enemies.list) {
      if (!unit.dead || unit.gone || unit.rollId >= 0) continue;
      if (unit.fellAt === undefined) unit.fellAt = now;
      if (now - unit.fellAt < after || unit === G.enemies.dragged) continue;
      const far = Math.hypot(unit.x - G.player.x, unit.z - G.player.z) > off;
      if (far || !sees(Math.floor(unit.x), Math.floor(unit.z))) unit.gone = true;
    }
  }

  function clear() {
    restore(r, null);
    later = [];
    doors.clear();
    sweepT = 0;
    last = null;
  }

  return {
    name: 'response',
    brief: [['', 'WAVES', 'a wire, an alarm, a task done: each brings more']],
    controls: [
      [
        'Waves: a broken wire, an alarm and every task done bring machines',
        'They walk in by the doors and come up from the bay. Shut a whole wave down and its rounds are yours',
        'They come by the doors and from the bay. Shut a whole wave down for its rounds',
      ],
    ],
    tallies: { waves: 'Waves WARDEN sent', salvaged: 'Waves shut down to the last machine' },

    /** for tests and the curious */
    state: () => ({
      wires: [...r.wires],
      waiting: r.queue.length,
      waves: r.waves.map((wave) => ({ ...wave })),
      called: r.called,
      sent: r.sent,
      shed: r.shed,
      cap: cap(),
      running: G.enemies.list.filter(ofWaves).length,
      last,
    }),
    respond,

    reset: clear,
    save: () => keep(r),
    /**
     * A retry from a checkpoint. The game has just sent again what the checkpoint's task brought (main.js
     * `loadCheckpoint`): the rest of that wave comes again with it — nothing is said of it twice.
     */
    load(kept) {
      clear();
      restore(r, kept);
      if (G.mission.chargesPlanted > 0) respond('task', G.player, { again: true });
    },

    step(dt) {
      if (G.state !== 'playing') return;
      // whatever the game sent that no cause has claimed is nobody's (a wave the overspeed asked for, say)
      for (const unit of unclaimed()) unit.wave = 0;
      for (const order of stepResponse(r, dt, { alive: G.enemies.list.filter(ofWaves).length, cap: cap() }))
        bring(order);
      for (const say of later) say.t -= dt;
      const due = later.filter((say) => say.t <= 0);
      if (due.length) {
        later = later.filter((say) => say.t > 0);
        for (const say of due) {
          if (say.note) ctx.note(say.note, 'bad');
          if (say.radio) ctx.act.radio('Overwatch', say.radio, 6);
          if (say.say) ctx.say(say.say);
        }
      }
      sweepT -= dt;
      if (sweepT <= 0) {
        sweepT = SWEEP;
        sweep();
      }
    },

    on: {
      /** a machine has raised the alarm afresh — it found the player, or one of its own lying where it fell */
      alarm(on) {
        if (on) respond('alarm', G.enemies.alarm);
      },
      charge: (c) => respond('task', c, { why: 'the charge' }),
      blast: () => respond('task', G.site.firing, { why: 'the control room' }),
      beacon: () => respond('task', G.player, { why: 'the lodestar' }),
      /** every machine on the roll is down: the garrison is finished, and the reserve is sent */
      phase(phase) {
        if (phase === 'mark')
          respond('task', G.player, { lead: 'That was the garrison. WARDEN is sending its reserve —' });
      },
      kill(unit) {
        if (unit.wave) down(unit.wave);
      },
    },
  };
}

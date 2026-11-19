// Music a scene, joined to the game: the cues fetched when their scenes come, one laid over the next, each brought
// round on itself. Which cue a moment calls for is src/wild/music.js; the design is docs/WILD.md, "Music a scene".
// It goes through the engine's seams (src/audio/audio.js `graph`, `setScore`) and touches nothing else.
import { MUSIC, createScene, crossInto, cueFor, stepScene } from './music.js';

/** where each cue is fetched from (the build gives each file a name of its own; each must be written out here) */
const FILES = {
  title: new URL('./music/title.mp3', import.meta.url).href,
  infil: new URL('./music/infil.mp3', import.meta.url).href,
  hall: new URL('./music/hall.mp3', import.meta.url).href,
  tense: new URL('./music/tense.mp3', import.meta.url).href,
  combat: new URL('./music/combat.mp3', import.meta.url).href,
  overspeed: new URL('./music/overspeed.mp3', import.meta.url).href,
  exfil: new URL('./music/exfil.mp3', import.meta.url).href,
  end: new URL('./music/end.mp3', import.meta.url).href,
};

/** what is likely to be called for next, and so is fetched while there is time: a fight comes without warning */
const AHEAD = {
  title: ['infil'],
  infil: ['tense', 'combat'],
  hall: ['tense', 'combat'],
  tense: ['combat'],
  combat: ['tense'],
  overspeed: ['combat'],
  exfil: ['end'],
  end: [],
};

export function createMusicLive(ctx) {
  const { G } = ctx;
  // `?music=0`: the game's own score, as it was
  if (ctx.params.get('music') === '0') return null;
  const scene = createScene();
  const files = { ...FILES };
  /** the cues that are decoded, the one used longest ago first */
  const buffers = new Map();
  const loading = new Map();
  const failed = {};
  let graph = null;
  let out = null;
  /** between the cues and the engine: where the music gives way under a voice */
  let under = null;
  /** what is playing: { cue, buffer, gain, sources, nextAt } */
  let deck = null;
  let installed = false;
  /** for tests: how many times a cue has been started or brought round, a cue to call for whatever the moment, a shorter round */
  let rounds = 0;
  let forced = null;
  let roundSeconds = 0;
  /** the engine is handed this in place of its own score (audio.js `setScore`): it has nothing to be told */
  const score = { setState() {}, update() {} };

  /** A cue, decoded — fetched if it has not been; null if it cannot be had (it is asked for twice, then left). */
  function load(cue) {
    if (buffers.has(cue)) return Promise.resolve(buffers.get(cue));
    if (loading.has(cue)) return loading.get(cue);
    if ((failed[cue] || 0) >= 2) return Promise.resolve(null);
    const asked = fetch(files[cue])
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((bytes) => new Promise((done, fail) => graph.ctx.decodeAudioData(bytes, done, fail)))
      .then((buffer) => {
        buffers.set(cue, buffer);
        // few are kept decoded: the one playing, the one wanted, and the newest of the rest
        for (const old of [...buffers.keys()]) {
          if (buffers.size <= MUSIC.keep + 1) break;
          if (old !== deck?.cue && old !== scene.cue && old !== cue) buffers.delete(old);
        }
        return buffer;
      })
      .catch((error) => {
        failed[cue] = (failed[cue] || 0) + 1;
        console.warn(`music: the cue "${cue}" could not be had (${error?.message || error})`);
        return null;
      })
      .finally(() => loading.delete(cue));
    loading.set(cue, asked);
    return asked;
  }

  /** One playing of a deck's cue from `at`: in over `fadeIn` seconds, and out over the round's overlap at its end. */
  function play(d, at, fadeIn) {
    const ac = graph.ctx;
    const length = Math.min(d.buffer.duration, roundSeconds || Infinity);
    const source = ac.createBufferSource();
    source.buffer = d.buffer;
    const g = ac.createGain();
    g.gain.setValueAtTime(fadeIn ? 0 : 1, at);
    if (fadeIn) g.gain.linearRampToValueAtTime(1, at + fadeIn);
    g.gain.setValueAtTime(1, at + length - MUSIC.loop);
    g.gain.linearRampToValueAtTime(0, at + length);
    source.connect(g).connect(d.gain);
    source.start(at);
    source.stop(at + length + 0.05);
    d.sources.add(source);
    // a playing that is over is taken out of the graph, it and its own level (found in review, 17 November
    // 2026: each time a cue came round a source and a gain were left connected for good)
    source.onended = () => {
      d.sources.delete(source);
      source.disconnect();
      g.disconnect();
    };
    // it comes round again as this playing begins to go out
    d.nextAt = at + length - MUSIC.loop;
    rounds++;
  }

  /** A cue comes in over the one that was playing. */
  function start(cue, buffer) {
    const ac = graph.ctx;
    const now = ac.currentTime;
    const cross = deck ? crossInto(cue) : 1.2;
    const next = { cue, buffer, gain: ac.createGain(), sources: new Set(), nextAt: 0 };
    next.gain.gain.setValueAtTime(0, now);
    next.gain.gain.linearRampToValueAtTime(1, now + cross);
    next.gain.connect(out);
    play(next, now, 0);
    const old = deck;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + cross);
      for (const source of old.sources) source.stop(now + cross + 0.05);
      setTimeout(() => old.gain.disconnect(), (cross + 0.5) * 1000);
    }
    deck = next;
    // used now: it is the last to be let go of
    buffers.delete(cue);
    buffers.set(cue, buffer);
    if (!installed) {
      // from its first note the game's own score is silent (audio.js `setScore`); until then it played
      G.audio.setScore(score);
      installed = true;
    }
  }

  return {
    name: 'music',
    /** for tests and the curious */
    get state() {
      return {
        cue: deck ? deck.cue : null,
        wanted: scene.cue,
        installed,
        loaded: [...buffers.keys()],
        failed: { ...failed },
        rounds,
        sounding: deck ? deck.sources.size : 0,
        level: deck ? deck.gain.gain.value : 0,
        seconds: deck ? deck.buffer.duration : 0,
        under: under ? under.gain.value : 1,
      };
    },
    /** The music gives way under a voice (src/wild/voice-live.js): down to `to` of itself at `at`, back after `seconds`. */
    duck(at, seconds, to) {
      if (!under) return;
      under.gain.cancelScheduledValues(at);
      under.gain.setTargetAtTime(to, at, 0.12);
      under.gain.setTargetAtTime(1, at + seconds, 0.4);
    },
    /** for tests: a cue called for whatever the moment; a round shorter than the cue; a cue fetched from elsewhere */
    debug({ force, round, file } = {}) {
      if (force !== undefined) forced = force;
      if (round !== undefined) roundSeconds = round;
      if (file) Object.assign(files, file);
    },

    frame(real) {
      if (!graph) {
        // sound runs from the player's first key or touch: until then there is nothing to play into
        graph = G.audio.graph?.() || null;
        if (!graph) return;
        out = graph.ctx.createGain();
        under = graph.ctx.createGain();
        out.connect(under).connect(graph.music);
      }
      const playing = G.state === 'playing';
      const want =
        forced ||
        cueFor({
          state: G.state,
          screen: G.menus.current(),
          phase: G.mission?.phase,
          mood: playing ? G.enemies.mood() : 'calm',
          hall: playing && ctx.lib.zone(G.player.x, G.player.z) === 'Cascade hall',
          overspeed: !!G.wild?.feature('overspeed')?.state.running,
        });
      const cue = stepScene(scene, want, real);
      const now = graph.ctx.currentTime;
      if (cue && cue !== deck?.cue && !loading.has(cue))
        load(cue).then((buffer) => {
          // (by the time it has come the moment may call for something else: then it is only kept)
          if (buffer && scene.cue === cue && deck?.cue !== cue) start(cue, buffer);
        });
      if (deck) {
        // it comes round: the next playing is laid over the end of this one, a little ahead of time
        if (now > deck.nextAt - 0.4) play(deck, Math.max(deck.nextAt, now), MUSIC.loop);
        // what is likely next is fetched while there is time
        if (deck.cue === cue) for (const next of AHEAD[cue]) if (!buffers.has(next) && !loading.has(next)) load(next);
      }
      out.gain.setTargetAtTime(G.state === 'paused' ? MUSIC.paused : 1, now, 0.25);
    },
  };
}

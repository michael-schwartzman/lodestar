// The site speaks aloud, joined to the game: WARDEN's lines said as they are put on the radio, the public
// address reading its alerts out to the halls. Which line is heard when is src/wild/voice.js; the clips are made
// by tools/sound/voice.mjs; the design is docs/WILD.md, "Voices". It goes through the engine's seam
// (src/audio/audio.js `graph`) and touches nothing else.
import { VOICE, announce, createAddress, due } from './voice.js';

/** where each clip is fetched from, by "<speaker>/<line>": every mp3 under voice/ (the build names each file) */
const FILES = Object.fromEntries(
  Object.entries(import.meta.glob('./voice/*/*.mp3', { query: '?url', import: 'default', eager: true })).map(
    ([path, url]) => [path.slice('./voice/'.length, -'.mp3'.length), url],
  ),
);

export function createVoiceLive(ctx) {
  const { G } = ctx;
  // `?voice=0`: the lines on the radio and nothing said aloud, as it was
  if (ctx.params.get('voice') === '0') return null;
  const files = { ...FILES };
  /** each clip as it was fetched (some twenty kilobytes): it is decoded when it is said, and that let go of after */
  const fetched = new Map();
  const failed = {};
  let graph = null;
  /** each speaker's own way out, whether it is sent round the room yet, and when it will have said what it is saying */
  const outs = {};
  const sent = {};
  let until = {};
  const sounding = new Set();
  let address = createAddress();
  /** what has been said aloud this mission, in order (for tests and the curious) */
  let spoken = [];
  let pushed = false;
  /** whether the site's alarm was up a step ago: the address speaks when that changes */
  let alarmed = false;
  /** a line asked for in one mission is not said into the next */
  let mission = 0;

  const fail = (key, error) => {
    failed[key] = (failed[key] || 0) + 1;
    fetched.delete(key);
    console.warn(`voice: "${key}" could not be said (${error?.message || error})`);
    return null;
  };

  /** A clip, decoded — fetched if it has not been; null if it cannot be had (it is asked for twice, then left). */
  function clip(key) {
    if (!fetched.has(key))
      fetched.set(
        key,
        fetch(files[key]).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        }),
      );
    return fetched
      .get(key)
      .then((bytes) => new Promise((done, bad) => graph.ctx.decodeAudioData(bytes.slice(0), done, bad)))
      .catch((error) => fail(key, error));
  }

  function out(who) {
    if (!outs[who]) {
      outs[who] = graph.ctx.createGain();
      outs[who].gain.value = VOICE.level[who];
      outs[who].connect(graph.master);
    }
    // (the room is built a frame after sound first runs: until it is, a voice is only itself)
    if (!sent[who]) sent[who] = !!G.wild.feature('mix')?.send?.(outs[who], VOICE.send[who]);
    return outs[who];
  }

  /** A line is to be said: true if there is a clip of it to be heard. */
  function speak(who, id) {
    const key = `${who}/${id}`;
    graph = graph || G.audio.graph?.() || null;
    if (!graph || !files[key] || (failed[key] || 0) >= 2) return false;
    const asked = mission;
    clip(key).then((buffer) => {
      if (!buffer || asked !== mission) return;
      const ac = graph.ctx;
      // a speaker never talks over itself: this waits for what it is saying, and a breath
      const at = Math.max(ac.currentTime + VOICE.after, (until[who] || 0) + VOICE.breath);
      const source = ac.createBufferSource();
      source.buffer = buffer;
      source.connect(out(who));
      source.start(at);
      until[who] = at + buffer.duration;
      sounding.add(source);
      // (said, it is taken out of the graph: nothing is left connected for every line there has been)
      source.onended = () => {
        sounding.delete(source);
        source.disconnect();
      };
      spoken.push(key);
      if (who === 'warden') G.wild.feature('music')?.duck?.(at, buffer.duration, VOICE.duck);
    });
    return true;
  }

  /** WARDEN has put a line on the radio (src/wild/warden-live.js): it is said, if there is a clip of it. */
  ctx.voice = speak;

  return {
    name: 'voice',
    /** for tests and the curious */
    get state() {
      return {
        clips: Object.keys(files).length,
        spoken: [...spoken],
        sounding: sounding.size,
        waiting: address.waiting.map((w) => w.id),
        failed: { ...failed },
        until: { ...until },
        sent: { ...sent },
      };
    },
    /** for tests: a clip fetched from elsewhere; how long a clip is, decoded by this browser; a line said now */
    debug({ file } = {}) {
      if (file) Object.assign(files, file);
    },
    seconds(key) {
      graph = graph || G.audio.graph?.() || null;
      return graph && files[key] ? clip(key).then((buffer) => (buffer ? buffer.duration : 0)) : Promise.resolve(0);
    },
    speak,

    reset() {
      mission++;
      address = createAddress();
      spoken = [];
      until = {};
      pushed = false;
      alarmed = false;
      for (const source of sounding) source.stop();
      sounding.clear();
    },

    step() {
      const now = G.mission.time;
      // the alarm, by whatever it was raised — a machine, a charge, a tripwire, one of its own seen fired on —
      // and its standing down: the address reads out the one and the other
      const up = !!G.enemies.alarm.active;
      if (up !== alarmed) {
        alarmed = up;
        announce(address, up ? 'alarm' : 'clear', now);
      }
      // the drives being pushed has no event of its own either: the address speaks of it as it begins
      const pushing = !!G.wild.feature('overspeed')?.state.running;
      if (pushing && !pushed) announce(address, 'overspeed', now);
      pushed = pushing;
      for (const id of due(address, now)) speak('pa', id);
    },

    on: {
      blast() {
        if (G.mission) announce(address, 'blast', G.mission.time);
      },
      phase(phase) {
        if (phase === 'exfil' && G.mission) announce(address, 'evacuate', G.mission.time);
      },
    },
  };
}

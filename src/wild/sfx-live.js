// Firing, blasts and the centrifuges, joined to the game: the samples a video model's audio track gave
// (tools/sound/sfx.mjs), fetched and decoded without waiting on anything else, and played where the game has no
// call of its own yet. Which sounds the pack has is src/wild/sfx.js; the design and the gate are
// docs/WILD-sfx.md. It goes through the engine's one seam for more sounds than it was built with
// (src/audio/audio.js `extend`) and touches nothing else.
import { HALL, PACK, PRIORITY, SPIN_DOWN, dueBlasts } from './sfx.js';

/** every mp3 under sfx/, grouped by name in take order (the build names each file; this only sorts them) */
const FILES = {};
for (const [path, url] of Object.entries(
  import.meta.glob('./sfx/*.mp3', { query: '?url', import: 'default', eager: true }),
)) {
  const found = /^\.\/sfx\/([a-zA-Z]+)-(\d+)\.mp3$/.exec(path);
  if (!found) continue;
  (FILES[found[1]] ||= [])[Number(found[2])] = url;
}

/** a decoded sample almost always starts exactly on its sound: this is only insurance against an mp3 encoder's
 *  own lead-in silence, which not every decoder strips */
const LEAD_MAX_S = 0.2;
const LEAD_THRESHOLD = 0.01;

/** How much of a decoded buffer's start is silence below LEAD_THRESHOLD of full scale (seconds, capped). */
function leadOf(buffer) {
  const data = buffer.getChannelData(0);
  const max = Math.min(data.length, Math.round(buffer.sampleRate * LEAD_MAX_S));
  let i = 0;
  while (i < max && Math.abs(data[i]) < LEAD_THRESHOLD) i++;
  return i < max ? i / buffer.sampleRate : 0;
}

/** A sample, decoded: callback form (not the promise one) so Safari can do this before any user gesture. */
function decodeSample(bytes) {
  return new Promise((done, fail) => new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes, done, fail));
}

function fetchSample(url) {
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then(decodeSample)
    .then((buffer) => ({ buffer, lead: leadOf(buffer) }));
}

export function createSfxLive(ctx) {
  const { G } = ctx;
  // `?sfx=0`: the game's own sounds, as they were
  if (ctx.params.get('sfx') === '0') return null;
  // the `?noaudio=1` stand-in has neither: nothing of this pack is fetched into a game that cannot play it
  if (typeof G.audio?.extend !== 'function' || !G.audio.graph) return null;

  const files = { ...FILES };
  const loaded = [];
  const failed = {};
  let left = PRIORITY.length;
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });
  const tried = () => {
    if (--left <= 0) readyResolve();
  };

  /** One sound's recipe, built from its decoded takes (src/audio/audio.js: a one-shot `build`, or a loop's). */
  function recipeOf(name, takes) {
    const seconds = Math.max(...takes.map((t) => t.buffer.duration));
    const reach = PACK[name].reach;
    if (PACK[name].loop)
      return {
        seconds,
        reach,
        build(ac, dest) {
          const s = ac.createBufferSource();
          s.buffer = takes[0].buffer;
          s.connect(dest);
          s.start(0, takes[0].lead);
        },
      };
    return {
      seconds,
      takes: takes.length,
      reach,
      build(ac, dest, take) {
        const t = takes[take % takes.length];
        const s = ac.createBufferSource();
        s.buffer = t.buffer;
        s.connect(dest);
        s.start(0, t.lead);
      },
    };
  }

  function load(name) {
    const urls = files[name] || [];
    if (!urls.length || urls.includes(undefined)) {
      failed[name] = 'no file';
      console.warn(`sfx: "${name}" has no file to fetch`);
      tried();
      return Promise.resolve();
    }
    return Promise.all(urls.map(fetchSample))
      .then((takes) =>
        // Not before the wild build's own sounds are made (`ready`, src/wild/index.js): one of them may go by a
        // name this pack has too (pack A's shotgun), and whichever is handed to the engine last is the one that
        // stays. By the time a sample is fetched `G.wild` stands; were it ever not to, nothing waits.
        Promise.resolve(G.wild?.ready).then(() =>
          G.audio.extend(
            PACK[name].loop
              ? { loops: { [name]: recipeOf(name, takes) } }
              : { sounds: { [name]: recipeOf(name, takes) } },
          ),
        ),
      )
      .then(() => loaded.push(name))
      .catch((error) => {
        failed[name] = error?.message || String(error);
        console.warn(`sfx: "${name}" could not be made ready (${failed[name]})`);
      })
      .finally(tried);
  }

  // one after another, most-asked-for first: nothing here blocks the game's start (every step is async), and a
  // sound is in place as soon as ITS OWN takes are decoded — never waiting on the rest of the pack. Going one at
  // a time (rather than all firing together) also means the first sound is never slowed by competing for the
  // same connections and CPU as the others, and leaves a sound still unstarted (the last in PRIORITY) open to
  // test/wild/sfx.test.mjs pointing it elsewhere with `debug({ file })` before its turn comes up.
  PRIORITY.reduce((chain, name) => chain.then(() => load(name)), Promise.resolve());

  /** the centrifuge loop while the cascades stand, and its run-down once they go (see SPIN_DOWN) */
  let spin = null;
  let spinDown = null;
  /** the extra blasts due once the game's own first one has played: { from, given } (sfx.js `dueBlasts`), or null
   *  between missions */
  let blastQueue = null;

  function stopSpin() {
    spin?.stop(0.4);
    spin = null;
    spinDown = null;
  }

  return {
    name: 'sfx',
    get state() {
      return {
        wanted: [...PRIORITY],
        loaded: [...loaded],
        failed: { ...failed },
        ready,
        spinning: !!spin,
        windingDown: !!spinDown,
        blasting: !!blastQueue,
        given: blastQueue?.given ?? 0,
      };
    },
    /** for tests: a name's file(s) pointed elsewhere before its own fetch begins */
    debug({ file } = {}) {
      if (file) Object.assign(files, file);
    },

    reset() {
      stopSpin();
      blastQueue = null;
    },

    step(dt) {
      const m = G.mission;
      // the centrifuges spin for as long as the cascades stand; once the pack has the sample, it replaces
      // nothing kept quiet — it is a new loop (sfx.js: "the bed must not be tonal" does not bind it)
      if (m && !m.blown && loaded.includes('cascadeSpin') && !spin && !spinDown)
        spin = G.audio.loop('cascadeSpin', { x: HALL.x, y: HALL.y, z: HALL.z });
      if (spinDown) {
        spinDown.t += dt;
        const p = Math.min(1, spinDown.t / SPIN_DOWN.seconds);
        spin?.set({ rate: 1 + (SPIN_DOWN.rate - 1) * p, gain: 1 - p });
        if (p >= 1) stopSpin();
      }
      if (blastQueue && m) {
        for (const due of dueBlasts(blastQueue, m.time)) {
          const at = G.site.charges[due.charge];
          if (at) G.audio.play(due.sound, { x: at.x, y: due.y, z: at.z, rate: due.rate });
        }
      }
    },

    on: {
      /** the cascades blow: the game has already played its own first `cascadeBlast` at the hall by now — the
       *  centrifuge loop starts its run-down, and three more blasts are due at the charges (sfx.js BLAST_SCHEDULE) */
      blast() {
        if (spin) spinDown = spinDown || { t: 0 };
        blastQueue = { from: G.mission?.time ?? 0, given: 0 };
      },
    },
  };
}

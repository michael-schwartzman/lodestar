// The audio engine: renders every sound once with OfflineAudioContext, then plays them back against one real
// AudioContext created lazily on the first user gesture (unlock). See docs/DESIGN.md §8.5 for the contract
// this module implements, and src/core/silence.js for the shape it must fall back to if something goes wrong.
import { SOUNDS } from './sounds.js';
import { LOOPS } from './loops.js';
import { createMusic } from './music.js';
import { analyzeBuffer, tailPeak, seamDiff, fitPeak, stitchLoop, panner } from './synth.js';
import { tonalProminence, bareTone, heldFor, weightBelow, lasts, loudest } from './tone.js';
import { clamp, clamp01, smooth } from '../core/math.js';

const SAMPLE_RATE = 44100;
const LOOP_FADE = 0.3;
const MAX_VOICES = 24;
const MIN_REPEAT_GAP = 0.03;
/** a background bed may stand this far above its own surroundings at any frequency, and no further (tone.js) */
export const BED_TONE_LIMIT = 12;
const SOUND_NAMES = Object.keys(SOUNDS);
const LOOP_NAMES = Object.keys(LOOPS);

const getAudioCtor = () => window.AudioContext || window.webkitAudioContext;
const getOfflineCtor = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;

/**
 * Builds the game's audio engine. With `enabled: false` nothing Web Audio related is ever constructed and
 * every method is a harmless no-op — see `makeDisabledAudio` below.
 */
export function createAudio({ enabled = true } = {}) {
  if (!enabled) return makeDisabledAudio();

  let ctx = null; // the one real AudioContext; created only inside unlock()
  let master = null; // sfx bus -> compressor -> destination
  let musicGain = null; // music bus -> compressor -> destination
  let ambienceGain = null; // the background beds (loops.js `bed: true`) -> master: their own volume, under the master's
  let initDone = false;
  let initPromise = null;

  const oneShotBuffers = new Map(); // name -> AudioBuffer[]
  const loopBuffers = new Map(); // name -> AudioBuffer
  const warnedNames = new Set();
  const lastPlayed = new Map(); // name -> ctx.currentTime it last actually played
  const voices = []; // active one-shot voices: { source, peak, startedAt }
  const liveLoops = new Set(); // loop request state, pending or materialized
  const listener = { x: 0, y: 0, z: 0, yaw: 0 };
  const volume = { master: 1, music: 1, ambience: 1 };
  const musicEngine = createMusic();
  /** what selfTest() has measured of each one-shot buffer: asked for more than once, worked out once */
  const measured = new WeakMap();
  /** how fast everything is played: 1, unless time has been bent (the experiment, src/wild/focus.js) */
  let warp = 1;
  /** the wild build's, when it has set them (see `setMix`, `setScore`): nothing in the game does */
  let mix = null;
  let score = null;
  /** the scene the score was last told */
  let scene = 'none';

  /** Gain + pan for a sound given its opts and reach; falls off smoothly to 0 right at `reach` metres. */
  function spatial(opts, reach) {
    let gain = opts.gain ?? 1;
    let pan = 0;
    /** how far off it is, as a part of how far it carries: 0 for a sound with no place */
    let far = 0;
    if (opts.x != null || opts.y != null || opts.z != null) {
      const dx = (opts.x ?? 0) - listener.x;
      const dy = (opts.y ?? 0) - listener.y;
      const dz = (opts.z ?? 0) - listener.z;
      const dist = Math.hypot(dx, dy, dz);
      far = clamp01(dist / Math.max(1, reach));
      gain *= smooth(1 - far);
      const flat = Math.hypot(dx, dz);
      if (flat > 1e-4) {
        // right vector for this yaw convention (forward = (-sin yaw, 0, -cos yaw)) is (cos yaw, 0, -sin yaw)
        const rx = Math.cos(listener.yaw);
        const rz = -Math.sin(listener.yaw);
        pan = clamp((dx * rx + dz * rz) / flat, -1, 1);
      }
    }
    if (opts.muffled) gain *= 0.8;
    return { gain, pan, far };
  }

  function warnOnce(name) {
    if (warnedNames.has(name)) return;
    warnedNames.add(name);
    try {
      console.warn(`[audio] unknown sound name: "${name}"`);
    } catch (e) {
      /* ignore */
    }
  }

  function removeVoice(voice) {
    const i = voices.indexOf(voice);
    if (i >= 0) voices.splice(i, 1);
  }

  /** Keeps at most MAX_VOICES one-shots alive by stopping the quietest (then oldest) one first. */
  function makeRoomForVoice() {
    if (voices.length < MAX_VOICES) return;
    let worst = voices[0];
    for (const v of voices) {
      if (v.peak < worst.peak - 1e-6 || (Math.abs(v.peak - worst.peak) < 1e-6 && v.startedAt < worst.startedAt)) {
        worst = v;
      }
    }
    try {
      worst.source.stop();
    } catch (e) {
      /* already stopped */
    }
    removeVoice(worst);
  }

  function ensureGraph() {
    if (ctx) return;
    const Ctor = getAudioCtor();
    ctx = new Ctor();
    master = ctx.createGain();
    musicGain = ctx.createGain();
    ambienceGain = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 24;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    master.gain.value = volume.master;
    musicGain.gain.value = volume.music;
    ambienceGain.gain.value = volume.ambience;
    master.connect(compressor);
    musicGain.connect(compressor);
    ambienceGain.connect(master);
    compressor.connect(ctx.destination);
    musicEngine.start(ctx, musicGain);
    for (const state of liveLoops) tryMaterializeLoop(state);
  }

  /** Must run fully synchronously (no await before this point) so iOS counts it as part of the gesture. */
  function unlock() {
    try {
      ensureGraph();
      if (ctx.state !== 'running') ctx.resume();
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {
      /* never throw into the game */
    }
  }

  function play(name, opts = {}) {
    try {
      const recipe = SOUNDS[name];
      if (!recipe) {
        warnOnce(name);
        return;
      }
      if (!ctx || ctx.state !== 'running') return; // before unlock(): silently dropped
      const now = ctx.currentTime;
      if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_REPEAT_GAP) return;
      const buffers = oneShotBuffers.get(name);
      if (!buffers || !buffers.length) return; // init() still rendering — nothing to play yet
      const { gain, pan, far } = spatial(opts, recipe.reach);
      if (gain <= 0.001) return; // out of reach; don't spend a voice on silence
      lastPlayed.set(name, now);
      makeRoomForVoice();
      const buffer = buffers[(Math.random() * buffers.length) | 0];
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = (opts.rate ?? 1) * warp;
      const g = ctx.createGain();
      g.gain.value = gain;
      let node = source;
      // behind something it is dulled; and a mix (the wild build's) may say how far away a sound dulls
      const cut = opts.muffled ? 700 : mix ? mix.cut(far) : 20000;
      if (cut < 20000) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = cut;
        node.connect(f);
        node = f;
      }
      const p = panner(ctx, pan);
      if (p) {
        node.connect(p);
        node = p;
      }
      node.connect(g).connect(master);
      if (mix) mix.send(g, name, opts);
      source.start(0);
      const voice = { source, peak: gain, startedAt: now };
      voices.push(voice);
      source.onended = () => removeVoice(voice);
    } catch (e) {
      /* never throw into the game */
    }
  }

  function tryMaterializeLoop(state) {
    if (state.stopped || state.node || !ctx) return;
    const buffer = loopBuffers.get(state.name);
    if (!buffer) return; // init() still rendering this loop
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 20000; // effectively transparent unless muffled
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = panner(ctx, 0);
    source.connect(filter);
    pan ? filter.connect(pan).connect(gain) : filter.connect(gain);
    // a background bed goes through the Ambience volume; everything else straight to the master
    gain.connect(LOOPS[state.name].bed ? ambienceGain : master);
    source.start(0);
    state.node = { source, filter, gain, pan };
    if (mix) mix.send(gain, state.name, state.opts);
    applyLoopParams(state);
  }

  function applyLoopParams(state) {
    const node = state.node;
    if (!node || !ctx) return;
    const recipe = LOOPS[state.name];
    const { gain, pan, far } = spatial(state.opts, recipe.reach);
    const now = ctx.currentTime;
    node.gain.gain.setTargetAtTime(gain, now, 0.05);
    if (node.pan) node.pan.pan.setTargetAtTime(pan, now, 0.05);
    node.filter.frequency.setTargetAtTime(state.opts.muffled ? 700 : mix ? mix.cut(far) : 20000, now, 0.05);
    node.source.playbackRate.value = (state.opts.rate ?? 1) * warp;
  }

  function stopLoopNode(node, fadeSeconds) {
    const now = ctx.currentTime;
    node.gain.gain.cancelScheduledValues(now);
    node.gain.gain.setValueAtTime(node.gain.gain.value, now);
    node.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.01, fadeSeconds));
    try {
      node.source.stop(now + Math.max(0.01, fadeSeconds) + 0.05);
    } catch (e) {
      /* already stopped */
    }
  }

  function loop(name, opts = {}) {
    try {
      if (!LOOPS[name]) {
        warnOnce(name);
        return { set() {}, stop() {} };
      }
      const state = {
        name,
        opts: { x: opts.x, y: opts.y, z: opts.z, gain: opts.gain ?? 1, rate: opts.rate ?? 1, muffled: !!opts.muffled },
        node: null,
        stopped: false,
      };
      liveLoops.add(state);
      tryMaterializeLoop(state);
      return {
        set(o = {}) {
          try {
            Object.assign(state.opts, o);
            applyLoopParams(state);
          } catch (e) {
            /* never throw into the game */
          }
        },
        stop(fadeSeconds = 0.25) {
          try {
            state.stopped = true;
            liveLoops.delete(state);
            if (state.node) stopLoopNode(state.node, fadeSeconds);
          } catch (e) {
            /* never throw into the game */
          }
        },
      };
    } catch (e) {
      return { set() {}, stop() {} };
    }
  }

  function safeProgress(onProgress, fraction) {
    try {
      if (onProgress) onProgress(fraction);
    } catch (e) {
      /* a misbehaving caller shouldn't break rendering */
    }
  }

  /** Renders every take of one sound (a recipe of sounds.js) into its buffers. `tick` is called after each take. */
  async function renderSound(key, tick) {
    const OfflineCtor = getOfflineCtor();
    const recipe = SOUNDS[key];
    const takes = recipe.takes || 1;
    const channels = recipe.channels || 1;
    const length = Math.max(1, Math.round(recipe.seconds * SAMPLE_RATE));
    const buffers = [];
    for (let take = 0; take < takes; take++) {
      try {
        const offline = new OfflineCtor(channels, length, SAMPLE_RATE);
        recipe.build(offline, offline.destination, take);
        const buffer = await offline.startRendering();
        fitPeak(buffer, { min: 0.06, max: 0.95 });
        buffers.push(buffer);
      } catch (e) {
        try {
          console.warn(`[audio] failed to render "${key}" take ${take}:`, e);
        } catch (e2) {
          /* ignore */
        }
      }
      tick?.();
    }
    oneShotBuffers.set(key, buffers);
  }

  /** Renders one loop (a recipe of loops.js), and joins its end to its beginning. */
  async function renderLoop(key) {
    const OfflineCtor = getOfflineCtor();
    const recipe = LOOPS[key];
    const channels = recipe.channels || 1;
    const length = Math.max(1, Math.round(recipe.seconds * SAMPLE_RATE));
    try {
      const offline = new OfflineCtor(channels, length, SAMPLE_RATE);
      recipe.build(offline, offline.destination);
      const rendered = await offline.startRendering();
      const stitched = stitchLoop(rendered, LOOP_FADE);
      fitPeak(stitched, { min: 0.06, max: 0.95 });
      loopBuffers.set(key, stitched);
    } catch (e) {
      try {
        console.warn(`[audio] failed to render loop "${key}":`, e);
      } catch (e2) {
        /* ignore */
      }
    }
  }

  async function init(onProgress) {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const soundTotal = SOUND_NAMES.reduce((n, key) => n + (SOUNDS[key].takes || 1), 0);
      const total = soundTotal + LOOP_NAMES.length;
      let done = 0;
      const tick = () => safeProgress(onProgress, ++done / total);
      for (const key of SOUND_NAMES) await renderSound(key, tick);
      for (const key of LOOP_NAMES) {
        await renderLoop(key);
        tick();
      }
      initDone = true;
      for (const state of liveLoops) tryMaterializeLoop(state);
    })();
    return initPromise;
  }

  /**
   * More sounds than the game was built with — the experiment's (src/wild/sounds.js): recipes of the shape
   * sounds.js and loops.js have, rendered now, after the game's own. From then on they are played, measured and
   * checked (selfTest) like any other.
   */
  async function extend({ sounds = {}, loops = {} } = {}) {
    await init();
    for (const key of Object.keys(sounds)) {
      SOUNDS[key] = sounds[key];
      await renderSound(key);
    }
    for (const key of Object.keys(loops)) {
      LOOPS[key] = loops[key];
      await renderLoop(key);
    }
    for (const state of liveLoops) tryMaterializeLoop(state);
  }

  function setVolume({ master: m, music: mu, ambience: am } = {}) {
    try {
      if (m != null) {
        volume.master = clamp01(m);
        if (master) master.gain.setTargetAtTime(volume.master, ctx.currentTime, 0.05);
      }
      if (mu != null) {
        volume.music = clamp01(mu);
        if (musicGain) musicGain.gain.setTargetAtTime(volume.music, ctx.currentTime, 0.05);
      }
      if (am != null) {
        volume.ambience = clamp01(am);
        if (ambienceGain) ambienceGain.gain.setTargetAtTime(volume.ambience, ctx.currentTime, 0.05);
      }
    } catch (e) {
      /* never throw into the game */
    }
  }

  function setListener(x, y, z, yaw) {
    try {
      listener.x = x;
      listener.y = y;
      listener.z = z;
      listener.yaw = yaw;
    } catch (e) {
      /* never throw into the game */
    }
  }

  function music(stateName) {
    try {
      scene = stateName;
      (score || musicEngine).setState(stateName);
    } catch (e) {
      /* never throw into the game */
    }
  }

  function update(dt) {
    try {
      if (!ctx) return;
      for (const state of liveLoops) {
        if (!state.node) tryMaterializeLoop(state);
        else applyLoopParams(state);
      }
      (score || musicEngine).update(dt);
    } catch (e) {
      /* never throw into the game */
    }
  }

  function checkBuffer(label, buffer, problems, { loop }) {
    const { peak, rms, dc, finite } = analyzeBuffer(buffer);
    if (!finite) problems.push(`${label}: contains non-finite samples`);
    if (peak < 0.05 || peak > 1.0) problems.push(`${label}: peak ${peak.toFixed(3)} outside [0.05, 1.0]`);
    if (rms <= 0.004) problems.push(`${label}: rms ${rms.toFixed(4)} too quiet`);
    if (Math.abs(dc) > 0.05) problems.push(`${label}: DC offset ${dc.toFixed(3)}`);
    if (loop) {
      const seam = seamDiff(buffer);
      if (seam >= 0.05) problems.push(`${label}: loop seam mismatch ${seam.toFixed(3)}`);
    } else {
      const tail = tailPeak(buffer, 10);
      if (tail >= 0.02) problems.push(`${label}: does not end in silence (tail peak ${tail.toFixed(3)})`);
    }
    const entry = { name: label, seconds: buffer.duration, peak, rms };
    if (loop) {
      // how much of it is a steady note: a background bed — and a drone — must be a hush, not a hum
      entry.bed = !!LOOPS[label]?.bed;
      entry.hush = entry.bed || !!LOOPS[label]?.hush;
      entry.tonal = tonalProminence(buffer.getChannelData(0), buffer.sampleRate);
      if (entry.hush && entry.tonal >= BED_TONE_LIMIT)
        problems.push(`${label}: a steady tone stands ${entry.tonal.toFixed(1)} dB out of this sound`);
    } else {
      // what a one-shot is like (tone.js), for the tests that hold the sounds to having weight: how much of it
      // is one bare note; how much is low down, and high up; how long it lasts; how loud it is at its loudest.
      // Worked out once for each buffer: this is asked more than once.
      if (!measured.has(buffer)) {
        const samples = buffer.getChannelData(0);
        const rate = buffer.sampleRate;
        measured.set(buffer, {
          bleep: bareTone(samples, rate),
          low: weightBelow(samples, rate, 250),
          high: 1 - weightBelow(samples, rate, 2000),
          lasts: lasts(samples, rate),
          loud: loudest(samples, rate),
        });
      }
      Object.assign(entry, measured.get(buffer));
    }
    return entry;
  }

  function selfTest() {
    try {
      if (!initDone) return { ok: false, problems: ['init() has not completed yet'], sounds: [] };
      const problems = [];
      const sounds = [];
      for (const [name, buffers] of oneShotBuffers) {
        buffers.forEach((buffer, i) => {
          const label = buffers.length > 1 ? `${name}#${i}` : name;
          sounds.push(checkBuffer(label, buffer, problems, { loop: false }));
        });
      }
      for (const [name, buffer] of loopBuffers) {
        sounds.push(checkBuffer(name, buffer, problems, { loop: true }));
      }
      if (sounds.length < 40) problems.push(`only ${sounds.length} buffers rendered, expected at least 40`);
      return { ok: problems.length === 0, problems, sounds };
    } catch (e) {
      return { ok: false, problems: [String(e && e.message ? e.message : e)], sounds: [] };
    }
  }

  function dispose() {
    try {
      for (const v of voices.slice()) {
        try {
          v.source.stop();
        } catch (e) {
          /* already stopped */
        }
      }
      voices.length = 0;
      for (const state of liveLoops) {
        if (state.node) {
          try {
            state.node.source.stop();
          } catch (e) {
            /* already stopped */
          }
        }
      }
      liveLoops.clear();
      musicEngine.dispose();
      if (ctx) ctx.close();
      ctx = null;
    } catch (e) {
      /* never throw into the game */
    }
  }

  return {
    init,
    unlock,
    get state() {
      try {
        if (!ctx) return 'locked';
        return ctx.state === 'running' ? 'running' : 'locked';
      } catch (e) {
        return 'locked';
      }
    },
    setVolume,
    setListener,
    play,
    loop,
    music,
    update,
    selfTest,
    names: SOUND_NAMES,
    loopNames: LOOP_NAMES,
    dispose,
    extend,
    /** Everything is played this many times as fast from now on — what is already sounding in a loop as well. */
    warp(k) {
      warp = k;
    },
    // ---- the wild build's sound goes through these three (src/wild); the game itself sets none of them ----
    /** What the engine is built of, once it runs: its clock and the three buses everything goes to. */
    graph: () => (ctx ? { ctx, master, music: musicGain, ambience: ambienceGain } : null),
    /**
     * A mix: `send(node, name, opts)` is handed every voice as it starts (to give it a room), and `cut(far)` is
     * asked at what frequency a sound so far off — as a part of how far it carries — is dulled. Says what was set.
     */
    setMix(next) {
      const was = mix;
      mix = next;
      if (mix) for (const state of liveLoops) if (state.node) mix.send(state.node.gain, state.name, state.opts);
      return was;
    },
    /** A score that is told the scene, and stepped, instead of the game's own — which is then silent. */
    setScore(next) {
      const was = score;
      score = next;
      musicEngine.setState(next ? 'none' : scene);
      return was;
    },
    // Not part of the game's contract: lets tools/preview/audio.html draw real waveforms from the same
    // buffers selfTest() inspected, without exposing anything new to the rest of the game.
    debugBuffers() {
      return { sounds: oneShotBuffers, loops: loopBuffers };
    },
    /**
     * Also not part of the game's contract: renders the score of a scene into a buffer and measures it, so that a
     * test can hold it to being a hush, a beat and a tune — never a hum. Without `hits`, only what plays ALL THE
     * TIME (the layers that never stop); with `hits`, the step sequencer is run as well, and the score is played —
     * keep `seconds` under 8, when the first rare ring of metal comes, to leave that out.
     * `tonal`: how far a steady note stands out of it (dB); `held`: how long its longest-held note holds (s).
     * @returns {Promise<{ rms: number, peak: number, tonal: number, held: number }>}
     */
    async debugMusicBed(scene, seconds = 6, { hits = false } = {}) {
      const OfflineCtor = getOfflineCtor();
      const offline = new OfflineCtor(1, Math.round(seconds * SAMPLE_RATE), SAMPLE_RATE);
      const score = createMusic();
      score.setState(scene);
      score.start(offline, offline.destination);
      if (hits && typeof offline.suspend === 'function') {
        // the sequencer looks 0.15 s ahead, so it is woken a little more often than that
        const STEP = 0.1;
        for (let t = STEP; t < seconds - 0.01; t += STEP)
          offline.suspend(t).then(() => {
            score.update(STEP);
            offline.resume();
          });
      }
      const buffer = await offline.startRendering();
      const { rms, peak } = analyzeBuffer(buffer);
      const samples = buffer.getChannelData(0);
      return { rms, peak, tonal: tonalProminence(samples, SAMPLE_RATE), held: heldFor(samples, SAMPLE_RATE) };
    },
  };
}

/** The enabled:false path: every method is inert, nothing Web Audio related is ever touched. */
function makeDisabledAudio() {
  const inertLoop = { set() {}, stop() {} };
  return {
    async init() {},
    unlock() {},
    get state() {
      return 'off';
    },
    setVolume() {},
    setListener() {},
    play() {},
    loop() {
      return inertLoop;
    },
    music() {},
    update() {},
    selfTest() {
      return { ok: true, problems: [], sounds: [] };
    },
    names: SOUND_NAMES,
    loopNames: LOOP_NAMES,
    dispose() {},
    debugBuffers() {
      return { sounds: new Map(), loops: new Map() };
    },
    async debugMusicBed() {
      return { rms: 0, peak: 0, tonal: 0, held: 0 };
    },
  };
}

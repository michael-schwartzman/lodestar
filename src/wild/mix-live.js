// The room in the sound, joined to the game's engine: five spaces built once, every voice sent round the one the
// listener stands in. The rules and the arithmetic are src/wild/mix.js; the design is docs/WILD.md, "The room in
// the sound". It goes through the engine's seams (src/audio/audio.js `graph`, `setMix`) and touches nothing else.
import { SPACES, cutAt, impulse, sendOf, spaceOf } from './mix.js';

/** seconds over which one space gives way to the next as the listener walks from one into the other */
const CROSS = 0.6;

export function createMixLive(ctx) {
  const { G } = ctx;
  /** once sound runs: the engine's clock, the bus every send goes to, and the five spaces */
  let built = null;
  let space = '';
  let sends = 0;

  function build(graph) {
    const ac = graph.ctx;
    const bus = ac.createGain();
    const rooms = {};
    for (const [name, spec] of Object.entries(SPACES)) {
      const [left, right] = impulse(name, ac.sampleRate);
      const buffer = ac.createBuffer(2, left.length, ac.sampleRate);
      buffer.copyToChannel(left, 0);
      buffer.copyToChannel(right, 1);
      const room = ac.createConvolver();
      // (the answer already holds exactly a click's energy: the engine is not to scale it again)
      room.normalize = false;
      room.buffer = buffer;
      const input = ac.createGain();
      input.gain.value = 0;
      const out = ac.createGain();
      out.gain.value = spec.wet;
      bus.connect(input).connect(room).connect(out).connect(graph.master);
      rooms[name] = { input, buffer };
    }
    return { ac, bus, rooms };
  }

  /** what the engine is handed (audio.js `setMix`) */
  const mix = {
    send(node, name) {
      const amount = sendOf(name);
      if (!amount) return;
      const g = built.ac.createGain();
      g.gain.value = amount;
      node.connect(g).connect(built.bus);
      sends++;
    },
    cut: cutAt,
  };

  return {
    name: 'mix',
    /** for tests and the curious */
    get state() {
      return { built: !!built, space, sends };
    },
    /** for tests: what a space does to a click, as the engine holds it */
    answer: (name) => built?.rooms[name]?.buffer || null,
    /** Another feature's own voice (a gain node), sent round the room the listener is in; false until there is one. */
    send(node, amount) {
      if (!built) return false;
      const g = built.ac.createGain();
      g.gain.value = amount;
      node.connect(g).connect(built.bus);
      return true;
    },

    frame() {
      if (!built) {
        // sound runs from the player's first key or touch: until then there is nothing to build in
        const graph = G.audio.graph?.();
        if (!graph) return;
        built = build(graph);
        G.audio.setMix(mix);
      }
      // where the LISTENER is: the eye — the drone's, when one is flown
      const at = G.camera.position;
      const next = spaceOf(ctx.lib.zone(at.x, at.z), G.world.openSky(at.x, at.z));
      if (next === space) return;
      const now = built.ac.currentTime;
      for (const [name, room] of Object.entries(built.rooms))
        room.input.gain.setTargetAtTime(name === next ? 1 : 0, now, CROSS / 3);
      space = next;
    },
  };
}

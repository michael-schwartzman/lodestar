// The shape of the game's sound, with nothing behind it. Used when sound cannot be had at all, so that the rest
// of the game never has to ask whether there is any.
const handle = { set() {}, stop() {} };

export function createSilence() {
  return {
    state: 'off',
    names: [],
    loopNames: [],
    init: async () => {},
    unlock() {},
    setVolume() {},
    setListener() {},
    play() {},
    loop: () => handle,
    music() {},
    update() {},
    selfTest: () => ({ ok: true, problems: [], sounds: [] }),
    dispose() {},
  };
}

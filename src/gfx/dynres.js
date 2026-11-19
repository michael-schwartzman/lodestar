// Keeps the picture smooth by drawing fewer pixels when frames run long, and more again when they do not.
//
// It is a small controller with no knowledge of the browser: feed it each frame's length, read back the scale.
// The one rule that matters on a phone: after the screen is re-shaped (turned, resized) it HOLDS for a while,
// because the slow frames of the turn itself say nothing about the device. test/unit/dynres.test.mjs pins that.
export function createDynRes({
  min = 0.6,
  max = 1,
  step = 0.1,
  /** frames slower than this (ms, averaged) count as too slow */
  slowMs = 24,
  /** frames quicker than this count as having room to spare */
  fastMs = 15,
  /** seconds of "too slow" before stepping down */
  downAfter = 1,
  /** seconds of "room to spare" before stepping up */
  upAfter = 4,
  /** a single frame longer than this is a stall (hidden tab, a turn), not a measurement */
  stallMs = 200,
  enabled = true,
} = {}) {
  const state = {
    scale: max,
    /** the smallest the picture is ever drawn */
    min,
    average: 16,
    slowFor: 0,
    fastFor: 0,
    holdFor: 0,
    enabled,
    /**
     * @param {number} ms how long the last frame took
     * @returns {number} the scale to draw the next frame at
     */
    frame(ms) {
      if (!state.enabled) return state.scale;
      if (ms > stallMs) {
        // never learn from a stall, and distrust what follows it for a moment
        state.slowFor = 0;
        state.fastFor = 0;
        state.holdFor = Math.max(state.holdFor, 0.5);
        return state.scale;
      }
      const dt = ms / 1000;
      if (state.holdFor > 0) {
        state.holdFor = Math.max(0, state.holdFor - dt);
        state.slowFor = 0;
        state.fastFor = 0;
        state.average = 16;
        return state.scale;
      }
      state.average += (ms - state.average) * 0.1;
      if (state.average > slowMs) {
        state.slowFor += dt;
        state.fastFor = 0;
        if (state.slowFor >= downAfter && state.scale > min) {
          state.scale = Math.max(min, Number((state.scale - step).toFixed(3)));
          state.slowFor = 0;
          state.average = 16;
        }
      } else if (state.average < fastMs) {
        state.fastFor += dt;
        state.slowFor = 0;
        if (state.fastFor >= upAfter && state.scale < max) {
          state.scale = Math.min(max, Number((state.scale + step).toFixed(3)));
          state.fastFor = 0;
        }
      } else {
        state.slowFor = 0;
        state.fastFor = 0;
      }
      return state.scale;
    },
    /** Ignore frame times for this many seconds (the screen was just re-shaped). */
    hold(seconds = 2) {
      state.holdFor = Math.max(state.holdFor, seconds);
      state.slowFor = 0;
      state.fastFor = 0;
    },
  };
  return state;
}

// The WebGL canvas: how big it is drawn, and keeping that right when the page is re-shaped.
import * as THREE from 'three';
import { createDynRes } from './dynres.js';

/** What each detail level costs. `Auto` is settled once, at start, and never changes while playing. */
export const QUALITY = {
  // post: the finishing passes (gfx/post.js); msaa: samples for smoothing edges there (0: a cheaper pass does it);
  // bevel / round: how finely models are built (gfx/geo.js); detail: bump maps (gfx/detail.js);
  // artSize: which size of the pictures in src/assets/art is asked for (gfx/art.js)
  low: {
    ratioCap: 1.5,
    textureSize: 256,
    artSize: 256,
    particles: 0.5,
    antialias: false,
    anisotropy: 2,
    post: true,
    msaa: 0,
    bloom: 4,
    bevel: false,
    round: 1,
    detail: true,
  },
  medium: {
    ratioCap: 2,
    textureSize: 512,
    artSize: 512,
    particles: 1,
    antialias: true,
    anisotropy: 4,
    post: true,
    msaa: 4,
    bloom: 5,
    bevel: true,
    round: 1.5,
    detail: true,
  },
  high: {
    ratioCap: 2.5,
    textureSize: 512,
    artSize: 1024,
    particles: 1.5,
    antialias: true,
    anisotropy: 8,
    post: true,
    msaa: 4,
    bloom: 6,
    bevel: true,
    round: 2,
    detail: true,
  },
};

/** Turns the player's choice into a level. A phone or a small screen starts low. */
export function resolveQuality(choice, { touch, width, height }) {
  if (choice !== 'auto' && QUALITY[choice]) return choice;
  if (touch || Math.min(width, height) < 500) return 'low';
  return 'medium';
}

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {'low' | 'medium' | 'high'} o.quality
 * @param {boolean} [o.dynamic=true] let the drawing resolution follow the frame rate
 * @param {boolean} [o.post=true] the finishing passes are wanted (gfx/post.js): they smooth edges themselves, so
 *   the canvas need not
 */
export function createRenderer({ canvas, quality, dynamic = true, post = true }) {
  const level = QUALITY[quality];
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: level.antialias && !(post && level.post),
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 1);
  renderer.info.autoReset = false;

  const dynres = createDynRes({ enabled: dynamic });
  const listeners = new Set();
  const size = { width: 0, height: 0, pixelWidth: 0, pixelHeight: 0, aspect: 1, ratio: 1 };
  let rawRatio = 0;

  /**
   * Makes the drawing buffer fit the canvas's box. Called every frame — it is a handful of comparisons — so that it
   * does not matter which event, if any, the browser sent when the page changed shape. A ResizeObserver also calls
   * it, which keeps the picture right while nothing is being drawn.
   */
  function fit() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return false;
    const deviceRatio = window.devicePixelRatio || 1;
    // the phone's own ratio is compared, not the capped one: a change that the cap hides is still a re-shape
    const reshaped = width !== size.width || height !== size.height || deviceRatio !== rawRatio;
    if (reshaped) {
      size.width = width;
      size.height = height;
      size.aspect = width / height;
      rawRatio = deviceRatio;
      dynres.hold(2);
    }
    const ratio = Math.min(deviceRatio, level.ratioCap) * dynres.scale;
    const pixelWidth = Math.max(2, Math.round(width * ratio));
    const pixelHeight = Math.max(2, Math.round(height * ratio));
    if (pixelWidth !== size.pixelWidth || pixelHeight !== size.pixelHeight) {
      size.pixelWidth = pixelWidth;
      size.pixelHeight = pixelHeight;
      size.ratio = ratio;
      renderer.setPixelRatio(1);
      renderer.setSize(pixelWidth, pixelHeight, false);
    }
    if (reshaped) for (const fn of listeners) fn(size);
    return reshaped;
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fit()).observe(canvas);
  window.addEventListener('resize', () => fit());
  window.visualViewport?.addEventListener('resize', () => fit());
  fit();

  return {
    renderer,
    size,
    level,
    quality,
    dynres,
    fit,
    /** Tells the picture-size controller how long the last frame took. */
    frame(ms) {
      dynres.frame(ms);
    },
    /** Calls fn(size) whenever the canvas's box or the device's pixel ratio changes. */
    onResize(fn) {
      listeners.add(fn);
      if (size.width) fn(size);
      return () => listeners.delete(fn);
    },
  };
}

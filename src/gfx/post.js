// The finishing passes: what turns a picture of lit surfaces into a photograph of a place at night.
//
// The world is drawn, not to the screen, but into a picture that can hold values brighter than white. Then:
//   bloom      whatever is brighter than white spills over what is beside it, as it does in an eye or a lens —
//              found at half size, halved again and again, and added back on the way up
//   composite  exposure, night vision, a grade (cool shadows, warm lamps), the tone curve, a darkening towards
//              the corners, a little colour fringing there, film grain
//   edges      smoothed by the picture's own extra samples where the device has them, by a pass (FXAA) where not
//
// Where the device cannot hold bright values at all, none of this is used and every material finishes itself,
// as it always could (gfx/materials.js lodeFinish): `enabled` says which. That decision is gfx/shade.js postPlan.
import * as THREE from 'three';
import { shared } from './materials.js';
import { bloomChain, postPlan } from './shade.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// the first step of the bloom: half size, and only what is brighter than white
const PREFILTER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c = min(c * 0.25, vec3(24.0));
  float bright = max(c.r, max(c.g, c.b));
  // a soft knee: it comes in gently just under the threshold, not at a hard line
  float knee = uThreshold * 0.6;
  float soft = clamp(bright - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  gl_FragColor = vec4(c * max(soft, bright - uThreshold) / max(bright, 1e-4), 1.0);
}
`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.125, 1.0);
}
`;

// added onto the step above it
const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uSpread;
varying vec2 vUv;
void main() {
  vec2 d = uTexel * 0.5;
  vec3 c = texture2D(tSrc, vUv + vec2(-d.x, -d.y)).rgb
         + texture2D(tSrc, vUv + vec2(d.x, -d.y)).rgb
         + texture2D(tSrc, vUv + vec2(-d.x, d.y)).rgb
         + texture2D(tSrc, vUv + vec2(d.x, d.y)).rgb;
  gl_FragColor = vec4(c * 0.25 * uSpread, 1.0);
}
`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uNight;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;
uniform float uFringe;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 c = vUv - 0.5;
  // a lens is not perfect: towards the corners red and blue part company a little
  vec2 off = c * dot(c, c) * uFringe;
  vec3 col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
  col += texture2D(tBloom, vUv).rgb * uBloom;
  col *= uExposure;

  if (uNight > 0.0) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float amp = pow(lum, 0.6) * 1.35;
    float grain = hash(gl_FragCoord.xy + fract(uTime) * 97.0);
    float line = 0.94 + 0.06 * sin(gl_FragCoord.y * 1.6);
    col = mix(col, vec3(0.16, 1.0, 0.42) * amp * (0.86 + 0.28 * grain) * line, uNight);
  }

  // the grade: a little more colour, the dark a little blue, the lamps a little warm — less of it through goggles
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float grade = 1.0 - uNight;
  col = mix(vec3(lum), col, 1.0 + 0.1 * grade);
  col *= mix(vec3(1.0), mix(vec3(0.92, 0.99, 1.1), vec3(1.06, 1.0, 0.92), smoothstep(0.02, 0.7, lum)), grade);

  // the tone curve, then the screen's own
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  col = pow(col, vec3(1.0 / 2.2));

  // darker towards the corners
  float edge = smoothstep(0.35, 0.98, length(c * vec2(1.0, 0.85)) * 1.25);
  col *= 1.0 - uVignette * edge * edge;

  // film grain: finer than a pixel can be, changing every frame, strongest in the dark
  float g = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) + hash(gl_FragCoord.yx + fract(uTime * 3.17) * 71.0) - 1.0;
  col += g * uGrain * (1.0 - 0.65 * dot(col, vec3(0.333)));
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// FXAA, the short form: find the edge from the brightness of five points, blur along it
const FXAA = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}
void main() {
  vec3 m = texture2D(tSrc, vUv).rgb;
  float lNW = luma(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  float lNE = luma(texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb);
  float lSW = luma(texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb);
  float lSE = luma(texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  float lM = luma(m);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  float scale = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * scale, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv + dir * -0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
  float lB = luma(b);
  gl_FragColor = vec4(lB < lMin || lB > lMax ? a : b, 1.0);
}
`;

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} o
 * @param {object} o.level    the detail level's row of QUALITY (renderer.js): post, msaa, bloom
 * @param {boolean} [o.wanted=true] false to go without (the address says ?post=0)
 */
export function createPost(renderer, { level, wanted = true }) {
  const can = {
    webgl2: renderer.capabilities.isWebGL2 !== false,
    halfFloat:
      renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float'),
  };
  const plan = postPlan(level, can, wanted);
  const post = {
    enabled: plan.enabled,
    plan,
    can,
    /** what can be turned by hand: how much bloom, vignette, grain and colour fringing */
    look: { bloom: 0.85, threshold: 1.0, vignette: 0.42, grain: 0.05, fringe: level.msaa ? 0.003 : 0 },
    size: [0, 0],
    resize() {},
    begin() {},
    end() {},
    /** Goes without, for good: every material finishes itself from the next frame on. */
    disable() {
      post.enabled = false;
      shared.uPost.value = 0;
      renderer.setRenderTarget(null);
    },
  };
  if (!plan.enabled) return post;

  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  triangle.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const mesh = new THREE.Mesh(triangle);
  mesh.frustumCulled = false;
  const stage = new THREE.Scene();
  stage.add(mesh);
  const eye = new THREE.Camera();

  const pass = (fragmentShader, uniforms, extra = {}) =>
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      ...extra,
    });
  const texel = () => ({ value: new THREE.Vector2() });
  const prefilter = pass(PREFILTER, { tSrc: { value: null }, uTexel: texel(), uThreshold: { value: 1 } });
  const down = pass(DOWN, { tSrc: { value: null }, uTexel: texel() });
  const up = pass(
    UP,
    { tSrc: { value: null }, uTexel: texel(), uSpread: { value: 1 } },
    {
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    },
  );
  const composite = pass(COMPOSITE, {
    tScene: { value: null },
    tBloom: { value: null },
    uBloom: { value: 1 },
    uExposure: shared.uExposure,
    uNight: shared.uNight,
    uTime: shared.uTime,
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uFringe: { value: 0 },
  });
  const fxaa = pass(FXAA, { tSrc: { value: null }, uTexel: texel() });

  const half = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  let scene = null;
  let ldr = null;
  let chain = [];

  function build(width, height) {
    scene?.dispose();
    ldr?.dispose();
    for (const target of chain) target.dispose();
    scene = new THREE.WebGLRenderTarget(width, height, { ...half, depthBuffer: true, samples: plan.samples });
    ldr = plan.fxaa
      ? new THREE.WebGLRenderTarget(width, height, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
        })
      : null;
    chain = bloomChain(width, height, level.bloom || 5).map(
      ([w, h]) => new THREE.WebGLRenderTarget(w, h, { ...half, depthBuffer: false }),
    );
    post.size = [width, height];
  }

  const draw = (material, target) => {
    mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(stage, eye);
  };

  /** Keeps the pictures the size of the canvas's drawing buffer. Call every frame: it is two comparisons. */
  post.resize = (width, height) => {
    if (post.enabled && (width !== post.size[0] || height !== post.size[1])) build(width, height);
  };

  /** From here until end(), whatever is drawn goes into the bright picture. */
  post.begin = () => {
    if (!post.enabled) return;
    shared.uPost.value = 1;
    renderer.setRenderTarget(scene);
  };

  /** Bloom, composite, and out to the screen. */
  post.end = () => {
    if (!post.enabled) return;
    const look = post.look;
    prefilter.uniforms.tSrc.value = scene.texture;
    prefilter.uniforms.uTexel.value.set(0.5 / scene.width, 0.5 / scene.height);
    prefilter.uniforms.uThreshold.value = look.threshold;
    draw(prefilter, chain[0]);
    for (let i = 1; i < chain.length; i++) {
      down.uniforms.tSrc.value = chain[i - 1].texture;
      down.uniforms.uTexel.value.set(1 / chain[i - 1].width, 1 / chain[i - 1].height);
      draw(down, chain[i]);
    }
    for (let i = chain.length - 2; i >= 0; i--) {
      up.uniforms.tSrc.value = chain[i + 1].texture;
      up.uniforms.uTexel.value.set(1 / chain[i + 1].width, 1 / chain[i + 1].height);
      draw(up, chain[i]);
    }
    composite.uniforms.tScene.value = scene.texture;
    composite.uniforms.tBloom.value = chain[0].texture;
    composite.uniforms.uBloom.value = look.bloom / chain.length;
    composite.uniforms.uVignette.value = look.vignette;
    composite.uniforms.uGrain.value = look.grain;
    composite.uniforms.uFringe.value = look.fringe;
    draw(composite, ldr);
    if (ldr) {
      fxaa.uniforms.tSrc.value = ldr.texture;
      fxaa.uniforms.uTexel.value.set(1 / ldr.width, 1 / ldr.height);
      draw(fxaa, null);
    }
    renderer.setRenderTarget(null);
  };

  // make them once now, and see that the device really will draw into them: some say they can and cannot
  try {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    build(Math.max(2, size.x), Math.max(2, size.y));
    renderer.setRenderTarget(scene);
    const gl = renderer.getContext();
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    renderer.setRenderTarget(null);
    if (!complete) throw new Error('the bright picture cannot be drawn into');
  } catch (error) {
    console.warn(`finishing passes switched off: ${error.message}`);
    post.disable();
  }
  return post;
}

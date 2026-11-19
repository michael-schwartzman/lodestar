// Every surface in the game is drawn by one of the small shader programs made here.
//
// Where the light is and how much of it there is was worked out beforehand, once, per corner of every surface
// (world/build.js) — that is what lets a phone draw the whole site. What it LOOKS like is worked out per pixel:
// each corner also carries an arrow pointing the way most of its light came (gfx/shade.js createLightSum), and
// with that the shader can tilt a surface by its bump map, put the highlight of the lamp on wet ground or on
// steel, and let a bevelled edge catch the light — without ever knowing where a lamp is.
//
//   lit({ baked: true })  level surfaces and furniture — the `color` attribute IS the light, `ldir` is its arrow
//   lit()                 moving things — `color` is paint, light and arrow come from the spot they stand on
//   glow()                things that give off light: lamps, eyes, screens, tracers
//   beam()                the haze a lamp lights up in the air beneath it
//
// All of them finish through the same last step (fog, then lodeFinish), so the picture stays of a piece. When
// the finishing passes are on (gfx/post.js) that step hands the light over as it is and the passes do the rest.
import * as THREE from 'three';
import { RELIGHT_FLOOR } from './shade.js';
import { MATTER_NAMES } from './matter.js';
import { SPIN } from '../world/spin.js';

export const MAX_DYN_LIGHTS = 4;
/** how many lamps a floor can show the reflections of at once */
export const MAX_GLINTS = 10;
/** how many key lights — lamps that throw real shadows — can burn at once (the second look: look/slots.js) */
export const MAX_KEYS = 6;

/** Uniforms every material shares. Change a value here and every surface follows. */
export const shared = {
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color(0.012, 0.017, 0.028) },
  uFogDensity: { value: 0.013 },
  uExposure: { value: 1 },
  /** 0..1 — night-vision goggles */
  uNight: { value: 0 },
  /** 0..1 — the site alarm washes everything red */
  uAlarm: { value: 0 },
  /** 1 while the finishing passes are drawing the picture: materials then hand over linear light, untouched */
  uPost: { value: 0 },
  /** how strongly surfaces shine: highlights and reflections are multiplied by this */
  uSheen: { value: 1 },
  /**
   * The lamps whose reflections floors show: the nearest ones the eye can see (world/build.js updateGlints).
   * xyz = where the lamp is, w = how far its light reaches; and its colour.
   */
  uGlint: { value: Array.from({ length: MAX_GLINTS }, () => new THREE.Vector4(0, -999, 0, 1)) },
  uGlintCol: { value: Array.from({ length: MAX_GLINTS }, () => new THREE.Vector3()) },
  /** short-lived lights (muzzle flashes, blasts): xyz = position, w = reach in metres */
  uDynPos: { value: Array.from({ length: MAX_DYN_LIGHTS }, () => new THREE.Vector4(0, -999, 0, 1)) },
  uDynCol: { value: Array.from({ length: MAX_DYN_LIGHTS }, () => new THREE.Vector3()) },
  /** 0..1 — how far everything inside uRuinBox (x0, z0, x1, z1) has been brought down to rubble */
  uRuin: { value: 0 },
  uRuinBox: { value: new THREE.Vector4(0, 0, 0, 0) },
  /**
   * The strike as it is seen from outside: uCraterGo (0..1) is how far the ground has sunk into a hollow at
   * uCrater.xy (x, z), uCrater.z metres across from middle to rim and uCrater.w metres deep.
   */
  uCrater: { value: new THREE.Vector4(0, 0, 1, 0) },
  uCraterGo: { value: 0 },

  // ---------- the second look (src/look): none of these is read by a shader unless `setLook` has switched it on ----------
  /** 1: every lit surface is drawn in a flat colour that says whether it has a material (tests count them) */
  uLookDebug: { value: 0 },
  /** the pictures of the materials, a layer each (gfx/matter.js): colour, and tilt + how roughness varies */
  uMatColor: { value: null },
  uMatDetail: { value: null },
  /** for each layer — x: repeats to the metre, y: depth of its relief, z: how far its roughness wanders, w: edge wear */
  uMatInfo: { value: Array.from({ length: MATTER_NAMES.length }, () => new THREE.Vector4(1, 0, 0, 0)) },
  /** the key lights that hold the slots (look/keylight.js). xyz where it hangs, w its reach in metres (below 0: it does not fade on the way) */
  uKeyPos: { value: Array.from({ length: MAX_KEYS }, () => new THREE.Vector4(0, -999, 0, 1)) },
  /** xyz the way it points, w the cosine of its beam's edge */
  uKeyAxis: { value: Array.from({ length: MAX_KEYS }, () => new THREE.Vector4(0, -1, 0, 2)) },
  /** rgb its light, as brightly as it is being drawn; w the cosine of the angle inside which the beam is full */
  uKeyCol: { value: Array.from({ length: MAX_KEYS }, () => new THREE.Vector4(0, 0, 0, 2)) },
  /** from the world into each one's depth picture */
  uKeyMat: { value: Array.from({ length: MAX_KEYS }, () => new THREE.Matrix4()) },
  /** the depth pictures, a tile to a slot: of what stands still, and of what moves (a desk only) */
  uKeyStill: { value: null },
  uKeyMoving: { value: null },
  /** x: one pixel of a still tile, as a share of the tile; y: how far a surface is moved off itself before it is looked up, in metres; z: how soft a shadow's edge is, in pixels; w: one pixel of a moving tile */
  uKeyTex: { value: new THREE.Vector4(1 / 2048, 0.05, 1.6, 1 / 1024) },
  /** how the tiles lie in the pictures: x so many across; y, z the size of one, as a share of the picture */
  uKeyGrid: { value: new THREE.Vector3(1, 1, 1) },
  /**
   * what metal mirrors inside uEnvBox (x0, z0, x1, z1): a capture of the place (look/mirror.js). uEnvAt — where it
   * was captured from, and in w the height of the box; uEnvInfo — x: its last mip, y: gain, z: over how many
   * metres inside the box's edge it fades in, w: how much of it is shown just now (0..1)
   */
  uEnvCube: { value: null },
  uEnvBox: { value: new THREE.Vector4(0, 0, 0, 0) },
  uEnvAt: { value: new THREE.Vector4(0, 0, 0, 1) },
  uEnvInfo: { value: new THREE.Vector4(0, 1, 2, 1) },
};

/**
 * What of the second look is switched on. Set once, before any material is made (main.js, when the address says
 * `look=2`); a material made while everything here is off is exactly the material it was before there was a
 * second look — its program has not a line of the look's in it.
 *
 * `glsl` is the look's shader text (src/look/glsl.js, which is fetched only with the look): a piece for each
 * place marked `//<look:name>` in the programs below. Switched on without it, no material can be made.
 */
const LOOK = { on: false, matter: false, cheap: false, keys: 0, taps: 9, moving: false, env: false, glsl: null };
export function setLook(next = {}) {
  Object.assign(LOOK, next);
  LOOK.keys = Math.min(MAX_KEYS, LOOK.keys | 0);
  return LOOK;
}
export const lookNow = () => ({ ...LOOK });

const MARK = /^[ \t]*\/\/<look:(\w+)>[ \t]*\n/gm;
/** a program with its marked places filled — kept, so that every material is handed the very same text */
const filled = new Map();
/**
 * The text of a program as it is to be compiled now: every marked place filled with the look's piece of that
 * name, or — the look not being on — left empty.
 */
function withLook(text) {
  const glsl = LOOK.on ? LOOK.glsl : null;
  if (LOOK.on && !glsl)
    throw new Error('the second look is switched on, but its shader text (src/look/glsl.js) was not handed to setLook');
  let made = filled.get(text);
  if (!made || made.glsl !== glsl) {
    made = { glsl, text: text.replace(MARK, (_, name) => (glsl && glsl[name]) || '') };
    filled.set(text, made);
  }
  return made.text;
}

/** GLSL for a fragment shader: declares the shared uniforms it needs and gives lodeFog() and lodeFinish(). */
export const FINISH_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uExposure;
uniform float uNight;
uniform float uPost;

float lodeHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// smooth noise, 0..1
float lodeNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(lodeHash(i), lodeHash(i + vec2(1.0, 0.0)), f.x),
    mix(lodeHash(i + vec2(0.0, 1.0)), lodeHash(i + vec2(1.0, 1.0)), f.x),
    f.y);
}

// how much of the picture the night haze has taken at this distance: 0 none, 1 all
float lodeFogAmount(float depth) {
  return 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
}

vec3 lodeFog(vec3 col, float depth) {
  return mix(col, uFogColor, lodeFogAmount(depth));
}

// linear light in, display colour out — unless the finishing passes are on, which do all of this themselves
vec3 lodeFinish(vec3 col) {
  if (uPost > 0.5) return col;
  col *= uExposure;
  if (uNight > 0.0) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float amp = pow(lum, 0.6) * 1.35;
    float grain = lodeHash(gl_FragCoord.xy + fract(uTime) * 97.0);
    float line = 0.94 + 0.06 * sin(gl_FragCoord.y * 1.6);
    col = mix(col, vec3(0.16, 1.0, 0.42) * amp * (0.86 + 0.28 * grain) * line, uNight);
  }
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  col = pow(col, vec3(1.0 / 2.2));
#ifndef LODE_NO_DITHER
  col += (lodeHash(gl_FragCoord.xy) - 0.5) / 255.0;
#endif
  return col;
}

// for light that is ADDED to the picture (flares, beams, fire): no tone curve, so that it fades all the way to
// nothing at its edges instead of leaving a faint box
vec3 lodeFinishAdd(vec3 col) {
  if (uPost > 0.5) return col;
  col *= uExposure;
  if (uNight > 0.0) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(0.16, 1.0, 0.42) * lum * 1.3, uNight);
  }
  return col;
}
`;

const LIT_VERT = /* glsl */ `
uniform float uTime;
uniform float uAlarm;
uniform vec4 uDynPos[${MAX_DYN_LIGHTS}];
uniform vec3 uDynCol[${MAX_DYN_LIGHTS}];
uniform vec3 uProbe;
uniform vec3 uProbeDir;
uniform vec2 uSurf;
uniform float uRuin;
uniform vec4 uRuinBox;
uniform vec4 uCrater;
uniform float uCraterGo;
#ifdef LODE_BAKED
attribute vec3 ldir;
#endif
#ifdef LODE_PAINT
attribute vec3 paint;
#endif
#ifdef LODE_SURF
attribute vec2 surf;
#endif
#ifdef LODE_SPIN
// a casing of the cascade: which corners are its skin, the lot this casing drew, and how far round the turning
// has got (world/spin.js)
attribute float spin;
attribute float spinLot;
uniform float uSpin;
#endif
//<look:vertHead>
varying vec3 vLight;
varying vec3 vLightDir;
varying vec3 vFlash;
varying vec3 vPaint;
varying vec2 vUv;
varying float vDepth;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vSurf;

void main() {
#ifdef USE_INSTANCING
  mat4 m = modelMatrix * instanceMatrix;
#else
  mat4 m = modelMatrix;
#endif
  vec3 lodeAt = position;
  vec3 lodeFacing = normal;
#ifdef LODE_SPIN
  if (spin > 0.5) {
    // The skin turns about the casing's own axis, in the casing's own space — before it is stood in the hall, or
    // thrown down in the wreck — each at its own speed and from its own place round. (What the second look
    // wraps its metal by is the corner as it was built: so the grain goes round with the skin.)
    float lodeTurn = uSpin * (LODE_SPIN_FROM + LODE_SPIN_STEP * min(LODE_SPIN_SPEEDS - 1.0, floor(spinLot * LODE_SPIN_SPEEDS))) + spinLot * 6.2831853;
    float lodeC = cos(lodeTurn);
    float lodeS = sin(lodeTurn);
    lodeAt.xz = vec2(lodeC * position.x - lodeS * position.z, lodeS * position.x + lodeC * position.z);
    lodeFacing.xz = vec2(lodeC * normal.x - lodeS * normal.z, lodeS * normal.x + lodeC * normal.z);
  }
#endif
  vec4 wp = m * vec4(lodeAt, 1.0);
  vec3 n = normalize(mat3(m) * lodeFacing);
  // the strike: whatever stands inside the box comes down to a field of rubble
  float ruined = 0.0;
  if (uRuin > 0.0 && wp.x > uRuinBox.x && wp.z > uRuinBox.y && wp.x < uRuinBox.z && wp.z < uRuinBox.w) {
    ruined = uRuin;
    vec2 cell = floor(wp.xz * 0.5);
    float lot = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    // mostly low heaps; here and there a stump of wall is left standing
    float heap = lot > 0.9 ? 3.0 + 40.0 * (lot - 0.9) : 0.2 + 2.4 * lot;
    wp.y = mix(wp.y, min(wp.y, heap * (0.35 + 0.65 * fract(wp.y * 0.37 + cell.x * 0.13))), uRuin);
  }
  // …and seen from outside: the mountain over the facility sinks into a hollow of broken ground
  float hollow = 0.0;
  if (uCraterGo > 0.0) {
    float bowl = 1.0 - smoothstep(0.12, 1.0, distance(wp.xz, uCrater.xy) / uCrater.z);
    if (bowl > 0.0) {
      vec2 block = floor(wp.xz * 0.25);
      float lot = fract(sin(dot(block, vec2(12.9898, 78.233))) * 43758.5453);
      wp.y -= uCrater.w * uCraterGo * bowl * (0.8 + 0.4 * lot);
      ruined = max(ruined, uCraterGo * bowl * 0.85);
      hollow = uCraterGo * bowl;
    }
  }
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vDepth = length(mv.xyz);
  vUv = uv;
  vWorld = wp.xyz;
  vNormal = n;
//<look:vertBody>

#ifdef LODE_BAKED
  vec3 light = color;
  vLightDir = ldir;
  #ifdef LODE_PAINT
  vPaint = paint;
  #else
  vPaint = vec3(1.0);
  #endif
#else
  vec3 light = uProbe;
  #ifdef USE_INSTANCING_COLOR
  light *= instanceColor;
  #endif
  vLightDir = uProbeDir;
  #ifdef USE_COLOR
  vPaint = color;
  #else
  vPaint = vec3(1.0);
  #endif
#endif

#ifdef LODE_SURF
  // geometry that was not painted through gfx/geo.js has no such attribute: it reads as zero, and the
  // material's own values stand in
  vSurf = surf.x > 0.0 ? surf : uSurf;
#else
  vSurf = uSurf;
#endif

  float pulse = 0.5 + 0.5 * sin(uTime * 5.2);
  light = mix(light, light * vec3(1.2, 0.4, 0.36) + vec3(0.03, 0.0, 0.0) * pulse, uAlarm * 0.8);
  // rubble is scorched, and glows a little where it still burns
  light = mix(light, light * 0.22 + vec3(0.16, 0.05, 0.012) * (0.6 + 0.4 * sin(uTime * 3.0 + wp.x * 1.7 + wp.z * 2.3)), ruined);
  // the hollow is seen from a long way off: the deeper into it, the more of its floor is on fire
  light += vec3(2.4, 0.62, 0.1) * hollow * hollow * (0.55 + 0.45 * sin(uTime * 2.1 + wp.x * 0.31 + wp.z * 0.47));
  vLight = light;

  vec3 flash = vec3(0.0);
  for (int i = 0; i < ${MAX_DYN_LIGHTS}; i++) {
    vec3 d = uDynPos[i].xyz - wp.xyz;
    float dist = length(d);
    float att = max(0.0, 1.0 - dist / max(uDynPos[i].w, 0.001));
    flash += uDynCol[i] * att * att * (0.35 + 0.65 * max(dot(n, d / max(dist, 0.001)), 0.0));
  }
  vFlash = flash;
}
`;

const LIT_FRAG = /* glsl */ `
${FINISH_GLSL}
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uOpacity;
uniform float uRim;
uniform float uBump;
uniform float uWet;
uniform float uSheen;
uniform mat3 uEnvRot;
#ifdef LODE_GLINT
uniform vec4 uGlint[${MAX_GLINTS}];
uniform vec3 uGlintCol[${MAX_GLINTS}];
#endif
#ifdef LODE_MAP
uniform sampler2D uMap;
#endif
#ifdef LODE_DETAIL
uniform sampler2D uDetail;
#endif
//<look:fragHead>
varying vec3 vLight;
varying vec3 vLightDir;
varying vec3 vFlash;
varying vec3 vPaint;
varying vec2 vUv;
varying float vDepth;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vSurf;

// what a dull mirror facing 'dir' would show at night: dark sky overhead, black ground below, and along the
// horizon the glow of whatever light there is about ('around'). The rougher the mirror, the wider that glow.
vec3 lodeEnv(vec3 dir, float rough, vec3 around) {
  float band = exp(-abs(dir.y) * mix(7.0, 2.2, rough));
  vec3 above = mix(vec3(0.010, 0.009, 0.008), vec3(0.020, 0.030, 0.058), smoothstep(-0.15, 0.3, dir.y));
  return above + around * (0.1 * band);
}

//<look:fragLib>

void main() {
  vec4 tex = vec4(1.0);
#ifdef LODE_MAP
  tex = texture2D(uMap, vUv);
  #ifdef LODE_ALPHATEST
  if (tex.a < 0.5) discard;
  #endif
#endif
  vec3 albedo = uColor * vPaint * tex.rgb;
  vec3 flat_ = normalize(vNormal);
  vec3 N = flat_;
  float rough = clamp(vSurf.x, 0.05, 1.0);
  float metal = vSurf.y;
  vec3 V = normalize(cameraPosition - vWorld);

//<look:fragMatter>

#ifdef LODE_DETAIL
  // the bump map: red and green tilt the surface along and across it, blue is how rough it is there.
  // Level surfaces are all upright or level, so their tangents can be had from the normal alone.
  vec4 det = texture2D(uDetail, vUv);
  bool level = abs(flat_.y) > 0.6;
  vec3 T = level ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), flat_));
  vec3 B = level ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  // far away the bumps are smaller than a pixel: let them go rather than let them sparkle
  vec2 tilt = (det.xy * 2.0 - 1.0) * uBump * (1.0 - smoothstep(16.0, 42.0, vDepth));
  N = normalize(flat_ + T * tilt.x + B * tilt.y);
  rough = clamp(det.z, 0.05, 1.0);
#endif
#ifdef LODE_WET
  // it has rained: the ground is damp all over, and water stands in the hollows
  float pool = lodeNoise(vWorld.xz * 0.21) * 0.65 + lodeNoise(vWorld.xz * 0.83 + 7.3) * 0.35;
  float water = smoothstep(0.44, 0.58, pool) * uWet * step(0.6, flat_.y);
  N = normalize(mix(N, flat_, water * 0.93));
  rough = mix(rough * mix(1.0, 0.6, uWet), 0.05, water);
  albedo *= mix(1.0, 0.5, water) * mix(1.0, 0.84, uWet);
#endif

  // the arrow: which way most of the light came, and how much of the light that is
  float k = min(length(vLightDir), 1.0);
  vec3 Ld = k > 0.001 ? normalize(vLightDir) : vec3(0.0, 1.0, 0.0);
  float per = max(dot(N, Ld), 0.0);
#ifdef LODE_BAKED
  // the light was worked out for the flat surface: re-aim it at the way this pixel faces (shade.js relight)
  float geo = max(dot(flat_, Ld), ${RELIGHT_FLOOR.toFixed(2)});
  vec3 E = vLight * clamp(1.0 + k * (per / geo - 1.0), 0.0, 2.0);
  vec3 lamp = vLight * (k / geo);
#else
  // lit by the spot it stands on: part of that light comes from one side, the rest from all round
  float wrap = 0.5 + 0.5 * dot(N, Ld);
  vec3 E = vLight * mix(1.0, 0.2 + 0.3 * wrap * wrap + 0.95 * per, k);
  vec3 lamp = vLight * k * 1.6;
#endif
  E += vFlash;
  vec3 col = albedo * (1.0 - metal * 0.88) * E;

  // the highlight of the main lamp
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  float nv = max(dot(N, V), 0.0);
  float a2 = max(rough * rough, 0.012);
  a2 *= a2;
#ifdef LODE_GLINT
  // a floor: it shows the reflection of every lamp the eye can see, each where a mirror would put it — drawn
  // out into a streak towards the lamp on damp ground, a clean image of it in standing water
  for (int i = 0; i < ${MAX_GLINTS}; i++) {
    vec3 toLamp = uGlint[i].xyz - vWorld;
    float d2 = dot(toLamp, toLamp);
    float reach = uGlint[i].w * 3.0;
    float window = clamp(1.0 - d2 / (reach * reach), 0.0, 1.0);
    vec3 Li = toLamp * inversesqrt(max(d2, 1e-4));
    vec3 Hi = normalize(Li + V);
    float nhi = max(dot(N, Hi), 0.0);
    float ddi = nhi * nhi * (a2 - 1.0) + 1.0;
    float Di = min(a2 / (3.14159 * ddi * ddi), 400.0);
    vec3 Fi = F0 + (1.0 - F0) * pow(1.0 - max(dot(Hi, V), 0.0), 5.0);
    col += uGlintCol[i] * Fi * (Di * max(dot(N, Li), 0.0) * 0.25 * window * window / (1.0 + 0.02 * d2)) * uSheen;
  }
#else
  vec3 H = normalize(Ld + V);
  float nh = max(dot(N, H), 0.0);
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float D = min(a2 / (3.14159 * dd * dd), 80.0);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  col += (lamp + vFlash) * F * (D * per * 0.25) * uSheen;
#endif

//<look:fragKey>

  // and what it reflects of everything else, brighter where there is light about: what a dull mirror would show
  vec3 Fenv = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - nv, 5.0);
  vec3 back = uEnvRot * reflect(-V, N);
  vec3 seen = lodeEnv(back, rough, vLight);
//<look:fragEnv>
  col += seen * Fenv * (1.0 - 0.55 * rough) * uSheen;

  // a pale edge, so that a machine in the dark is still a shape
  col += albedo * (vLight * 0.7 + vec3(0.012, 0.018, 0.026)) * pow(1.0 - nv, 3.0) * uRim;

  col += uEmissive;
  gl_FragColor = vec4(lodeFinish(lodeFog(col, vDepth)), uOpacity * tex.a);
//<look:fragDebug>
}
`;

const GLOW_VERT = /* glsl */ `
varying vec3 vPaint;
varying vec2 vUv;
varying float vDepth;

void main() {
#ifdef USE_INSTANCING
  mat4 m = modelMatrix * instanceMatrix;
#else
  mat4 m = modelMatrix;
#endif
  vec4 mv = viewMatrix * (m * vec4(position, 1.0));
  gl_Position = projectionMatrix * mv;
  vDepth = length(mv.xyz);
  vUv = uv;
  vPaint = vec3(1.0);
#ifdef USE_COLOR
  vPaint *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vPaint *= instanceColor;
#endif
}
`;

const GLOW_FRAG = /* glsl */ `
${FINISH_GLSL}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uOpacity;
#ifdef LODE_MAP
uniform sampler2D uMap;
#endif
varying vec3 vPaint;
varying vec2 vUv;
varying float vDepth;

void main() {
  vec4 tex = vec4(1.0);
#ifdef LODE_MAP
  tex = texture2D(uMap, vUv);
#endif
  vec3 col = uColor * vPaint * tex.rgb * uIntensity;
  // through the finishing passes a lamp is brighter than white, and spills over what is beside it
  col *= 1.0 + 1.6 * uPost;
  float clear = 1.0 - lodeFogAmount(vDepth);
#ifdef LODE_ADDITIVE
  gl_FragColor = vec4(lodeFinishAdd(col * clear), uOpacity * tex.a);
#else
  gl_FragColor = vec4(lodeFinish(mix(uFogColor, col, clear)), uOpacity * tex.a);
#endif
}
`;

const BEAM_VERT = /* glsl */ `
varying vec3 vPaint;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlong;
varying float vDepth;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vDepth = length(mv.xyz);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vAlong = uv.y;
  vPaint = color;
}
`;

const BEAM_FRAG = /* glsl */ `
${FINISH_GLSL}
uniform float uIntensity;
varying vec3 vPaint;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlong;
varying float vDepth;

void main() {
  // brightest looking through the thick of it, nothing at its edge; strongest by the lamp, thin by the ground
  float through = abs(dot(normalize(vNormal), normalize(cameraPosition - vWorld)));
  float a = pow(through, 1.7) * mix(1.0, 0.1, vAlong);
  // dust drifting through it
  a *= 0.72 + 0.28 * lodeNoise(vWorld.xz * 1.3 + vec2(uTime * 0.06, vWorld.y * 0.9 - uTime * 0.04));
  // standing inside it, it must not fog the whole view
  a *= smoothstep(0.5, 3.5, vDepth) * (1.0 - lodeFogAmount(vDepth));
  gl_FragColor = vec4(lodeFinishAdd(vPaint * (a * uIntensity)), 1.0);
}
`;

function link(uniforms) {
  for (const key in shared) uniforms[key] = shared[key];
  return uniforms;
}

/** The arrow moving things are lit along until somebody says otherwise: from above and a little to one side. */
const DEFAULT_ARROW = new THREE.Vector3(0.32, 0.86, 0.4).normalize().multiplyScalar(0.6);

/**
 * A lit surface.
 * @param {object} [o]
 * @param {number|THREE.Color} [o.color=0xffffff] tint multiplied over everything
 * @param {THREE.Texture|null} [o.map] colour texture (uses the `uv` attribute)
 * @param {THREE.Texture|null} [o.detail] bump map for the same `uv`: red/green tilt, blue roughness (gfx/detail.js)
 * @param {number} [o.bump=1] how strongly the bump map tilts the surface
 * @param {boolean} [o.baked=false] true: `color` is light worked out beforehand and `ldir` the arrow of it
 * @param {boolean} [o.painted=false] baked only: the geometry also has `paint` (its colour) and `surf`
 * @param {boolean} [o.vertexColors] not baked: true if `color` holds paint (and `surf` what it is made of)
 * @param {number} [o.rough=0.7] 0 mirror … 1 chalk, where the geometry or the bump map does not say
 * @param {number} [o.metal=0] 0 paint, stone, rubber … 1 bare metal, where the geometry does not say
 * @param {number} [o.wet=0] 0..1 rained-on ground: damp all over, with standing water in the hollows
 * @param {boolean} [o.glint=false] a floor: it shows the reflections of the lamps the eye can see (`shared.uGlint`)
 * @param {boolean} [o.surf] not baked: false to ignore what the geometry says it is made of and use `rough` and
 *   `metal` for the whole of it
 * @param {number|THREE.Color} [o.emissive=0x000000] light the surface gives off whatever falls on it
 * @param {number} [o.rim=0] 0..1 pale edge light, so that a shape still reads in the dark
 * @param {boolean} [o.alphaTest=false] cut holes where the texture's alpha is below one half
 * @param {boolean} [o.spin=false] a casing of the cascade: the corners its geometry marks `spin` turn about the
 *   casing's own axis, as far as `uniforms.uSpin` says and each casing's `spinLot` makes of it (world/spin.js)
 */
export function lit({
  color = 0xffffff,
  map = null,
  detail = null,
  bump = 1,
  baked = false,
  painted = false,
  vertexColors = baked,
  rough = 0.7,
  metal = 0,
  wet = 0,
  glint = false,
  surf = true,
  emissive = 0x000000,
  rim = 0,
  alphaTest = false,
  transparent = false,
  opacity = 1,
  side = THREE.FrontSide,
  spin = false,
} = {}) {
  const defines = {};
  if (spin) {
    defines.LODE_SPIN = 1;
    defines.LODE_SPIN_FROM = SPIN.from.toFixed(4);
    defines.LODE_SPIN_STEP = SPIN.step.toFixed(4);
    defines.LODE_SPIN_SPEEDS = SPIN.speeds.toFixed(1);
  }
  if (baked) defines.LODE_BAKED = 1;
  if (baked && painted) defines.LODE_PAINT = 1;
  if (surf && ((baked && painted) || (!baked && vertexColors))) defines.LODE_SURF = 1;
  if (map) defines.LODE_MAP = 1;
  if (detail) defines.LODE_DETAIL = 1;
  if (wet > 0) defines.LODE_WET = 1;
  if (glint) defines.LODE_GLINT = 1;
  if (alphaTest) defines.LODE_ALPHATEST = 1;
  // the second look: only when main.js has switched it on (setLook), and then for every lit surface made after
  if (LOOK.on) defines.LODE_LOOK = 1;
  // anything built out of painted parts says what each part is made of (the `mat` attribute, gfx/geo.js)
  if (LOOK.matter && !map && ((baked && painted) || (!baked && vertexColors))) {
    defines.LODE_MATTER = 1;
    if (LOOK.cheap) defines.LODE_MATTER_CHEAP = 1;
  }
  if (LOOK.keys > 0) {
    defines.LODE_KEY = LOOK.keys;
    defines.LODE_KEY_TAPS = LOOK.taps;
    if (LOOK.moving) defines.LODE_KEY_MOVING = 1;
  }
  if (LOOK.env) defines.LODE_ENVCUBE = 1;
  const material = new THREE.ShaderMaterial({
    name: baked ? 'lode-baked' : 'lode-lit',
    defines,
    uniforms: link({
      uColor: { value: new THREE.Color(color) },
      uEmissive: { value: new THREE.Color(emissive) },
      uProbe: { value: new THREE.Color(1, 1, 1) },
      uProbeDir: { value: DEFAULT_ARROW.clone() },
      uSurf: { value: new THREE.Vector2(rough, metal) },
      uRim: { value: rim },
      uBump: { value: bump },
      uWet: { value: wet },
      uEnvRot: { value: new THREE.Matrix3() },
      uOpacity: { value: opacity },
      uMap: { value: map },
      uDetail: { value: detail },
      /** 0: the key lights do not fall on this (the gun: it is drawn in a space of its own, and lit by hand) */
      uKeyGain: { value: 1 },
      /** below 0: the captured place is mirrored inside its box; 0..1: by this much, wherever it is (the gun) */
      uEnvMix: { value: -1 },
      /** …and then where in the world it is mirrored from: the eye's place (the gun is in a space of its own) */
      uEnvFrom: { value: new THREE.Vector3() },
      /** a casing of the cascade: how far round the turning has got, in radians (world/spin.js) */
      ...(spin ? { uSpin: { value: 0 } } : {}),
    }),
    vertexShader: withLook(LIT_VERT),
    fragmentShader: withLook(LIT_FRAG),
    vertexColors: baked || vertexColors,
    transparent,
    side,
  });
  material.userData.lode = baked ? 'baked' : 'lit';
  return material;
}

/**
 * Something that gives off light and takes none: lamp faces, eyes, screens, flares, tracers.
 * @param {object} [o]
 * @param {number|THREE.Color} [o.color=0xffffff]
 * @param {number} [o.intensity=1] above 1 burns out towards white
 * @param {boolean} [o.additive=false] true: adds its light to what is behind it (flares, beams) and writes no depth
 * @param {boolean} [o.vertexColors=false] the `color` attribute tints it
 */
export function glow({
  color = 0xffffff,
  intensity = 1,
  map = null,
  additive = false,
  vertexColors = false,
  opacity = 1,
  transparent = additive,
  depthTest = true,
  side = THREE.DoubleSide,
} = {}) {
  const defines = {};
  if (map) defines.LODE_MAP = 1;
  if (additive) {
    defines.LODE_ADDITIVE = 1;
    defines.LODE_NO_DITHER = 1;
  }
  const material = new THREE.ShaderMaterial({
    name: 'lode-glow',
    defines,
    uniforms: link({
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uOpacity: { value: opacity },
      uMap: { value: map },
    }),
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    vertexColors,
    transparent,
    depthTest,
    depthWrite: !additive && !transparent,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side,
  });
  material.userData.lode = 'glow';
  return material;
}

/**
 * The haze a lamp lights up in the air under it: for a cone of geometry whose `color` is the lamp's colour and
 * whose `uv.y` runs from 0 at the lamp to 1 at the ground. Added to the picture; both sides are drawn, so that
 * looking through the middle of the cone crosses it twice and is brighter, as it should be.
 */
export function beam({ intensity = 1 } = {}) {
  const material = new THREE.ShaderMaterial({
    name: 'lode-beam',
    defines: { LODE_NO_DITHER: 1 },
    uniforms: link({ uIntensity: { value: intensity } }),
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  material.userData.lode = 'glow';
  return material;
}

/** A copy of one of these materials with its own colour and probe, still following the shared values. */
export function cloneMaterial(material) {
  // the shared values are taken out while the copy is made: they are not to be copied (some are render targets,
  // which cannot be), and the copy is tied back to the very same ones afterwards
  const held = {};
  for (const key in shared) {
    held[key] = material.uniforms[key];
    delete material.uniforms[key];
  }
  const copy = material.clone();
  for (const key in shared) material.uniforms[key] = held[key];
  link(copy.uniforms);
  return copy;
}

/**
 * Gives one model its own copies of the materials it uses, so that it can be lit and tinted apart from its twins.
 * @returns {{ lit: THREE.ShaderMaterial[], glow: THREE.ShaderMaterial[] }}
 */
export function ownMaterials(root) {
  const copies = new Map();
  const out = { lit: [], glow: [] };
  root.traverse((node) => {
    const kind = node.material?.userData?.lode;
    if (!kind) return;
    let copy = copies.get(node.material);
    if (!copy) {
      copy = cloneMaterial(node.material);
      copies.set(node.material, copy);
      if (kind === 'glow') out.glow.push(copy);
      else out.lit.push(copy);
    }
    node.material = copy;
  });
  return out;
}

/**
 * Sets the light that falls on a model whose materials came from ownMaterials().
 * @param {THREE.Color} color how much light there is where it stands
 * @param {THREE.Vector3} [arrow] which way most of it comes from, as long as the share of the light that is
 *   (world/build.js probe); left out, the arrow it had is kept
 */
export function setProbe(materials, color, arrow) {
  for (const material of materials.lit) {
    material.uniforms.uProbe.value.copy(color);
    if (arrow) material.uniforms.uProbeDir.value.copy(arrow);
  }
}

/**
 * For a model drawn in a space of its own (the gun in the hand): how that space is turned in the world, so that
 * what it reflects is the world's sky and horizon and not its own.
 * @param {THREE.Matrix3} rotation
 */
export function setEnvRotation(materials, rotation) {
  for (const material of materials.lit) material.uniforms.uEnvRot.value.copy(rotation);
}

/**
 * The second look, for a model drawn in a space of its own (what is in the hands). The key lights are worked out
 * per pixel from where a surface is in the world, and so is which part of the captured place it mirrors — and
 * these surfaces are not in the world. They are told instead: no key light of that kind (it is added to their
 * probe by hand, weapon.js); `mirror` — how much of the captured place they show, 0 none … 1 all of it; and
 * `x, y, z` — where in the world the eye is, which is where they mirror it from.
 * Without the second look their shaders read none of this, and it changes nothing.
 */
export function setInHand(materials, mirror = 0, x = 0, y = 0, z = 0) {
  for (const material of materials.lit) {
    material.uniforms.uKeyGain.value = 0;
    material.uniforms.uEnvMix.value = mirror;
    material.uniforms.uEnvFrom.value.set(x, y, z);
  }
}

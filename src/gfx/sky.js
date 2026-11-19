// The night sky: one dome, drawn behind everything, that finishes through the same lodeFinish() as every other
// surface so brightness and night vision apply to it too. Everything in it — stars, cloud, the mountain ridge —
// is a function of the view direction alone, never of screen position, so nothing swims or pops when the camera
// turns.
import * as THREE from 'three';
import { FINISH_GLSL, shared } from './materials.js';

const DEFAULT_MOON_DIR = new THREE.Vector3(0.35, 0.58, -0.74).normalize();

const SKY_VERT = /* glsl */ `
varying vec3 vDir;

void main() {
  // the dome is re-centred on the camera every frame (see update()), so the local position already IS the
  // direction to look along — no need to subtract the camera position here.
  vDir = position;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // pin the depth to the far plane so the dome can never be clipped, whatever its radius or the camera's far
  clip.z = clip.w;
  gl_Position = clip;
}
`;

const SKY_FRAG = /* glsl */ `
${FINISH_GLSL}
uniform vec3 uMoonDir;
varying vec3 vDir;

// ---- hashing & noise -------------------------------------------------------------------------
float hash1(vec2 p) {
  return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453123);
}

vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash1(i);
  float b = hash1(i + vec2(1.0, 0.0));
  float c = hash1(i + vec2(0.0, 1.0));
  float d = hash1(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// three octaves is "a few": enough to look layered without costing much on a phone.
float fbm2(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * noise2(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

float hash1v3(vec3 p) {
  return fract(sin(dot(p, vec3(41.3, 289.1, 177.7))) * 43758.5453123);
}

// value noise on a genuine 3D lattice, sampled with the view direction itself (never flattened to a 2D
// plane like d.xz): flattening a sphere direction to 2D pinches to a pole straight up, which showed as sharp
// rays converging near the zenith once cloud actually used it. A 3D lattice has no such pole or seam anywhere.
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash1v3(i);
  float n100 = hash1v3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash1v3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash1v3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash1v3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash1v3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash1v3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash1v3(i + vec3(1.0, 1.0, 1.0));
  float nxy0 = mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y);
  float nxy1 = mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y);
  return mix(nxy0, nxy1, f.z);
}

float fbm3(vec3 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * noise3(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

// ---- stars -------------------------------------------------------------------------------
// one star candidate per cell of a 3D grid on the direction itself (never screen space), so turning the
// camera never makes them crawl: the same world direction always lands in the same cell.
vec3 starLayer(vec3 d, float freq, float sharpness, float chance, float twinkleAmt) {
  vec3 p = d * freq;
  vec3 cell = floor(p);
  vec3 f = fract(p);
  vec3 h = hash3(cell);
  if (h.x > chance) return vec3(0.0);
  float dist = length(f - h);
  float star = exp(-dist * dist * sharpness);
  float tw = 1.0 - twinkleAmt + twinkleAmt * (0.5 + 0.5 * sin(uTime * (1.5 + h.y * 2.5) + h.z * 6.2831));
  vec3 tint = mix(vec3(0.78, 0.84, 1.0), vec3(1.0, 0.9, 0.75), h.y);
  float bright = 0.25 + 0.75 * pow(h.z, 1.5);
  return tint * star * bright * tw;
}

vec3 stars(vec3 d) {
  vec3 col = starLayer(d, 220.0, 140.0, 0.1, 0.12);
  col += starLayer(d, 55.0, 90.0, 0.028, 0.18) * 1.6;
  // the milky way: a faint band of denser, brighter stars along one great circle
  float band = 1.0 - abs(dot(d, normalize(vec3(0.3, 0.9, -0.22))));
  float milky = smoothstep(0.82, 1.0, band);
  col += starLayer(d, 95.0, 70.0, 0.09, 0.1) * milky * 1.4;
  col += milky * vec3(0.012, 0.013, 0.016);
  return col;
}

// ---- moon ----------------------------------------------------------------------------------
vec3 moon(vec3 d, vec3 moonDir) {
  float c = dot(d, moonDir);
  vec3 col = vec3(0.0);
  // halves: a tight bright halo, then a wide faint one
  col += vec3(0.5, 0.55, 0.6) * pow(max(c, 0.0), 420.0) * 1.1;
  col += vec3(0.4, 0.46, 0.55) * pow(max(c, 0.0), 40.0) * 0.1;
  // the disc itself is about 1.6 deg across: cos(0.8 deg) ~= 0.99990
  float disc = smoothstep(0.99975, 0.99993, c);
  if (disc > 0.0) {
    vec3 up = abs(moonDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(up, moonDir));
    up = cross(moonDir, right);
    // local coordinates across the disc, roughly -1..1
    vec2 local = vec2(dot(d, right), dot(d, up)) * 130.0;
    float maria = noise2(local * 2.2 + 11.0) * 0.5 + noise2(local * 5.0 + 71.0) * 0.5;
    float shade = 1.0 - maria * 0.28 - length(local) * 0.06;
    col = mix(col, vec3(0.78, 0.8, 0.82) * shade, disc);
  }
  return col;
}

// ---- mountain ridge, all the way round the horizon --------------------------------------------
// noise sampled along the horizontal unit circle: a function of azimuth with no explicit angle wrap needed,
// because walking all the way round returns to the exact same 2D point the noise is sampled at.
float ridgeNoise(vec2 horiz, float freq, float seed) {
  return fbm2(horiz * freq + seed);
}

void main() {
  vec3 d = normalize(vDir);
  vec2 horiz = length(d.xz) > 1e-4 ? normalize(d.xz) : vec2(1.0, 0.0);

  vec3 zenith = vec3(0.006, 0.010, 0.022);
  vec3 horizonCol = uFogColor;
  float t = clamp(d.y, 0.0, 1.0);
  vec3 sky = mix(horizonCol, zenith, pow(t, 0.42));

  sky += stars(d) * smoothstep(-0.02, 0.1, d.y);

  // thin high cloud: a couple of slow wisps, pale near the moon, dark elsewhere, hiding some stars.
  // sampled from the full 3D direction (fbm3), not a flattened d.xz, so there is no pole near the zenith.
  vec3 windOff = vec3(uTime * 0.004, 0.0, uTime * 0.0013);
  float cloud = fbm3(d * 2.6 + windOff) * 0.6 + fbm3(d * 6.0 - windOff * 1.7) * 0.4;
  float coverage = smoothstep(0.5, 0.78, cloud) * smoothstep(-0.05, 0.18, d.y);
  float moonFacing = clamp(dot(horiz, normalize(uMoonDir.xz + 1e-4)), 0.0, 1.0);
  vec3 cloudLit = mix(vec3(0.01, 0.012, 0.016), vec3(0.09, 0.1, 0.12), pow(moonFacing, 2.0));
  sky = mix(sky, cloudLit, coverage * 0.85);

  sky += moon(d, normalize(uMoonDir));

  vec3 col;
  // layered ridge: two noise profiles across azimuth give a near (taller, darker) and a far (lower, paler) line
  float hNear = 0.03 + 0.125 * clamp(ridgeNoise(horiz, 3.6, 71.0), 0.0, 1.0); // up to ~9 deg
  float hFar = 0.025 + 0.07 * clamp(ridgeNoise(horiz, 2.1, 11.0), 0.0, 1.0); // up to ~5.5 deg
  float rim = clamp(dot(horiz, normalize(uMoonDir.xz + 1e-4)), 0.0, 1.0);

  // a faint warm sodium-light glow low over the site, all around the horizon. Kept mostly off the rock
  // below: it is meant to light the haze, not wash the "near-black" ridge out into a uniform brown band.
  float glow = exp(-abs(d.y) * 9.0) * 0.05;
  vec3 glowCol = vec3(0.5, 0.28, 0.1) * glow;

  if (d.y < 0.0) {
    col = uFogColor + glowCol * 0.5;
  } else if (d.y < hNear) {
    float edge = smoothstep(hNear - 0.012, hNear, d.y);
    col = mix(vec3(0.012, 0.011, 0.013), vec3(0.05, 0.055, 0.07), edge * rim * 0.8) + glowCol * 0.12;
  } else if (d.y < hFar) {
    float edge = smoothstep(hFar - 0.01, hFar, d.y);
    col = mix(vec3(0.022, 0.024, 0.032), vec3(0.07, 0.08, 0.095), edge * rim * 0.8) + glowCol * 0.12;
  } else {
    col = sky + glowCol;
  }

  gl_FragColor = vec4(lodeFinish(col), 1.0);
}
`;

/**
 * A dome drawn behind everything in the scene: the night gradient, stars, the moon, thin cloud and the ridge
 * of the basin's rim. Finishes through the same lodeFinish() step as every other surface.
 * @param {object} [o]
 * @param {THREE.Vector3} [o.moonDir] unit vector pointing at the moon (default: high and a little to one side)
 * @returns {{ mesh: THREE.Mesh, update(camera: THREE.Camera, time: number): void, uniforms: object }}
 */
export function createSky({ moonDir = DEFAULT_MOON_DIR } = {}) {
  const geometry = new THREE.SphereGeometry(50, 24, 16);
  const uniforms = {
    // spreading `shared` links to the very same uniform objects every other material uses, so a change to
    // brightness, night vision, fog or the clock reaches the sky too — see link() in materials.js.
    ...shared,
    uMoonDir: { value: moonDir.clone().normalize() },
  };
  const material = new THREE.ShaderMaterial({
    name: 'lode-sky',
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;

  /** Call once a frame: keeps the dome centred on the camera and drives its clock. */
  function update(camera, time) {
    mesh.position.copy(camera.position);
    // wrapped the same way the game's own per-frame update wraps it (main.js: `G.time % 3600`), so a long
    // session never hands the noise/trig in the shader an ever-growing number, whichever call writes it last.
    shared.uTime.value = time % 3600;
  }

  return { mesh, update, uniforms };
}

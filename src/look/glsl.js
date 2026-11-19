// The shader text of the second look: what `look=2` adds to the program that draws every lit surface.
//
// gfx/materials.js keeps the program everything is drawn with, and in it a few marked places (`//<look:name>`).
// This file is the text that goes into them — and it is in the look's own part of the game, fetched only when the
// address asks for the look. A game started without the switch therefore does not carry a line of it: its
// materials are handed nothing, the marked places are left empty, and what is compiled is the program that was
// there before there was a second look. `setLook({ glsl: LOOK_GLSL })` (look/index.js) hands it over, before any
// material is made.
//
// Each piece is fenced by the define that switches it on (gfx/materials.js `lit`), so a set-up without, say, the
// captured place compiles none of that piece. No three.js and no browser in here.
import { MAX_KEYS } from '../gfx/materials.js';
import { MATTER_MID, MATTER_NAMES } from '../gfx/matter.js';
import { KEY_HALF } from './key.js';

/** vertex shader, before main(): what each corner carries, and what it hands on */
const vertHead = /* glsl */ `
#ifdef LODE_MATTER
// what each part is made of (a layer of the catalogue, or −1; plus a half on the edges of things), and the
// model's own space to wrap its picture in. Flat: a triangle is of one material, and is handed over whole
attribute float mat;
flat varying float vMat;
varying vec3 vObj;
varying vec3 vObjN;
varying vec3 vAxisX;
varying vec3 vAxisY;
#endif
`;

/** vertex shader, in main(), once the corner's place in the world (wp), its normal (n) and its matrix (m) are known */
const vertBody = /* glsl */ `
#ifdef LODE_MATTER
  vMat = mat;
  vObj = position;
  vObjN = normal;
  vAxisX = normalize(mat3(m) * vec3(1.0, 0.0, 0.0));
  vAxisY = normalize(mat3(m) * vec3(0.0, 1.0, 0.0));
#endif
`;

/** fragment shader, among the uniforms */
const fragHead = /* glsl */ `
#ifdef LODE_LOOK
uniform float uLookDebug;
#endif
#ifdef LODE_MATTER
uniform highp sampler2DArray uMatColor;
uniform highp sampler2DArray uMatDetail;
uniform vec4 uMatInfo[${MATTER_NAMES.length}];
flat varying float vMat;
varying vec3 vObj;
varying vec3 vObjN;
varying vec3 vAxisX;
varying vec3 vAxisY;
#endif
#ifdef LODE_KEY
// the lamps that hold the slots (look/slots.js): where each hangs and how far it reaches (below nothing: it does
// not fade on the way — the moon); the way it points and the edge of its beam; its light, as brightly as it is
// being drawn, and the middle of its beam; and the way from the world into its depth picture
uniform vec4 uKeyPos[${MAX_KEYS}];
uniform vec4 uKeyAxis[${MAX_KEYS}];
uniform vec4 uKeyCol[${MAX_KEYS}];
uniform mat4 uKeyMat[${MAX_KEYS}];
uniform vec4 uKeyTex;
uniform vec3 uKeyGrid;
uniform float uKeyGain;
// a tile to a slot: of what stands still, and — where there is one — of what moves
uniform highp sampler2DShadow uKeyStill;
#ifdef LODE_KEY_MOVING
uniform highp sampler2DShadow uKeyMoving;
#endif
#endif
#ifdef LODE_ENVCUBE
uniform samplerCube uEnvCube;
uniform vec4 uEnvBox;
uniform vec4 uEnvAt;
uniform vec4 uEnvInfo;
uniform float uEnvMix;
uniform vec3 uEnvFrom;
#endif
`;

/** fragment shader, before main(): the sums the pieces below share */
const fragLib = /* glsl */ `
#if defined(LODE_MATTER)
// smooth noise in space, 0..1: what keeps two metres of the same material from being the same two metres
float lodeHash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float lodeNoise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(lodeHash3(i), lodeHash3(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(lodeHash3(i + vec3(0.0, 1.0, 0.0)), lodeHash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(lodeHash3(i + vec3(0.0, 0.0, 1.0)), lodeHash3(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(lodeHash3(i + vec3(0.0, 1.0, 1.0)), lodeHash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
#endif

#ifdef LODE_KEY
// the same fading with distance as look/key.js keyFade: gentle, and gone at the end of the reach
float lodeKeyFade(float d, float range) {
  float k = d / range;
  if (k >= 1.0) return 0.0;
  float window = 1.0 - k * k * k * k;
  float half_ = range * ${KEY_HALF.toFixed(3)};
  return (window * window) / (1.0 + (d * d) / (half_ * half_));
}

// How much of a key light gets past whatever stands between: 1 none of it is blocked, 0 all of it. A depth
// picture answers "is this point further from the lamp than the nearest thing on the way?" for four pixels at a
// time; it is asked at several points round the one wanted, and the answers averaged, for a soft edge.
// The pictures of all the slots are tiles of one picture: 'slot' says which tile, and no point is asked for
// nearer the tile's edge than its own softness — the next tile is another lamp's.
float lodeKeyOpen(vec4 coord, float slot) {
  if (coord.w <= 0.0) return 1.0;
  vec3 p = coord.xyz / coord.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  vec2 origin = vec2(mod(slot, uKeyGrid.x), floor(slot / uKeyGrid.x)) * uKeyGrid.yz;
  float r = uKeyTex.x * uKeyTex.z;
  float rim = r + uKeyTex.x * 1.5;
  // turned by a different angle at every pixel, so that the pattern of the taps does not show as bands
  float turn = lodeHash(gl_FragCoord.xy) * 6.2831853;
  mat2 spin = mat2(cos(turn), -sin(turn), sin(turn), cos(turn));
  float open = 0.0;
#define LODE_KEY_AT(o) texture(uKeyStill, vec3(origin + clamp(p.xy + spin * (o) * r, rim, 1.0 - rim) * uKeyGrid.yz, p.z))
#if LODE_KEY_TAPS >= 9
  open += LODE_KEY_AT(vec2(-0.613, 0.617));
  open += LODE_KEY_AT(vec2(0.170, -0.040));
  open += LODE_KEY_AT(vec2(-0.299, -0.792));
  open += LODE_KEY_AT(vec2(0.646, 0.493));
  open += LODE_KEY_AT(vec2(-0.651, -0.717));
  open += LODE_KEY_AT(vec2(0.421, 0.027));
  open += LODE_KEY_AT(vec2(-0.817, -0.271));
  open += LODE_KEY_AT(vec2(0.977, -0.105));
  open += LODE_KEY_AT(vec2(0.063, 0.142));
  #if LODE_KEY_TAPS >= 16
  open += LODE_KEY_AT(vec2(0.203, 0.214));
  open += LODE_KEY_AT(vec2(-0.667, 0.326));
  open += LODE_KEY_AT(vec2(-0.098, -0.295));
  open += LODE_KEY_AT(vec2(-0.885, 0.215));
  open += LODE_KEY_AT(vec2(0.566, 0.605));
  open += LODE_KEY_AT(vec2(0.039, -0.862));
  open += LODE_KEY_AT(vec2(-0.207, 0.871));
  open /= 16.0;
  #else
  open /= 9.0;
  #endif
#else
  open += LODE_KEY_AT(vec2(-0.5, -0.5));
  open += LODE_KEY_AT(vec2(0.5, -0.5));
  open += LODE_KEY_AT(vec2(-0.5, 0.5));
  open += LODE_KEY_AT(vec2(0.5, 0.5));
  open /= 4.0;
#endif
#ifdef LODE_KEY_MOVING
  // …and what moves — a machine walking through the beam, the leaf of a door — is in a picture of its own, kept
  // up every frame: in shadow if either says so
  float rm = uKeyTex.w * 1.5;
  float rimM = rm + uKeyTex.w * 1.5;
#define LODE_KEY_STIR(o) texture(uKeyMoving, vec3(origin + clamp(p.xy + spin * (o) * rm, rimM, 1.0 - rimM) * uKeyGrid.yz, p.z))
  float stir = LODE_KEY_STIR(vec2(-0.5, -0.5)) + LODE_KEY_STIR(vec2(0.5, -0.5)) + LODE_KEY_STIR(vec2(-0.5, 0.5)) + LODE_KEY_STIR(vec2(0.5, 0.5));
  open = min(open, stir * 0.25);
#endif
  return open;
}
#endif
`;

/** fragment shader, in main(), once albedo, N, rough and metal have their first values */
const fragMatter = /* glsl */ `
#ifdef LODE_MATTER
  // What the part is made of: its material's picture, wrapped round it from the three sides of its own space.
  // The picture is grey on average, so the part keeps the colour its builder gave it; what the picture adds is
  // grain, relief and the way shine wanders over a real surface.
  float hasMatter = step(-0.5, vMat);
  if (hasMatter > 0.5) {
    float sheet = floor(vMat + 0.01);
    // a half over the layer's number: this triangle is the bevelled edge of something (gfx/geo.js markEdges)
    float edge = step(0.25, vMat - sheet);
    int layer = int(sheet);
    vec4 info = uMatInfo[layer];
    vec3 on = normalize(vObjN);
    vec3 q = vObj * info.x;
    vec3 axisZ = cross(vAxisX, vAxisY);
  #ifdef LODE_MATTER_CHEAP
    // a phone: laid on from the one side the surface faces most
    vec3 an = abs(on);
    vec4 mc;
    vec4 md;
    vec3 tu;
    vec3 tv;
    if (an.x > an.y && an.x > an.z) { mc = texture(uMatColor, vec3(q.zy, sheet)); md = texture(uMatDetail, vec3(q.zy, sheet)); tu = axisZ; tv = vAxisY; }
    else if (an.y > an.z) { mc = texture(uMatColor, vec3(q.xz, sheet)); md = texture(uMatDetail, vec3(q.xz, sheet)); tu = vAxisX; tv = axisZ; }
    else { mc = texture(uMatColor, vec3(q.xy, sheet)); md = texture(uMatDetail, vec3(q.xy, sheet)); tu = vAxisX; tv = vAxisY; }
    vec2 lean = (md.xy * 2.0 - 1.0) * info.y;
    vec3 tilt = tu * lean.x + tv * lean.y;
  #else
    vec3 w3 = pow(abs(on), vec3(6.0));
    w3 /= w3.x + w3.y + w3.z;
    vec4 mc = texture(uMatColor, vec3(q.zy, sheet)) * w3.x + texture(uMatColor, vec3(q.xz, sheet)) * w3.y + texture(uMatColor, vec3(q.xy, sheet)) * w3.z;
    vec4 dX = texture(uMatDetail, vec3(q.zy, sheet));
    vec4 dY = texture(uMatDetail, vec3(q.xz, sheet));
    vec4 dZ = texture(uMatDetail, vec3(q.xy, sheet));
    vec4 md = dX * w3.x + dY * w3.y + dZ * w3.z;
    vec2 lx = (dX.xy * 2.0 - 1.0) * (info.y * w3.x);
    vec2 ly = (dY.xy * 2.0 - 1.0) * (info.y * w3.y);
    vec2 lz = (dZ.xy * 2.0 - 1.0) * (info.y * w3.z);
    vec3 tilt = axisZ * lx.x + vAxisY * lx.y + vAxisX * ly.x + axisZ * ly.y + vAxisX * lz.x + vAxisY * lz.y;
  #endif
    // far away the grain is smaller than a pixel: let it go rather than let it sparkle
    float near = 1.0 - smoothstep(14.0, 38.0, vDepth);
    N = normalize(flat_ + tilt * near);
    // the picture is a middle grey on the whole, and is divided by that grey — as light, which is what it is
    // handed here as (gfx/matter.js MATTER_MID) — so that it multiplies the paint by one on the whole. Its darkest
    // places are held to four tenths: a chip in pale paint is primer, not a hole (on a white tank, by a strong
    // lamp, the chips of the painted-steel picture were black spots — 16 November 2026)
    vec3 grain = clamp(mc.rgb * ${(1 / MATTER_MID).toFixed(4)}, 0.4, 2.0);
    albedo *= mix(vec3(1.0), grain, 0.35 + 0.65 * near);
    rough = clamp(rough + (md.z - 0.5) * 2.0 * info.z, 0.05, 1.0);
    // no two metres the same: slow drifts of tone and of shine
    float drift = lodeNoise3(vObj * 0.9 + 3.1) * 0.65 + lodeNoise3(vObj * 3.7 + 11.3) * 0.35;
    albedo *= 1.0 + 0.24 * (drift - 0.5);
    rough = clamp(rough + 0.14 * (lodeNoise3(vObj * 2.3 + 7.7) - 0.5), 0.05, 1.0);
  #ifdef LODE_BAKED
    // what stands on the floor is dirtiest where it meets it
    float foot = (1.0 - smoothstep(0.0, 0.6, vWorld.y)) * (0.45 + 0.55 * drift);
    albedo *= 1.0 - 0.42 * foot;
    rough = mix(rough, 0.95, foot * 0.6);
  #endif
    // edges wear first: along the bevels of things the finish is rubbed through, in patches, to what is under it.
    // Which triangles are edges is known from the model, not guessed from the picture, so it does not shimmer.
    float chip = lodeNoise3(vObj * 46.0) * 0.6 + lodeNoise3(vObj * 9.0 + 5.0) * 0.6;
    float worn = edge * smoothstep(0.42, 0.78, chip) * info.w * near;
    albedo = mix(albedo, mix(vec3(0.34, 0.33, 0.32), albedo * 1.7 + 0.03, metal), worn * 0.85);
    rough = mix(rough, 0.36, worn * 0.6);
    metal = mix(metal, max(metal, 0.8), worn * 0.85);
  }
#endif
`;

/** fragment shader, in main(), after the baked light and its highlight are in `col` */
const fragKey = /* glsl */ `
#ifdef LODE_KEY
  // the key lights: worked out here, pixel by pixel, with what stands in their way taken off (look/keylight.js)
  if (uKeyGain > 0.0) {
    for (int i = 0; i < LODE_KEY; i++) {
      // a slot nobody holds, or a lamp that has crept out: no sums for it
      if (uKeyCol[i].r + uKeyCol[i].g + uKeyCol[i].b <= 0.0) continue;
      vec3 toKey = uKeyPos[i].xyz - vWorld;
      float kd = length(toKey);
      float reachM = uKeyPos[i].w;
      float fade = reachM < 0.0 ? step(kd, -reachM) : lodeKeyFade(kd, reachM);
      if (fade <= 0.0) continue;
      vec3 Lk = toKey / max(kd, 1e-4);
      float beam = smoothstep(uKeyAxis[i].w, uKeyCol[i].w, dot(-Lk, uKeyAxis[i].xyz));
      float reach = beam * fade * uKeyGain;
      if (reach < 0.002) continue;
      // a face turned away from the lamp is in its own shadow whatever the depth picture says
      float turned = dot(flat_, Lk);
      float facing = smoothstep(-0.05, 0.12, turned);
      if (facing <= 0.0) continue;
      // light that skims along a surface picks out every bump on it, and a bump map is coarser than the wall it
      // stands for: the nearer the light lies to the surface's own plane, the less of the bumps it is given
      vec3 Nk = normalize(mix(N, flat_, 0.8 * (1.0 - smoothstep(0.0, 0.45, turned))));
      float nlk = max(dot(Nk, Lk), 0.0);
      // looked up a little off the surface, along its own normal: a surface must not shadow itself
      float open = lodeKeyOpen(uKeyMat[i] * vec4(vWorld + flat_ * uKeyTex.y, 1.0), float(i));
      vec3 Ek = uKeyCol[i].rgb * (reach * open * facing);
      col += albedo * (1.0 - metal * 0.88) * Ek * nlk;
      vec3 Hk = normalize(Lk + V);
      float nhk = max(dot(Nk, Hk), 0.0);
      float ddk = nhk * nhk * (a2 - 1.0) + 1.0;
      float Dk = min(a2 / (3.14159 * ddk * ddk), 80.0);
      vec3 Fk = F0 + (1.0 - F0) * pow(1.0 - max(dot(Hk, V), 0.0), 5.0);
      col += Ek * Fk * (Dk * nlk * 0.25) * uSheen;
    }
  }
#endif
`;

/**
 * fragment shader, in main(), where `seen` — what the surface mirrors — holds the sum that stands in for a place:
 * where there is a captured place, that takes its stead
 */
const fragEnv = /* glsl */ `
#ifdef LODE_ENVCUBE
  // inside the box that was captured, metal mirrors the place itself; outside it, the old sum
  float inside = uEnvMix;
  // where this surface is in the world. What is in the hands is not in the world: it is told where the eye is
  // (uEnvFrom) and how far inside the captured place that is (uEnvMix), and is near enough the eye to stand there
  vec3 from = uEnvFrom;
  if (inside < 0.0) {
    from = vWorld;
    // fading in over the first metres inside the box's edge (uEnvInfo.z: two where the edge is a line across
    // open ground, a few tenths where it is a wall), and by how much of the capture is shown just now
    // (uEnvInfo.w: it is faded out before another place's takes its stead)
    float edge = uEnvInfo.z;
    inside = smoothstep(uEnvBox.x, uEnvBox.x + edge, vWorld.x) * (1.0 - smoothstep(uEnvBox.z - edge, uEnvBox.z, vWorld.x))
           * smoothstep(uEnvBox.y, uEnvBox.y + edge, vWorld.z) * (1.0 - smoothstep(uEnvBox.w - edge, uEnvBox.w, vWorld.z))
           * uEnvInfo.w;
  }
  if (inside > 0.0) {
    // the capture was made from one point and this surface is somewhere else: the box is taken for the room,
    // the ray followed to its wall, and the capture read towards the place where it lands
    vec3 way = step(0.0, back);
    vec3 wall = mix(vec3(uEnvBox.x, 0.0, uEnvBox.y), vec3(uEnvBox.z, uEnvAt.w, uEnvBox.w), way);
    vec3 run = (wall - from) / ((way * 2.0 - 1.0) * max(abs(back), vec3(1e-4)));
    vec3 toward = from + back * max(min(min(run.x, run.y), run.z), 0.0) - uEnvAt.xyz;
    float blur = rough * uEnvInfo.x;
  #ifdef LODE_GLINT
    // a floor shows its lamps by another sum (the glints): of the capture it keeps the glow, not the lamps
    blur = max(blur, 1.5);
  #endif
    seen = mix(seen, textureLod(uEnvCube, toward, blur).rgb * uEnvInfo.y, inside);
  }
#endif
`;

/** fragment shader, the last thing in main(): for counting, not for looking at */
const fragDebug = /* glsl */ `
#ifdef LODE_LOOK
  // for counting, not for looking at: green has a material (a picture of its own, or one wrapped round it),
  // magenta is bare paint
  if (uLookDebug > 0.5) {
    float has = 0.0;
  #ifdef LODE_MAP
    has = 1.0;
  #endif
  #ifdef LODE_MATTER
    has = max(has, hasMatter);
  #endif
    gl_FragColor = vec4(mix(vec3(1.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0), has), uOpacity * tex.a);
  }
#endif
`;

/** What goes into each marked place of the lit program: `//<look:vertHead>` gets `vertHead`, and so on. */
export const LOOK_GLSL = { vertHead, vertBody, fragHead, fragLib, fragMatter, fragKey, fragEnv, fragDebug };

// Flat pictures that always face the camera: lamp flares, smoke, sparks, flashes.
// One draw call for as many as `capacity`, whatever they are doing.
import * as THREE from 'three';
import { FINISH_GLSL, shared } from './materials.js';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSizeRot;
attribute vec4 iColor;
varying vec2 vUv;
varying vec4 vColor;
varying float vDepth;

void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iSizeRot.y);
  float s = sin(iSizeRot.y);
  mv.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSizeRot.x;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vColor = iColor;
  vDepth = length(mv.xyz);
}
`;

const FRAG = /* glsl */ `
${FINISH_GLSL}
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
varying float vDepth;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float clear = 1.0 - lodeFogAmount(vDepth);
#ifdef LODE_FOG_FLOOR
  // a light is seen through haze as a glare: the haze never takes all of it (a drone's running lights)
  clear = max(clear, LODE_FOG_FLOOR);
#endif
#ifdef LODE_ADDITIVE
  // black in the picture means "nothing here", so its brightness is its strength
  gl_FragColor = vec4(lodeFinishAdd(vColor.rgb * tex.rgb * clear), vColor.a);
#else
  gl_FragColor = vec4(lodeFinish(mix(uFogColor, vColor.rgb * tex.rgb, clear)), vColor.a * tex.a);
#endif
}
`;

export class Billboards {
  /**
   * @param {object} o
   * @param {number} o.capacity   the most that can be shown at once
   * @param {THREE.Texture} o.map
   * @param {boolean} [o.additive=true] adds light (flares, fire) rather than covering what is behind (smoke)
   * @param {number} [o.fogFloor=0] the night haze never takes more of these than leaves this share (0: all of it)
   */
  constructor({ capacity, map, additive = true, depthTest = true, fogFloor = 0 }) {
    this.capacity = capacity;
    this.count = 0;
    this.pos = new Float32Array(capacity * 3);
    this.sizeRot = new Float32Array(capacity * 2);
    this.color = new Float32Array(capacity * 4);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
    );
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSizeRot = new THREE.InstancedBufferAttribute(this.sizeRot, 2).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iPos', this.aPos);
    geometry.setAttribute('iSizeRot', this.aSizeRot);
    geometry.setAttribute('iColor', this.aColor);
    geometry.instanceCount = 0;

    const uniforms = { uMap: { value: map } };
    for (const key in shared) uniforms[key] = shared[key];
    const defines = additive ? { LODE_ADDITIVE: 1, LODE_NO_DITHER: 1 } : { LODE_NO_DITHER: 1 };
    if (fogFloor > 0) defines.LODE_FOG_FLOOR = fogFloor.toFixed(3);
    const material = new THREE.ShaderMaterial({
      name: additive ? 'lode-flare' : 'lode-smoke',
      defines,
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
  }

  /** Writes one picture into slot i. */
  set(i, x, y, z, size, r, g, b, a = 1, rot = 0) {
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.sizeRot[i * 2] = size;
    this.sizeRot[i * 2 + 1] = rot;
    this.color[i * 4] = r;
    this.color[i * 4 + 1] = g;
    this.color[i * 4 + 2] = b;
    this.color[i * 4 + 3] = a;
  }

  /** Shows the first n slots; call after writing them. */
  commit(n) {
    this.count = Math.min(n, this.capacity);
    this.mesh.geometry.instanceCount = this.count;
    this.aPos.needsUpdate = true;
    this.aSizeRot.needsUpdate = true;
    this.aColor.needsUpdate = true;
  }
}

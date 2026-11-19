// Words on things that move: a gun's serial, a machine's number. (What is written on things that stand still is
// drawn by world/build.js, from what their builders return as `letters`.)
//
// Each text is drawn once on a small canvas and becomes a lit square that a model's builder stands just off one
// of its surfaces. The mesh is named 'lettering', which is how tests find it. Where there is no canvas (node,
// under test) the square is still made, with nothing on it, so that builders run everywhere.
import * as THREE from 'three';
import { lit } from '../materials.js';

const INK = { white: '#e9e5d8', hazard: '#e2b93b', black: '#15171a', red: '#b5382c', orange: '#d9772b' };
const cache = new Map();

function textureFor(text, tone) {
  const key = `${tone}:${text}`;
  if (cache.has(key)) return cache.get(key);
  let made = null;
  if (typeof document !== 'undefined') {
    const ROW = 64;
    const probe = document.createElement('canvas').getContext('2d');
    const font = `700 ${ROW * 0.74}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    probe.font = font;
    const gap = ROW * 0.05;
    let width = ROW * 0.3;
    for (const ch of text) width += probe.measureText(ch).width + gap;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(8, Math.ceil(width));
    canvas.height = ROW;
    const c = canvas.getContext('2d');
    c.font = font;
    c.textBaseline = 'middle';
    c.fillStyle = INK[tone] || INK.white;
    let x = ROW * 0.15;
    for (const ch of text) {
      c.fillText(ch, x, ROW * 0.52);
      x += c.measureText(ch).width + gap;
    }
    // stencilled paint that has been handled: small chips out of it, the same for the same text every time
    c.globalCompositeOperation = 'destination-out';
    let seed = 0;
    for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let n = 0; n < (canvas.width * ROW) / 220; n++) {
      c.globalAlpha = 0.3 + next() * 0.6;
      c.fillRect(next() * canvas.width, next() * ROW, 1 + next() * 4, 1 + next() * 2);
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    made = { map, aspect: canvas.width / ROW };
  }
  cache.set(key, made);
  return made;
}

/**
 * A line of text as a lit square facing +Z, centred on `at`, `height` metres tall and as wide as the text needs.
 * @param {string} text
 * @param {object} [o]
 * @param {number} [o.height=0.02] metres
 * @param {'white'|'hazard'|'black'|'red'|'orange'} [o.tone='white']
 * @param {number[]} [o.at]  where its middle is, in the model's space — a hair off the surface it is on
 * @param {number[]} [o.rot] XYZ Euler angles in radians; as made it faces +Z and reads along +X
 * @returns {THREE.Mesh} named 'lettering'
 */
export function lettering(text, { height = 0.02, tone = 'white', at = [0, 0, 0], rot = [0, 0, 0] } = {}) {
  const drawn = textureFor(text, tone);
  const material = drawn
    ? lit({ map: drawn.map, transparent: true, rough: 0.7 })
    : lit({ color: 0x000000, transparent: true, opacity: 0 });
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * (drawn ? drawn.aspect : 4), height), material);
  mesh.name = 'lettering';
  mesh.position.set(at[0], at[1], at[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  return mesh;
}

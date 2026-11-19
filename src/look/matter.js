// The pictures things are made of (the second look): fetched, and laid in the two picture arrays that the shader
// of every painted part reads one layer of (gfx/materials.js, LODE_MATTER).
//
// A layer to a material, in the order of the catalogue (gfx/matter.js). The first array is the material's colour
// picture, brought to a neutral grey on average — the shader multiplies a part's own paint by it, so the paint
// keeps its colour and gains the picture's grain. The second is worked out from the first, as the level's bump
// maps are (gfx/detail.js): which way each point tilts, and how much rougher or smoother it is than the part.
//
// Loop contract: every picture is asked for once, all at the same time; one that cannot be had leaves its layer
// plain grey — the part is then drawn in its paint alone, as it was before — and the game does not wait for it.
import * as THREE from 'three';
import { ART } from '../gfx/art.js';
import { makeDetail } from '../gfx/detail.js';
import { BORROWED, MATTER, MATTER_NAMES, toNeutral } from '../gfx/matter.js';
import { shared } from '../gfx/materials.js';

/** every material picture there is, as { name: { size: address } } — written out by the bundler */
const FILES = import.meta.glob('../assets/matter/*.webp', { query: '?url', import: 'default', eager: true });
const OWN = {};
for (const [path, url] of Object.entries(FILES)) {
  const [, name, size] = /([A-Za-z]+)\.(\d+)\.webp$/.exec(path) || [];
  if (name) (OWN[name] ||= {})[size] = url;
}

/** Where a material's picture is: its own, or one borrowed from the level's surfaces (gfx/matter.js BORROWED). */
const addressOf = (name, size) => (OWN[name] || ART[BORROWED[name]] || null)?.[size] || null;

/**
 * @param {object} o
 * @param {number} o.size        pixels across a layer: 512 on a desk, 256 on a phone
 * @param {number} [o.anisotropy=4]
 * @param {(url: string) => string} [o.address] a way to change where a picture is asked for (tests break it)
 * @returns {Promise<{ size: number, layers: string[], failed: string[] }>}
 */
export async function loadMatter({ size, anisotropy = 4, address = (url) => url }) {
  const layers = MATTER_NAMES.length;
  const colour = new Uint8Array(size * size * 4 * layers).fill(128);
  // neutral: no tilt, no change of roughness
  const detail = new Uint8Array(size * size * 4 * layers).fill(128);
  const failed = [];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  const pictures = await Promise.all(
    MATTER_NAMES.map(async (name) => {
      const url = MATTER[name].picture ? addressOf(name, size) : null;
      if (!url) {
        if (MATTER[name].picture) failed.push(name);
        return null;
      }
      try {
        const image = new Image();
        image.decoding = 'async';
        image.src = address(url);
        await image.decode();
        return image;
      } catch {
        failed.push(name);
        return null;
      }
    }),
  );

  pictures.forEach((image, layer) => {
    if (!image) return;
    context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size);
    const data = pixels.data;
    // to one middle grey on average, measured as light, each colour on its own (gfx/matter.js toNeutral): whatever
    // colour the picture has, only what it does round its own average is wanted. The pictures are made nearly so
    // already; the wall's concrete, which stands in for a material here, is not.
    toNeutral(data);
    context.putImageData(pixels, 0, 0);
    // the same arithmetic as the level's bump maps: a slope from the picture's darks and lights, and in blue how
    // much rougher (dark: dirt lies in the low places) or smoother than the part's own roughness it is there
    const tilts = makeDetail(new THREE.CanvasTexture(canvas), { strength: 1, rough: 0.5, vary: 1 });
    const bumps = tilts.image.getContext('2d').getImageData(0, 0, size, size).data;
    // a canvas keeps its top row first and a picture array its bottom row: turned over as it is copied, so that
    // these layers lie the same way up as every other texture in the game
    const at = layer * size * size * 4;
    for (let row = 0; row < size; row++) {
      const from = (size - 1 - row) * size * 4;
      colour.set(data.subarray(from, from + size * 4), at + row * size * 4);
      detail.set(bumps.subarray(from, from + size * 4), at + row * size * 4);
    }
    tilts.dispose();
  });

  const array = (bytes, colourSpace) => {
    const texture = new THREE.DataArrayTexture(bytes, size, size, layers);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.colorSpace = colourSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
    return texture;
  };
  shared.uMatColor.value = array(colour, THREE.SRGBColorSpace);
  shared.uMatDetail.value = array(detail, THREE.NoColorSpace);
  MATTER_NAMES.forEach((name, layer) => {
    const m = MATTER[name];
    shared.uMatInfo.value[layer].set(1 / m.metres, m.bump, m.vary, m.wear);
  });
  if (failed.length)
    console.warn(`materials whose pictures could not be had, drawn plain: ${failed.sort().join(', ')}`);
  return { size, layers: MATTER_NAMES.slice(), failed };
}

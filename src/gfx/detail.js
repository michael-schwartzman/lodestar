// Bump maps, made from the colour maps.
//
// Every surface texture in gfx/textures.js is a tiling picture of what the surface looks like. This turns such a
// picture into a second one that says what the surface FEELS like: which way each point tilts (red and green)
// and how rough it is there (blue). Dark lines in the picture — cracks, joints, seams, the gaps between the
// plates of a floor — are taken to be grooves, and the surface tilts down into them. It is the oldest trick
// there is, and it is right often enough: a crack is dark because it is deep.
import * as THREE from 'three';

/**
 * @param {THREE.Texture} texture a tiling canvas texture
 * @param {object} [o]
 * @param {number} [o.strength=1] how deep the relief is
 * @param {number} [o.rough=0.8]  how rough the surface is on the whole, 0 mirror … 1 chalk
 * @param {number} [o.vary=0.25]  how much rougher the dark parts are than the light (dirt lies in the cracks)
 * @returns {THREE.CanvasTexture | null} null where there is no canvas to read (a test without a browser)
 */
export function makeDetail(texture, { strength = 1, rough = 0.8, vary = 0.25 } = {}) {
  const source = texture?.image;
  if (typeof document === 'undefined' || !source?.getContext) return null;
  const w = source.width;
  const h = source.height;
  const pixels = source.getContext('2d').getImageData(0, 0, w, h).data;
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    height[i] = (pixels[i * 4] * 0.3 + pixels[i * 4 + 1] * 0.59 + pixels[i * 4 + 2] * 0.11) / 255;

  // the same slope whatever the size of the picture: a smaller one has steeper steps from pixel to pixel
  const k = 4 * strength * (w / 512);
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  const image = context.createImageData(w, h);
  const out = image.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // a wide and a narrow difference together: the narrow one keeps hairline cracks, the wide one gives the
      // slow swell of a worn surface
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 + (at(x + 3, y) - at(x - 3, y)) * 0.12;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 + (at(x, y + 3) - at(x, y - 3)) * 0.12;
      const here = height[y * w + x];
      const i = (y * w + x) * 4;
      // the picture is stored upside down (v runs up, rows run down), hence the sign of the second
      out[i] = Math.max(0, Math.min(255, (0.5 - dx * k * 0.5) * 255));
      out[i + 1] = Math.max(0, Math.min(255, (0.5 + dy * k * 0.5) * 255));
      out[i + 2] = Math.max(13, Math.min(255, (rough + (0.5 - here) * vary) * 255));
      out[i + 3] = 255;
    }
  context.putImageData(image, 0, 0);
  const detail = new THREE.CanvasTexture(canvas);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.colorSpace = THREE.NoColorSpace;
  detail.anisotropy = texture.anisotropy;
  detail.userData.metres = texture.userData?.metres;
  return detail;
}

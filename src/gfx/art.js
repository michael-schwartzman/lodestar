// The pictures some surfaces are made from, and loading them.
//
// They are in src/assets/art: made by an image model, chosen by a person and worked into tiles by tools/art/
// (docs/DESIGN.md, "Generated art"). The game never calls a model. A picture that cannot be had — no network, a
// file that fails, `?art=0` in the address — is simply not in what this returns, and gfx/textures.js paints that
// surface itself, as it did before there were pictures.
//
// Only the browser build reads this file (it uses the bundler's file list): nothing pure may import it.

/** every picture there is, as { name: { size: address } } — written out by the bundler from the folder's contents */
const FILES = import.meta.glob('../assets/art/*.webp', { query: '?url', import: 'default', eager: true });

export const ART = {};
for (const [path, url] of Object.entries(FILES)) {
  const [, name, size] = /([A-Za-z]+)\.(\d+)\.webp$/.exec(path) || [];
  if (!name) continue;
  (ART[name] ||= {})[size] = url;
}

/** The sizes pictures come in (pixels across); a detail level asks for one of them. */
export const ART_SIZES = [256, 512, 1024];

/**
 * @param {object} o
 * @param {number} o.size                 256 | 512 | 1024, from the detail level
 * @param {boolean} [o.enabled=true]      false: load nothing (every surface is painted)
 * @param {(done: number) => void} [o.onProgress]  told how far along it is, 0 … 1
 * @param {(url: string) => string} [o.address]    a way to change where a picture is asked for (tests break it)
 * @returns {Promise<{ images: Record<string, HTMLImageElement>, failed: string[], size: number }>}
 */
export async function loadArt({ size, enabled = true, onProgress, address = (url) => url }) {
  const images = {};
  const failed = [];
  const names = enabled ? Object.keys(ART) : [];
  let done = 0;
  await Promise.all(
    names.map(async (name) => {
      const url = ART[name][size] || ART[name][512] || Object.values(ART[name])[0];
      try {
        const image = new Image();
        image.decoding = 'async';
        image.src = address(url);
        await image.decode();
        images[name] = image;
      } catch {
        failed.push(name);
      }
      onProgress?.(++done / names.length);
    }),
  );
  if (failed.length) console.warn(`pictures that could not be loaded, painted instead: ${failed.sort().join(', ')}`);
  return { images, failed, size };
}

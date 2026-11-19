// What things are made of, in the second look (docs/DESIGN.md, "The second look").
//
// A part of a model says what it is made of by one of these names — `paint(g, colour, { mat: 'rubber' })` in
// gfx/geo.js — and the shader then wraps that material's picture round it: its grain, its bumps, how its shine
// varies. The COLOUR is still the part's own: every picture is graded to a neutral grey, and only what it does
// around that grey is used. One picture of painted steel therefore serves an olive truck and a red container.
//
// The order is the order of the layers in the picture array (look/matter.js); test/unit/matter.test.mjs pins both.
// No three.js and no browser in here.

/** the layer of a vertex that has no material: it is drawn in its paint alone, as everything used to be */
export const NO_MATTER = -1;

/**
 * picture: there is a picture for it in src/assets/matter (glass has none)
 * metres:  how much of a surface one repeat of the picture covers — small for what is seen from a hand's breadth
 *          (the gun), large for what is seen across a yard
 * bump:    how deep its relief is
 * vary:    how much its roughness wanders from the part's own
 * wear:    how readily its edges wear through to what is underneath
 */
export const MATTER = {
  paint: { layer: 0, picture: true, metres: 1.6, bump: 0.45, vary: 0.35, wear: 1 },
  steel: { layer: 1, picture: true, metres: 1.1, bump: 0.5, vary: 0.45, wear: 0.5 },
  galv: { layer: 2, picture: true, metres: 0.8, bump: 0.3, vary: 0.4, wear: 0.3 },
  rust: { layer: 3, picture: true, metres: 1.2, bump: 1, vary: 0.3, wear: 0 },
  gunmetal: { layer: 4, picture: true, metres: 0.22, bump: 0.3, vary: 0.4, wear: 1 },
  polymer: { layer: 5, picture: true, metres: 0.12, bump: 0.5, vary: 0.2, wear: 0.4 },
  rubber: { layer: 6, picture: true, metres: 0.3, bump: 0.6, vary: 0.2, wear: 0.15 },
  fabric: { layer: 7, picture: true, metres: 0.09, bump: 0.8, vary: 0.2, wear: 0 },
  wood: { layer: 8, picture: true, metres: 1.2, bump: 1, vary: 0.3, wear: 0.2 },
  concrete: { layer: 9, picture: true, metres: 3, bump: 0.8, vary: 0.25, wear: 0.1 },
  glass: { layer: 10, picture: false, metres: 1, bump: 0, vary: 0, wear: 0 },
  // 16 November 2026, the plan's second step ("about sixteen materials"): added after the eleven, so that no
  // layer already named by a model changes its number.
  /** machined, satin: the casings of the cascade, the bodies of instruments */
  aluminium: { layer: 11, picture: true, metres: 0.6, bump: 0.25, vary: 0.4, wear: 0.2 },
  /** soft yellow metal gone dull — and, painted copper-red by its part, copper: cartridges, fittings, busbars */
  brass: { layer: 12, picture: true, metres: 0.25, bump: 0.3, vary: 0.45, wear: 0.3 },
  /** the smooth stoved finish of cabinets, consoles and lockers: paint that has been looked after */
  enamel: { layer: 13, picture: true, metres: 1.2, bump: 0.2, vary: 0.25, wear: 0.6 },
  /** tread plate: steps, decks, the beds of vehicles */
  chequer: { layer: 14, picture: true, metres: 0.5, bump: 1.2, vary: 0.3, wear: 0.5 },
  /** heavy cloth seen across a yard — a lorry's cover, a tarpaulin: creases, where `fabric` is threads */
  canvas: { layer: 15, picture: true, metres: 1.4, bump: 0.9, vary: 0.2, wear: 0 },
  /** the mountain itself (the picture is the cavern wall's): boulders, spoil */
  rock: { layer: 16, picture: true, metres: 3, bump: 1, vary: 0.2, wear: 0 },
};

export const MATTER_NAMES = Object.keys(MATTER);

/**
 * The materials whose picture is one the level's surfaces already have (src/assets/art, by that name): the wall's
 * concrete, the cavern's rock. Every other material with a picture has one of its own in src/assets/matter.
 */
export const BORROWED = { concrete: 'concrete', rock: 'rock' };

/**
 * The middle grey every material's picture is brought to, measured as LIGHT. The pictures are stored the way
 * pictures are (sRGB), in which the grey they are graded to is the number one half (tools/art); a shader is
 * handed light, in which that same grey is this. The shader divides by it (gfx/materials.js), so that a picture
 * multiplies a part's paint by one on the whole: it changes how the part looks, not how light it is.
 */
export const MATTER_MID = 0.214;

const toLight = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toPicture = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
/** the light of each of the 256 values a picture can hold */
const LIGHT = Float32Array.from({ length: 256 }, (_, i) => toLight(i / 255));

/**
 * Brings a picture — red, green, blue and alpha, a byte each, as a canvas hands them over — to MATTER_MID on
 * average, as light, in each of its three colours on its own: whatever colour it has on the whole is taken out,
 * and what it does round its own average is kept. In place. Alpha is left alone.
 * @param {Uint8ClampedArray | Uint8Array} pixels
 */
export function toNeutral(pixels) {
  const count = pixels.length / 4;
  if (!count) return pixels;
  // twice: what the first pass pushes past white is cut off, which leaves the average a little short
  for (let pass = 0; pass < 2; pass++) {
    const mean = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) mean[c] += LIGHT[pixels[i + c]];
    const gain = mean.map((sum) => MATTER_MID / Math.max(1e-6, sum / count));
    if (gain.every((g) => Math.abs(g - 1) < 0.002)) break;
    const table = gain.map((g) =>
      Uint8Array.from({ length: 256 }, (_, v) => Math.round(Math.min(1, toPicture(LIGHT[v] * g)) * 255)),
    );
    for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) pixels[i + c] = table[c][pixels[i + c]];
  }
  return pixels;
}

/** The layer of a material by name. A name that is not in the catalogue is a mistake in a model: say so. */
export function layerOf(name) {
  const m = MATTER[name];
  if (!m) throw new Error(`no such material: "${name}" (there are: ${MATTER_NAMES.join(', ')})`);
  return m.layer;
}

const lum = (r, g, b) => r * 0.3 + g * 0.59 + b * 0.11;

/**
 * What a part is made of when its builder did not say: guessed from its colour (linear r, g, b), how rough it is
 * and how much like metal. Good enough for a crate at the far end of a yard; anything looked at closely says.
 */
export function matterOf(r, g, b, rough, metal) {
  const light = lum(r, g, b);
  if (metal >= 0.5) {
    if (light < 0.06) return 'gunmetal';
    return light > 0.4 ? 'galv' : 'steel';
  }
  if (rough >= 0.8 && light < 0.03) return 'rubber';
  const most = Math.max(r, g, b);
  const colourful = most > 1e-6 ? (most - Math.min(r, g, b)) / most : 0;
  if (colourful > 0.25) return 'paint';
  if (rough >= 0.85 && light > 0.25) return 'concrete';
  if (light < 0.1) return 'polymer';
  return 'paint';
}

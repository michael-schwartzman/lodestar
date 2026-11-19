// The key lights of the site, in the second look: where each hangs, what it is aimed at, and its light.
//
// Strong lamps that throw real shadows; the hundred small lamps stay as they are, as fill. The first two — over
// the yard of containers outside the drainage adit — were the slice of 15 November 2026 (docs/DESIGN.md, "The
// second look"); the rest are the plan's third step, of the 16th: "one strong light in every space that throws
// real shadows: the moon outside and down the shaft, floodlights in the cavern, work lights in the hall".
//
//   the south flood  hangs high on the cavern's south wall and is aimed north across the yard. It is the one that
//                    lights what somebody coming out of the adit is looking at: the long sides of the containers
//                    full on, their ends at a slant, their shadows thrown away to the left, onto the building.
//   the east flood   hangs on the building's south wall, further in, and is aimed back towards the adit: weaker,
//                    behind everything in the view. It is the lamp that is SEEN, it edges the tops of things, and
//                    its shadows run along the ground towards the eye.
//
// The first plan was one lamp to a space, and it was the east one alone. By that lamp alone every face in the
// view is in its own shade (15 November 2026; `debug.keySolo(1)` shows it): a view lit only from behind shows
// shapes, not what they are made of. So the big spaces have a lamp that lights what is looked at and one behind
// it; a room has one. Not all of them burn at once: look/slots.js says which, from where the eye is.
//
// More than one colour of light, as the plan asks: the floods are a cold white; the moon is blue; the tunnel and
// the dock are sodium; the working rooms are tungsten; the hall and the feed room have the greenish white of
// their high bays; the control room is lit the colour of its screens; the armoury and the drone bay are on
// their red standing lights.
//
// How strong: in the same measure as the baked light, in which a surface a lamp post shines straight down on gets
// about 1.7. A flood across forty metres of yard is 4; a lamp in a room, which is a few metres from what it
// lights, is 2 to 2.5 — and under a roof the light worked out beforehand is turned down to be its fill
// (ROOM_FILL). The first pictures of the rooms, with lamps as strong as the floods over the rooms' own light at
// full, were white; the second, with weaker lamps over it at full, showed no lamp at all (16 November 2026).
//
// No three.js and no browser in here.

// the colour of each kind of lamp, its strongest part being 1
const COLD = [0.9, 0.95, 1];
const SODIUM = [1, 0.667, 0.278];
const BAY = [0.857, 1, 0.914];
const WHITE = [0.97, 1, 0.97];
const TUNGSTEN = [1, 0.9, 0.74];
const AMBER = [1, 0.69, 0.3];
const SCREEN = [0.42, 0.9, 1];
const RED = [1, 0.31, 0.2];
const MOONLIGHT = [0.47, 0.625, 1];

/**
 * A key light.
 * @param {string} name
 * @param {'flood' | 'work' | 'moon'} kind what the lamp itself looks like (look/keylight.js): a bank of four heads,
 *   a single head, nothing at all
 * @param {number[]} at     x, y, z: where it hangs (metres)
 * @param {number[]} aim    x, y, z: what it is aimed at
 * @param {number[]} beam   the half-angles of its beam, in degrees — full inside the first, nothing outside the
 *   second — and how far it reaches, in metres
 * @param {number[]} tone   its colour (above)
 * @param {number} power    how strong
 * @param {object} [more]   sky: it hangs outside the map (the moon): a line to it is followed to the map's edge.
 *   even: its light does not fade with distance (the moon again). near, far: how far from its light the eye must
 *   be for it to start to fade, and to be out (look/slots.js; left out, by its reach). column: its light comes
 *   down a hole this far across from its middle (metres) — the air it lights is that wide (look/key.js shaftOf).
 */
const key = (name, kind, at, aim, beam, tone, power, more = {}) => ({
  name,
  kind,
  x: at[0],
  y: at[1],
  z: at[2],
  tx: aim[0],
  ty: aim[1],
  tz: aim[2],
  inner: beam[0],
  outer: beam[1],
  range: beam[2],
  r: +(tone[0] * power).toFixed(3),
  g: +(tone[1] * power).toFixed(3),
  b: +(tone[2] * power).toFixed(3),
  ...more,
});

/**
 * How far the light worked out beforehand is turned down under a built ceiling, where there are key lights: it
 * becomes the fill beside them (world/build.js). 1 would leave a room as bright as its own lamps make it, with a
 * key light on top that adds a seventh; at 0.55 the key is the stronger of the two.
 */
export const ROOM_FILL = 0.55;

export const KEYS = [
  // ---------- the main cavern: the yard south of the building ----------
  key('yard flood, south', 'flood', [29, 9, 83.3], [35, 0.5, 62], [34, 50, 46], COLD, 4),
  key('yard flood, east', 'flood', [50, 8.2, 55.06], [28, 0.5, 65.5], [30, 44, 46], COLD, 3),
  key('yard flood, portal', 'flood', [68.6, 9, 83.3], [85, 0.5, 66], [34, 50, 46], COLD, 3.8),
  key('yard flood, south-east tower', 'flood', [109.3, 8.6, 80.3], [90, 0.5, 68], [28, 42, 44], COLD, 2.9),
  key('dock flood', 'flood', [94, 8.2, 55.06], [101, 0.5, 69], [32, 48, 40], SODIUM, 3),
  // ---------- …the strip west of it, and the passage along its north wall ----------
  key('west flood', 'flood', [29.94, 8.5, 50], [22, 0.5, 26], [30, 46, 44], COLD, 3.2),
  key('north passage, west tower', 'flood', [18.7, 8.6, 14.5], [48, 0.5, 14.5], [9, 17, 50], COLD, 3),
  key('north passage, east', 'work', [99.6, 6.8, 14.5], [70, 0.5, 14.5], [9, 17, 50], COLD, 3),
  // ---------- under the exhaust shaft ----------
  key('the moon, down the shaft', 'moon', [104.4, 56, 37.8], [106.5, 0, 34.5], [5, 6.5, 64], MOONLIGHT, 1.6, {
    even: true,
    // half the width of the shaft it comes down: its light is a column that wide, not the cone its beam would be
    column: 3.3,
  }),
  key('shaft cavern flood', 'flood', [106.5, 8.5, 13.4], [106.5, 0.5, 30], [30, 46, 40], COLD, 1.9),
  // ---------- the way out ----------
  key('the moon, on the forecourt', 'moon', [38.8, 36, 133.3], [64, 0, 92.5], [7, 11, 80], MOONLIGHT, 1.2, {
    sky: true,
    even: true,
  }),
  key('tunnel lamp', 'work', [64, 5.1, 84.4], [64, 0.2, 93], [34, 56, 18], SODIUM, 2.4),
  key('adit lamp', 'work', [4.6, 2.3, 66.6], [13, 0.7, 66.6], [26, 46, 14], TUNGSTEN, 1.8),
  // ---------- the building ----------
  // the cascades stand in rows that run east and west, as tall as a man and half again: two lamps in opposite
  // corners of the hall, high up, each shining across the rows — every casing is lit on two sides by one and
  // edged by the other, and the aisles between the rows lie in bars of light and shadow
  key('cascade hall, south-west', 'flood', [32.2, 6.7, 40.4], [50, 1.2, 27], [36, 54, 46], BAY, 2.6),
  key('cascade hall, north-east', 'flood', [70.2, 6.7, 17.6], [52, 1.2, 31], [36, 54, 46], BAY, 2),
  key('feed room', 'work', [73.6, 4.6, 22.5], [88, 0.5, 22.5], [36, 56, 30], BAY, 2.3),
  key('control room', 'work', [73.6, 3.3, 35.5], [80, 0.6, 35.5], [40, 62, 16], SCREEN, 2),
  key('switchgear', 'work', [94.5, 3.7, 30.4], [94.5, 0.5, 37], [38, 60, 16], AMBER, 2.3),
  key('corridor, west', 'work', [31.6, 3.3, 44.5], [42, 0, 44.5], [24, 44, 32], WHITE, 3.3, { near: 10, far: 22 }),
  key('corridor, east', 'work', [98.6, 3.3, 44.5], [88, 0, 44.5], [24, 44, 32], WHITE, 3.3, { near: 10, far: 22 }),
  key('lobby', 'work', [32.6, 3.3, 50.5], [40, 0.5, 50.5], [40, 62, 18], TUNGSTEN, 2.3),
  key('armoury', 'work', [53, 3.3, 47.6], [53, 0.5, 51], [40, 64, 12], RED, 2.4),
  key('workshop', 'work', [60.6, 3.3, 49.5], [70, 0.5, 49.5], [40, 62, 20], WHITE, 2.2),
  key('loading dock', 'work', [98.4, 4.6, 50.5], [88, 0.5, 50.5], [38, 58, 22], SODIUM, 2.4),
  key('generator shed', 'work', [19.6, 3.3, 32.5], [24, 0.5, 32.5], [40, 62, 12], TUNGSTEN, 2.1),
  key('gatehouse', 'work', [71.6, 2.9, 79.5], [75, 0.6, 80], [40, 64, 9], TUNGSTEN, 2),
  // ---------- the drone bay, behind its wire on the north passage ----------
  key('drone bay', 'work', [38.6, 4.6, 8.5], [64, 0.5, 8.5], [12, 26, 56], RED, 2.4),
];

/**
 * The captured places — what metal mirrors (look/mirror.js). One to a space: where it is taken from (x, y, z),
 * and the box inside which it is used: `box` is x0, z0, x1, z1 on the map and `top` its height. The box is taken
 * for the room when a reflection is placed, so it is the room: its edges lie in the middle of the walls round it.
 * `fade`: over how many metres inside the box's edge the capture fades in — two where the edge is a line across
 * open ground (the two halves of the yard), a few tenths where it is a wall.
 *
 * The first is the slice's (15 November 2026): the west half of the main cavern, floor to roof. The plan asked
 * for "one captured view of each kind of space"; these are one of each space, taken the first time the eye is in
 * it. The drone bay has none: nobody gets in there.
 */
const place = (name, at, box, top, fade = 0.4) => ({ name, x: at[0], y: at[1], z: at[2], box, top, fade });
export const MIRRORS = [
  place('yard, west', [31, 2.4, 65.5], [14.5, 54.5, 52, 83.5], 13.5, 2),
  place('yard, east', [79.5, 2.4, 71.5], [52, 54.5, 113, 83.5], 13.5, 2),
  place('west strip', [21.5, 2.4, 42.5], [14.5, 16.5, 30.5, 54.5], 12.5, 2),
  place('north passage', [60.5, 2.2, 14.5], [14.5, 12.5, 100.5, 16.5], 12.5, 1),
  place('shaft cavern', [106.5, 2.4, 26.5], [100.5, 12.5, 113, 54.5], 12.5, 1),
  place('cascade hall', [51.5, 3.9, 29.5], [30.5, 16.5, 72.5, 42.5], 7),
  place('feed room', [86.5, 2.2, 22.5], [72.5, 16.5, 100.5, 28.5], 5),
  place('control room', [79.5, 1.8, 35.5], [72.5, 28.5, 85.5, 42.5], 3.6),
  place('switchgear', [94.5, 2, 35.5], [89.5, 28.5, 100.5, 42.5], 4),
  place('corridor', [65.5, 1.8, 44.5], [30.5, 42.5, 100.5, 46.5], 3.6),
  place('corridor, north arm', [87.5, 1.8, 36.5], [85.5, 28.5, 89.5, 42.5], 3.6),
  place('lobby', [39.5, 1.8, 50.5], [30.5, 46.5, 47.5, 54.5], 3.6),
  place('armoury', [53.5, 1.8, 50.5], [47.5, 46.5, 59.5, 54.5], 3.6),
  place('workshop', [69.5, 1.8, 50.5], [59.5, 46.5, 79.5, 54.5], 3.6),
  place('loading dock', [89.5, 2.2, 50.5], [79.5, 46.5, 100.5, 54.5], 5),
  place('generator shed', [23.5, 1.8, 32.5], [18.5, 28.5, 27.5, 37.5], 3.6),
  place('gatehouse', [73.5, 1.6, 79.5], [70.5, 76.5, 77.5, 83.5], 3.2),
  place('drainage adit', [9.5, 1.5, 66.5], [2.5, 63.5, 14.5, 70.5], 3),
  place('tunnel and forecourt', [64.5, 2.2, 91.5], [55.5, 83.5, 72.5, 96], 12, 1),
];

/** the first of them, as the slice had it */
export const MIRROR = MIRRORS[0];

/**
 * The captured place a point on the map is in: the smallest box that holds it — a shed stands inside the strip
 * of cavern it was built in — or null where there is none.
 * @param {object[]} [places=MIRRORS]
 */
export function mirrorAt(x, z, places = MIRRORS) {
  let best = null;
  let least = Infinity;
  for (const s of places) {
    if (x < s.box[0] || x >= s.box[2] || z < s.box[1] || z >= s.box[3]) continue;
    const area = (s.box[2] - s.box[0]) * (s.box[3] - s.box[1]);
    if (area < least) {
      least = area;
      best = s;
    }
  }
  return best;
}

/**
 * Whether a lamp that hangs at (x, z) and lights `reach` metres round it can light anything in a captured place:
 * the place's box is nearer the lamp than that. A lamp that goes out, or comes back, makes stale the captures of
 * the places it reaches, and no others (look/mirror.js `dirty`).
 * @param {{ box: number[] }} space one of MIRRORS
 */
export function mirrorReached(space, x, z, reach) {
  const dx = Math.max(space.box[0] - x, 0, x - space.box[2]);
  const dz = Math.max(space.box[1] - z, 0, z - space.box[3]);
  return dx * dx + dz * dz < reach * reach;
}

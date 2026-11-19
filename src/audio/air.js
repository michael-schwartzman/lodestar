// What the air of a place sounds like. Pure: main.js asks it for the listener every frame, and
// test/unit/air.test.mjs pins it. The site is inside a mountain, and the ear is told so as well as the eye:
// wind belongs to the outside, the facility's air to the facility, and water comes through bare rock.
import { ZONE } from '../world/map.js';

/** Bored through the rock and left bare: they have a ceiling (world/grid.js `ceil`), but it is rock. */
const BORED = new Set([ZONE.ADIT, ZONE.TUNNEL, ZONE.BAY]);

/** What grid.sky says of a cell (world/grid.js). */
const SKY = 1;
const SHAFT = 2;

/**
 * @param {object} at
 * @param {number} at.sky    world/grid.js `sky` where the listener is: 0 rock overhead, 1 open sky, 2 the shaft's foot
 * @param {boolean} at.room  is there a built ceiling over the listener
 * @param {number} at.zone   world/map.js ZONE
 * @returns {{ wind: number, hum: number, drips: boolean }} how loud the wind and the air of the facility are
 *   (0..1, before the Ambience volume), and whether water drips somewhere near
 */
export function airOf({ sky, room, zone }) {
  if (sky === SKY) return { wind: 0.55, hum: 0, drips: false };
  // a room of the facility, or a hut with a roof of its own: lined, dry, and close
  const lined = room && !BORED.has(zone);
  return {
    // a little of the wind comes down the exhaust shaft; none of it gets anywhere else
    wind: sky === SHAFT ? 0.2 : 0.04,
    hum: lined ? 0.5 : room ? 0.2 : 0.3,
    drips: !lined,
  };
}

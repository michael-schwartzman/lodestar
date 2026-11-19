// Contract lock: what the air of a place sounds like (src/audio/air.js). Decision of 12 November 2026 — the owner:
// "I want it clear that this is a hidden centrifuge site inside a mountain, underground, not just a hangar."
// The ear is told as well as the eye: wind belongs to the outside, and water comes through bare rock.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { airOf } from '../../src/audio/air.js';
import { buildSite, W, H, ZONE } from '../../src/world/map.js';
import { KIND } from '../../src/world/grid.js';

const ROCK = 0;
const SKY = 1;
const SHAFT = 2;
const LINED = [ZONE.LOBBY, ZONE.CORRIDOR, ZONE.HALL, ZONE.CONTROL, ZONE.FEED, ZONE.POWER, ZONE.DOCK, ZONE.WORKSHOP];
const BORED = [ZONE.ADIT, ZONE.TUNNEL, ZONE.BAY];

test('under the open sky there is wind, and nothing of the facility', () => {
  const air = airOf({ sky: SKY, room: false, zone: ZONE.OUTSIDE });
  assert.ok(air.wind >= 0.4, `the wind outside is only ${air.wind}`);
  assert.equal(air.hum, 0);
  assert.equal(air.drips, false);
});

test('inside the mountain there is next to no wind — anywhere, in any zone', () => {
  for (const zone of Object.values(ZONE))
    for (const room of [false, true]) {
      const air = airOf({ sky: ROCK, room, zone });
      assert.ok(air.wind <= 0.05, `wind ${air.wind} under rock in zone ${zone}`);
      assert.ok(air.hum > 0 && air.hum <= 1, `the air of the place is ${air.hum} in zone ${zone}`);
    }
});

test('a little of the wind comes down the exhaust shaft: more than under rock, far less than outside', () => {
  const foot = airOf({ sky: SHAFT, room: false, zone: ZONE.STACK });
  const cavern = airOf({ sky: ROCK, room: false, zone: ZONE.STACK });
  const outside = airOf({ sky: SKY, room: false, zone: ZONE.OUTSIDE });
  assert.ok(foot.wind > cavern.wind * 2, `${foot.wind} at the foot of the shaft, ${cavern.wind} beside it`);
  assert.ok(foot.wind < outside.wind / 2, `${foot.wind} at the foot of the shaft, ${outside.wind} outside`);
});

test('water comes through bare rock — the cavern, the adit, the tunnel, the drone bay — and never into a lined room', () => {
  for (const zone of [ZONE.YARD, ZONE.STACK]) assert.equal(airOf({ sky: ROCK, room: false, zone }).drips, true);
  for (const zone of BORED) assert.equal(airOf({ sky: ROCK, room: true, zone }).drips, true, `zone ${zone}`);
  for (const zone of LINED) assert.equal(airOf({ sky: ROCK, room: true, zone }).drips, false, `zone ${zone}`);
  // a hut that stands in the cavern has a roof of its own
  for (const zone of [ZONE.GATEHOUSE, ZONE.GENSHED, ZONE.ARMOURY])
    assert.equal(airOf({ sky: ROCK, room: true, zone }).drips, false, `zone ${zone}`);
});

test('the air of the facility is closest in its lined rooms, and thinner out in the rock', () => {
  const room = airOf({ sky: ROCK, room: true, zone: ZONE.HALL });
  const cavern = airOf({ sky: ROCK, room: false, zone: ZONE.YARD });
  const adit = airOf({ sky: ROCK, room: true, zone: ZONE.ADIT });
  assert.ok(room.hum > cavern.hum, `${room.hum} in the hall, ${cavern.hum} in the cavern`);
  assert.ok(adit.hum <= cavern.hum, `${adit.hum} in the adit, ${cavern.hum} in the cavern`);
});

test('on the map as it is built: you start where water drips and no wind blows, and the pickup is in the wind', () => {
  const site = buildSite();
  const g = site.grid;
  const at = (x, z) => {
    const i = g.index(Math.floor(x), Math.floor(z));
    return airOf({ sky: g.sky[i], room: g.ceil[i] > 0, zone: g.zone[i] });
  };
  const start = at(site.start.x, site.start.z);
  assert.ok(start.drips && start.wind <= 0.05, JSON.stringify(start));
  const pickup = at(site.pickup.x, site.pickup.z);
  assert.ok(!pickup.drips && pickup.wind >= 0.4 && pickup.hum === 0, JSON.stringify(pickup));
  // and of every cell a body can be in, the windy ones are exactly those under the sky
  let windy = 0;
  let sky = 0;
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const i = g.index(x, z);
      if (g.kind[i] === KIND.ROCK || g.kind[i] === KIND.WALL) continue;
      if (g.sky[i] === SKY) sky++;
      if (airOf({ sky: g.sky[i], room: g.ceil[i] > 0, zone: g.zone[i] }).wind >= 0.4) windy++;
    }
  assert.ok(sky > 0);
  assert.equal(windy, sky);
});

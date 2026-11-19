// The things the mission puts in the world: where the charges go and the charges themselves, the beacon and its
// pad, the pickup, the ammunition. They only show what the mission says; they decide nothing.
import * as THREE from 'three';
import { glow, lit, ownMaterials, setProbe } from './gfx/materials.js';
import { box, merge } from './gfx/geo.js';

const tint = new THREE.Color();

export function createMarkers({ scene, site, models, world, fx, audio }) {
  const group = new THREE.Group();
  group.name = 'mission';
  scene.add(group);

  /** everything here that takes the light of the place it stands in: its materials, and where that is */
  const standing = [];
  const takeLight = ({ mats, x, z }) => {
    world.probe(x, z, tint);
    tint.setRGB(Math.max(tint.r, 0.1), Math.max(tint.g, 0.11), Math.max(tint.b, 0.13));
    setProbe(mats, tint);
  };
  const lightUp = (root, x, z) => {
    const entry = { mats: ownMaterials(root), x, z };
    standing.push(entry);
    takeLight(entry);
  };
  const facing = (nx, nz) => Math.atan2(-nx, -nz);

  // ---------- charge sites ----------
  const frameGeometry = merge([
    box(0.5, 0.025, 0.02, 0xffffff, [0, 0.19, 0]),
    box(0.5, 0.025, 0.02, 0xffffff, [0, -0.19, 0]),
    box(0.025, 0.4, 0.02, 0xffffff, [0.25, 0, 0]),
    box(0.025, 0.4, 0.02, 0xffffff, [-0.25, 0, 0]),
    box(0.12, 0.02, 0.02, 0xffffff, [0, 0, 0]),
    box(0.02, 0.12, 0.02, 0xffffff, [0, 0, 0]),
  ]);
  const charges = site.charges.map((c) => {
    const frame = new THREE.Mesh(frameGeometry, glow({ color: 0xffb44a, intensity: 1.6, vertexColors: true }));
    frame.position.set(c.x + c.nx * 0.04, c.y, c.z + c.nz * 0.04);
    frame.rotation.y = facing(c.nx, c.nz);
    group.add(frame);
    const model = models.buildCharge();
    model.root.position.set(c.x, c.y, c.z);
    model.root.rotation.y = facing(c.nx, c.nz);
    model.root.visible = false;
    group.add(model.root);
    lightUp(model.root, c.x + c.nx * 0.5, c.z + c.nz * 0.5);
    return { site: c, frame, model, led: model.parts.led?.material || null, planted: false };
  });

  // ---------- the beacon ----------
  const ringGeometry = (inner, outer) => new THREE.RingGeometry(inner, outer, 48).rotateX(-Math.PI / 2);
  // ---------- where the charges are fired from ----------
  const firing = site.firing
    ? new THREE.Mesh(ringGeometry(0.52, 0.64), glow({ color: 0xffb44a, intensity: 1, additive: true }))
    : null;
  if (firing) {
    firing.position.set(site.firing.x, 0.04, site.firing.z);
    group.add(firing);
  }
  const pad = new THREE.Mesh(ringGeometry(1.45, 1.6), glow({ color: 0x8dffcf, intensity: 1, additive: true }));
  pad.position.set(site.beacon.x, 0.04, site.beacon.z);
  group.add(pad);
  const beacon = models.buildBeacon();
  beacon.root.position.set(site.beacon.x, 0, site.beacon.z);
  beacon.root.visible = false;
  group.add(beacon.root);
  lightUp(beacon.root, site.beacon.x, site.beacon.z);
  const beamGeometry = new THREE.CylinderGeometry(0.07, 0.07, 1, 8, 1, true).translate(0, 0.5, 0);
  const beam = new THREE.Mesh(beamGeometry, glow({ color: 0x8dffcf, intensity: 0.8, additive: true }));
  beam.position.set(site.beacon.x, 1.1, site.beacon.z);
  beam.scale.set(1, 90, 1);
  beam.visible = false;
  group.add(beam);

  // ---------- the pickup ----------
  const pickup = new THREE.Mesh(ringGeometry(2.7, 2.95), glow({ color: 0x8dffcf, intensity: 1.2, additive: true }));
  pickup.position.set(site.pickup.x, 0.05, site.pickup.z);
  const pickupBeam = new THREE.Mesh(beamGeometry, glow({ color: 0x8dffcf, intensity: 0.5, additive: true }));
  pickupBeam.position.set(site.pickup.x, 0, site.pickup.z);
  pickupBeam.scale.set(2.2, 60, 2.2);
  pickup.visible = pickupBeam.visible = false;
  group.add(pickup, pickupBeam);

  // ---------- ammunition ----------
  const caseGeometry = merge([
    box(0.62, 0.3, 0.38, 0x56624a, [0, 0.15, 0], undefined, { bottom: 0.7, top: 1 }),
    box(0.64, 0.04, 0.4, 0x3d4636, [0, 0.31, 0]),
    box(0.03, 0.12, 0.03, 0x2b2f2a, [-0.2, 0.39, 0]),
    box(0.03, 0.12, 0.03, 0x2b2f2a, [0.2, 0.39, 0]),
    box(0.43, 0.03, 0.03, 0x2b2f2a, [0, 0.45, 0]),
  ]);
  const caseMaterial = lit({ vertexColors: true, rim: 0.4 });
  const stripMaterial = glow({ color: 0x8dffcf, intensity: 1.4 });
  /** one per cache on the site, in the order of site.ammo: its crate, and the lit strip that says it is full */
  const caches = [];
  for (const [x, z] of site.ammo) {
    const crate = new THREE.Mesh(caseGeometry, caseMaterial);
    crate.position.set(x, 0, z);
    crate.rotation.y = (x * 7 + z * 3) % 3;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.012), stripMaterial);
    strip.position.set(0, 0.2, -0.196);
    crate.add(strip);
    group.add(crate);
    lightUp(crate, x, z);
    caches.push({ crate, strip });
  }

  let pingT = 0;
  let clock = 0;
  let beaconUp = false;

  return {
    group,

    /**
     * The light of the site has changed — a lamp went out, or came back (main.js, "lamps that go out"): each
     * thing takes the light of the place it stands in again.
     */
    relight() {
      for (const entry of standing) takeLight(entry);
    },

    reset() {
      for (const c of charges) {
        c.planted = false;
        c.frame.visible = true;
        c.model.root.visible = false;
      }
      if (firing) firing.visible = true;
      beacon.root.visible = false;
      beam.visible = false;
      pickup.visible = pickupBeam.visible = false;
      pad.visible = true;
      beaconUp = false;
      pingT = 0;
      for (const cache of caches) cache.strip.visible = true;
    },

    /**
     * Shows which caches have been emptied: the crate stays, its light goes out.
     * @param {Iterable<number>} taken indexes into site.ammo
     */
    setCaches(taken) {
      const gone = new Set(taken);
      caches.forEach((cache, n) => (cache.strip.visible = !gone.has(n)));
    },

    /** A charge goes on its casing. */
    arm(id) {
      const c = charges.find((entry) => entry.site.id === id);
      if (!c) return;
      c.planted = true;
      c.frame.visible = false;
      c.model.root.visible = true;
    },

    /** The charges are fired: they are gone, and so is the ring that marked where to fire them from. */
    blow() {
      for (const c of charges) {
        c.planted = true;
        c.frame.visible = false;
        c.model.root.visible = false;
      }
      if (firing) firing.visible = false;
    },

    /** The beacon stands up and starts calling. */
    raiseBeacon() {
      beaconUp = true;
      beacon.root.visible = true;
      beam.visible = true;
      pad.visible = false;
      pickup.visible = pickupBeam.visible = true;
      pingT = 0;
    },

    /** Hides everything the strike would have destroyed. */
    hideAll() {
      group.visible = false;
    },
    showAll() {
      group.visible = true;
    },
    /** Puts the pickup's ring and beam away (you are standing in it; it has done its job). */
    hidePickup() {
      pickup.visible = pickupBeam.visible = false;
    },

    /**
     * @param {boolean} padReady the beacon can be placed now
     * @param {boolean} fireReady every charge is set: the cascades can be blown
     */
    update(dt, padReady, fireReady = false) {
      clock += dt;
      const pulse = 0.5 + 0.5 * Math.sin(clock * 4);
      for (const c of charges) {
        if (!c.planted) c.frame.material.uniforms.uIntensity.value = 0.9 + pulse * 1.3;
        else if (c.led) c.led.uniforms.uIntensity.value = Math.sin(clock * 9) > 0.2 ? 3 : 0.15;
      }
      if (firing) firing.material.uniforms.uIntensity.value = fireReady ? 0.8 + pulse * 1.5 : 0.1;
      pad.material.uniforms.uIntensity.value = padReady ? 0.7 + pulse * 0.9 : 0.12;
      if (beaconUp) {
        if (beacon.parts.dish) beacon.parts.dish.rotation.y += dt * 1.6;
        if (beacon.parts.lamp?.material?.uniforms) beacon.parts.lamp.material.uniforms.uIntensity.value = 1 + pulse * 3;
        beam.material.uniforms.uIntensity.value = 0.5 + pulse * 0.5;
        pickup.material.uniforms.uIntensity.value = 0.8 + pulse * 0.8;
        pingT -= dt;
        if (pingT <= 0) {
          pingT = 2;
          fx.puff('ring', site.beacon.x, 1.1, site.beacon.z, 0, 0, 0, 1.4, 0.4, 9, 0.4, 1, 0.8, 0.55);
          audio.play('beaconPing', { x: site.beacon.x, y: 1.1, z: site.beacon.z });
        }
      }
    },
  };
}

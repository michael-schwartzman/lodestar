// The player's own figure, joined to the game: stands exactly where the body was left while the drone is flown
// (src/wild/pilot-live.js), and nowhere else. The rules of what it looks like are src/wild/operator.js; the
// design is docs/WILD-operator.md.
import * as THREE from 'three';
import { buildOperator, setOperatorCrouch } from './operator.js';

/** how fast the antenna's tip and the slate's screen breathe, and between what the glow runs */
const PULSE_SPEED = 1.1;
const PULSE_LOW = 0.55;
const PULSE_HIGH = 1.35;

export function createOperatorLive(ctx) {
  const { G } = ctx;
  const { player } = G;
  const { setProbe } = ctx.lib;
  const { root, parts, mats } = buildOperator(ctx.lib);
  root.visible = false;
  ctx.scene.add(root);

  const tint = new THREE.Color();
  let crouched = false;
  let t = 0;

  return {
    name: 'operator',
    /** for tests and the curious: the group this feature draws, and the figure's own parts */
    group: root,
    parts,

    frame(real) {
      t += real;
      if (!ctx.flying) {
        root.visible = false;
        return;
      }
      root.visible = true;
      root.position.set(player.x, player.y, player.z);
      root.rotation.y = player.yaw;
      if (player.crouched !== crouched) {
        crouched = player.crouched;
        setOperatorCrouch(parts, crouched);
      }
      G.world.probe(player.x, player.z, tint);
      setProbe(mats, tint);
      const pulse = PULSE_LOW + (PULSE_HIGH - PULSE_LOW) * (0.5 + 0.5 * Math.sin(t * PULSE_SPEED));
      parts.antennaTip.material.uniforms.uIntensity.value = pulse;
      parts.slateFace.material.uniforms.uIntensity.value = pulse;
    },
  };
}

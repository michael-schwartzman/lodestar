// The one picture every mark on the site is a square of (look/marks.js: SHEET, CELLS), drawn here once, on a
// canvas, when the second look is switched on: the dark under things, paint, what use leaves, stencilled numbers
// and the signs beside doors. It is the same picture every time — what looks like chance in it comes from a
// counter, not from the clock.
//
// A square's own colours are what the thing is painted with (they are lit like the floor they lie on), and its
// alpha is how much of the floor it covers. "White" is old paint, as in world/build.js: about half of what falls
// on it comes back, no more than the concrete beside it.
import * as THREE from 'three';
import { CELLS, SHEET } from './marks.js';

const S = SHEET.cell;
const WHITE = '#bdb9ad';
const YELLOW = '#c9a227';
const BLACK = '#17191a';
const RED = '#a83428';
const BLUE = '#24508f';
const GREEN = '#23764a';

function counter(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws the sheet.
 * @returns {THREE.CanvasTexture | null} null where there is no canvas to draw on
 */
export function drawMarkSheet({ anisotropy = 8 } = {}) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SHEET.cols * S;
  canvas.height = SHEET.rows * S;
  const c = canvas.getContext('2d');
  const at = (name) => {
    const i = CELLS.indexOf(name);
    return [(i % SHEET.cols) * S, Math.floor(i / SHEET.cols) * S];
  };
  /** Draws in one square only, in its own pixels (0…S), and puts everything back after. */
  const inCell = (name, draw) => {
    const [x, y] = at(name);
    c.save();
    c.beginPath();
    c.rect(x, y, S, S);
    c.clip();
    c.translate(x, y);
    draw(counter(CELLS.indexOf(name) * 7919 + 17));
    c.restore();
  };
  /** Paint that has been walked on: chips and scuffs knocked out of whatever is in the square. */
  const wear = (rnd, chips, scuffs = 0) => {
    c.globalCompositeOperation = 'destination-out';
    for (let n = 0; n < chips; n++) {
      c.globalAlpha = 0.25 + rnd() * 0.65;
      c.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 5, 1 + rnd() * 3);
    }
    for (let n = 0; n < scuffs; n++) {
      c.globalAlpha = 0.12 + rnd() * 0.25;
      c.beginPath();
      const x = rnd() * S;
      const y = rnd() * S;
      c.ellipse(x, y, 6 + rnd() * 26, 2 + rnd() * 7, rnd() * 3.14, 0, 6.283);
      c.fill();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  };
  /** A soft blot: darkest in its middle, nothing at its rim. */
  const blot = (x, y, r, colour, alpha) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${colour},${alpha})`);
    g.addColorStop(0.55, `rgba(${colour},${alpha * 0.6})`);
    g.addColorStop(1, `rgba(${colour},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, 6.283);
    c.fill();
  };

  // ---------- the dark under things ----------
  // Under a box: full over the middle half of the square each way, and fading out over the outer quarter all
  // round — world/build.js stretches the middle and keeps the edges their own width. Round: full to DISC_CORE.
  const shade = (name, most, round) => {
    const [x0, y0] = at(name);
    const image = c.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const u = ((x + 0.5) / S) * 2 - 1;
        const v = ((y + 0.5) / S) * 2 - 1;
        let out;
        if (round) out = Math.max(0, (Math.hypot(u, v) - 0.55) / 0.45);
        else out = Math.hypot(Math.max(Math.abs(u) - 0.5, 0), Math.max(Math.abs(v) - 0.5, 0)) / 0.5;
        const f = Math.max(0, 1 - out);
        const i = (y * S + x) * 4;
        image.data[i] = 4;
        image.data[i + 1] = 5;
        image.data[i + 2] = 7;
        image.data[i + 3] = Math.round(255 * most * f * f * (3 - 2 * f));
      }
    c.putImageData(image, x0, y0);
  };
  shade('blob', 0.5, false);
  shade('deep', 0.74, false);
  shade('disc', 0.5, true);

  // ---------- paint ----------
  // the hazard band: yellow and black at 45°, four to the metre, the same at its right edge as at its left. Only
  // its rows 0.1…0.42 are laid (a band 0.32 m deep); its two long edges are ragged inside that.
  inCell('hazard', (rnd) => {
    const top = 0.115 * S;
    const foot = 0.405 * S;
    c.fillStyle = YELLOW;
    c.fillRect(0, top, S, foot - top);
    c.fillStyle = BLACK;
    for (let k = -1; k < 9; k++) {
      c.beginPath();
      c.moveTo(k * 64, top);
      c.lineTo(k * 64 + 32, top);
      c.lineTo(k * 64 + 32 - (foot - top), foot);
      c.lineTo(k * 64 - (foot - top), foot);
      c.fill();
    }
    c.globalCompositeOperation = 'destination-out';
    for (let n = 0; n < 90; n++) {
      c.globalAlpha = 0.5 + rnd() * 0.5;
      const y = rnd() < 0.5 ? top : foot;
      c.fillRect(rnd() * S, y - 2 - rnd() * 2, 2 + rnd() * 9, 3 + rnd() * 4);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    wear(rnd, 520, 26);
  });
  // a painted line: a tenth of a metre of it down the middle of the rows 0.3…0.7 that are laid
  for (const [name, colour] of [
    ['yellow', YELLOW],
    ['white', WHITE],
  ])
    inCell(name, (rnd) => {
      c.fillStyle = colour;
      c.fillRect(0, 0.4 * S, S, 0.2 * S);
      c.globalCompositeOperation = 'destination-out';
      for (let n = 0; n < 70; n++) {
        c.globalAlpha = 0.5 + rnd() * 0.5;
        c.fillRect(rnd() * S, (rnd() < 0.5 ? 0.4 : 0.6) * S - 2, 2 + rnd() * 8, 4);
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      wear(rnd, 420, 18);
    });
  inCell('arrow', (rnd) => {
    c.fillStyle = WHITE;
    c.beginPath();
    c.moveTo(128, 22);
    c.lineTo(206, 120);
    c.lineTo(156, 120);
    c.lineTo(156, 234);
    c.lineTo(100, 234);
    c.lineTo(100, 120);
    c.lineTo(50, 120);
    c.fill();
    wear(rnd, 500, 20);
  });
  // numbers, stencilled: a bridge left across each where the stencil held together
  for (let n = 1; n <= 8; n++)
    inCell(`n${n}`, (rnd) => {
      c.fillStyle = n <= 4 ? YELLOW : WHITE;
      c.font = `900 ${S * 0.86}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(n), S / 2, S * 0.54);
      c.globalCompositeOperation = 'destination-out';
      c.fillRect(S * 0.47, 0, 7, S);
      c.globalCompositeOperation = 'source-over';
      wear(rnd, 620, 22);
    });

  // ---------- what use leaves ----------
  // two tracks, 1.8 m apart on a square 2.3 m wide: darkest where the lorry stands (the top), gone by the far end
  inCell('tyre', (rnd) => {
    for (const mid of [0.11, 0.89]) {
      for (let y = 0; y < S; y += 3) {
        const fade = (1 - y / S) ** 1.4;
        c.fillStyle = `rgba(9,9,10,${(0.2 + rnd() * 0.2) * fade})`;
        c.fillRect(mid * S - 17 + rnd() * 3, y, 34 - rnd() * 6, 3);
        // the tread: a darker bar across, every few
        if (y % 12 === 0) {
          c.fillStyle = `rgba(4,4,5,${0.3 * fade})`;
          c.fillRect(mid * S - 15, y, 30, 2);
        }
      }
    }
  });
  inCell('oil', (rnd) => {
    for (let n = 0; n < 16; n++) {
      const a = rnd() * 6.283;
      const d = rnd() ** 1.5 * 52;
      blot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 26 + rnd() * 44, '10,8,7', 0.34);
    }
    for (let n = 0; n < 22; n++) {
      const a = rnd() * 6.283;
      const d = 60 + rnd() * 56;
      blot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 3 + rnd() * 8, '8,7,6', 0.6);
    }
    blot(120, 132, 34, '4,4,4', 0.55);
  });
  inCell('damp', (rnd) => {
    for (let n = 0; n < 22; n++) {
      const a = rnd() * 6.283;
      const d = rnd() * 62;
      blot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 34 + rnd() * 34, '12,14,15', 0.13);
    }
    // where it dried back: a darker line round part of its edge
    c.strokeStyle = 'rgba(8,9,10,0.16)';
    c.lineWidth = 3;
    for (let n = 0; n < 5; n++) {
      c.beginPath();
      c.arc(128 + (rnd() - 0.5) * 30, 128 + (rnd() - 0.5) * 30, 62 + rnd() * 26, rnd() * 6.283, rnd() * 6.283);
      c.stroke();
    }
  });
  // down a wall: from a line near the top of the square, streaks of different lengths, some of them rust
  inCell('drip', (rnd) => {
    for (let n = 0; n < 15; n++) {
      const x = 28 + rnd() * 200;
      const long = 60 + rnd() ** 0.7 * 180;
      const wide = 3 + rnd() * 9;
      const rust = rnd() < 0.4;
      const g = c.createLinearGradient(0, 8, 0, 8 + long);
      const colour = rust ? '70,40,22' : '9,11,11';
      g.addColorStop(0, `rgba(${colour},${rust ? 0.42 : 0.34})`);
      g.addColorStop(0.5, `rgba(${colour},${rust ? 0.22 : 0.2})`);
      g.addColorStop(1, `rgba(${colour},0)`);
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x - wide, 8);
      c.lineTo(x + wide, 8);
      c.lineTo(x + wide * 0.25, 8 + long);
      c.lineTo(x - wide * 0.25, 8 + long);
      c.fill();
    }
  });
  inCell('scuff', (rnd) => {
    c.lineCap = 'round';
    for (let n = 0; n < 110; n++) {
      const x = 128 + (rnd() + rnd() - 1) * 110;
      const y = 128 + (rnd() + rnd() - 1) * 110;
      const dark = rnd() < 0.62;
      c.strokeStyle = dark ? `rgba(8,8,9,${0.1 + rnd() * 0.2})` : `rgba(176,174,165,${0.06 + rnd() * 0.12})`;
      c.lineWidth = 1 + rnd() * 3.5;
      c.beginPath();
      c.arc(x + (rnd() - 0.5) * 80, y + (rnd() - 0.5) * 80, 14 + rnd() * 70, rnd() * 6.283, rnd() * 6.283 + 0.5);
      c.stroke();
    }
    // …and nothing of it at the square's rim
    c.globalCompositeOperation = 'destination-in';
    const g = c.createRadialGradient(128, 128, 60, 128, 128, 126);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'source-over';
  });
  inCell('crack', (rnd) => {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const run = (x, y, a, steps, width) => {
      const points = [[x, y]];
      for (let n = 0; n < steps; n++) {
        a += (rnd() - 0.5) * 0.9;
        x += Math.cos(a) * (7 + rnd() * 9);
        y += Math.sin(a) * (7 + rnd() * 9);
        if (x < 14 || y < 14 || x > S - 14 || y > S - 14) break;
        points.push([x, y]);
        if (width > 1.6 && rnd() < 0.16)
          run(x, y, a + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.6), steps * 0.5, width * 0.6);
      }
      for (const [w, colour] of [
        [width * 3.2, 'rgba(6,6,7,0.1)'],
        [width, 'rgba(3,3,4,0.78)'],
      ]) {
        c.strokeStyle = colour;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(points[0][0], points[0][1]);
        for (const p of points) c.lineTo(p[0], p[1]);
        c.stroke();
      }
    };
    for (let n = 0; n < 3; n++) run(128 + (rnd() - 0.5) * 40, 128 + (rnd() - 0.5) * 40, rnd() * 6.283, 16, 2.6);
  });
  // the foot of a wall: the dirt that gathers there (laid along it, darkest at the wall)
  inCell('grime', () => {
    const g = c.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(9,9,9,0.42)');
    g.addColorStop(0.5, 'rgba(9,9,9,0.14)');
    g.addColorStop(1, 'rgba(9,9,9,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
  });
  // a square that was dug up and laid again: darker, with tar run along its joints
  inCell('patch', (rnd) => {
    c.fillStyle = 'rgba(14,14,16,0.34)';
    c.fillRect(30, 26, S - 60, S - 52);
    c.strokeStyle = 'rgba(3,3,4,0.72)';
    c.lineWidth = 5;
    c.lineJoin = 'round';
    c.beginPath();
    const wob = () => (rnd() - 0.5) * 5;
    c.moveTo(30 + wob(), 26 + wob());
    for (const [x, y] of [
      [128, 26],
      [S - 30, 26],
      [S - 30, 128],
      [S - 30, S - 26],
      [128, S - 26],
      [30, S - 26],
      [30, 128],
      [30, 26],
    ])
      c.lineTo(x + wob(), y + wob());
    c.stroke();
  });

  // ---------- faces: the signs beside doors ----------
  /** A rectangle with its corners taken off, where the browser can draw one. */
  const rounded = (x, y, w, h, r) => (c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h));
  /** The plate a sign is printed on, with a little of the square left clear all round it. */
  const plate = (colour, draw) => (rnd) => {
    const m = 12;
    c.fillStyle = colour;
    c.beginPath();
    rounded(m, m, S - 2 * m, S - 2 * m, 12);
    c.fill();
    c.save();
    c.beginPath();
    rounded(m, m, S - 2 * m, S - 2 * m, 12);
    c.clip();
    draw(rnd);
    c.restore();
    c.strokeStyle = 'rgba(20,20,20,0.55)';
    c.lineWidth = 3;
    c.beginPath();
    rounded(m + 1.5, m + 1.5, S - 2 * m - 3, S - 2 * m - 3, 11);
    c.stroke();
    // four screws
    c.fillStyle = 'rgba(60,62,62,0.9)';
    for (const [x, y] of [
      [26, 26],
      [S - 26, 26],
      [26, S - 26],
      [S - 26, S - 26],
    ]) {
      c.beginPath();
      c.arc(x, y, 4, 0, 6.283);
      c.fill();
    }
    wear(rnd, 150, 5);
  };
  /** A warning triangle: yellow, with a black edge. */
  const triangle = () => {
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(128, 38);
    c.lineTo(222, 204);
    c.lineTo(34, 204);
    c.closePath();
    c.fillStyle = YELLOW;
    c.fill();
    c.strokeStyle = BLACK;
    c.lineWidth = 12;
    c.stroke();
  };
  inCell(
    'trefoil',
    plate(WHITE, () => {
      triangle();
      c.fillStyle = BLACK;
      const cx = 128;
      const cy = 150;
      c.beginPath();
      c.arc(cx, cy, 8, 0, 6.283);
      c.fill();
      // three blades: two above, one below (angles as a canvas has them, y downward)
      for (const mid of [-30, -150, 90]) {
        const a0 = ((mid - 30) * Math.PI) / 180;
        const a1 = ((mid + 30) * Math.PI) / 180;
        c.beginPath();
        c.arc(cx, cy, 40, a0, a1);
        c.arc(cx, cy, 13, a1, a0, true);
        c.closePath();
        c.fill();
      }
    }),
  );
  inCell(
    'voltage',
    plate(WHITE, () => {
      triangle();
      c.fillStyle = BLACK;
      c.beginPath();
      c.moveTo(140, 78);
      c.lineTo(104, 146);
      c.lineTo(126, 146);
      c.lineTo(112, 194);
      c.lineTo(156, 126);
      c.lineTo(132, 126);
      c.closePath();
      c.fill();
    }),
  );
  inCell(
    'noEntry',
    plate(WHITE, () => {
      c.fillStyle = RED;
      c.beginPath();
      c.arc(128, 128, 88, 0, 6.283);
      c.fill();
      c.fillStyle = WHITE;
      c.fillRect(62, 110, 132, 36);
    }),
  );
  inCell(
    'ears',
    plate(WHITE, () => {
      c.fillStyle = BLUE;
      c.beginPath();
      c.arc(128, 128, 90, 0, 6.283);
      c.fill();
      // ear defenders: a band over the head and a cup each side
      c.strokeStyle = WHITE;
      c.lineWidth = 12;
      c.lineCap = 'round';
      c.beginPath();
      c.arc(128, 132, 48, Math.PI * 1.08, Math.PI * 1.92);
      c.stroke();
      c.fillStyle = WHITE;
      for (const x of [70, 164]) {
        c.beginPath();
        rounded(x, 118, 22, 50, 9);
        c.fill();
      }
    }),
  );
  inCell(
    'fire',
    plate(RED, () => {
      c.fillStyle = WHITE;
      // an extinguisher: its body, its neck and handle, its hose
      c.beginPath();
      rounded(98, 92, 54, 122, 14);
      c.fill();
      c.fillRect(116, 70, 18, 26);
      c.fillRect(108, 58, 52, 12);
      c.strokeStyle = WHITE;
      c.lineWidth = 9;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(112, 80);
      c.bezierCurveTo(70, 84, 66, 120, 74, 168);
      c.stroke();
    }),
  );
  inCell(
    'exit',
    plate(GREEN, () => {
      c.fillStyle = WHITE;
      // a doorway, and an arrow to it
      c.fillRect(160, 62, 50, 132);
      c.fillStyle = GREEN;
      c.fillRect(170, 72, 30, 122);
      c.fillStyle = WHITE;
      c.beginPath();
      c.moveTo(46, 114);
      c.lineTo(104, 114);
      c.lineTo(104, 88);
      c.lineTo(148, 128);
      c.lineTo(104, 168);
      c.lineTo(104, 142);
      c.lineTo(46, 142);
      c.fill();
    }),
  );
  // the site's plan under glass: rooms, the road, and where you are
  inCell(
    'plan',
    plate('#b9b7ac', (rnd) => {
      c.fillStyle = '#23405c';
      c.fillRect(24, 24, S - 48, 26);
      c.fillStyle = WHITE;
      for (let n = 0; n < 5; n++) c.fillRect(34 + n * 30, 33, 22, 8);
      c.strokeStyle = '#3d4a54';
      c.lineWidth = 3;
      for (const [x, y, w, h] of [
        [34, 64, 96, 54],
        [34, 122, 44, 48],
        [82, 122, 48, 48],
        [136, 64, 86, 34],
        [136, 102, 40, 68],
        [180, 102, 42, 68],
        [34, 176, 188, 22],
      ])
        c.strokeRect(x, y, w, h);
      c.fillStyle = 'rgba(61,74,84,0.35)';
      c.fillRect(34, 176, 188, 22);
      c.fillStyle = RED;
      c.beginPath();
      c.arc(104 + rnd() * 6, 150, 7, 0, 6.283);
      c.fill();
      c.fillStyle = '#5a6168';
      for (let n = 0; n < 4; n++) c.fillRect(34, 206 + n * 7, 80 + rnd() * 90, 3);
    }),
  );
  // a notice board: cork, and what has been pinned to it
  inCell(
    'notice',
    plate('#7d6240', (rnd) => {
      for (const [x, y, w, h, colour, turn] of [
        [36, 36, 80, 104, '#bcb8aa', -0.05],
        [124, 30, 94, 62, '#b9ad6a', 0.04],
        [128, 100, 84, 112, '#bcb8aa', 0.03],
        [40, 148, 76, 66, '#a9b4b6', 0.06],
      ]) {
        c.save();
        c.translate(x + w / 2, y + h / 2);
        c.rotate(turn);
        c.fillStyle = colour;
        c.fillRect(-w / 2, -h / 2, w, h);
        c.fillStyle = 'rgba(40,44,48,0.6)';
        c.fillRect(-w / 2 + 8, -h / 2 + 10, w * 0.6, 5);
        c.fillStyle = 'rgba(40,44,48,0.38)';
        for (let n = 0; n < Math.floor((h - 34) / 9); n++)
          c.fillRect(-w / 2 + 8, -h / 2 + 26 + n * 9, (w - 16) * (0.6 + rnd() * 0.4), 3);
        c.fillStyle = RED;
        c.beginPath();
        c.arc(0, -h / 2 + 6, 3.5, 0, 6.283);
        c.fill();
        c.restore();
      }
    }),
  );

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  map.name = 'marks';
  return map;
}

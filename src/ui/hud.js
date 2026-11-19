// What is drawn over the picture while you play: health, light, ammunition, the compass, the small map,
// who is noticing you, what to do next, and what Overwatch says.
// It is plain DOM; update() only touches an element when what it shows has changed.
import './hud.css';
import { KIND } from '../world/grid.js';
import { AI } from '../enemies/ai.js';
import { ARROWS, POINTS, POINT_WORDS, bearingOf, headingOf, pointOf } from '../bearing.js';
import { angleDelta, clamp, yawTo } from '../core/math.js';

const MAP_SCALE = 4; // pixels per metre on the stored map
/** how many contacts the readout under the small map names, and how many the compass strip marks */
const CONTACT_LINES = 2;
const CONTACT_TICKS = 6;

const html = `
<div class="vignette"></div>
<div class="nvmask"></div>
<div class="hitdir"><i></i></div>
<div class="cross"><i></i><i></i><i></i><i></i><b></b><em></em></div>
<div class="aware"></div>
<div class="objectives" data-hud="objectives"><h4>Objectives</h4><ul></ul></div>
<div class="top" data-hud="compass">
  <canvas class="compass"></canvas>
  <div class="now"></div>
  <div class="banner" hidden></div>
</div>
<div class="mini" data-hud="minimap"><canvas></canvas></div>
<div class="bearing" data-hud="bearing"><b class="facing"><small>FACING </small><span></span></b><span class="goal"></span><span class="contact"></span><span class="contact"></span><span class="more"></span></div>
<div class="status" data-hud="status">
  <div class="zone"></div>
  <div class="vital">
    <span class="count"><b class="hp">100</b><i>HEALTH</i></span>
    <div class="gauge"><span class="stance">STAND</span><div class="bar health"><u></u><i></i></div></div>
  </div>
  <div class="row"><span class="tag">LIGHT</span><div class="bar light"><i></i></div><span class="seen">HIDDEN</span></div>
</div>
<div class="ammo" data-hud="ammo">
  <div class="counts">
    <span class="count inmag"><b class="mag">30</b><i>IN MAG</i></span>
    <span class="count left"><b class="total">120</b><i>TOTAL LEFT</i></span>
  </div>
  <small><span class="gun">K9 CARBINE · AUTO</span><span class="knife">KNIFE</span></small>
  <small class="rack"><span></span><span></span><span></span><span class="emp"></span></small>
</div>
<div class="prompt" data-hud="prompt" hidden><span></span><div class="bar"><i></i></div></div>
<div class="radio" data-hud="radio"></div>
<div class="note"></div>
<div class="bigmap" hidden><canvas></canvas><p>TAB / M — close</p></div>
`;

const MARKER_COLORS = { charge: '#ffb44a', beacon: '#8dffcf', pickup: '#8dffcf', ammo: '#9fb3ad', hostile: '#ff4a43' };

/**
 * @param {object} o
 * @param {HTMLElement} o.root   #ui
 * @param {boolean} o.touch
 * @param {object} o.site        the site data (for the map)
 */
export function createHud({ root, touch, site }) {
  const el = document.createElement('div');
  el.id = 'hud';
  el.hidden = true;
  el.classList.toggle('touch', touch);
  el.innerHTML = html;
  root.appendChild(el);
  const flash = document.createElement('div');
  flash.className = 'flash';
  const fade = document.createElement('div');
  fade.className = 'fade';
  root.append(flash, fade);

  const $ = (q) => el.querySelector(q);
  const dom = {
    vignette: $('.vignette'),
    hitdir: $('.hitdir'),
    cross: $('.cross'),
    aware: $('.aware'),
    list: $('.objectives ul'),
    compass: $('.compass'),
    now: $('.top .now'),
    banner: $('.banner'),
    mini: $('.mini canvas'),
    miniBox: $('.mini'),
    facing: $('.bearing .facing span'),
    goal: $('.bearing .goal'),
    contacts: [...el.querySelectorAll('.bearing .contact')],
    more: $('.bearing .more'),
    zone: $('.zone'),
    stance: $('.stance'),
    vital: $('.vital'),
    health: $('.health i'),
    ghost: $('.health u'),
    hp: $('.hp'),
    light: $('.light i'),
    seen: $('.seen'),
    mag: $('.mag'),
    total: $('.total'),
    ammo: $('.ammo'),
    gun: $('.ammo .gun'),
    rack: [...el.querySelectorAll('.ammo .rack span:not(.emp)')],
    emp: $('.ammo .rack .emp'),
    knifeHint: $('.ammo .knife'),
    prompt: $('.prompt'),
    promptText: $('.prompt span'),
    promptBar: $('.prompt .bar i'),
    radio: $('.radio'),
    note: $('.note'),
    bigmap: $('.bigmap'),
    bigCanvas: $('.bigmap canvas'),
  };
  const last = {};
  const set = (key, value, apply) => {
    if (last[key] === value) return;
    last[key] = value;
    apply(value);
  };
  /** the health last shown, and the seconds left of the flash that says some of it has just gone */
  let hpShown = 100;
  let hurtT = 0;

  // ---------- the site, drawn once ----------
  const g = site.grid;
  const base = document.createElement('canvas');
  base.width = g.w * MAP_SCALE;
  base.height = g.h * MAP_SCALE;
  {
    const c = base.getContext('2d');
    for (let z = 0; z < g.h; z++)
      for (let x = 0; x < g.w; x++) {
        const i = z * g.w + x;
        const kind = g.kind[i];
        let color = null;
        if (kind === KIND.WALL) color = 'rgba(141,255,207,0.62)';
        else if (kind === KIND.ROCK) color = 'rgba(141,255,207,0.1)';
        else if (kind === KIND.FENCE) color = 'rgba(141,255,207,0.34)';
        else if (kind === KIND.DOOR) color = 'rgba(255,180,74,0.7)';
        else if (g.block[i] > 0 && !g.thin[i]) color = 'rgba(141,255,207,0.26)';
        else if (kind === KIND.FLOOR) color = 'rgba(141,255,207,0.08)';
        if (!color) continue;
        c.fillStyle = color;
        if (kind === KIND.FENCE) c.fillRect(x * MAP_SCALE + 1, z * MAP_SCALE + 1, MAP_SCALE - 2, MAP_SCALE - 2);
        else c.fillRect(x * MAP_SCALE, z * MAP_SCALE, MAP_SCALE, MAP_SCALE);
      }
  }

  // ---------- canvases follow their boxes ----------
  const ratio = () => Math.min(window.devicePixelRatio || 1, 2);
  function fitCanvas(canvas) {
    const w = Math.round(canvas.clientWidth * ratio());
    const h = Math.round(canvas.clientHeight * ratio());
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
    return w && h;
  }
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      fitCanvas(dom.compass);
      fitCanvas(dom.mini);
    });
    ro.observe(dom.compass);
    ro.observe(dom.mini);
  }

  // ---------- pooled bits ----------
  const wedges = Array.from({ length: 6 }, () => {
    const w = document.createElement('i');
    w.hidden = true;
    dom.aware.appendChild(w);
    return w;
  });
  const radioLines = [];
  let noteT = 0;
  let hitT = 0;
  let mapOpen = false;
  let drawT = 0;
  let zoneT = 0;
  /** what was last drawn on the canvases, in numbers — canvases cannot be read back by a test */
  const drawn = { north: [0, -1], dots: 0, arrows: 0, ticks: 0 };

  const HOT = '#ff4a43';
  const WARM = '#ffd98a';

  function drawCompass(s) {
    const canvas = dom.compass;
    if (!fitCanvas(canvas)) return;
    const c = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const k = ratio();
    c.clearRect(0, 0, w, h);
    const perDeg = w / 110;
    const bearing = (-s.yaw * 180) / Math.PI;
    const NAMES = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.font = `600 ${11 * k}px ui-monospace, Menlo, Consolas, monospace`;
    for (let deg = 0; deg < 360; deg += 15) {
      let off = ((((deg - bearing) % 360) + 540) % 360) - 180;
      const x = w / 2 + off * perDeg;
      if (x < 4 || x > w - 4) continue;
      const edge = 1 - Math.abs(off) / 55;
      c.globalAlpha = clamp(edge * 2.2, 0, 1);
      c.fillStyle = '#dfe8e4';
      if (NAMES[deg]) {
        c.fillText(NAMES[deg], x, 2 * k);
        c.fillRect(x - 0.5 * k, 16 * k, k, 6 * k);
      } else c.fillRect(x - 0.5 * k, 18 * k, k, 4 * k);
    }
    for (const m of s.markers) {
      // things that are worth finding but are not the next thing to do (ammunition) stay off the compass
      if (m.quiet) continue;
      const to = (Math.atan2(m.x - s.x, -(m.z - s.z)) * 180) / Math.PI;
      const off = clamp(((((to - bearing) % 360) + 540) % 360) - 180, -53, 53);
      const x = w / 2 + off * perDeg;
      c.globalAlpha = 1;
      c.fillStyle = MARKER_COLORS[m.kind] || '#fff';
      c.beginPath();
      c.moveTo(x, h - 9 * k);
      c.lineTo(x + 4.5 * k, h - 4.5 * k);
      c.lineTo(x, h);
      c.lineTo(x - 4.5 * k, h - 4.5 * k);
      c.closePath();
      c.fill();
    }
    // where they are coming from: a mark at the bearing of each machine that is after you, nearest last (on top).
    // One that is off the end of the strip sits at that end, so the way to turn is always plain.
    const list = s.contacts || [];
    const count = Math.min(list.length, CONTACT_TICKS);
    c.globalAlpha = 1;
    c.lineWidth = k;
    c.strokeStyle = 'rgba(5,8,11,0.9)';
    for (let n = count - 1; n >= 0; n--) {
      const contact = list[n];
      const off = clamp(((((contact.bearing - bearing) % 360) + 540) % 360) - 180, -53, 53);
      const x = w / 2 + off * perDeg;
      const top = 12 * k;
      c.fillStyle = contact.hot ? HOT : WARM;
      c.beginPath();
      c.moveTo(x - 5 * k, top);
      c.lineTo(x + 5 * k, top);
      c.lineTo(x, top + 8.5 * k);
      c.closePath();
      c.fill();
      c.stroke();
    }
    drawn.ticks = count;
    c.globalAlpha = 1;
    c.fillStyle = '#8dffcf';
    c.fillRect(w / 2 - 0.75 * k, 0, 1.5 * k, h);
  }

  function drawMap(canvas, s, big) {
    if (!fitCanvas(canvas)) return;
    const c = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    c.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    let scale;
    let cos = 1;
    let sin = 0;
    let ox = s.x;
    let oz = s.z;
    c.save();
    if (big) {
      // the whole site, north up
      scale = Math.min(w / g.w, h / g.h);
      ox = g.w / 2;
      oz = g.h / 2;
    } else {
      // round, turning with you: ahead is up
      scale = w / 64;
      cos = Math.cos(s.yaw);
      sin = Math.sin(s.yaw);
      c.beginPath();
      c.arc(cx, cy, w / 2 - 1, 0, Math.PI * 2);
      c.clip();
      c.fillStyle = 'rgba(5,8,11,0.62)';
      c.fillRect(0, 0, w, h);
    }
    c.translate(cx, cy);
    if (!big) c.rotate(s.yaw);
    c.imageSmoothingEnabled = big;
    c.drawImage(base, -ox * scale, -oz * scale, g.w * scale, g.h * scale);
    c.restore();

    const put = (wx, wz, clampToRim) => {
      const dx = (wx - ox) * scale;
      const dz = (wz - oz) * scale;
      let mx = dx * cos - dz * sin;
      let my = dx * sin + dz * cos;
      const rim = w / 2 - 5 * ratio();
      const d = Math.hypot(mx, my);
      let outside = false;
      if (!big && d > rim) {
        if (!clampToRim) return null;
        mx *= rim / d;
        my *= rim / d;
        outside = true;
      }
      return [cx + mx, cy + my, outside];
    };
    const k = ratio();
    for (const m of s.markers) {
      // quiet markers are only drawn where they are — never held at the rim of the small map
      const p = put(m.x, m.z, !m.quiet);
      if (!p) continue;
      c.fillStyle = MARKER_COLORS[m.kind] || '#fff';
      c.globalAlpha = p[2] ? 0.75 : 1;
      const r = (big ? 5 : 3.5) * k;
      c.beginPath();
      c.moveTo(p[0], p[1] - r);
      c.lineTo(p[0] + r, p[1]);
      c.lineTo(p[0], p[1] + r);
      c.lineTo(p[0] - r, p[1]);
      c.closePath();
      c.fill();
      if (big && m.label) {
        c.font = `600 ${11 * k}px ui-monospace, Menlo, Consolas, monospace`;
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(m.label, p[0] + r + 4 * k, p[1]);
      }
    }
    c.globalAlpha = 1;
    let dots = 0;
    let arrows = 0;
    for (const u of s.units) {
      if (u.dead || !u.shown || u === s.held) continue;
      // a machine that is after you is never dropped off the edge of the small map: it becomes an arrow on the rim
      // (the experiment: a machine the player has turned is drawn in its own colour, and is nobody's pursuer)
      const after = !u.turned && (u.brain.state !== AI.PATROL || u.rollId < 0);
      const p = put(u.x, u.z, after);
      if (!p) continue;
      c.fillStyle = u.turned
        ? '#6fd8ff'
        : u.brain.state === AI.COMBAT
          ? HOT
          : u.brain.state === AI.PATROL
            ? '#ffb44a'
            : WARM;
      if (p[2]) {
        // pointing outwards, the way it is coming from
        const a = Math.atan2(p[1] - cy, p[0] - cx);
        c.save();
        c.translate(p[0], p[1]);
        c.rotate(a);
        c.beginPath();
        c.moveTo(4 * k, 0);
        c.lineTo(-4.5 * k, -4.5 * k);
        c.lineTo(-2 * k, 0);
        c.lineTo(-4.5 * k, 4.5 * k);
        c.closePath();
        c.fill();
        c.restore();
        arrows++;
      } else {
        c.beginPath();
        c.arc(p[0], p[1], (u.type === 'drone' ? 2 : 2.6) * k, 0, Math.PI * 2);
        c.fill();
        dots++;
      }
    }
    // the four points of the compass: on the small map they turn with it, on the big one north is always up
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${(big ? 13 : 9) * k}px ui-monospace, Menlo, Consolas, monospace`;
    for (let n = 0; n < 4; n++) {
      const a = (n * Math.PI) / 2;
      const dx = Math.sin(a);
      const dz = -Math.cos(a);
      const ux = dx * cos - dz * sin;
      const uy = dx * sin + dz * cos;
      const rx = big ? (g.w * scale) / 2 - 9 * k : w / 2 - 8 * k;
      const ry = big ? (g.h * scale) / 2 - 9 * k : w / 2 - 8 * k;
      const lx = cx + ux * rx;
      const ly = cy + uy * ry;
      if (n === 0 && !big) drawn.north = [ux, uy];
      c.fillStyle = 'rgba(5,8,11,0.78)';
      c.beginPath();
      c.arc(lx, ly, (big ? 9 : 6.2) * k, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = n === 0 ? '#8dffcf' : 'rgba(223,232,228,0.85)';
      c.fillText('NESW'[n], lx, ly + 0.5 * k);
    }
    if (!big) {
      drawn.dots = dots;
      drawn.arrows = arrows;
    }
    // you
    const me = big ? put(s.x, s.z, true) : [cx, cy];
    c.save();
    c.translate(me[0], me[1]);
    if (big) c.rotate(-s.yaw);
    c.fillStyle = '#8dffcf';
    c.beginPath();
    c.moveTo(0, -6 * k);
    c.lineTo(4.5 * k, 5 * k);
    c.lineTo(0, 2.5 * k);
    c.lineTo(-4.5 * k, 5 * k);
    c.closePath();
    c.fill();
    c.restore();
    if (!big) {
      c.strokeStyle = 'rgba(141,255,207,0.5)';
      c.lineWidth = k;
      c.beginPath();
      c.arc(cx, cy, w / 2 - k, 0, Math.PI * 2);
      c.stroke();
    }
  }

  const clock = (seconds) => {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const hud = {
    el,
    /** What the canvases last showed, for tests: where north is on the small map, and how many machines it marks. */
    drawn,
    get mapOpen() {
      return mapOpen;
    },

    setVisible(on) {
      el.hidden = !on;
      if (!on && mapOpen) hud.toggleMap(false);
    },

    /** Opens or shuts the big map. */
    toggleMap(want = !mapOpen) {
      mapOpen = want;
      dom.bigmap.hidden = !mapOpen;
      last.bigDrawn = -1;
    },

    /** A line on the radio. */
    radio(who, text, seconds = 5) {
      const line = document.createElement('p');
      line.innerHTML = `<b></b><span></span>`;
      line.firstChild.textContent = who;
      line.lastChild.textContent = text;
      dom.radio.appendChild(line);
      radioLines.push({ line, t: seconds });
      while (radioLines.length > 3) radioLines.shift().line.remove();
    },

    /** A short word by the crosshair: what just happened. */
    note(text, tone = '') {
      dom.note.textContent = text;
      dom.note.className = `note show ${tone}`;
      noteT = 2.2;
    },

    /** The crosshair's tick that says a round landed. */
    hitmarker(kill) {
      dom.cross.classList.remove('hit', 'kill');
      void dom.cross.offsetWidth;
      dom.cross.classList.add(kill ? 'kill' : 'hit');
      hitT = 0.25;
    },

    /** 0..1 white over everything (the strike). */
    flash(v) {
      set('flash', v.toFixed(2), (x) => (flash.style.opacity = x));
    },
    /** 0..1 black over everything (cuts between scenes). */
    fade(v) {
      set('fade', v.toFixed(2), (x) => (fade.style.opacity = x));
    },

    update(s, dt) {
      // health, stance, light. Health says what it is (18 November 2026 — the owner: "add a health hud for the
      // player"; it had been a hairline beside the word STAND): the number, the bar and behind the bar what was
      // just lost, amber at sixty and under, red under thirty-five, and a flash the moment any of it goes.
      const hp = Math.max(0, Math.round(s.health));
      set('hp', hp, (v) => {
        const full = `${Math.min(100, v)}%`;
        dom.hp.textContent = v;
        dom.health.style.width = full;
        dom.ghost.style.width = full;
        dom.vital.classList.toggle('warn', v <= 60 && v >= 35);
        dom.vital.classList.toggle('low', v < 35);
        if (v < hpShown) {
          dom.vital.classList.add('hit');
          hurtT = 0.4;
        }
        hpShown = v;
      });
      if (hurtT > 0 && (hurtT -= dt) <= 0) dom.vital.classList.remove('hit');
      set('stance', s.crouched, (v) => (dom.stance.textContent = v ? 'CROUCH' : 'STAND'));
      set('light', Math.round(s.light * 20), (v) => {
        dom.light.style.width = `${v * 5}%`;
        dom.seen.textContent = v < 4 ? 'HIDDEN' : v < 10 ? 'DIM' : 'EXPOSED';
        dom.seen.className = `seen ${v < 4 ? 'ok' : v < 10 ? '' : 'bad'}`;
      });
      set('zone', s.zone, (v) => {
        dom.zone.textContent = v;
        dom.zone.classList.add('show');
        zoneT = 3.5;
      });
      if (zoneT > 0 && (zoneT -= dt) <= 0) dom.zone.classList.remove('show');

      // ammunition: what is in the gun in hand, and every round there is for it — in it and in reserve together
      set('mag', s.mag, (v) => (dom.mag.textContent = v));
      set('magLow', s.magLow, (v) => dom.ammo.classList.toggle('low', v));
      set('total', s.total, (v) => (dom.total.textContent = v));
      set('scarce', s.scarce, (v) => dom.ammo.classList.toggle('scarce', v));
      set('out', s.out, (v) => dom.ammo.classList.toggle('out', v));
      set('reloading', s.reloading, (v) => dom.ammo.classList.toggle('reloading', v));
      set('gun', s.gunLabel, (v) => (dom.gun.textContent = v));
      set('knifeHint', touch ? 'KNIFE' : s.out ? 'NO ROUNDS — KNIFE: FIRE OR V' : 'KNIFE · V', (v) => {
        dom.knifeHint.textContent = v;
      });
      // and what else is carried: each gun by the key that takes it in hand, with what is left for it — the one
      // in hand marked, an empty one struck out — and the grenades
      let rack = `${s.gun}|${s.grenades}`;
      for (const g of s.guns) rack += `|${g.total}`;
      set('rack', rack, () => {
        s.guns.forEach((g, n) => {
          const item = dom.rack[n];
          item.textContent = `${g.slot} ${g.short} ${g.total}`;
          item.classList.toggle('on', g.key === s.gun);
          item.classList.toggle('dry', g.total === 0);
        });
        dom.emp.textContent = `T EMP ${s.grenades}`;
        dom.emp.classList.toggle('dry', s.grenades === 0);
      });

      // crosshair: its gap is the cone of fire; it goes away when the sight is at the eye
      set('gap', Math.round(6 + s.spread * 520), (v) => dom.cross.style.setProperty('--gap', `${v}px`));
      set('aim', s.aim > 0.6 || s.dead, (v) => dom.cross.classList.toggle('hide', v));
      if (hitT > 0 && (hitT -= dt) <= 0) dom.cross.classList.remove('hit', 'kill');

      // objectives
      const key = s.objectives.map((o) => `${o.done ? 1 : 0}${o.locked ? 1 : 0}${o.text}`).join('|');
      set('objectives', key, () => {
        dom.list.textContent = '';
        const current = s.objectives.find((o) => !o.done && !o.locked);
        dom.now.textContent = current ? current.text : '';
        for (const o of s.objectives) {
          const li = document.createElement('li');
          li.textContent = o.text;
          li.className = `${o.done ? 'done' : ''} ${o.locked ? 'locked' : ''} ${o === current ? 'now' : ''}`;
          dom.list.appendChild(li);
        }
      });

      // the banner under the compass: the clock, or the alarm
      let banner = '';
      let tone = '';
      if (s.clock !== null) {
        banner = `HAMMERFALL  ${clock(s.clock)}`;
        tone = s.clock < 20 ? 'red' : 'amber';
      } else if (s.alarm.active) {
        banner = `SITE ALARM  ${clock(s.alarm.timeLeft)}`;
        tone = 'red';
      }
      set('banner', banner, (v) => {
        dom.banner.hidden = !v;
        dom.banner.textContent = v;
      });
      set('bannerTone', tone, (v) => (dom.banner.className = `banner ${v}`));

      // under the small map, in words: the way you face, the nearest thing to do, and who is coming from where
      const heading = headingOf(s.yaw);
      set('facing', pointOf(heading), (v) => (dom.facing.textContent = POINT_WORDS[v].toUpperCase()));
      let goal = null;
      let goalD = Infinity;
      for (const m of s.markers) {
        if (m.kind === 'hostile' || m.quiet) continue;
        const d = Math.hypot(m.x - s.x, m.z - s.z);
        if (d < goalD) {
          goalD = d;
          goal = m;
        }
      }
      set(
        'goal',
        goal ? `◆ ${POINTS[pointOf(bearingOf(goal.x - s.x, goal.z - s.z))]} ${Math.round(goalD)} m` : '',
        (v) => (dom.goal.textContent = v),
      );
      set('goalKind', goal ? goal.kind !== 'charge' : false, (v) => dom.goal.classList.toggle('go', v));
      const contacts = s.contacts || [];
      for (let n = 0; n < CONTACT_LINES; n++) {
        const contact = contacts[n];
        // the arrow is where it is from the way you face now; the letters are where it is on the map
        const text = contact
          ? `${ARROWS[pointOf(contact.bearing - heading)]} ${POINTS[contact.point]} ${Math.round(contact.d)} m`
          : '';
        set(`contact${n}`, text, (v) => (dom.contacts[n].textContent = v));
        set(`contactHot${n}`, !!contact?.hot, (v) => dom.contacts[n].classList.toggle('hot', v));
      }
      const more = (contacts.total || 0) - Math.min(CONTACT_LINES, contacts.length);
      set('more', more > 0 ? `+${more} MORE` : '', (v) => (dom.more.textContent = v));

      // the prompt (desk) — on a phone the USE button carries it
      const prompt = touch ? '' : s.prompt ? s.prompt.text : s.wantsMouse ? 'CLICK TO TAKE THE MOUSE BACK' : '';
      set('prompt', prompt, (v) => {
        dom.prompt.hidden = !v;
        dom.promptText.textContent = v;
      });
      if (prompt)
        set('progress', Math.round((s.prompt?.progress || 0) * 100), (v) => (dom.promptBar.style.width = `${v}%`));

      // damage
      const hurt = clamp(s.hitFlash * 0.8 + (hp < 35 ? 0.25 + 0.15 * Math.sin(s.time * 6) : 0), 0, 1);
      set('hurt', hurt.toFixed(2), (v) => (dom.vignette.style.opacity = v));
      set('hitdir', s.hitFlash > 0.05 ? Math.round((-s.hitYaw * 180) / Math.PI / 4) * 4 : null, (v) => {
        dom.hitdir.style.opacity = v === null ? 0 : 1;
        if (v !== null) dom.hitdir.style.transform = `rotate(${v}deg)`;
      });
      set('nv', s.nv, (v) => el.classList.toggle('nv', v));

      // who is noticing you: a wedge pointing at each one, filling as it makes up its mind
      let n = 0;
      for (const u of s.units) {
        if (n >= wedges.length) break;
        // a machine in your own arms is noticing nothing
        if (u.dead || u === s.held || (u.brain.awareness < 0.05 && u.brain.state === AI.PATROL)) continue;
        if (u.dist > 60) continue;
        const wedge = wedges[n++];
        const a = angleDelta(s.yaw, yawTo(s.x, s.z, u.x, u.z));
        wedge.hidden = false;
        wedge.style.transform = `rotate(${(-a * 180) / Math.PI}deg)`;
        const fill = u.brain.state === AI.COMBAT ? 1 : clamp(u.brain.awareness, 0, 1);
        wedge.style.setProperty('--fill', fill.toFixed(2));
        wedge.className = u.brain.state === AI.COMBAT ? 'hot' : u.brain.state === AI.PATROL ? '' : 'warm';
      }
      for (; n < wedges.length; n++) wedges[n].hidden = true;

      // radio lines fade out
      for (let i = radioLines.length - 1; i >= 0; i--) {
        const r = radioLines[i];
        r.t -= dt;
        if (r.t < 0.6) r.line.style.opacity = Math.max(0, r.t / 0.6);
        if (r.t <= 0) {
          r.line.remove();
          radioLines.splice(i, 1);
        }
      }
      if (noteT > 0 && (noteT -= dt) <= 0) dom.note.classList.remove('show');

      drawCompass(s);
      drawT -= dt;
      if (drawT <= 0) {
        drawT = 0.08;
        drawMap(dom.mini, s, false);
        if (mapOpen) drawMap(dom.bigCanvas, s, true);
      }
    },
  };
  return hud;
}

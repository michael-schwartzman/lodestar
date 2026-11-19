// Bullet and blade impacts: what a surface does when something hits it hard and fast — a broadband
// transient (never a pitched sweep), then the surface's own character (concrete's dull thud and dust,
// metal's inharmonic ring and a ricochet whine, glass's shatter) — see docs/WILD-sound-a.md.
import { noiseBurst, makeRng, rand } from '../../audio/synth.js';
import { crack, punch, ring, whine, scatter, rub } from './helpers.js';

export const IMPACTS = {
  // a bullet on bare steel: the owner's 2/10 ("firearm being cocked") — the old recipe was a pure tone plus
  // a sine sweep with no noise at all, so it had no transient and no ring, only a tonal slide; rebuilt from a
  // real broadband crack, an inharmonic plate ring (not a chord), and a ricochet whine (filtered noise, not a
  // pitched tone) peeling off a few milliseconds later, as the fragment actually leaves the plate
  hitMetal: {
    seconds: 0.4,
    takes: 3,
    reach: 30, // audio/sounds.js REACH.impact
    build(ctx, dest, take) {
      const rng = makeRng(610 + take);
      // try 2 added a low 2-partial ring (read as a "pitch drop"), try 3 added scatter texture (read as
      // "shell casing bouncing") — both regressed from try 1's plain build, so try 1's balance stuck.
      // try 4 (cap, after selfTest found try 1 a bleep): try1 passed realism but its ring (90-130ms clean
      // partials) measured as a bare tone (selfTest bleep 0.5-0.6) — a held sine spike reads as "a note"
      // (selfTest bleep 0.5-0.6) — a held sine spike reads as "a note" however much noise plays beside it;
      // shortened the ring to a brief ping fused with the crack, and let the whine (filtered noise, not a
      // tone, started right away instead of 10-22ms later) carry the sustained metallic character instead
      crack(ctx, dest, 0, { peak: rand(rng, 0.62, 0.72), freq: rand(rng, 3600, 4800), duration: 0.0015, rng });
      ring(ctx, dest, 0.001, {
        base: rand(rng, 1800, 2400),
        partials: [1, 1.81, 2.63, 3.92],
        decay: rand(rng, 0.018, 0.026),
        peak: 0.34,
        rng,
      });
      whine(ctx, dest, 0, {
        from: rand(rng, 4200, 5400),
        to: rand(rng, 900, 1300),
        duration: rand(rng, 0.2, 0.26),
        peak: rand(rng, 0.36, 0.42),
        Q: 4,
        rng,
      });
    },
  },

  // a lamp shot out: the shatter, then shards pattering down, then nothing
  lampBreak: {
    seconds: 0.7,
    takes: 3,
    reach: 30, // audio/sounds.js REACH.impact
    build(ctx, dest, take) {
      const rng = makeRng(1420 + take);
      // try 2: take 1 ("footstep", realism 3) said the ring() read as "a resonant synth chirp" — dropped it
      // for a denser cluster of near-instant inharmonic shard noise (glass shatter has no clean pitch), and
      // added a punch() for the bulb's own pop
      noiseBurst(ctx, dest, 0, {
        duration: 0.035,
        filterType: 'highpass',
        freq: rand(rng, 3800, 5200),
        peak: rand(rng, 0.55, 0.64),
        attack: 0.0005,
        decay: 0.032,
        rng,
      });
      punch(ctx, dest, 0, { peak: rand(rng, 0.52, 0.62), freq: rand(rng, 160, 230), duration: 0.03, drive: 0.2, rng });
      scatter(ctx, dest, { count: 4, window: [0.002, 0.03], freq: [3500, 7000], peak: [0.13, 0.25], rng });
      const bits = 7 + Math.floor(rand(rng, 0, 5));
      scatter(ctx, dest, { count: bits, window: [0.04, 0.45], freq: [2500, 5500], peak: [0.04, 0.12], rng });
    },
  },

  // the knife striking a machine: a duller, lower impact than a bullet's — steel scraping steel, a knock, a
  // short ring — no bare tone for the "knock" (the old recipe used one)
  knifeHit: {
    seconds: 0.35,
    takes: 3,
    reach: 30, // audio/sounds.js REACH.impact
    build(ctx, dest, take) {
      const rng = makeRng(780 + take);
      // try 2: take 1 read as "synthetic beep" — the ring's tail was too clean/bell-like and lacked low end;
      // shortened + detuned the ring (spread), boosted the punch for body, added a scrape afterward
      crack(ctx, dest, 0, { peak: rand(rng, 0.68, 0.78), freq: rand(rng, 2600, 3400), duration: 0.0022, rng });
      punch(ctx, dest, 0, { peak: rand(rng, 0.75, 0.85), freq: rand(rng, 150, 200), duration: 0.06, drive: 0.22, rng });
      ring(ctx, dest, 0.004, {
        base: rand(rng, 1700, 2100),
        partials: [1, 1.47, 2.19],
        decay: 0.032,
        peak: 0.42,
        spread: 0.04,
        rng,
      });
      rub(ctx, dest, 0.03, { seconds: 0.1, freq: rand(rng, 4500, 6000), Q: 0.8, peak: rand(rng, 0.2, 0.28), rng });
    },
  },
};

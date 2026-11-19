// Contract lock: the shader text of the second look is the look's own, and a game without the switch has none of it.
//
// Decision of 16 November 2026. Until then the program of every lit surface carried the second look's lines,
// fenced off by `#ifdef`: they were not compiled without the switch, but they were downloaded — 24.8 kB in the one
// script every player fetches, which the lock on that script (test/second/look.test.mjs) holds under 870 kB (880
// since the game itself grew later the same day: the note is in that file). The
// plan's next steps add to that text. It was moved to src/look/glsl.js, which is fetched only with the look, and
// is handed to the materials by `setLook` before any is made. Three things must hold, and are held here:
// without the switch there is none of it; with it every piece is where it belongs; and a look switched on with no
// text handed over fails at once and says why, instead of quietly drawing the game as it was.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lit, setLook } from '../../src/gfx/materials.js';
import { LOOK_GLSL } from '../../src/look/glsl.js';

/** anything that only the second look's shader text has in it */
const OF_THE_LOOK =
  /LODE_MATTER|LODE_KEY|LODE_ENVCUBE|LODE_LOOK|uMatColor|uMatDetail|uKeyPos|uEnvCube|lodeKeyOpen|lodeNoise3|<look:/;
const OFF = { on: false, matter: false, cheap: false, keys: 0, taps: 9, env: false, glsl: null };

test('without the switch, the program of a lit surface has not a line of the second look in it', () => {
  setLook(OFF);
  for (const options of [{}, { baked: true, painted: true }, { vertexColors: true }, { baked: true, glint: true }]) {
    const m = lit(options);
    assert.doesNotMatch(m.vertexShader, OF_THE_LOOK, JSON.stringify(options));
    assert.doesNotMatch(m.fragmentShader, OF_THE_LOOK, JSON.stringify(options));
    assert.deepEqual(
      Object.keys(m.defines).filter((d) => /MATTER|KEY|ENVCUBE|LOOK/.test(d)),
      [],
    );
    // and it is still a whole program: it begins and ends where it did
    assert.match(m.vertexShader, /void main\(\) \{[\s\S]*gl_Position = [\s\S]*\}\s*$/);
    assert.match(m.fragmentShader, /void main\(\) \{[\s\S]*gl_FragColor = [\s\S]*\}\s*$/);
  }
});

test('with the switch, each piece of the look is in its place in the program', () => {
  setLook({ on: true, matter: true, cheap: false, keys: 2, taps: 16, env: true, glsl: LOOK_GLSL });
  try {
    const m = lit({ vertexColors: true });
    for (const define of ['LODE_LOOK', 'LODE_MATTER', 'LODE_KEY', 'LODE_KEY_TAPS', 'LODE_ENVCUBE'])
      assert.ok(define in m.defines, `${define} is not defined`);
    // what each corner carries is declared before main(), and handed on inside it
    const [vertBefore, vertInside] = m.vertexShader.split('void main() {');
    assert.match(vertBefore, /attribute float mat;/);
    assert.match(vertInside, /vMat = mat;/);
    // in the pixel's program: the uniforms and the sums before main(), the pieces inside it in the order light
    // is added up — what it is made of, then the key lights, then what it mirrors, then the count for tests
    const [fragBefore, fragInside] = m.fragmentShader.split('void main() {');
    assert.match(fragBefore, /uniform highp sampler2DArray uMatColor;/);
    assert.match(fragBefore, /float lodeKeyFade\(/);
    const order = ['hasMatter = step', 'the key lights:', 'uEnvCube', 'uLookDebug > 0.5'].map((mark) =>
      fragInside.indexOf(mark),
    );
    assert.ok(
      order.every((at) => at > 0),
      `a piece is missing: ${order}`,
    );
    assert.deepEqual(
      order,
      order.slice().sort((a, b) => a - b),
      'the pieces are out of order',
    );
    // nothing is left of the marks themselves
    assert.doesNotMatch(m.vertexShader + m.fragmentShader, /<look:/);
  } finally {
    setLook(OFF);
  }
});

test('the look switched on with no shader text handed over: a material is not made, and the error says why', () => {
  setLook({ ...OFF, on: true, matter: true });
  try {
    assert.throws(() => lit({ vertexColors: true }), /look\/glsl\.js/);
  } finally {
    setLook(OFF);
  }
  // and switched off again, materials are made as they always were
  assert.doesNotMatch(lit().fragmentShader, OF_THE_LOOK);
});

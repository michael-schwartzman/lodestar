// A question for the graphics card that no desk can answer for a phone (the second look).
//
// The key lights' shadows are read from depth pictures through a sampler that answers "is this point nearer the
// lamp than the picture says?" (gfx/materials.js lodeKeyOpen). Most cards answer for the four pixels round the
// point and blend the four answers — a soft edge for nothing. Some hand back the nearest pixel's answer alone,
// and then a shadow's edge is as coarse as the picture, unless more points are asked. Which this card does is
// found by asking it: look/index.js gives a phone more points if it has to, and the phone test page (look/bench.js)
// writes the answer down.

/**
 * Asked of a little context of its own, on the same card: two pixels of a depth picture, one nearer than the
 * question and one further, read exactly between them. Half: blended. Nought or one: the nearest.
 * @returns {'blended' | 'nearest' | 'unknown'}
 */
export function shadowFilter() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) return 'unknown';
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT16,
      2,
      1,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_SHORT,
      new Uint16Array([16384, 49151]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(
      program,
      shader(
        gl.VERTEX_SHADER,
        `#version 300 es
void main() {
  // one triangle that covers everything
  gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0);
}`,
      ),
    );
    gl.attachShader(
      program,
      shader(
        gl.FRAGMENT_SHADER,
        `#version 300 es
precision highp float;
uniform highp sampler2DShadow map;
out vec4 colour;
void main() {
  colour = vec4(vec3(texture(map, vec3(0.5, 0.5, 0.5))), 1.0);
}`,
      ),
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return 'unknown';
    gl.useProgram(program);
    gl.viewport(0, 0, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const answer = pixel[0] / 255;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return answer > 0.2 && answer < 0.8 ? 'blended' : 'nearest';
  } catch {
    return 'unknown';
  }
}

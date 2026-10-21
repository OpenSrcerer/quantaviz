/* hud.js — a 2D canvas overlay a scene can letter and draw diagrams on.
 * WebGL has no text, and a diagram without labels isn't much of a diagram. A scene draws on
 * hud.begin(w, h) with the usual canvas API (pixel units, y down), then hud.draw() uploads it and
 * lays it over whatever the scene has rendered so far. It goes through the HDR pipeline like the
 * rest of the frame, so it shakes and blooms a little with everything else.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;

  const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uHud;
uniform float uGain;
void main() {
  vec4 h = texture(uHud, vUv);                 // premultiplied
  vec3 c = h.a > 0.001 ? h.rgb / h.a : vec3(0.0);
  fragColor = vec4(pow(c, vec3(2.2)) * uGain * h.a, h.a);   // sRGB canvas colours into the linear frame
}`;

  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  /** "235" -> "²³⁵" (digits only; anything else passes through). */
  VIZ.sup = (s) => String(s).replace(/[0-9]/g, (d) => SUP[+d]).replace(/\+/g, '⁺').replace(/-/g, '⁻');
  VIZ.sub = (s) => String(s).replace(/[0-9]/g, (d) => SUB[+d]);

  VIZ.Hud = class Hud {
    constructor(ctx) {
      this.ctx = ctx;
      this.gl = ctx.gl;
      this.canvas = document.createElement('canvas');
      this.g = this.canvas.getContext('2d');
      this.tex = ctx.createTexture({ filter: this.gl.LINEAR });
      this.prog = ctx.fsProgram(COMPOSITE, 'hud');
      this.w = 0; this.h = 0;
    }
    /** Size the canvas to the frame, clear it, and hand back the 2D context. */
    begin(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (w !== this.w || h !== this.h) { this.canvas.width = w; this.canvas.height = h; this.w = w; this.h = h; }
      const g = this.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, w, h);
      g.globalAlpha = 1;
      g.lineCap = 'butt'; g.lineJoin = 'miter';
      g.setLineDash([]);
      return g;
    }
    /** Upload and blend over the bound target. gain > 1 pushes it through the tonemapper brighter. */
    draw(gain = 1.25) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.prog.use().tex('uHud', this.tex).f('uGain', gain);
      this.ctx.drawQuad();
      gl.disable(gl.BLEND);
    }
    dispose() {
      this.prog.dispose();
      this.gl.deleteTexture(this.tex);
      this.canvas.width = this.canvas.height = 0;
    }
  };
})();

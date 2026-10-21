/* hud.js — 2D drawing layers for scenes that want lines, labels and readouts.
 * WebGL has no text, and a diagram without labels isn't much of a diagram. A scene gets two
 * canvases:
 *   world  begin(w, h) ... draw()   Drawn into the scene's HDR frame, so it shakes, blooms and goes
 *                                    through the effects with everything else. For graphics that
 *                                    belong to the scene: tracks, rods, wave packets.
 *   screen beginUI() ...            The #overlay canvas over the WebGL one, at full device
 *                                    resolution. No post-processing, no shake, never blurred by
 *                                    adaptive quality. For text, panels and instruments.
 * Both use pixel units with y down; VIZ.Hud.pen() wraps a context with scene-space helpers.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const MONO = '"Lucida Console", "Courier New", "DejaVu Sans Mono", monospace';

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
  /** "235" -> "²³⁵" (digits and signs only; anything else passes through). */
  VIZ.sup = (s) => String(s).replace(/[0-9]/g, (d) => SUP[+d]).replace(/\+/g, '⁺').replace(/-/g, '⁻');
  VIZ.sub = (s) => String(s).replace(/[0-9]/g, (d) => SUB[+d]);

  const reset = (g) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.lineCap = 'butt'; g.lineJoin = 'miter';
    g.setLineDash([]);
  };

  VIZ.Hud = class Hud {
    constructor(ctx) {
      this.ctx = ctx;
      this.gl = ctx.gl;
      this.canvas = document.createElement('canvas');
      this.g = this.canvas.getContext('2d');
      this.tex = ctx.createTexture({ filter: this.gl.LINEAR });
      this.prog = ctx.fsProgram(COMPOSITE, 'hud');
      this.w = 0; this.h = 0;
      this.ui = document.getElementById('overlay');
    }
    /** World layer: size to the frame, clear, and hand back the 2D context. */
    begin(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (w !== this.w || h !== this.h) { this.canvas.width = w; this.canvas.height = h; this.w = w; this.h = h; }
      reset(this.g);
      this.g.clearRect(0, 0, w, h);
      return this.g;
    }
    /** Upload the world layer and blend it over the bound target. gain > 1 pushes it brighter through the tonemapper. */
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
    /** Screen layer: the overlay canvas, sized to the window at device resolution and cleared. */
    beginUI() {
      const el = this.ui;
      if (!el) return null;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(el.clientWidth * dpr)), h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
      const g = el.getContext('2d');
      reset(g);
      g.clearRect(0, 0, w, h);
      return g;
    }
    clearUI() {
      const el = this.ui;
      if (el && el.width) el.getContext('2d').clearRect(0, 0, el.width, el.height);
    }
    dispose() {
      this.prog.dispose();
      this.gl.deleteTexture(this.tex);
      this.canvas.width = this.canvas.height = 0;
      this.clearUI();
    }

    /** Helpers for drawing in scene space (screen height = 1, origin in the middle, y up). */
    static pen(g, W, H, fsDiv = 64) {
      const asp = W / H;
      const p = {
        g, W, H,
        X: (x) => (x / asp + 0.5) * W,
        Y: (y) => (0.5 - y) * H,
        S: (l) => l * H,
        fs: Math.max(9, Math.round(H / fsDiv)),
      };
      p.font = (px, bold, fam = MONO) => { g.font = (bold ? 'bold ' : '') + Math.round(px) + 'px ' + fam; };
      p.line = (x0, y0, x1, y1) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
      p.arrow = (x0, y0, x1, y1, head) => {
        p.line(x0, y0, x1, y1);
        const a = Math.atan2(y1 - y0, x1 - x0);
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x1 - Math.cos(a - 0.4) * head, y1 - Math.sin(a - 0.4) * head);
        g.lineTo(x1 - Math.cos(a + 0.4) * head, y1 - Math.sin(a + 0.4) * head);
        g.closePath(); g.fill();
      };
      return p;
    }
  };
})();

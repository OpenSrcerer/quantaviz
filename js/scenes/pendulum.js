/* pendulum.js — Pendulum Wave.
 * The classic lecture demo: a row of pendulums whose lengths are tuned so that in one cycle of
 * T seconds the n-th one swings exactly K + n times (omega_n = 2 pi (K + n) / T, length
 * L_n = g / omega_n^2). Released together, they drift out of step into travelling snakes,
 * standing waves and apparent chaos, then all line up again at T. Seen in perspective from a
 * slowly drifting camera, with motion trails behind each bob.
 *   bass  -> kicks push every pendulum wider (and nudge the pattern's clock forward)
 *   mids  -> the row is a spectrum: each bob glows with its own mid band
 *   highs -> a high onset sends a ripple of light running along the row
 * Bobs, strings and trails are projected in JS and drawn in one fullscreen pass from a small
 * float data texture.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NB = 24, TR = 9;
  const ROWS = TR + 3;      // 0 current bob, 1..TR trail, TR+1 pivots, TR+2 extras
  const K = 18, T = 60, G = 9.81;
  const SCALE = 0.36;      // longest pendulum ~1 unit

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define NB ${NB}
#define TR ${TR}
uniform sampler2D uData;
uniform vec2 uBar0;
uniform vec2 uBar1;
uniform float uFloorY;

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  vec3 col = mix(palette(0.0) * 0.12, palette(0.0) * 0.03, vUv.y);
  // A floor glow under the row.
  col += palette(0.3) * exp(-pow((p.y - uFloorY) / 0.08, 2.0)) * 0.05 * (0.5 + uMid);

  // The bar the strings hang from.
  float bd = segDist(p, uBar0, uBar1);
  col = mix(col, palette(0.2) * 0.4 + 0.04, 1.0 - smoothstep(px * 2.0, px * 3.5, bd));

  float bestDepth = 1e9;
  vec3 bobCol = vec3(0.0);
  float bobA = 0.0;
  for (int i = 0; i < NB; i++) {
    vec4 b = texelFetch(uData, ivec2(i, 0), 0);
    vec4 piv = texelFetch(uData, ivec2(i, TR + 1), 0);
    vec4 ex = texelFetch(uData, ivec2(i, TR + 2), 0);   // band energy, ripple, depth fade
    float t = float(i) / float(NB - 1);
    vec3 tint = palette(0.3 + 0.65 * t);
    float e = ex.x;
    // String.
    float sd = segDist(p, piv.xy, b.xy);
    col += vec3(0.6) * (1.0 - smoothstep(0.0, px * 1.2, sd)) * 0.12 * ex.z;
    // Trail.
    vec2 prev = b.xy;
    for (int k = 1; k <= TR; k++) {
      vec4 tp = texelFetch(uData, ivec2(i, k), 0);
      float d = segDist(p, prev, tp.xy);
      float fade = 1.0 - float(k) / float(TR + 1);
      col += tint * exp(-d * d / (b.z * b.z * 0.25)) * fade * fade * 0.12 * (0.4 + 1.6 * e) * ex.z;
      prev = tp.xy;
    }
    // Bob: a shaded sphere, nearest one wins.
    float r = length(p - b.xy) / b.z;
    col += tint * exp(-r * 1.6) * 0.06 * (0.5 + 2.0 * e + ex.y * 3.0) * ex.z;
    if (r < 1.0 + px / b.z && b.w < bestDepth) {
      bestDepth = b.w;
      vec2 q = (p - b.xy) / b.z;
      vec3 n = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
      float diff = 0.25 + 0.75 * max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
      float spec = pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), n), normalize(vec3(-0.4, 0.6, 0.7))), 0.0), 30.0);
      bobCol = tint * diff * (0.4 + 2.2 * e) + vec3(1.0) * spec * 0.8 + vec3(1.0) * ex.y * 1.5;
      bobCol *= ex.z;
      bobA = 1.0 - smoothstep(1.0 - 1.5 * px / b.z, 1.0, r);
    }
  }
  col = mix(col, bobCol, bobA);
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class PendulumScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.prog = ctx.fsProgram(FS, 'pendulum');
      this.data = new Float32Array(NB * ROWS * 4);
      this.tex = ctx.createTexture({ width: NB, height: ROWS, internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST });
      this.tau = 0;
      this.amp = 0.35;
      this.boost = 0;
      this.ripple = -10;
      this.rippleDir = 1;
      this.vp = new Float32Array(16);
      this.omega = [];
      this.len = [];
      for (let i = 0; i < NB; i++) {
        const w = (2 * Math.PI * (K + i)) / T;
        this.omega.push(w);
        this.len.push((G / (w * w)) * SCALE);
      }
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const gl = this.gl, mat4 = VIZ.mat4;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const k = audio.kick;
      this.boost += (k - this.boost) * (1 - Math.exp(-dt / (k > this.boost ? 0.06 : 0.9)));
      this.tau += dt * P.speed * (1 + 0.5 * this.boost * P.push);
      const amp = Math.min(1.1, 0.32 * P.amplitude * (1 + 1.6 * this.boost * P.push));
      if (audio.highOnset && audio.highPulse > 0.5) { this.ripple = 0; this.rippleDir = Math.random() < 0.5 ? 1 : -1; }
      this.ripple += dt;

      // Camera: drifting around the front of the row, slightly above.
      const t = u.time;
      const az = 0.55 * Math.sin(t * 0.045) + 0.25;
      const el = 0.32 + 0.12 * Math.sin(t * 0.06);
      const dist = 3.0 * P.distance * (u.width < u.height ? 1.6 : 1);
      const target3 = [0, 0.5, 0];
      const eye = [Math.sin(az) * Math.cos(el) * dist, target3[1] + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist];
      const view = mat4.lookAt(eye, target3, [0, 1, 0]);
      const proj = mat4.perspective(40 * Math.PI / 180, u.width / Math.max(1, u.height), 0.05, 50);
      mat4.multiply(proj, view, this.vp);
      const asp = u.width / u.height;
      const m = this.vp;
      const project = (x, y, z) => {
        const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        return [cx / cw * 0.5 * asp, cy / cw * 0.5, cw];
      };
      const rowW = 1.6;
      const barY = 1.15;
      const D = this.data;
      const bobR = 0.032;
      for (let i = 0; i < NB; i++) {
        const x = -rowW / 2 + (rowW * i) / (NB - 1);
        const L = this.len[i];
        const w = this.omega[i];
        const pv = project(x, barY, 0);
        let o = ((TR + 1) * NB + i) * 4;
        D[o] = pv[0]; D[o + 1] = pv[1];
        for (let kk = 0; kk <= TR; kk++) {
          const th = amp * Math.cos(w * (this.tau - kk * 0.035 * P.trails));
          const q = project(x, barY - L * Math.cos(th), L * Math.sin(th));
          o = (kk * NB + i) * 4;
          D[o] = q[0]; D[o + 1] = q[1];
          if (kk === 0) { D[o + 2] = bobR * proj[5] * 0.5 / q[2]; D[o + 3] = q[2]; }
        }
        // Extras: mid band energy for this bob, the highs' ripple, a depth fade.
        o = ((TR + 2) * NB + i) * 4;
        const bandT = 0.25 + 0.43 * (i / (NB - 1));
        D[o] = Math.min(1.5, audio.bandAt(bandT) * 1.2);
        const pos = this.rippleDir > 0 ? i : NB - 1 - i;
        const front = this.ripple * 40;
        D[o + 1] = Math.exp(-Math.pow((pos - front) / 2, 2)) * Math.exp(-this.ripple * 1.5) * P.ripple;
        D[o + 2] = 1;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NB, ROWS, gl.RGBA, gl.FLOAT, D);
      gl.bindTexture(gl.TEXTURE_2D, null);
      const b0 = project(-rowW / 2 - 0.08, barY, 0), b1 = project(rowW / 2 + 0.08, barY, 0);
      const fl = project(0, 0.0, 0);
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.tex('uData', this.tex).f2('uBar0', b0[0], b0[1]).f2('uBar1', b1[0], b1[1]).f('uFloorY', fl[1]);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); this.gl.deleteTexture(this.tex); }
  }

  VIZ.registerScene({
    id: 'pendulum',
    name: 'Pendulum Wave',
    blurb: 'Twenty-four tuned pendulums drift in and out of step into snakes and standing waves. Each bob glows with its mid band; kicks swing them wider.',
    params: [
      { key: 'speed', label: 'Time speed', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'amplitude', label: 'Swing', min: 0.3, max: 2.5, step: 0.05, value: 1 },
      { key: 'push', label: 'Push on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'trails', label: 'Trail length', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'ripple', label: 'Ripple on highs', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'distance', label: 'Camera distance', min: 0.6, max: 1.6, step: 0.05, value: 1 },
    ],
    create: (ctx) => new PendulumScene(ctx),
  });
})();

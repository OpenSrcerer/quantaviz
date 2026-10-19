/* aurora.js — Aurora.
 * Night sky over a mountain lake. Electrons from the solar wind rain down the field lines and
 * light the upper atmosphere in curtains: a sharp lower edge where they stop, vertical rays along
 * the field, oxygen green fading up into oxygen red, a thin nitrogen-violet fringe at the bottom.
 * The curtains fold and drift, and the lake mirrors them.
 *   mids  -> the curtains: each stretch of curtain is one mid band, and its height and brightness
 *            follow that band; a mid onset sets off a "substorm" brightening that runs along them
 *   highs -> the rays flicker (pulsating aurora) and the stars twinkle
 *   bass  -> kicks send a ripple of sway through the curtains (a shake of the magnetic field)
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform float uSway;       // smoothed kick
uniform float uBreak;      // substorm envelope (mid onsets)
uniform float uBreakX;
uniform float uBreakAge;
uniform float uNatural;    // 0 = palette colours, 1 = natural emission colours
uniform float uHeight;
uniform float uFolds;
uniform float uAsp;
const float HORIZON = -0.27;

vec3 emission(float h) {
  vec3 nat = mix(vec3(0.12, 1.0, 0.38), vec3(0.95, 0.12, 0.3) * 0.75, smoothstep(0.3, 0.95, h));
  nat += vec3(0.55, 0.2, 1.0) * exp(-max(h, 0.0) * 22.0) * 0.9;
  vec3 pal = palette(0.4 + 0.58 * clamp(h, 0.0, 1.0)) * 1.3;
  return mix(pal, nat, uNatural);
}

// One curtain layer. q: sky coordinates (x across, y above the horizon).
vec3 curtain(vec2 q, float layer) {
  float s = layer * 3.7 + 1.3;
  float depth = 1.0 - 0.28 * layer;                      // far layers are lower and smaller
  float x = q.x * (0.9 + 0.35 * layer) + s;
  // Folding: warp x slowly; kicks push a travelling sway through it.
  float warp = (noise2(vec2(x * 0.7, uTime * 0.05 + s)) - 0.5) * 1.6 * uFolds;
  warp += uSway * 0.06 * sin(x * 5.0 - uTime * 6.0 + s);
  float xw = x + warp;
  float base = (0.24 - 0.06 * layer) + 0.2 * (noise2(vec2(xw * 0.35, uTime * 0.03 + s * 2.0)) - 0.5) + 0.04 * sin(xw * 0.9 + uTime * 0.07 + s);
  // Mids: this stretch of curtain is one mid band.
  float bx = abs(fract(xw * 0.11 + layer * 0.31) * 2.0 - 1.0);
  float e = bandMid(bx);
  float height = (0.06 + 0.6 * pow(e, 1.2)) * uHeight * depth;
  float h = (q.y - base) / height;
  if (h < -0.08 || h > 1.25) return vec3(0.0);
  float prof = smoothstep(-0.06, 0.0, h) * exp(-max(h, 0.0) * 2.4) * (1.0 - smoothstep(0.85, 1.25, h));
  float rays = noise2(vec2(xw * 70.0, uTime * 0.35 + s));
  rays = 0.3 + 0.7 * rays * rays;
  rays *= 1.0 + (0.9 * uHigh + 1.2 * uHighPulse) * (noise2(vec2(xw * 140.0, uTime * 14.0)) - 0.35);
  // Curtains come in patches with dark gaps between them, drifting slowly.
  float presence = smoothstep(0.3, 0.7, noise2(vec2(xw * 0.32 + 3.0 * layer, uTime * 0.025 + s)));
  float glow = (0.04 + 1.6 * pow(e, 1.4)) * presence;
  // Substorm: a brightening that spreads along the curtain from where it began.
  float spread = 0.05 + uBreakAge * 1.2;
  glow += uBreak * 2.0 * exp(-abs(q.x - uBreakX) / spread) * (0.3 + presence);
  return emission(h) * prof * rays * glow * depth;
}

float mountains(float x) {
  float ridge = 1.0 - abs(noise2(vec2(x * 2.2, 3.0)) * 2.0 - 1.0);
  return 0.015 + 0.09 * ridge * ridge + 0.035 * fbm2(vec2(x * 6.0, 1.0));
}

vec3 sky(vec2 q, float px) {
  vec3 col = mix(palette(0.0) * 0.3 + vec3(0.006, 0.01, 0.02), palette(0.0) * 0.08, smoothstep(0.0, 0.5, q.y));
  // Stars, twinkling with the highs.
  vec2 g = q * 80.0;
  vec3 h = hash33(vec3(floor(g), 9.0));
  float d = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.7);
  float tw = 0.6 + 0.4 * sin(uTime * (2.0 + 6.0 * h.x) + h.y * 50.0) * (0.5 + uHigh);
  col += vec3(0.9, 0.95, 1.0) * step(0.88, h.z) * exp(-d * d * 900.0) * tw * smoothstep(0.0, 0.25, q.y);
  vec3 a = vec3(0.0);
  for (int i = 0; i < 3; i++) a += curtain(q, float(i));
  col += a;
  // Mountains in silhouette, rim-lit by the aurora.
  float m = mountains(q.x);
  float ground = 1.0 - smoothstep(m - px, m + px, q.y);
  vec3 rock = vec3(0.004, 0.005, 0.008) + a * 0.02 + emission(0.1) * 0.03 * smoothstep(m - 0.006, m, q.y);
  return mix(col, rock, ground);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAsp, 1.0);
  float px = 1.0 / uRes.y;
  vec2 q = vec2(p.x, p.y - HORIZON);
  vec3 col;
  if (q.y >= 0.0) {
    col = sky(q, px);
  } else {
    // The lake: the sky mirrored, rippled and darkened.
    float ripple = (noise2(vec2(p.x * 40.0, q.y * 120.0 + uTime * 0.8)) - 0.5) * 0.012 * (1.0 + 2.0 * uBass);
    vec2 mq = vec2(q.x + ripple, -q.y * 1.15);
    col = sky(mq, px * 2.0) * (0.22 + 0.18 * smoothstep(-0.2, 0.0, q.y));
    col += vec3(0.002, 0.003, 0.005);
  }
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class AuroraScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'aurora');
      this.sway = 0;
      this.brk = 0;
      this.brkX = 0;
      this.brkAge = 10;
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const k = audio.kick;
      this.sway += (k - this.sway) * (1 - Math.exp(-dt / (k > this.sway ? 0.03 : 0.5)));
      this.brkAge += dt;
      if (audio.midOnset && audio.midPulse * P.substorm > this.brk * 0.6) {
        this.brk = Math.min(1.5, audio.midPulse * P.substorm);
        this.brkX = (Math.random() - 0.5) * u.aspect * 0.9;
        this.brkAge = 0;
      }
      this.brk *= Math.exp(-dt / 0.55);
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f('uSway', this.sway * P.sway)
        .f('uBreak', this.brk)
        .f('uBreakX', this.brkX)
        .f('uBreakAge', this.brkAge)
        .f('uNatural', P.natural)
        .f('uHeight', P.height)
        .f('uFolds', P.folds)
        .f('uAsp', u.width / u.height);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'aurora',
    name: 'Aurora',
    blurb: 'Curtains of light over a mountain lake. Each fold is one band of the mids and rises and brightens with it; mid hits set off substorms.',
    params: [
      { key: 'height', label: 'Curtain height', min: 0.4, max: 1.8, step: 0.05, value: 1 },
      { key: 'natural', label: 'Natural colours (oxygen green / red)', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'folds', label: 'Folding', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'substorm', label: 'Substorm on mid hits', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'sway', label: 'Sway on kicks', min: 0, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new AuroraScene(ctx),
  });
})();

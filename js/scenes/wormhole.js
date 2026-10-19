/* wormhole.js — Wormhole.
 * A flight down the throat of an Einstein–Rosen bridge that never ends: a curving tube of
 * spacetime, ruled like the Spacetime Fabric's grid, glowing nebula on its walls and the light of
 * the other universe at the far end. The camera always moves forward.
 *   bass  -> kicks hit the throttle (the flight surges, then coasts), squeeze the throat and launch
 *            a gravitational-wave ring from the far end that rushes past you
 *   mids  -> the wall rings light up: around each ring the mid spectrum runs once (mirrored)
 *   highs -> star dust streaking past and the grid's glints
 * Classic polar tunnel mapping (depth = R / r) with the tube's bend folded in by a few fixed-point
 * iterations, so the curve is seen in perspective.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NRING = 8;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define NRING ${NRING}
uniform float uZ;          // distance flown
uniform float uRoll;
uniform float uThroat;     // squeeze (0..1)
uniform float uBoost;      // speed surge (0..1)
uniform float uCurve;
uniform float uGrid;
uniform vec2 uRings[NRING];  // world depth, strength
const float TAU = 6.2831853;
const float F = 1.0;

vec2 path(float z) { return vec2(sin(z * 0.17) * 0.9 + sin(z * 0.071 + 1.0) * 0.6, cos(z * 0.13) * 0.7 + sin(z * 0.053) * 0.5) * uCurve; }

float aaLine(float x, float width) {
  float fw = max(fwidth(x), 1e-4);
  float d = abs(fract(x) - 0.5);
  return (1.0 - smoothstep(width - fw, width + fw, 0.5 - d)) * clamp(1.0 - fw * 3.0, 0.0, 1.0);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float c = cos(uRoll), s = sin(uRoll);
  p = mat2(c, -s, s, c) * p;
  float R = 1.0 - 0.25 * uThroat;
  // Bend: the tube's centre at depth d sits at path(z + d), seen from a camera that looks along path'(z).
  vec2 dp = (path(uZ + 0.05) - path(uZ - 0.05)) / 0.1;
  vec2 q = p;
  float d = 1.0;
  for (int i = 0; i < 3; i++) {
    d = F * R / max(length(q), 1e-3);
    vec2 off = path(uZ + d) - path(uZ) - dp * d;
    q = p - off * F / d;
  }
  float r = max(length(q), 1e-4);
  d = F * R / r;
  float a = atan(q.y, q.x);
  float v = d + uZ;
  float fog = exp(-d * 0.14) * smoothstep(0.15, 0.7, d);
  vec2 cs = vec2(cos(a), sin(a));

  // Walls: nebula (seamless around the tube), the grid, rings lit by the mids.
  float neb = fbm3(vec3(cs * 1.4, v * 0.18));
  vec3 col = palette(0.15 + 0.5 * neb) * pow(neb, 2.5) * 0.45;
  float ringId = floor(v * 0.5);
  float ringL = aaLine(v * 0.5, 0.025);
  float longL = aaLine(a / TAU * 24.0 + v * 0.05, 0.03);
  float seg = abs(fract(a / TAU + 0.5) * 2.0 - 1.0);           // mirrored around the ring
  float e = bandMid(seg);
  float lit = 0.15 + 1.8 * e * (0.7 + 0.6 * hash11(ringId * 1.7));
  vec3 gridCol = palette(0.6 + 0.35 * e);
  col += gridCol * ringL * lit * uGrid;
  col += palette(0.5) * longL * (0.04 + 0.18 * uMid) * uGrid;
  // Highs: glints running along the grid lines.
  float gl = pow(0.5 + 0.5 * sin(v * 3.0 - uTime * 10.0 + a * 7.0), 30.0);
  col += vec3(1.0) * gl * (ringL + 0.4 * longL) * (0.2 * uHigh + 0.9 * uHighPulse);
  // Panels between rings glow faintly with the same band.
  col += gridCol * e * 0.08 * smoothstep(0.0, 0.5, fract(v * 0.5));

  // Gravitational-wave rings released by kicks, rushing toward the camera.
  for (int i = 0; i < NRING; i++) {
    float dr = uRings[i].x - uZ;
    if (uRings[i].y <= 0.0 || dr < 0.1) continue;
    float w = 0.12 + 0.02 * dr;
    col += palette(0.95) * exp(-pow((d - dr) / w, 2.0)) * uRings[i].y * 2.5;
  }
  col *= fog;

  // Star dust on an inner cylinder streaking past (highs).
  float d2 = F * 0.42 * R / r;
  if (d2 > 0.25) {
    float v2 = d2 + uZ * 1.0;
    vec2 g = vec2(a / TAU * 48.0, v2 * 0.8);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    vec3 h = hash33(vec3(id, 3.0));
    if (h.z > 0.72) {
      float len = 0.05 + 0.2 * uBoost;
      float sx = (f.x - (h.x - 0.5) * 0.6) * 4.0;
      float sy = (f.y - (h.y - 0.5) * 0.6) / len;
      float streak = exp(-sx * sx * 3.0 - sy * sy);
      col += mix(palette(0.9), vec3(1.0), 0.5) * streak * exp(-d2 * 0.25) * smoothstep(0.25, 0.8, d2) *
             (0.06 + 0.9 * uHigh + 1.4 * uHighPulse) * (0.6 + h.z);
    }
  }

  // The far mouth: light from the other side.
  float mouth = exp(-r * 9.0) * (0.6 + 1.2 * uLevel + 0.8 * uBoost);
  col += palette(0.95) * mouth + vec3(1.0) * exp(-r * 40.0) * 0.8;
  col *= 0.65 + 0.6 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class WormholeScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'wormhole');
      this.trig = new VIZ.KickTrigger(0.35);
      this.z = 0;
      this.roll = 0;
      this.boost = 0;
      this.throat = 0;
      this.rings = new Float32Array(NRING * 2);
      this.next = 0;
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const k = audio.kick;
      this.boost += (k - this.boost) * (1 - Math.exp(-dt / (k > this.boost ? 0.03 : 0.55)));
      this.throat += (k - this.throat) * (1 - Math.exp(-dt / (k > this.throat ? 0.02 : 0.18)));
      this.z += dt * P.speed * (1.2 + 3.5 * this.boost * P.surge);
      this.roll += dt * P.roll * (0.12 + 0.5 * this.boost);
      const hit = this.trig.update(k);
      if (hit) {
        const o = this.next * 2;
        this.rings[o] = this.z + 14;
        this.rings[o + 1] = hit;
        this.next = (this.next + 1) % NRING;
      }
      for (let i = 0; i < NRING; i++) this.rings[i * 2 + 1] *= Math.exp(-dt / 2.5);
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f('uZ', this.z)
        .f('uRoll', this.roll)
        .f('uThroat', this.throat * P.squeeze)
        .f('uBoost', this.boost)
        .f('uCurve', P.curve)
        .f('uGrid', P.grid)
        .f2v('uRings', this.rings);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'wormhole',
    name: 'Wormhole',
    blurb: 'An endless flight down the throat of a wormhole. Kicks hit the throttle and send gravitational waves rushing past; the rings glow with the mids.',
    params: [
      { key: 'speed', label: 'Cruise speed', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'surge', label: 'Surge on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'squeeze', label: 'Throat squeeze on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'curve', label: 'Tunnel bends', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'roll', label: 'Roll', min: -3, max: 3, step: 0.05, value: 1 },
      { key: 'grid', label: 'Grid brightness', min: 0, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new WormholeScene(ctx),
  });
})();

/* horizon.js — Event Horizon.
 * A point-mass gravitational lens bends a sky of cartoon stars (each star twinkles with its own
 * frequency band) around a black hole whose accretion disk is heated by the music. Beats send
 * flares rippling outward through the disk. Single fullscreen fragment shader.
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
uniform float uLensing;
uniform float uSpin;
uniform float uDisk;
uniform float uStars;
uniform float uStretch;     // kick envelope with a smooth ~40 ms attack / ~250 ms return: the disk's "ears"
uniform float uBeats[8];

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// Three-octave fbm: plenty for soft gas, a third of the cost of the shared five-octave one.
float fbm3q(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * noise3(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

// Five-pointed star signed distance (Inigo Quilez).
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

vec3 starLayer(vec2 p, float scale, float seed, float px) {
  vec2 g = p * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec3 col = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec3 h = hash33(vec3(id + o, seed));
      vec3 h2 = hash33(vec3(id + o + 7.0, seed * 3.1 + 1.0));
      if (h2.z > uStars) continue;
      vec2 sp = o + (h.xy - 0.5) * 0.8;
      float e = bandMid(fract(h.z * 0.9 + 0.05));      // stars are lit by the mids
      float size = (0.028 + h2.x * h2.x * 0.1) * (0.75 + 0.8 * e);
      vec2 q = rot(uTime * (h2.y - 0.5) * 0.8 + h.z * 6.2831) * (f - sp);
      float d = sdStar5(q, size, 0.42 + 0.25 * e);
      float aa = px * scale * 1.5;
      float fill = 1.0 - smoothstep(-aa, aa, d);
      float rim = 1.0 - smoothstep(0.0, aa * 2.5, abs(d));
      float glow = exp(-max(d, 0.0) * 22.0 / (size + 0.02)) * (0.2 + 1.0 * e);
      vec3 tint = palette(0.35 + 0.65 * fract(h.y * 1.7 + 0.2));
      vec3 c = fill * tint * (0.9 + 2.4 * e) + glow * tint * 0.35;
      c = mix(c, tint * 0.12, rim * fill);
      col += c;
    }
  }
  return col;
}

vec3 nebula(vec2 p) {
  float n = fbm3q(vec3(p * 2.2, uTime * 0.03));
  float m = fbm3q(vec3(p * 4.0 + 5.0, uTime * 0.02 + 3.0));
  float v = smoothstep(0.35, 0.85, n) * (0.5 + 0.5 * m);
  return palette(0.25 + 0.5 * m) * v * (0.25 + 0.5 * uMid) * 0.6;
}

vec3 disk(vec2 ps, float rs) {
  // The disk stretches with the kick: longer (outer radius) and taller (tilt) on a hit, then relaxes.
  float tilt = 0.30 + 0.14 * uStretch;
  vec2 d = vec2(ps.x, ps.y / tilt);
  float rr = length(d) / rs;
  float th = atan(d.y, d.x);
  const float rin = 1.7;
  float rout = 4.8 + 4.2 * uStretch;
  float radial = smoothstep(rin, rin + 0.5, rr) * (1.0 - smoothstep(rout * 0.62, rout, rr));
  if (radial <= 0.0) return vec3(0.0);
  float spin = uTime * uSpin * 1.2 / pow(rr, 1.5);
  float a = th - spin;
  float streaks = fbm3q(vec3(cos(a) * 2.5, sin(a) * 2.5, rr * 1.6 + uTime * 0.1));
  streaks = pow(streaks, 1.6);
  float heat = radial * (0.25 + 1.4 * streaks) * 5.5 / (rr * rr);
  // Highs: fine hot granules sparkle in the gas.
  heat *= 1.0 + (1.2 * uHigh + 1.5 * uHighPulse) * pow(noise3(vec3(a * 9.0, rr * 7.0, uTime * 2.5)), 3.0);
  float doppler = 1.0 + 0.75 * cos(th + 0.6);
  float spec = bandMid(fract(th / 6.2831853 + 0.5));   // the disk glows with the mids
  float flare = 0.0;
  for (int i = 0; i < 8; i++) {
    float age = uTime - uBeats[i];
    if (age > 0.0 && age < 2.5) {
      float fr = rin + age * 2.4;
      flare += exp(-pow((rr - fr) / 0.45, 2.0)) * exp(-age * 1.8);
    }
  }
  vec3 col = palette(clamp(1.0 - rr / 7.0, 0.0, 1.0)) * heat * doppler * (0.55 + 0.9 * spec + 0.8 * uLevel) * (1.0 + 0.5 * uStretch);
  col += palette(0.95) * flare * 1.8 * radial / (0.5 + rr * 0.3);
  return col * uDisk;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  float rs = 0.08 * (1.0 + 0.07 * uStretch + 0.06 * uBass);   // the hole only breathes gently; the disk does the stretching
  float r = length(p);
  float thE2 = rs * rs * 2.6 * uLensing;
  vec2 ps = p * (1.0 - thE2 / max(r * r, 1e-5));
  vec2 drift = vec2(uTime * 0.012, uTime * 0.004);
  vec3 col = nebula(ps * 0.8 + drift * 0.5);
  col += starLayer(ps + drift, 4.5, 1.0, px);
  col += starLayer(ps * 0.55 + drift * 0.4, 7.0, 2.0, px) * 0.55;
  col += disk(ps, rs);
  float ring = exp(-pow((r - rs * 1.5) / (rs * 0.09), 2.0)) * (0.6 + 1.5 * uLevel + uPulse);
  col += palette(0.9) * ring * uDisk;
  col *= smoothstep(rs * 0.97, rs * 1.05, r);
  col *= 0.6 + 0.6 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class HorizonScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'horizon');
      this.stretch = 0;
    }
    resize() { /* fullscreen shader: nothing to allocate */ }
    render(target, audio, u) {
      // Smooth the kick for the stretch: quick attack, soft return, so it elongates rather than snaps.
      const dt = Math.min(u.dt, 0.05);
      const k = audio.kick;
      this.stretch += (k - this.stretch) * (1 - Math.exp(-dt / (k > this.stretch ? 0.035 : 0.2)));
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f('uLensing', u.params.lensing)
        .f('uSpin', u.params.spin)
        .f('uDisk', u.params.disk)
        .f('uStars', u.params.stars)
        .f('uStretch', this.stretch * u.params.stretch)
        .fv('uBeats', audio.recentBeats);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'horizon',
    name: 'Event Horizon',
    blurb: 'A black hole lenses a sky of stars that twinkle to their own frequencies; beats flare through the disk.',
    params: [
      { key: 'lensing', label: 'Lensing strength', min: 0, max: 2, step: 0.01, value: 1 },
      { key: 'spin', label: 'Disk spin', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'disk', label: 'Disk brightness', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'stars', label: 'Star density', min: 0.1, max: 1, step: 0.01, value: 0.75 },
      { key: 'stretch', label: 'Disk stretch on kicks', min: 0, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new HorizonScene(ctx),
  });
})();

/* merger.js — Black Hole Merger.
 * Two black holes spiral together while gravitational waves carry their orbit away: the
 * separation shrinks as a(t)^4 = a0^4 - 4Kt (Peters' quadrupole law), so the orbit speeds up
 * into the famous chirp. They lens the starfield behind them, a two-armed gravitational-wave
 * spiral ripples outward through it, and a LIGO-style strain trace scrolls along the bottom. At
 * contact they merge: a flash, a ring of gravitational radiation, a remnant that rings down —
 * then a new pair falls in. The orbital plane slowly tilts and rolls.
 *   bass  -> every kick bleeds the orbit (the pair steps closer), so heavy music merges faster
 *   mids  -> the hot gas around each hole and the waves' glow
 *   highs -> starlight twinkle and glints in the wave crests
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const HIST = 128;
  const A0 = 0.46, AM = 0.07;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define HIST ${HIST}
uniform vec2 uB1;
uniform vec2 uB2;
uniform float uRs1;
uniform float uRs2;
uniform float uPhase;
uniform float uOmega;
uniform float uGW;          // wave amplitude now
uniform float uRing;        // time since merger (s), < 0 during the inspiral
uniform float uWobble;
uniform float uRoll;
uniform float uFadeIn;
uniform float uStrain[HIST];
const float TAU = 6.2831853;

vec3 sky(vec2 q) {
  vec3 col = palette(0.0) * 0.12;
  float n = fbm2(q * 1.6 + 3.0);
  col += palette(0.3) * smoothstep(0.5, 0.95, n) * 0.18 * (0.5 + uMid);
  for (int l = 0; l < 2; l++) {
    float sc = l == 0 ? 60.0 : 30.0;
    vec2 g = q * sc;
    vec3 h = hash33(vec3(floor(g), float(l) + 2.0));
    float d = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.7);
    float tw = 0.65 + 0.35 * sin(uTime * (2.0 + 6.0 * h.x) + h.y * 40.0) * (0.4 + 1.4 * uHigh);
    col += palette(0.85 + 0.15 * h.x) * step(0.9 - 0.04 * float(l), h.z) * exp(-d * d * 900.0) * tw * (l == 0 ? 0.9 : 1.6);
  }
  return col;
}

vec2 lens(vec2 p, vec2 b, float rs) {
  vec2 d = p - b;
  return d * (rs * rs * 2.6) / max(dot(d, d), 1e-6);
}

float hole(vec2 p, vec2 b, float rs, float px, inout vec3 col) {
  float r = length(p - b);
  float ring = exp(-pow((r - rs * 1.5) / (rs * 0.12), 2.0));
  float gas = exp(-pow((r - rs * 2.4) / (rs * 0.9), 2.0)) * (0.5 + 0.5 * noise2(vec2(atan(p.y - b.y, p.x - b.x) * 3.0, uTime * 2.0)));
  col += palette(0.9) * ring * (0.8 + 1.4 * uMid) + palette(0.6) * gas * (0.15 + 0.9 * uMid);
  return smoothstep(rs * 0.97, rs * 1.03 + px, r);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  float c = cos(uRoll), s = sin(uRoll);
  vec2 pr = mat2(c, -s, s, c) * p;
  float r = length(pr);
  float th = atan(pr.y, pr.x);

  // Gravitational waves: a two-armed spiral, retarded by distance, strongest near the source.
  float wave = 0.0;
  if (uRing < 0.0) {
    wave = cos(2.0 * (th - uPhase) + uOmega * 2.0 * r / 0.6) * uGW / (0.15 + r * 3.0);
  } else {
    float R = uRing * 0.75;
    wave = exp(-pow((r - R) / (0.03 + 0.05 * uRing), 2.0)) * cos(2.0 * th + uRing * 20.0) * 1.5 * exp(-uRing * 0.4)
         + cos(2.0 * th - uRing * 30.0 + r * 30.0) * uWobble / (0.15 + r * 3.0);
  }
  vec2 q = pr * (1.0 + 0.012 * wave);
  q -= lens(pr, uB1, uRs1) + lens(pr, uB2, uRs2);
  vec3 col = sky(q);
  col += palette(0.5 + 0.4 * clamp(wave, -1.0, 1.0)) * max(wave, 0.0) * 0.12 * (0.4 + uMid);
  col += vec3(1.0) * pow(max(wave, 0.0), 6.0) * 0.4 * (0.3 + 1.5 * uHigh);

  float m = 1.0;
  m *= hole(pr, uB1, uRs1 * (1.0 + 0.08 * uWobble * cos(2.0 * th + uTime * 40.0)), px, col);
  if (uRs2 > 0.0) m *= hole(pr, uB2, uRs2, px, col);
  col *= m;
  if (uRing >= 0.0) col += vec3(1.0, 0.95, 0.9) * exp(-uRing * 6.0) * 0.8;

  // LIGO strip.
  float y0 = -0.42;
  if (p.y < y0 + 0.07) {
    float x = clamp((p.x / (uRes.x / uRes.y)) + 0.5, 0.0, 1.0) * float(HIST - 1);
    int i0 = int(floor(x));
    int i1 = min(i0 + 1, HIST - 1);
    float h = mix(uStrain[i0], uStrain[i1], fract(x));
    float d = abs(p.y - (y0 + h * 0.055));
    float line = exp(-d * d / (px * px * 2.5));
    float base = exp(-pow((p.y - y0) / px, 2.0)) * 0.15;
    col = col * 0.45 + palette(0.95) * (line * 1.4 + base);
  }
  col *= uFadeIn;
  col *= 0.6 + 0.6 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class MergerScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'merger');
      this.trig = new VIZ.KickTrigger(0.35);
      this.strain = new Float32Array(HIST);
      this.sampleT = 0;
      this._newPair();
    }
    _newPair() {
      this.a4 = Math.pow(A0, 4);
      this.phase = Math.random() * Math.PI * 2;
      this.ring = -1;
      this.wobble = 0;
      this.fadeIn = 0;
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const K = (Math.pow(A0, 4) - Math.pow(AM, 4)) / (4 * 30 / P.speed);   // ~30 s to merge with no music
      let h = 0, omega = 0;
      this.fadeIn = Math.min(1, this.fadeIn + dt / 1.5);
      const hit = this.trig.update(audio.kick);
      if (this.ring < 0) {
        this.a4 -= 4 * K * dt;
        if (hit) this.a4 -= Math.pow(A0, 4) * 0.035 * hit * P.pull;
        const a = Math.pow(Math.max(this.a4, Math.pow(AM, 4)), 0.25);
        omega = Math.min(22, 0.95 * Math.sqrt(1 / (a * a * a)));
        this.phase += omega * dt;
        this.a = a;
        h = Math.pow(omega, 2 / 3) * 0.12 * Math.cos(2 * this.phase);
        if (a <= AM + 1e-4) { this.ring = 0; this.wobble = 1; }
      } else {
        this.ring += dt;
        this.wobble *= Math.exp(-dt / 0.35);
        h = this.wobble * 0.9 * Math.cos(this.ring * 30);
        if (this.ring > 5) this._newPair();
      }
      // Strain history, sampled at 40 Hz.
      this.sampleT += dt;
      while (this.sampleT > 1 / 40) {
        this.sampleT -= 1 / 40;
        this.strain.copyWithin(0, 1);
        this.strain[HIST - 1] = Math.max(-1, Math.min(1, h));
      }
      // Orbital plane seen at a slowly changing inclination.
      const incl = 0.6 + 0.25 * Math.sin(u.time * 0.05);
      const ci = Math.cos(incl);
      const inspiral = this.ring < 0;
      const a = inspiral ? this.a : 0;
      const bx = Math.cos(this.phase) * a / 2, by = Math.sin(this.phase) * a / 2 * ci;
      const rs = 0.03 * P.size;
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f2('uB1', bx, by).f2('uB2', -bx, -by)
        .f('uRs1', inspiral ? rs : rs * 1.45)
        .f('uRs2', inspiral ? rs : 0)
        .f('uPhase', this.phase)
        .f('uOmega', omega)
        .f('uGW', inspiral ? Math.min(1.5, Math.pow(omega, 2 / 3) * 0.12) * P.waves : 0)
        .f('uRing', inspiral ? -1 : this.ring)
        .f('uWobble', this.wobble * P.waves)
        .f('uRoll', u.time * 0.03)
        .f('uFadeIn', this.fadeIn)
        .fv('uStrain', this.strain);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'merger',
    name: 'Black Hole Merger',
    blurb: 'Two black holes spiral together and chirp. Every kick bleeds their orbit, so heavy music merges them faster. Watch the strain trace at the bottom.',
    params: [
      { key: 'pull', label: 'Inspiral per kick', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'speed', label: 'Base inspiral speed', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'waves', label: 'Gravitational waves', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'size', label: 'Black hole size', min: 0.5, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new MergerScene(ctx),
  });
})();

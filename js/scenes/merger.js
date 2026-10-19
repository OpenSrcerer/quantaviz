/* merger.js — Black Hole Merger.
 * One continuous life cycle, about a minute long, that never cuts away:
 *   1. alone: a single black hole lensing the starfield, still wearing the corona from its last
 *      merger, which slowly fades;
 *   2. approach: as the corona dies a companion falls in from beyond the frame and the two
 *      capture each other (the pair's centre slides to their midpoint as they bind);
 *   3. inspiral: gravitational waves carry the orbit away — the separation shrinks as
 *      a(t)^4 = a0^4 - 4Kt (Peters' quadrupole law), so the orbit speeds up into the chirp;
 *   4. merger: a flash, a ring of gravitational radiation, a remnant that rings down, and a new
 *      corona: a ring of spectrum bars round the hole, in the style of the Trap Nation ball.
 * A two-armed gravitational-wave spiral ripples through the lensed stars, and a LIGO-style
 * strain trace scrolls along the bottom. The orbital plane slowly tilts and rolls.
 *   bass  -> every kick bleeds the orbit (the pair steps closer); the corona pumps with the kick
 *   mids  -> the hot gas round each hole and the waves' glow
 *   highs -> starlight twinkle and glints in the wave crests
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const HIST = 128;
  const A0 = 0.46, AM = 0.07, AFAR = 1.3;
  const LONE = 14, APPROACH = 10, RING = 3;
  const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define HIST ${HIST}
uniform vec2 uB1;           // primary (the lone hole / the remnant)
uniform vec2 uB2;           // companion
uniform vec2 uCM;           // centre of the gravitational-wave pattern
uniform float uRs1;
uniform float uRs2;         // 0 = no companion
uniform float uPhase;
uniform float uOmega;
uniform float uGW;          // inspiral wave amplitude
uniform float uRing;        // seconds since the merger (< 0: none)
uniform float uWobble;
uniform float uRoll;
uniform float uCorona;      // 0..1
uniform float uStrain[HIST];
const float TAU = 6.2831853;
const float PI = 3.14159265;

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

// The corona: mirrored spectrum bars standing on a ring round the remnant (bass at the top).
vec3 corona(vec2 p, float px) {
  vec2 d = p - uB1;
  float rr = length(d);
  float t = abs(atan(d.x, d.y)) / PI;                 // 0 top .. 1 bottom, mirrored left/right
  const float NBAR = 40.0;
  float bt = (floor(t * NBAR) + 0.5) / NBAR;
  float v = band(bt * 0.9);
  float gap = 1.0 - smoothstep(0.32, 0.42, abs(fract(t * NBAR) - 0.5));
  float r0 = uRs1 * 2.3 * (1.0 + 0.18 * uKick);
  float L = (0.012 + 0.2 * v * v) * uCorona;
  float bar = smoothstep(r0 - px, r0 + px, rr) * (1.0 - smoothstep(r0 + L - px, r0 + L + px, rr)) * gap;
  float tip = exp(-pow((rr - r0 - L) / (2.0 * px), 2.0)) * gap;
  vec3 c = palette(0.45 + 0.5 * bt) * (bar * 1.2 + tip * 1.5) * (0.6 + 0.8 * v);
  c += palette(0.8) * exp(-pow((rr - r0) / (r0 * 0.12), 2.0)) * 0.6 * (0.5 + uKick);
  c += palette(0.6) * exp(-max(rr - r0, 0.0) / (0.06 + 0.1 * uLevel)) * 0.15 * step(r0, rr);
  return c * uCorona;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  float c = cos(uRoll), s = sin(uRoll);
  vec2 pr = mat2(c, -s, s, c) * p;
  vec2 pc = pr - uCM;
  float r = length(pc);
  float th = atan(pc.y, pc.x);

  // Gravitational waves: the inspiral's two-armed spiral, the merger's burst, the ringdown.
  float wave = cos(2.0 * (th - uPhase) + uOmega * 2.0 * r / 0.6) * uGW / (0.15 + r * 3.0);
  if (uRing >= 0.0) {
    float R = uRing * 0.75;
    wave += exp(-pow((r - R) / (0.03 + 0.05 * uRing), 2.0)) * cos(2.0 * th + uRing * 20.0) * 1.5 * exp(-uRing * 0.4)
          + cos(2.0 * th - uRing * 30.0 + r * 30.0) * uWobble / (0.15 + r * 3.0);
  }
  vec2 q = pr * (1.0 + 0.012 * wave);
  q -= lens(pr, uB1, uRs1);
  if (uRs2 > 0.0) q -= lens(pr, uB2, uRs2);
  vec3 col = sky(q);
  col += palette(0.5 + 0.4 * clamp(wave, -1.0, 1.0)) * max(wave, 0.0) * 0.12 * (0.4 + uMid);
  col += vec3(1.0) * pow(max(wave, 0.0), 6.0) * 0.4 * (0.3 + 1.5 * uHigh);

  if (uCorona > 0.001) col += corona(pr, px);
  float m = hole(pr, uB1, uRs1 * (1.0 + 0.08 * uWobble * cos(2.0 * th + uTime * 40.0)), px, col);
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
      // Start alone, a few seconds before a companion arrives.
      this.state = 'lone';
      this.t = LONE - 4;
      this.phase = Math.random() * Math.PI * 2;
      this.a = AFAR;
      this.w = 0;
      this.corona = 0;
      this.wobble = 0;
      this.rsBoost = 0;        // the remnant is bigger and settles back
      this.ringT = -1;
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const hit = this.trig.update(audio.kick);
      this.t += dt;
      let h = 0, omega = 0, gw = 0;
      const omegaOf = (a) => Math.min(22, 0.95 * Math.sqrt(1 / (a * a * a)));

      if (this.state === 'lone') {
        // The corona fades over the first ~10 s; then a companion starts to fall in.
        this.corona = Math.max(0, 1 - this.t / (LONE - 3)) ** 1.5;
        this.rsBoost *= Math.exp(-dt / 6);
        if (this.t >= LONE) {
          this.state = 'approach';
          this.t = 0;
          this.a = AFAR;
          this.w = 0;
          this.phase = Math.random() * Math.PI * 2;
        }
      } else if (this.state === 'approach') {
        // Swoop in from beyond the frame; the pair's centre slides from the lone hole to the midpoint.
        const k = smooth(this.t / APPROACH);
        this.a = AFAR + (A0 - AFAR) * k;
        this.w = 0.5 * k;
        omega = omegaOf(this.a);
        this.phase += omega * dt;
        gw = Math.pow(omega, 2 / 3) * 0.12 * k;
        h = gw * Math.cos(2 * this.phase);
        this.rsBoost *= Math.exp(-dt / 6);
        if (this.t >= APPROACH) { this.state = 'inspiral'; this.t = 0; this.a4 = Math.pow(A0, 4); }
      } else if (this.state === 'inspiral') {
        const K = (Math.pow(A0, 4) - Math.pow(AM, 4)) / (4 * 40 / P.speed);   // ~40 s with no music
        this.a4 -= 4 * K * dt;
        if (hit) this.a4 -= Math.pow(A0, 4) * 0.014 * hit * P.pull;
        this.a = Math.pow(Math.max(this.a4, Math.pow(AM, 4)), 0.25);
        this.w = 0.5;
        omega = omegaOf(this.a);
        this.phase += omega * dt;
        gw = Math.min(1.5, Math.pow(omega, 2 / 3) * 0.12);
        h = Math.pow(omega, 2 / 3) * 0.12 * Math.cos(2 * this.phase);
        if (this.a <= AM + 1e-4) {
          this.state = 'ring';
          this.t = 0;
          this.wobble = 1;
          this.rsBoost = 0.45;
          this.ringT = 0;
        }
      } else {
        // Ringdown; the corona swells in.
        this.wobble *= Math.exp(-dt / 0.35);
        this.corona = Math.min(1, this.corona + dt / 0.6);
        h = this.wobble * 0.9 * Math.cos(this.t * 30);
        if (this.t >= RING) { this.state = 'lone'; this.t = 0; }
      }
      if (this.ringT >= 0) { this.ringT += dt; if (this.ringT > 7) this.ringT = -1; }
      if (this.state !== 'ring') this.wobble *= Math.exp(-dt / 0.35);

      // Strain history, sampled at 40 Hz.
      this.sampleT += dt;
      while (this.sampleT > 1 / 40) {
        this.sampleT -= 1 / 40;
        this.strain.copyWithin(0, 1);
        this.strain[HIST - 1] = Math.max(-1, Math.min(1, h));
      }

      // Geometry: the orbital plane seen at a slowly changing inclination.
      const ci = Math.cos(0.6 + 0.25 * Math.sin(u.time * 0.05));
      const paired = this.state === 'approach' || this.state === 'inspiral';
      const dx = Math.cos(this.phase) * this.a, dy = Math.sin(this.phase) * this.a * ci;
      // Primary at -w*a, companion at (1-w)*a from the pair centre; the centre itself is pinned so
      // the primary sits still while it is alone.
      const b1 = paired ? [-this.w * dx, -this.w * dy] : [0, 0];
      const b2 = paired ? [(1 - this.w) * dx, (1 - this.w) * dy] : [0, 0];
      const cm = paired ? [b1[0] * 0.5 + b2[0] * 0.5, b1[1] * 0.5 + b2[1] * 0.5] : [0, 0];
      const rs = 0.03 * P.size;
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f2('uB1', b1[0], b1[1]).f2('uB2', b2[0], b2[1]).f2('uCM', cm[0], cm[1])
        .f('uRs1', rs * (1.2 + this.rsBoost))
        .f('uRs2', paired ? rs : 0)
        .f('uPhase', this.phase)
        .f('uOmega', omega)
        .f('uGW', gw * P.waves)
        .f('uRing', this.ringT)
        .f('uWobble', this.wobble * P.waves)
        .f('uRoll', u.time * 0.03)
        .f('uCorona', this.corona * P.corona)
        .fv('uStrain', this.strain);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'merger',
    name: 'Black Hole Merger',
    blurb: 'A lone black hole, a companion falls in, they spiral together and chirp, merge, and the remnant wears a spectrum corona until the next one arrives.',
    params: [
      { key: 'pull', label: 'Inspiral per kick', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'speed', label: 'Base inspiral speed', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'corona', label: 'Corona after a merger', min: 0, max: 1.5, step: 0.05, value: 1 },
      { key: 'waves', label: 'Gravitational waves', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'size', label: 'Black hole size', min: 0.5, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new MergerScene(ctx),
  });
})();

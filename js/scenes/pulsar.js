/* pulsar.js — Pulsar.
 * A spinning neutron star whose magnetic axis is tilted against its spin axis, so its two radio
 * beams sweep the sky like a lighthouse; whenever the near beam crosses our line of sight we see
 * a pulse (a flash, plus a radio ring expanding outward). Dipole field lines (r = L sin²θ) wrap the
 * star inside its light cylinder, and a pulsar-wind nebula (an equatorial torus and two jets)
 * glows around it.
 * The music drives the spin the way real pulsars misbehave: every snare is a *glitch*, a sudden
 * spin-up that magnetic braking then bleeds off, so the star visibly lurches round on each hit.
 *   highs -> the glitches (spin), the starquake glow, sparks streaming out along the beams,
 *            glints running along the field lines
 *   mids  -> beam brightness and the nebula
 *   bass  -> the star breathes slightly
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ALPHA = (65 * Math.PI) / 180;   // magnetic inclination
  const ZETA = (25 * Math.PI) / 180;    // spin axis tilted toward the viewer: alpha + zeta = 90°, so the beam grazes us
  const ROLL = 0.35;                    // spin axis roll on screen

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform vec3 uSpinAxis;    // unit, view space (z toward the viewer)
uniform vec3 uE1;          // basis of the equatorial plane
uniform vec3 uE2;
uniform vec3 uMag;         // magnetic axis (unit)
uniform float uPhase;      // rotation angle
uniform float uQuake;      // starquake envelope after a glitch
uniform float uSpinRate;   // normalised angular speed (0 = base .. 1 = a hard glitch)
uniform float uPulses[8];  // times of recent pulses (beam crossing the line of sight)
uniform float uBeamW;
uniform float uFieldLines;
const float TAU = 6.2831853;

vec3 rotAxis(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

float beam(vec2 p, vec3 b, float r) {
  float l2 = length(b.xy);
  float face = pow(max(b.z, 0.0), 8.0) * exp(-r * 7.0) * 0.5;      // pointing at us: a flood of light
  if (l2 < 1e-3) return face;
  vec2 bn = b.xy / l2;
  float along = dot(p, bn);
  float perp = abs(dot(p, vec2(-bn.y, bn.x)));
  float half_ = uBeamW * max(along, 0.0) / max(l2, 0.12) + 0.004;
  float I = exp(-(perp * perp) / (half_ * half_)) * smoothstep(0.0, 0.03, along) * exp(-along / (1.1 * l2 + 0.08));
  return I * (b.z < 0.0 ? 0.55 : 1.0) + face;
}

// Sparks: dots on a grid in beam coordinates, the grid streaming outward.
float sparks(vec2 p, vec2 b) {
  float l = length(b);
  if (l < 1e-3) return 0.0;
  vec2 bn = b / l;
  vec2 g = vec2(dot(p, bn) * 34.0 - uTime * 7.0, dot(p, vec2(-bn.y, bn.x)) * 34.0);
  vec2 id = floor(g);
  vec3 h = hash33(vec3(id, 11.0));
  if (h.z < 0.75) return 0.0;
  vec2 d = fract(g) - 0.5 - (h.xy - 0.5) * 0.6;
  return exp(-dot(d, d) * 60.0) * 2.0;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  float r = length(p);
  float rs = 0.042 * (1.0 + 0.07 * uKick + 0.04 * uBass);
  vec3 col = palette(0.0) * 0.22 * (1.0 - 0.6 * r);

  // Background stars.
  {
    vec2 g = p * 55.0;
    vec2 id = floor(g);
    vec3 h = hash33(vec3(id, 4.0));
    float d = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.7);
    float on = step(0.86, h.z);
    float tw = 0.6 + 0.4 * sin(uTime * (2.0 + 5.0 * h.x) + h.y * 30.0);
    col += palette(0.9) * on * exp(-d * d * 700.0) * tw * (0.8 + 1.5 * uHigh);
  }

  // Pulsar-wind nebula: an equatorial torus (an ellipse in projection) and jets along the spin axis.
  {
    mat2 inv = inverse(mat2(uE1.xy, uE2.xy));
    vec2 ab = inv * p;
    float rr = length(ab);
    float n = fbm2(p * 6.0 + vec2(uTime * 0.04, -uTime * 0.03));
    float torus = exp(-pow((rr - 0.2) / 0.06, 2.0)) * (0.4 + 0.9 * n);
    vec2 sa = normalize(uSpinAxis.xy);
    float jl = dot(p, sa), jp = abs(dot(p, vec2(-sa.y, sa.x)));
    float jets = exp(-jp * jp / (0.0004 + 0.0025 * abs(jl))) * exp(-abs(jl) * 3.0) * (0.5 + n);
    float fil = smoothstep(0.5, 0.95, fbm2(p * 3.0 + 7.0)) * exp(-r * 2.2);
    float e = 0.25 + 1.2 * uMid;
    col += palette(0.45) * torus * 0.35 * e + palette(0.7) * jets * 0.6 * e + palette(0.3) * fil * 0.25 * e;
  }

  // Dipole field lines around the magnetic axis, inside the light cylinder.
  {
    vec2 m2 = uMag.xy;
    float l2 = length(m2);
    vec2 mn = m2 / max(l2, 1e-4);
    float y = dot(p, mn), x = dot(p, vec2(-mn.y, mn.x));
    float L = r * r * r / max(x * x, 1e-6);
    float q = log(L) * 3.2;
    float fw = max(fwidth(q), 1e-4);
    float line = 1.0 - clamp(abs(fract(q) - 0.5) / fw - 0.5, 0.0, 1.0);
    float zone = smoothstep(rs * 1.2, rs * 2.5, r) * (1.0 - smoothstep(0.3, 0.46, L)) * smoothstep(0.1, 0.4, l2);
    float th = atan(abs(x), y);
    float glint = pow(0.5 + 0.5 * sin(th * 16.0 - uTime * 9.0 + floor(q) * 2.3), 24.0);
    col += palette(0.6) * line * zone * uFieldLines * (0.12 + 0.25 * uMid + glint * (0.3 + 2.5 * uHigh + 2.0 * uHighPulse));
  }

  // The two beams; round sparks stream outward along them with the highs.
  float b1 = beam(p, uMag, r), b2 = beam(p, -uMag, r);
  float spark = sparks(p, uMag.xy) * b1 + sparks(p, -uMag.xy) * b2;
  vec3 beamCol = mix(palette(0.95), vec3(1.0), 0.3);
  col += beamCol * (b1 + b2) * (0.3 + 1.0 * uMid + 0.4 * uSpinRate) + vec3(1.0) * spark * (0.2 + 2.0 * uHigh + 3.0 * uHighPulse);

  // Radio pulses: one ring per beam crossing.
  for (int i = 0; i < 8; i++) {
    float age = uTime - uPulses[i];
    if (age < 0.0 || age > 2.5) continue;
    float R = rs + age * 0.55;
    col += palette(0.85) * exp(-pow((r - R) / (0.004 + 0.01 * age), 2.0)) * exp(-age * 1.6) * 0.8;
  }

  // The neutron star: hot polar caps, a crust that turns with the spin, cracks glowing after a glitch.
  float rr = r / rs;
  float body = 1.0 - smoothstep(1.0 - 1.5 * px / rs, 1.0, rr);
  if (body > 0.0) {
    vec3 n = vec3(p / rs, sqrt(max(0.0, 1.0 - rr * rr)));
    vec3 nb = rotAxis(n, uSpinAxis, -uPhase);
    float crust = fbm3(nb * 5.0);
    float cracks = pow(1.0 - abs(noise3(nb * 9.0) * 2.0 - 1.0), 10.0);
    float caps = pow(max(dot(n, uMag), 0.0), 30.0) + pow(max(dot(n, -uMag), 0.0), 30.0);
    vec3 s = palette(0.55 + 0.3 * crust) * (0.35 + 0.65 * n.z) * 1.4;
    s += vec3(1.0) * caps * 5.0;
    s += palette(1.0) * cracks * (0.1 + 4.0 * uQuake);
    col = mix(col, s, body);
  }
  col += palette(0.9) * exp(-max(rr - 1.0, 0.0) * 3.0) * (1.0 - body) * (0.25 + 0.6 * uQuake + 0.3 * uMid);
  // Line-of-sight flash when the near beam sweeps over us.
  col += beamCol * pow(max(uMag.z, 0.0), 24.0) * 0.25;

  col *= 0.6 + 0.6 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class PulsarScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'pulsar');
      this.phase = 0;
      this.w = 0;           // extra angular velocity from glitches (rad/s)
      this.quake = 0;
      this.pulses = new Float32Array(8).fill(-100);
      this.prevFace = 0;
      // Fixed geometry: spin axis, equatorial basis.
      const cz = Math.cos(ZETA), sz = Math.sin(ZETA);
      const O = [-Math.sin(ROLL) * cz, Math.cos(ROLL) * cz, sz];
      const n = Math.hypot(O[1], O[0]);
      const e1 = [O[1] / n, -O[0] / n, 0];
      const e2 = [O[1] * e1[2] - O[2] * e1[1], O[2] * e1[0] - O[0] * e1[2], O[0] * e1[1] - O[1] * e1[0]];
      this.O = O; this.e1 = e1; this.e2 = e2;
      this.m = [0, 0, 0];
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      // Glitch: a snare (a high onset with a mid onset at the same moment: the crack plus the
      // drum's body) spins the star up; with "snares only", hi-hats (highs alone) just nudge it.
      if (audio.highOnset) {
        const body = clamp((Math.max(audio.midPulse, audio.midHit) - 0.3) / 0.4, 0, 1);
        const s = audio.highPulse * (P.snaresOnly ? 0.15 + 0.85 * body : 1);
        if (s > 0.05) { this.w += 4.5 * P.glitch * s; this.quake = Math.max(this.quake, s); }
      }
      // Magnetic braking bleeds the glitch off in a few hundred ms.
      this.w *= Math.exp(-dt / 0.38);
      this.quake *= Math.exp(-dt / 0.4);
      this.phase += (P.spin + this.w) * dt;
      const c = Math.cos(this.phase), s = Math.sin(this.phase);
      const ca = Math.cos(ALPHA), sa = Math.sin(ALPHA);
      for (let j = 0; j < 3; j++) this.m[j] = ca * this.O[j] + sa * (c * this.e1[j] + s * this.e2[j]);
      // A pulse each time the near beam sweeps across the line of sight.
      const face = Math.pow(Math.max(this.m[2], 0), 24);
      if (face > 0.4 && this.prevFace <= 0.4) { this.pulses.copyWithin(0, 1); this.pulses[7] = u.time; }
      this.prevFace = face;

      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f3('uSpinAxis', this.O[0], this.O[1], this.O[2])
        .f3('uE1', this.e1[0], this.e1[1], this.e1[2])
        .f3('uE2', this.e2[0], this.e2[1], this.e2[2])
        .f3('uMag', this.m[0], this.m[1], this.m[2])
        .f('uPhase', this.phase)
        .f('uQuake', this.quake)
        .f('uSpinRate', clamp(this.w / 6, 0, 1))
        .fv('uPulses', this.pulses)
        .f('uBeamW', 0.12 * P.beam)
        .f('uFieldLines', P.field);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'pulsar',
    name: 'Pulsar',
    blurb: 'A neutron star sweeps its radio beams across the sky. Every snare is a glitch that spins it up, and magnetic braking slows it back down.',
    params: [
      { key: 'glitch', label: 'Glitch size (spin per snare)', min: 0, max: 2.5, step: 0.05, value: 1 },
      { key: 'spin', label: 'Base spin', min: 0, max: 6, step: 0.1, value: 1.2, fmt: (v) => v.toFixed(1) + ' rad/s' },
      { key: 'snaresOnly', label: 'Snares only (ignore hi-hats)', min: 0, max: 1, step: 1, value: 1, fmt: (v) => (v ? 'on' : 'off') },
      { key: 'beam', label: 'Beam width', min: 0.3, max: 2.5, step: 0.05, value: 1 },
      { key: 'field', label: 'Field lines', min: 0, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new PulsarScene(ctx),
  });
})();

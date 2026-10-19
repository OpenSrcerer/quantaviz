/* comet.js — Comet.
 * We ride along with a comet on an eccentric (e = 0.75) Kepler orbit. Its two tails behave the
 * way real ones do: the blue ion tail is blown straight away from the sun by the solar wind, the
 * yellow dust tail curves back along the orbit because dust is pushed only gently by sunlight.
 * Swinging through perihelion the sun's direction wheels round quickly, the comet brightens and
 * both tails sweep across the sky while the starfield streams past.
 *   bass  -> solar-wind gusts: every kick sends a kink (a disconnection event) racing down the
 *            ion tail, and the tail flaps with the bass
 *   mids  -> the coma and the dust tail glow
 *   highs -> fragments and grains shed from the nucleus sparkle down the dust tail
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NK = 6;
  const ECC = 0.75;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define NK ${NK}
uniform vec2 uSun;        // unit vector from the comet toward the sun (screen)
uniform vec2 uVel;        // unit orbital velocity (screen)
uniform vec2 uNuc;        // nucleus position on screen
uniform float uBright;    // activity: grows as 1/r^2 toward perihelion
uniform vec2 uOff;        // starfield scroll
uniform vec2 uKinks[NK];  // age (s), strength
uniform float uGust;
uniform float uTail;

float stars(vec2 q, float sc, float seed) {
  vec2 g = q * sc;
  vec3 h = hash33(vec3(floor(g), seed));
  float d = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.7);
  float tw = 0.7 + 0.3 * sin(uTime * (2.0 + 5.0 * h.x) + h.y * 40.0) * (0.3 + uHigh);
  return step(0.9, h.z) * exp(-d * d * 1100.0) * tw;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 col = palette(0.0) * 0.08;
  col += vec3(0.8, 0.85, 1.0) * stars(p + uOff, 70.0, 1.0) * 0.7;
  col += vec3(0.8, 0.85, 1.0) * stars(p + uOff * 0.5, 40.0, 2.0) * 1.1;
  col += palette(0.2) * smoothstep(0.55, 0.95, fbm2((p + uOff * 0.2) * 1.5)) * 0.06;

  vec2 axis = -uSun;
  vec2 perp = vec2(-axis.y, axis.x);
  vec2 d = p - uNuc;
  float u = dot(d, axis);
  float v = dot(d, perp);
  float len = (0.55 + 0.6 * uBright) * uTail;

  // Ion tail: narrow, straight, filamentary, streaming outward fast; kinks race down it.
  if (u > -0.02) {
    float dv = 0.025 * uGust * sin(u * 9.0 - uTime * 5.0) * smoothstep(0.0, 0.3, u);
    for (int i = 0; i < NK; i++) {
      float age = uKinks[i].x;
      if (uKinks[i].y <= 0.0 || age > 3.0) continue;
      float front = age * 0.55;
      dv += uKinks[i].y * 0.06 * smoothstep(front - 0.12, front, u) * (1.0 - smoothstep(front, front + 0.35, u)) * smoothstep(0.0, 0.2, u);
    }
    float vv = v - dv;
    float w = 0.004 + 0.045 * max(u, 0.0);
    float rays = 0.45 + 0.55 * noise2(vec2(u * 4.0 - uTime * 1.6, vv / w * 2.5));
    float ion = exp(-vv * vv / (w * w)) * exp(-max(u, 0.0) / len) * rays * smoothstep(-0.02, 0.03, u);
    col += mix(palette(0.55), vec3(0.35, 0.6, 1.0), 0.5) * ion * (0.5 + 0.8 * uBright) * 1.4;
  }

  // Dust tail: broad, curved back along the orbit, with striae.
  float side = -sign(dot(uVel, perp) + 1e-4);
  float vc = side * 0.55 * u * u;
  float vd = v - vc;
  float wd = 0.008 + 0.16 * max(u, 0.0);
  if (u > -0.02) {
    float striae = 0.6 + 0.4 * noise2(vec2(u * 5.0, vd / wd * 1.5 + uTime * 0.05));
    float dust = exp(-vd * vd / (wd * wd)) * exp(-max(u, 0.0) / (len * 0.75)) * striae * smoothstep(-0.02, 0.04, u);
    col += palette(0.9) * dust * (0.35 + 1.0 * uMid) * (0.5 + uBright);
    // Highs: fragments and grains shed along the dust tail.
    vec2 g = vec2(u * 26.0 - uTime * 1.2, vd / wd * 4.0);
    vec3 h = hash33(vec3(floor(g), 7.0));
    vec2 f = fract(g) - 0.5 - (h.xy - 0.5) * 0.6;
    float frag = step(0.82, h.z) * exp(-dot(f, f) * 50.0) * exp(-vd * vd / (wd * wd)) * exp(-max(u, 0.0) / len);
    col += vec3(1.0, 0.95, 0.8) * frag * (0.2 + 2.0 * uHigh + 3.0 * uHighPulse);
  }

  // Coma, sunward jets, nucleus.
  float r = length(d);
  float ang = atan(d.y, d.x) - atan(uSun.y, uSun.x);
  float jets = pow(max(cos(ang * 3.0 + sin(uTime * 0.7) * 0.6), 0.0), 6.0) * max(cos(ang * 0.5), 0.0) * exp(-r / 0.06);
  col += palette(0.75) * (exp(-r / 0.035) * 0.9 + exp(-r / 0.12) * 0.2 + jets * 0.5) * (0.4 + 1.2 * uMid) * (0.5 + uBright);
  col += vec3(1.0) * exp(-r * r / 0.00003) * 2.0;

  // The sun's glare from beyond the frame.
  vec2 sunPos = uNuc + uSun * 1.1;
  col += palette(1.0) * exp(-length(p - sunPos) * 2.6) * (0.3 + 0.6 * uBright);

  col *= 0.6 + 0.6 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class CometScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'comet');
      this.trig = new VIZ.KickTrigger(0.3);
      this.f = -2.2;                       // true anomaly (start on the way in)
      this.off = [0, 0];
      this.kinks = new Float32Array(NK * 2);
      for (let i = 0; i < NK; i++) this.kinks[i * 2] = 99;
      this.next = 0;
      this.gust = 0;
      this.nuc = null;
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      // Kepler: df/dt = n (1 + e cos f)^2 / (1 - e^2)^1.5, period ~80 s at speed 1.
      const n = (Math.PI * 2 / 80) * P.speed;
      const q = 1 + ECC * Math.cos(this.f);
      // A small constant term keeps the long aphelion arc from dragging.
      this.f = (this.f + dt * (n * q * q / Math.pow(1 - ECC * ECC, 1.5) + 0.06 * P.speed)) % (Math.PI * 2);
      const r = (1 - ECC * ECC) / (1 + ECC * Math.cos(this.f));
      const bright = Math.min(1.5, 0.25 / (r * r));
      const cf = Math.cos(this.f), sf = Math.sin(this.f);
      const sun = [-cf, -sf];
      const vr = ECC * sf, vt = 1 + ECC * cf;
      let vel = [vr * cf - vt * sf, vr * sf + vt * cf];
      const vl = Math.hypot(vel[0], vel[1]);
      vel = [vel[0] / vl, vel[1] / vl];
      // The view follows the comet: stars stream backward, faster near perihelion.
      const sp = 0.04 * vl * P.speed;
      this.off[0] += vel[0] * sp * dt;
      this.off[1] += vel[1] * sp * dt;
      // Nucleus sits toward the sun so the tails have room; eased so it glides.
      const target2 = [sun[0] * 0.22, sun[1] * 0.18];
      if (!this.nuc) this.nuc = target2.slice();
      const e = 1 - Math.exp(-dt / 1.2);
      this.nuc[0] += (target2[0] - this.nuc[0]) * e;
      this.nuc[1] += (target2[1] - this.nuc[1]) * e;
      // Bass: gusts and disconnection kinks.
      const k = audio.kick;
      this.gust += (k - this.gust) * (1 - Math.exp(-dt / (k > this.gust ? 0.04 : 0.4)));
      for (let i = 0; i < NK; i++) this.kinks[i * 2] += dt;
      const hit = this.trig.update(k);
      if (hit) {
        const o = this.next * 2;
        this.kinks[o] = 0;
        this.kinks[o + 1] = hit * (Math.random() < 0.5 ? -1 : 1) * P.kinks;
        this.next = (this.next + 1) % NK;
      }
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f2('uSun', sun[0], sun[1]).f2('uVel', vel[0], vel[1]).f2('uNuc', this.nuc[0], this.nuc[1])
        .f('uBright', bright).f2('uOff', this.off[0], this.off[1])
        .f2v('uKinks', this.kinks)
        .f('uGust', this.gust * P.kinks)
        .f('uTail', P.tail);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'comet',
    name: 'Comet',
    blurb: 'Ride along a comet swinging past the sun. The ion tail flaps in the solar wind on every kick, and fragments sparkle down the dust tail with the highs.',
    params: [
      { key: 'speed', label: 'Orbit speed', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'kinks', label: 'Solar-wind gusts on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'tail', label: 'Tail length', min: 0.4, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new CometScene(ctx),
  });
})();

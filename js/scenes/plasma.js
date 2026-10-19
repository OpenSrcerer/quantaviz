/* plasma.js — Plasma Globe.
 * The novelty lamp: a high-voltage electrode inside a glass sphere of low-pressure noble gas.
 * Ionised channels (filaments) run from the electrode to the glass, crawl around as the hot gas
 * convects, fork near the glass and gather where you touch it (hold the mouse on the globe).
 * Filaments are drawn as polar curves (an angle that wanders with radius), so each pixel only
 * checks a handful of them.
 *   mids  -> the filaments: each one is a mid band, brighter and fatter when its band is loud
 *   bass  -> kicks are an arc burst: the electrode flashes, every filament flares and jumps
 *            to a new spot on the glass
 *   highs -> crackle flickering along the filaments, sparks where they touch the glass
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NF = 12;
  const TAU = Math.PI * 2;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define NF ${NF}
uniform vec4 uFil[NF];    // end angle, end radius (0..1 of R), depth brightness, seed
uniform float uR;
uniform float uBurst;
uniform vec2 uTouch;      // pointer (screen units), or far away
uniform float uTouchOn;
const float TAU = 6.2831853;

float adiff(float a, float b) { return mod(a - b + 3.14159265, TAU) - 3.14159265; }

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  p.y -= 0.03;
  float px = 1.0 / uRes.y;
  float r = length(p);
  float phi = atan(p.y, p.x);
  float R = uR;
  vec3 col = mix(palette(0.0) * 0.1, palette(0.0) * 0.02, vUv.y);

  // The stand.
  float base = step(p.y, -R * 0.92) * (1.0 - smoothstep(R * 0.42, R * 0.45, abs(p.x) + (p.y + R) * 0.4)) * step(-R * 1.25, p.y);
  col = mix(col, palette(0.0) * 0.2 + 0.02 + palette(0.6) * 0.08 * uBurst, base);

  vec3 glow = vec3(0.0);
  if (r < R) {
    float rn = r / R;
    // Faint gas glow.
    glow += palette(0.4) * 0.05 * (1.0 - rn) * (0.6 + uMid);
    for (int i = 0; i < NF; i++) {
      vec4 f = uFil[i];
      float rEnd = f.y;
      if (rn > rEnd + 0.02) continue;
      float seed = f.w;
      float ti = float(i) / float(NF - 1);
      float e = bandMid(ti);
      // Lateral wander (screen units) that grows away from the electrode and crawls with time.
      float wob = (noise2(vec2(rn * 5.0 - uTime * 1.3, seed)) - 0.5) * 0.11 * sin(3.14159 * min(rn / rEnd, 1.0));
      wob += (noise2(vec2(rn * 14.0 - uTime * 3.0, seed + 9.0)) - 0.5) * 0.02;
      float d = r * adiff(phi, f.x) - wob * R;
      float w = (0.0025 + 0.004 * e + 0.003 * uBurst) * (0.6 + 0.6 * rn);
      float crack = 1.0 + (uHigh * 1.5 + uHighPulse * 2.0) * (noise2(vec2(rn * 30.0, uTime * 25.0 + seed)) - 0.4);
      float lit = (0.35 + 2.0 * e + 1.5 * uBurst) * f.z * crack;
      float core = exp(-d * d / (w * w)) * 1.4 + exp(-abs(d) / (w * 6.0)) * 0.25;
      // Fork near the glass.
      float fk = smoothstep(0.55, 0.75, rn / rEnd);
      if (fk > 0.0) {
        float d2 = d - (rn / rEnd - 0.55) * 0.12 * R * (fract(seed * 7.3) < 0.5 ? 1.0 : -1.0);
        core += fk * (exp(-d2 * d2 / (w * w * 0.5)) * 0.9 + exp(-abs(d2) / (w * 5.0)) * 0.15);
      }
      core *= 1.0 - smoothstep(rEnd - 0.01, rEnd + 0.02, rn);
      glow += palette(0.5 + 0.45 * ti) * core * lit;
      // Contact spot on the glass.
      vec2 ep = vec2(cos(f.x), sin(f.x)) * rEnd * R;
      float de = length(p - ep);
      glow += palette(0.95) * (exp(-de * de / 0.0003) * 0.8 + exp(-de / 0.02) * 0.1) * lit * (0.5 + 1.5 * uHighPulse);
    }
    // The electrode.
    float re = r / (R * 0.13);
    glow += palette(0.9) * (exp(-re * re) * 1.5 + exp(-re) * 0.4) * (0.8 + 2.5 * uBurst);
    if (re < 1.0) glow += palette(0.3) * 0.25 * sqrt(1.0 - re * re);
    // Glass: rim reflection and a window highlight.
    float rim = pow(rn, 18.0);
    glow += vec3(0.6, 0.7, 0.9) * rim * 0.35;
    vec2 hl = p - vec2(-0.35, 0.4) * R;
    glow += vec3(1.0) * exp(-dot(hl, hl) / (R * R * 0.012)) * 0.15;
  }
  // Glass edge line.
  col += vec3(0.5, 0.6, 0.8) * exp(-pow((r - R) / (1.5 * px), 2.0)) * 0.4;
  col += glow;
  col *= 0.6 + 0.6 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class PlasmaScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'plasma');
      this.trig = new VIZ.KickTrigger(0.35);
      this.fil = [];
      for (let i = 0; i < NF; i++) {
        const a = Math.random() * TAU;
        this.fil.push({ a, target: a, drift: (Math.random() - 0.5) * 0.25, seed: Math.random() * 100, ph: Math.random() * TAU });
      }
      this.data = new Float32Array(NF * 4);
      this.burst = 0;
      this.touch = 0;
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const asp = u.width / u.height;
      const R = 0.38 * Math.min(1, asp * 0.8);
      const hit = this.trig.update(audio.kick);
      if (hit) {
        this.burst = Math.max(this.burst, hit * P.burst);
        for (const f of this.fil) f.target = f.a + (Math.random() - 0.5) * 2.4 * hit * P.burst;
      }
      this.burst *= Math.exp(-dt / 0.18);
      // Pointer: touching the glass pulls filaments to it.
      const ptx = (u.pointer.x - 0.5) * asp, pty = u.pointer.y - 0.5 - 0.03;
      const inside = Math.hypot(ptx, pty) < R * 1.05;
      this.touch += ((u.pointer.down && inside ? 1 : 0) - this.touch) * (1 - Math.exp(-dt / 0.15));
      const ta = Math.atan2(pty, ptx);
      for (let i = 0; i < NF; i++) {
        const f = this.fil[i];
        // Convection: a slow drift plus wander; kicks set a new target that is eased toward.
        f.target += dt * (f.drift + 0.35 * Math.sin(u.time * 0.23 + f.ph)) * P.crawl;
        let goal = f.target;
        if (this.touch > 0.01 && i % 2 === 0) {
          const d = Math.atan2(Math.sin(ta - f.target), Math.cos(ta - f.target));
          goal = f.target + d * this.touch;
        }
        f.a += Math.atan2(Math.sin(goal - f.a), Math.cos(goal - f.a)) * (1 - Math.exp(-dt / 0.12));
        const depth = 0.5 + 0.5 * Math.sin(u.time * 0.21 + f.ph);   // turning toward / away from us
        this.data[i * 4] = f.a;
        this.data[i * 4 + 1] = 0.9 + 0.1 * depth;
        this.data[i * 4 + 2] = 0.45 + 0.55 * depth;
        this.data[i * 4 + 3] = f.seed;
      }
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f4v('uFil', this.data).f('uR', R).f('uBurst', this.burst).f2('uTouch', ptx, pty).f('uTouchOn', this.touch);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'plasma',
    name: 'Plasma Globe',
    blurb: 'Crawling plasma filaments, one per mid band. Kicks fire an arc burst; highs make them crackle. Hold the mouse on the glass to pull them to your finger.',
    params: [
      { key: 'burst', label: 'Arc burst on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'crawl', label: 'Crawl speed', min: 0, max: 3, step: 0.05, value: 1 },
    ],
    create: (ctx) => new PlasmaScene(ctx),
  });
})();

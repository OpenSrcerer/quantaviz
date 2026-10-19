/* supernova.js — Supernova.
 * A massive star on the edge of core collapse. Every kick collapses the core and launches a blast
 * wave: the shock front grows like a Sedov–Taylor blast (R ∝ t^0.4, fast at first, then
 * coasting), its edge breaks up into Rayleigh–Taylor fingers as it ages, it refracts the starfield
 * behind it as it sweeps past, and it leaves a slowly fading remnant shell. Each blast also kicks
 * the camera (the scene's own spring-damped recoil, on top of the global shake).
 *   bass  -> the collapse, the blast waves, the recoil: the big change
 *   mids  -> the star's boiling surface, its corona and the hot ejecta filaments
 *   highs -> sparks in the ejecta and twinkling background stars
 * Single fullscreen fragment shader; up to MAXB blasts live at once.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const MAXB = 6;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define MAXB ${MAXB}
uniform vec3 uBlast[MAXB];   // age (s), strength 0..1 (0 = unused), seed
uniform float uCollapse;     // kick envelope with an instant attack: the core implodes
uniform vec2 uShake;         // recoil offset (screen units)
uniform float uStarSize;
uniform float uBlastSize;
uniform float uFilaments;
const float LIFE = 2.6;
const float TAU = 6.2831853;

float starfield(vec2 p, float scale, float seed) {
  vec2 g = p * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec3 h = hash33(vec3(id, seed));
  if (h.z < 0.82) return 0.0;
  float d = length(f - (h.xy - 0.5) * 0.7);
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h.x * 4.0) + h.y * 40.0);
  tw *= 1.0 + (1.2 * uHigh + 1.4 * uHighPulse) * step(0.55, h.y);   // highs: sparkle
  return tw * exp(-d * d * 900.0) * (h.z - 0.8) * 7.0;
}

// Round sparks on a polar grid that expands with the shell.
float sparks(vec2 p, float seed, float R) {
  float r = length(p);
  float a = atan(p.y, p.x);
  vec2 g = vec2(a * 18.0, r / max(R, 0.05) * 9.0);
  vec2 id = floor(g);
  vec3 h = hash33(vec3(id, seed));
  if (h.z < 0.8) return 0.0;
  vec2 d = fract(g) - 0.5 - (h.xy - 0.5) * 0.6;
  return exp(-dot(d, d) * 40.0) * 3.0;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  p += uShake;
  p *= 1.0 - 0.07 * uCollapse;          // the implosion pulls the view in
  float r = length(p);
  vec2 dir = p / max(r, 1e-4);
  float ang = atan(p.y, p.x);

  vec3 shells = vec3(0.0);
  vec2 bgOff = vec2(0.0);
  float flash = 0.0;
  for (int i = 0; i < MAXB; i++) {
    float amp = uBlast[i].y;
    float age = uBlast[i].x;
    if (amp <= 0.0 || age > LIFE) continue;
    float seed = uBlast[i].z;
    float t = age / LIFE;
    float R = uBlastSize * (0.42 + 0.7 * amp) * pow(t, 0.4);
    // Rayleigh–Taylor fingers grow as the shell sweeps up matter.
    float n1 = noise3(vec3(dir * 3.0, seed + age * 0.25));
    float n2 = noise3(vec3(dir * 9.0, seed * 1.7 + age * 0.4));
    float Rf = R * (1.0 - uFilaments * 0.24 * smoothstep(0.0, 0.5, t) * (0.65 * n1 + 0.35 * n2));
    float d = r - Rf;
    float w = 0.004 + 0.028 * t;
    float fade = amp * (exp(-age * 1.6) + 0.12 * exp(-age * 0.5)) * (1.0 - smoothstep(0.8, 1.0, t));
    float front = exp(-d * d / (w * w));
    // Ejecta behind the front: radial filaments, hottest just inside the shock.
    float inside = smoothstep(-0.45 * Rf, 0.0, d) * (1.0 - smoothstep(-w, 0.0, d));
    float fil = noise3(vec3(dir * 14.0, r * 4.0 + seed));
    fil = fil * fil * fil * 3.0;
    float midE = bandMid(fract(ang / TAU + seed * 0.37));          // the ejecta glow with the mids
    vec3 hot = mix(vec3(1.0, 0.96, 0.9), palette(0.95 - 0.65 * t), smoothstep(0.0, 0.35, t));
    vec3 c = hot * front * 1.4 + palette(0.85 - 0.5 * t) * inside * fil * (0.15 + 0.8 * midE) * uFilaments;
    // Highs: sparks of hot clumps in the ejecta.
    c += vec3(1.0, 0.95, 0.85) * sparks(p, seed, R) * inside * (0.1 + 0.8 * uHigh + 1.8 * uHighPulse);
    shells += c * fade;
    // The shock refracts what is behind it (a lens-like bump in the background).
    bgOff -= dir * (d / w) * front * 0.025 * amp * exp(-age * 0.9);
    flash += amp * exp(-age * 14.0);
  }

  // Background: two star layers seen through the shocks, a faint remnant haze.
  vec2 bp = p + bgOff;
  vec3 col = palette(0.0) * 0.1 * (1.0 - 0.5 * r);
  col += vec3(starfield(bp, 70.0, 1.0)) * palette(0.9) * 1.2;
  col += vec3(starfield(bp * 0.6 + 3.0, 45.0, 2.0)) * palette(0.6);
  float haze = fbm2(bp * 2.5 + uTime * 0.01);
  col += palette(0.4) * smoothstep(0.5, 0.9, haze) * 0.035 * (0.4 + uMid);

  // The progenitor: shrinks and goes white-hot on the collapse, boils with the mids.
  float rs = uStarSize * 0.075 * (1.0 - 0.5 * uCollapse) * (1.0 + 0.05 * uBass);
  float rr = r / rs;
  float body = 1.0 - smoothstep(1.0 - 1.5 * px / rs, 1.0, rr);
  if (body > 0.0) {
    float mu = sqrt(max(0.0, 1.0 - rr * rr));
    float gran = fbm2(p / rs * 2.2 + vec2(uTime * 0.15, -uTime * 0.11));
    float e = bandMid(fract(ang / TAU * 2.0 + 0.5));
    vec3 surf = palette(0.55 + 0.4 * gran) * (0.35 + 0.65 * mu) * (1.0 + 1.8 * e + 0.6 * uMid);
    surf = mix(surf, vec3(1.0, 0.97, 0.92) * 3.0, uCollapse * 0.8);
    col = mix(col, surf, body);
  }
  float corona = exp(-max(rr - 1.0, 0.0) * 2.2) * (1.0 - body);
  col += palette(0.8) * corona * (0.18 + 0.7 * uMid + 0.8 * uCollapse);

  col += shells;
  col += vec3(1.0, 0.95, 0.9) * flash * 0.3;
  col *= 0.6 + 0.6 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class SupernovaScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'supernova');
      this.trig = new VIZ.KickTrigger(0.35);
      this.blasts = new Float32Array(MAXB * 3);
      for (let i = 0; i < MAXB; i++) this.blasts[i * 3] = 99;
      this.next = 0;
      this.collapse = 0;
      this.sh = [0, 0];
      this.shv = [0, 0];
      this.idleT = 0;
    }
    resize() { /* fullscreen shader */ }
    _blast(amp, recoil) {
      const o = this.next * 3;
      this.blasts[o] = 0;
      this.blasts[o + 1] = amp;
      this.blasts[o + 2] = Math.random() * 100;
      this.next = (this.next + 1) % MAXB;
      const a = Math.random() * Math.PI * 2;
      this.shv[0] += Math.cos(a) * amp * 0.9 * recoil;
      this.shv[1] += Math.sin(a) * amp * 0.9 * recoil;
    }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      for (let i = 0; i < MAXB; i++) this.blasts[i * 3] += dt;
      const hit = this.trig.update(audio.kick);
      if (hit) { this._blast(hit, P.recoil); this.idleT = 0; }
      if (P.idle > 0) {
        this.idleT += dt;
        if (this.idleT > 1 / P.idle) { this.idleT = 0; this._blast(0.35 + Math.random() * 0.3, P.recoil * 0.5); }
      }
      const k = audio.kick;
      this.collapse += (k - this.collapse) * (1 - Math.exp(-dt / (k > this.collapse ? 0.012 : 0.3)));
      // Recoil: an under-damped spring, so a blast jolts the frame and it rings back.
      const K = 260, C = 2 * Math.sqrt(K) * 0.3;
      for (let j = 0; j < 2; j++) {
        this.shv[j] += (-K * this.sh[j] - C * this.shv[j]) * dt;
        this.sh[j] += this.shv[j] * dt;
      }
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f3v('uBlast', this.blasts)
        .f('uCollapse', this.collapse)
        .f2('uShake', this.sh[0], this.sh[1])
        .f('uStarSize', P.star)
        .f('uBlastSize', P.size)
        .f('uFilaments', P.filaments);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'supernova',
    name: 'Supernova',
    blurb: 'Every kick collapses the core and blows the star apart: a shock wave tears outward, bends the starlight behind it and jolts the camera.',
    params: [
      { key: 'size', label: 'Blast size', min: 0.3, max: 2, step: 0.05, value: 1 },
      { key: 'recoil', label: 'Camera recoil', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'star', label: 'Star size', min: 0.4, max: 2, step: 0.05, value: 1 },
      { key: 'filaments', label: 'Ejecta filaments', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'idle', label: 'Idle blasts (0 = kicks only)', min: 0, max: 2, step: 0.1, value: 0, fmt: (v) => (v ? v.toFixed(1) + ' / s' : 'kicks only') },
    ],
    create: (ctx) => new SupernovaScene(ctx),
  });
})();

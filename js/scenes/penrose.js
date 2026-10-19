/* penrose.js — Penrose Diagram.
 * The conformal (Penrose) diagram of a charged, maximally extended black hole
 * (Reissner–Nordström). Time runs up, light runs at exactly 45°, and infinity is squeezed into
 * finite edges, so the whole spacetime fits on the screen — and it is an endless chain:
 *     a pair of universes (diamonds)      -> the black hole interior (between the horizons)
 *     -> two regions beside the timelike singularities (the jagged vertical lines)
 *     -> a white hole                      -> a pair of brand-new universes -> ...
 * A traveller follows a genuine timelike worldline (never flatter than 45°) through it: falls
 * through the event horizon, slips past the inner horizon, dodges the singularity (in this
 * spacetime it is avoidable), is thrown out of the white hole into the next universe, left or
 * right at random. The view scrolls up with them forever; their own little light cone rides along.
 *   bass  -> kicks fire light rays from the traveller along both sides of the light cone, and
 *            hurry them on (proper time surges); the horizons pulse
 *   mids  -> the regions and horizons glow; each universe is one mid band
 *   highs -> the singularities crackle; sparks along the horizons
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NTR = 40, NPH = 16;
  const TRAIL_DT = 0.07;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define NTR ${NTR}
#define NPH ${NPH}
uniform vec2 uCam;          // diagram point at the screen centre
uniform float uS;           // screen units per diagram unit
uniform vec2 uTrav;         // traveller (x, t)
uniform vec2 uTrail[NTR];   // past worldline, newest first
uniform vec4 uPhot[NPH];    // x0, t0, direction (+-1, 0 = none), length travelled
uniform vec3 uFlash;        // x, t, age of the last horizon crossing
uniform float uPulse2;      // horizon pulse (kicks)

// 0 outside, 1 universe, 2 black hole, 3 beside the singularity, 4 white hole.
int region(vec2 d) {
  float x = d.x;
  float k = floor(d.y / 4.0);
  float tau = d.y - 4.0 * k;
  float ax = abs(x);
  if (abs(ax - 1.0) + tau < 1.0 || abs(ax - 1.0) + (4.0 - tau) < 1.0) return 1;
  if (ax + abs(tau - 1.0) < 1.0) return 2;
  if (ax + abs(tau - 3.0) < 1.0) return 4;
  if (ax < 1.0 && tau > 2.0 - ax && tau < 2.0 + ax) return 3;
  return 0;
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  vec2 d = p / uS + uCam;                  // diagram coordinates
  float dpx = px / uS;                     // one pixel in diagram units
  float k = floor(d.y / 4.0);
  float tau = d.y - 4.0 * k;
  int reg = region(d);

  vec3 col = palette(0.0) * 0.05;
  // Faint stars outside the spacetime.
  {
    vec2 g = p * 70.0;
    vec3 h = hash33(vec3(floor(g), 2.0));
    float sd = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.7);
    col += vec3(0.6) * step(0.95, h.z) * exp(-sd * sd * 900.0) * 0.4;
  }

  // Region fills.
  if (reg == 1) {
    float level = tau < 2.0 ? k : k + 1.0;
    float side = d.x > 0.0 ? 1.0 : 0.0;
    float e = bandMid(fract(level * 0.37 + side * 0.5 + 0.1));
    float neb = fbm2(d * 2.2 + level * 7.0 + side * 3.0);
    col = palette(0.1) * 0.18 + palette(0.35 + 0.3 * neb) * smoothstep(0.35, 0.9, neb) * (0.12 + 0.5 * e);
    vec2 g = d * 14.0;
    vec3 h = hash33(vec3(floor(g), level * 3.0 + side));
    float sd = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.7);
    float tw = 0.6 + 0.4 * sin(uTime * (2.0 + 5.0 * h.x) + h.y * 30.0) * (0.4 + 1.2 * uHigh);
    col += vec3(0.9, 0.95, 1.0) * step(0.86, h.z) * exp(-sd * sd * 400.0) * tw * (0.5 + e);
  } else if (reg == 2) {
    float sw = fbm2(vec2(d.x * 3.0, (d.y - uTime * 0.05) * 3.0));
    col = palette(0.0) * 0.12 + palette(0.9) * 0.05 * sw + palette(0.85) * 0.06 * uMid;
  } else if (reg == 3) {
    float near = 1.0 - abs(d.x);   // distance to the singularity
    col = palette(0.6) * 0.06 + palette(1.0) * exp(-near * 6.0) * (0.06 + 0.25 * uHigh);
  } else if (reg == 4) {
    float r = abs(d.x) + abs(tau - 3.0);
    col = palette(0.95) * (0.08 + 0.1 * (1.0 - r)) * (0.6 + 0.9 * uMid) + palette(0.5) * 0.04;
  }

  // Null lines: every edge of this tiling lies on t +- x = an even number.
  float valid = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2((i & 1) == 0 ? -1.0 : 1.0, (i & 2) == 0 ? -1.0 : 1.0) * dpx * 2.5;
    valid = max(valid, float(region(d + o) != 0));
  }
  valid = max(valid, float(reg != 0));
  float a = abs(fract((d.y + d.x) * 0.5 + 0.5) - 0.5) * 2.0;
  float b = abs(fract((d.y - d.x) * 0.5 + 0.5) - 0.5) * 2.0;
  float ld = min(a, b) * 0.7071;
  float line = (1.0 - smoothstep(dpx * 0.6, dpx * 1.8, ld)) * valid;
  if (line > 0.0) {
    bool infinity = abs(d.x) > 1.0 - dpx;          // the universes' outer edges: null infinity
    vec3 lc = infinity ? palette(0.45) * 0.45 : palette(0.85) * (0.6 + 1.2 * uMid + 1.4 * uPulse2);
    // Highs: sparks running along the horizons.
    float sp = pow(0.5 + 0.5 * sin((d.x + d.y) * 30.0 - uTime * 8.0), 30.0) * (infinity ? 0.0 : 1.0);
    lc += vec3(1.0) * sp * (0.3 * uHigh + 1.2 * uHighPulse);
    // A flash where the traveller just crossed.
    vec2 fd = d - uFlash.xy;
    lc += vec3(1.0) * exp(-dot(fd, fd) / 0.25) * exp(-uFlash.z * 2.0) * 2.0;
    col += lc * line;
  }
  // Singularities: jagged vertical lines at x = +-1 between tau = 1 and 3.
  if (tau > 1.0 && tau < 3.0) {
    float zig = abs(fract(tau * 6.0) - 0.5) * 0.06 - 0.015;
    float flick = 0.7 + 0.3 * noise2(vec2(tau * 20.0, uTime * 15.0));
    float sdist = abs(abs(d.x) - 1.0 - zig);
    float s = 1.0 - smoothstep(dpx * 0.8, dpx * 2.2, sdist);
    col += mix(vec3(1.0, 0.35, 0.3), palette(1.0), 0.4) * s * flick * (1.0 + 2.0 * uHigh + 2.5 * uHighPulse);
    col += vec3(1.0, 0.4, 0.3) * exp(-sdist / 0.05) * 0.08 * (0.5 + uHigh);
  }
  // Spatial infinity: the far corners of each universe.
  for (int s = -1; s <= 1; s += 2) {
    vec2 io = d - vec2(float(s) * 2.0, (floor(d.y / 4.0 + 0.5)) * 4.0);
    col += palette(0.5) * exp(-dot(io, io) / (dpx * dpx * 30.0)) * 0.8;
  }

  // Light rays fired on kicks: they travel at exactly 45 degrees until they leave the spacetime.
  for (int i = 0; i < NPH; i++) {
    vec4 ph = uPhot[i];
    if (ph.z == 0.0) continue;
    vec2 a0 = ph.xy;
    float alpha = abs(ph.z);
    vec2 a1 = ph.xy + vec2(sign(ph.z), 1.0) * ph.w;
    float sd = segDist(d, a0, a1);
    float headD = length(d - a1);
    float along = clamp(1.0 - headD / max(ph.w, 1e-3), 0.0, 1.0);
    float alive = float(reg != 0) * alpha;
    col += palette(1.0) * (1.0 - smoothstep(dpx, dpx * 2.5, sd)) * (0.2 + 0.8 * along * along) * alive;
    col += vec3(1.0) * exp(-headD * headD / (dpx * dpx * 18.0)) * 2.0 * alive;
  }

  // The traveller: worldline, light cone, and themselves.
  float wl = 1e9;
  vec2 prev = uTrav;
  for (int i = 0; i < NTR; i++) {
    vec2 q = uTrail[i];
    wl = min(wl, segDist(d, prev, q) + float(i) * dpx * 0.03);
    prev = q;
  }
  col += palette(0.95) * (1.0 - smoothstep(dpx * 0.8, dpx * 2.4, wl)) * 1.2;
  float cone = min(segDist(d, uTrav, uTrav + vec2(0.35, 0.35)), segDist(d, uTrav, uTrav + vec2(-0.35, 0.35)));
  float dash = step(0.5, fract((d.y - uTrav.y) * 14.0));
  col += vec3(1.0) * (1.0 - smoothstep(dpx * 0.5, dpx * 1.8, cone)) * dash * 0.6;
  vec2 td = d - uTrav;
  col += vec3(1.0) * exp(-dot(td, td) / (dpx * dpx * 10.0)) * 3.0 + palette(1.0) * exp(-length(td) / (dpx * 12.0)) * 0.4;

  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class PenroseScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'penrose');
      this.trig = new VIZ.KickTrigger(0.35);
      this.t = 0.3;
      this.boost = 0;
      this.pulse = 0;
      this.sides = new Map();      // random left/right choices, made as the path is needed
      this.trail = new Float32Array(NTR * 2);
      this.phot = new Float32Array(NPH * 4);
      this.nextP = 0;
      this.frozen = new Array(NPH).fill(false);
      this.flash = [0, -99, 9];
      this.lastRegion = 1;
      this.camT = null;
      this.camX = 0;
    }
    _side(key) {
      if (!this.sides.has(key)) this.sides.set(key, Math.random() < 0.5 ? -1 : 1);
      if (this.sides.size > 400) this.sides.delete(this.sides.keys().next().value);
      return this.sides.get(key);
    }
    /** The worldline: waypoints a unit of t apart, cosine-blended; slopes stay below 1. */
    _x(t) {
      const k = Math.floor(t / 4), tau = t - 4 * k;
      const sU = this._side('u' + k), sIII = this._side('s' + k), sN = this._side('u' + (k + 1));
      const w = [0.75 * sU, 0.15 * sU, 0.4 * sIII, 0.15 * sN, 0.75 * sN];
      const i = Math.min(3, Math.floor(tau));
      const f = tau - i;
      const e = (1 - Math.cos(Math.PI * f)) / 2;
      return w[i] + (w[i + 1] - w[i]) * e;
    }
    _region(x, t) {
      const k = Math.floor(t / 4), tau = t - 4 * k, ax = Math.abs(x);
      if (Math.abs(ax - 1) + tau < 1 || Math.abs(ax - 1) + (4 - tau) < 1) return 1;
      if (ax + Math.abs(tau - 1) < 1) return 2;
      if (ax + Math.abs(tau - 3) < 1) return 4;
      if (ax < 1 && tau > 2 - ax && tau < 2 + ax) return 3;
      return 0;
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const k = audio.kick;
      this.boost += (k - this.boost) * (1 - Math.exp(-dt / (k > this.boost ? 0.05 : 0.6)));
      this.pulse = Math.max(this.pulse * Math.exp(-dt / 0.25), k);
      this.t += dt * 0.2 * P.speed * (1 + 1.3 * this.boost * P.surge);
      const x = this._x(this.t);

      // Horizon crossings flash.
      const reg = this._region(x, this.t);
      if (reg !== this.lastRegion && reg !== 0) { this.flash = [x, this.t, 0]; this.lastRegion = reg; }
      this.flash[2] += dt;

      // Kicks fire a pair of light rays along the light cone.
      const hit = this.trig.update(k);
      if (hit && P.rays > 0) {
        for (const dir of [-1, 1]) {
          this.phot.set([x, this.t, dir, 0], this.nextP * 4);
          this.frozen[this.nextP] = false;
          this.nextP = (this.nextP + 1) % NPH;
        }
      }
      // Rays run at 45 degrees; when the head leaves the spacetime (it hit the singularity or
      // null infinity) the ray stops there and fades. The direction's magnitude is its alpha.
      for (let i = 0; i < NPH; i++) {
        const o = i * 4;
        const dir = this.phot[o + 2];
        if (dir === 0) continue;
        if (!this.frozen[i]) {
          const L = this.phot[o + 3] + dt * 0.55 * P.rays;
          const sg = Math.sign(dir);
          if (L > 0.05 && this._region(this.phot[o] + sg * L, this.phot[o + 1] + L) === 0) this.frozen[i] = true;
          else this.phot[o + 3] = L;
        } else {
          const a = Math.abs(dir) * Math.exp(-dt / 0.6);
          this.phot[o + 2] = a < 0.02 ? 0 : Math.sign(dir) * a;
        }
      }
      // Worldline trail, newest first.
      for (let i = 0; i < NTR; i++) {
        const tt = this.t - (i + 1) * TRAIL_DT;
        this.trail[i * 2] = this._x(tt);
        this.trail[i * 2 + 1] = tt;
      }

      // Camera: follows the traveller up (they sit a little below centre), drifts with their x.
      const asp = u.width / u.height;
      const S = Math.min(0.2, (0.9 * asp) / 4) * P.zoom;
      const goalT = this.t + 0.12 / S;
      if (this.camT === null) this.camT = goalT;
      this.camT += (goalT - this.camT) * (1 - Math.exp(-dt / 0.8));
      this.camX += (x * 0.3 - this.camX) * (1 - Math.exp(-dt / 1.5));

      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f2('uCam', this.camX, this.camT).f('uS', S)
        .f2('uTrav', x, this.t).f2v('uTrail', this.trail)
        .f4v('uPhot', this.phot)
        .f3('uFlash', this.flash[0], this.flash[1], this.flash[2])
        .f('uPulse2', this.pulse * 0.6);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'penrose',
    name: 'Penrose Diagram',
    blurb: 'An endless charged black hole: fall through the horizon, dodge the singularity, get thrown from a white hole into a new universe. Kicks fire light rays along your light cone.',
    params: [
      { key: 'speed', label: 'Travel speed', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'surge', label: 'Surge on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'rays', label: 'Light rays on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'zoom', label: 'Zoom', min: 0.6, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new PenroseScene(ctx),
  });
})();

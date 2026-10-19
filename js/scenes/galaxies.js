/* galaxies.js — Galaxy Collision.
 * Two spiral galaxies on a bound elliptical orbit fly through each other, the way Toomre & Toomre
 * first showed in 1972: each galaxy is a heavy core plus tens of thousands of massless stars on
 * circular orbits, and the passing core's tide rips long tails and bridges out of both disks.
 * Stars are integrated on the GPU (transform feedback); the cores' two-body orbit runs in JS with
 * the same softened gravity. The camera orbits slowly; after a couple of passages the pair is
 * replaced by a fresh one.
 *   bass  -> kicks hit the cosmic fast-forward: the encounter surges ahead, the cores flare
 *   mids  -> star brightness: every star belongs to a mid band
 *   highs -> young blue stars (star formation knots) sparkle
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const TAU = Math.PI * 2;
  const N_PER = 32000;
  const SOFT = 0.12;
  const RA = 5.5, RP = 1.1;                 // apocentre, pericentre of the cores' orbit
  const MT = 2.0;                           // total mass (G = 1)
  const A_ORB = (RA + RP) / 2;
  const PERIOD = TAU * Math.sqrt(A_ORB ** 3 / MT);

  const SIM_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aVel;
layout(location = 2) in vec4 aSeed;
uniform vec3 uG1;
uniform vec3 uG2;
uniform vec3 uV1;
uniform vec3 uV2;
uniform float uH;
uniform int uSteps;
out vec3 vPos;
out vec3 vVel;
out vec4 vSeed;
const float S2 = ${(SOFT * SOFT).toFixed(5)};
vec3 acc(vec3 x, vec3 g1, vec3 g2) {
  vec3 d1 = x - g1, d2 = x - g2;
  float r1 = dot(d1, d1) + S2, r2 = dot(d2, d2) + S2;
  return -d1 / (r1 * sqrt(r1)) - d2 / (r2 * sqrt(r2));
}
void main() {
  vec3 pos = aPos, vel = aVel;
  for (int i = 0; i < 6; i++) {
    if (i >= uSteps) break;
    // The cores move during the frame; linear extrapolation from the frame's start is plenty.
    float tt = (float(i) + 0.5) * uH;
    vec3 g1 = uG1 + uV1 * tt, g2 = uG2 + uV2 * tt;
    vel += acc(pos, g1, g2) * uH;
    pos += vel * uH;
  }
  if (!(length(pos) < 200.0) || !(length(vel) < 100.0)) { pos = vec3(150.0); vel = vec3(0.0); }
  vPos = pos; vVel = vel; vSeed = aSeed;
}`;
  const SIM_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

  const DRAW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec4 aSeed;   // galaxy (0/1), band 0..1, hash, kind (>0.88 young, <0.15 bulge)
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform mat4 uVP;
uniform float uSize;
uniform float uBright;
uniform float uFade;
out vec3 vCol;
void main() {
  vec4 c = uVP * vec4(aPos, 1.0);
  gl_Position = c;
  float young = step(0.88, aSeed.w);
  float bulge = step(aSeed.w, 0.15);
  float e = bandMid(aSeed.y);
  vec3 col = palette(mix(0.35, 0.75, aSeed.x) + 0.2 * (aSeed.z - 0.5));
  col = mix(col, palette(0.95) * 0.8 + vec3(0.15, 0.1, 0.0), bulge);
  float tw = 0.6 + 0.4 * sin(uTime * (3.0 + 9.0 * aSeed.z) + aSeed.z * 60.0);
  col = mix(col, palette(1.0) * 1.3, young) * (1.0 + young * tw * (2.5 * uHigh + 4.0 * uHighPulse));
  vCol = col * uBright * uFade * (0.6 + 1.4 * e) * (1.0 + 0.6 * bulge);
  float px = uSize * uRes.y / max(c.w, 0.1) * (0.7 + 0.8 * young + 0.4 * bulge);
  gl_PointSize = clamp(px, 1.0, 10.0);
  if (c.w <= 0.05) vCol = vec3(0.0);
}`;
  const DRAW_FS = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  fragColor = vec4(vCol * exp(-r2 * 3.0), 1.0);
}`;

  const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform vec4 uCores;      // screen uv of both cores
uniform vec2 uCoreVis;    // in front of the camera (0/1) * size
uniform float uFlare;
uniform float uFade;
void main() {
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = vUv * asp;
  vec3 col = palette(0.0) * 0.06;
  vec2 g = p * 90.0;
  vec3 h = hash33(vec3(floor(g), 5.0));
  float d = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.7);
  col += vec3(0.7, 0.75, 0.9) * step(0.93, h.z) * exp(-d * d * 1200.0) * 0.6;
  for (int i = 0; i < 2; i++) {
    vec2 c = (i == 0 ? uCores.xy : uCores.zw) * asp;
    float vis = i == 0 ? uCoreVis.x : uCoreVis.y;
    float r = length(p - c) / max(vis, 1e-3);
    col += (palette(0.95) * 0.5 + 0.5) * (exp(-r * 40.0) * 1.2 + exp(-r * 8.0) * 0.05) * (1.0 + 1.2 * uFlare) * step(1e-3, vis) * uFade;
  }
  fragColor = vec4(col, 1.0);
}`;

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  class GalaxiesScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.simProg = ctx.program(SIM_VS, SIM_FS, { label: 'galaxies-sim', varyings: ['vPos', 'vVel', 'vSeed'] });
      this.drawProg = ctx.program(DRAW_VS, DRAW_FS, { label: 'galaxies-draw' });
      this.bgProg = ctx.fsProgram(BG_FS, 'galaxies-bg');
      this.tf = gl.createTransformFeedback();
      this.count = N_PER * 2;
      this.vp = new Float32Array(16);
      this.boost = 0;
      this.fade = 0;
      this.fadeDir = 1;
      this.trig = new VIZ.KickTrigger(0.35);
      this.flare = 0;
      this._alloc();
      this._spawn();
    }

    _alloc() {
      const gl = this.gl;
      const n = this.count;
      const mk = (floats) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, floats * 4, gl.DYNAMIC_COPY); return b; };
      this.posB = [mk(n * 3), mk(n * 3)];
      this.velB = [mk(n * 3), mk(n * 3)];
      this.seedB = [mk(n * 4), mk(n * 4)];
      this.vaos = [0, 1].map((s) => {
        const v = gl.createVertexArray();
        gl.bindVertexArray(v);
        [[this.posB[s], 0, 3], [this.velB[s], 1, 3], [this.seedB[s], 2, 4]].forEach(([b, loc, sz]) => {
          gl.bindBuffer(gl.ARRAY_BUFFER, b);
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, 0, 0);
        });
        gl.bindVertexArray(null);
        return v;
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.cur = 0;
    }

    /** A fresh pair: cores near apocentre, falling in; both disks on circular orbits. */
    _spawn() {
      const gl = this.gl;
      const vA = Math.sqrt(MT * (2 / RA - 1 / A_ORB));
      // Relative orbit in the xz plane, rotated randomly about y for variety.
      const rot = Math.random() * TAU;
      const c = Math.cos(rot), s = Math.sin(rot);
      this.rel = [RA * c, 0, RA * s];
      this.relV = [-vA * s, 0, vA * c];
      // Fast-forward a little so the first passage arrives soon.
      for (let i = 0; i < 300; i++) this._stepCores(0.025);
      this.simT = 0;
      const L = cross(this.rel, this.relV);              // orbital angular momentum direction
      const Ln = norm(L);
      const tilt = (a, b) => norm([Ln[0] + a[0] * b, Ln[1] + a[1] * b, Ln[2] + a[2] * b]);
      const r1 = Math.random() - 0.5, r2 = Math.random() - 0.5;
      const normals = [tilt([0.3, 0, 0.2 + r1 * 0.4], 1), tilt([-0.6 + r2, 0.3, 0.7], 1.1)];
      const n = this.count;
      const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), seed = new Float32Array(n * 4);
      const G = this._cores();
      for (let g = 0; g < 2; g++) {
        const nz = normals[g];
        const ux = norm(cross(Math.abs(nz[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], nz));
        const uy = cross(nz, ux);
        const sign = g === 0 ? 1 : (Math.random() < 0.5 ? 1 : -1);   // second disk prograde or retrograde
        for (let k = 0; k < N_PER; k++) {
          const i = g * N_PER + k;
          const kind = Math.random();
          let r, th, z = 0;
          if (kind < 0.15) {                         // bulge
            r = 0.05 + 0.25 * Math.pow(Math.random(), 1.5);
            th = Math.random() * TAU;
            z = (Math.random() - 0.5) * r * 0.9;
          } else {                                   // disk with two logarithmic arms
            r = 0.2 + 1.3 * Math.pow(Math.random(), 0.8);
            const arm = Math.random() < 0.5 ? 0 : Math.PI;
            th = arm + Math.log(r) * 2.2 + (Math.random() - 0.5) * (0.5 + 0.6 * Math.random());
            z = (Math.random() - 0.5) * 0.04;
          }
          const ex = Math.cos(th), ey = Math.sin(th);
          const v = Math.sqrt(r * r / Math.pow(r * r + SOFT * SOFT, 1.5)) * sign;
          for (let j = 0; j < 3; j++) {
            pos[i * 3 + j] = G.p[g][j] + r * (ex * ux[j] + ey * uy[j]) + z * nz[j];
            vel[i * 3 + j] = G.v[g][j] + v * (-ey * ux[j] + ex * uy[j]);
          }
          seed[i * 4] = g;
          seed[i * 4 + 1] = Math.random();
          seed[i * 4 + 2] = Math.random();
          seed[i * 4 + 3] = kind < 0.15 ? 0.05 + Math.random() * 0.1 : 0.15 + Math.random() * 0.85;
        }
      }
      for (let s2 = 0; s2 < 2; s2++) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posB[s2]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.velB[s2]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, vel);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.seedB[s2]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, seed);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.fade = 0;
      this.fadeDir = 1;
    }

    _stepCores(h) {
      const r = this.rel, v = this.relV;
      const d2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + SOFT * SOFT;
      const k = -MT / (d2 * Math.sqrt(d2));
      for (let j = 0; j < 3; j++) v[j] += r[j] * k * h;
      for (let j = 0; j < 3; j++) r[j] += v[j] * h;
    }
    _cores() {
      // Equal masses, centre of mass at the origin.
      const r = this.rel, v = this.relV;
      return {
        p: [[r[0] / 2, r[1] / 2, r[2] / 2], [-r[0] / 2, -r[1] / 2, -r[2] / 2]],
        v: [[v[0] / 2, v[1] / 2, v[2] / 2], [-v[0] / 2, -v[1] / 2, -v[2] / 2]],
      };
    }

    resize() { /* resolution read per frame */ }

    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx, mat4 = VIZ.mat4;
      const P = u.params;
      const dt = Math.min(u.dt, 0.05);
      const k = audio.kick;
      this.boost += (k - this.boost) * (1 - Math.exp(-dt / (k > this.boost ? 0.05 : 0.7)));
      if (this.trig.update(k)) this.flare = 1;
      this.flare *= Math.exp(-dt / 0.25);

      // Fade between pairs.
      this.fade = Math.min(1, Math.max(0, this.fade + this.fadeDir * dt / 1.0));
      if (this.fadeDir < 0 && this.fade <= 0) this._spawn();
      if (this.fadeDir > 0 && this.simT > PERIOD * 1.6 * P.passages) this.fadeDir = -1;

      const total = dt * 0.55 * P.speed * (1 + 2.2 * this.boost * P.surge);
      const steps = Math.min(6, Math.max(1, Math.ceil(total / 0.02)));
      const h = total / steps;
      const G0 = this._cores();
      for (let i = 0; i < steps; i++) this._stepCores(h);
      this.simT += total;

      // Camera: slow orbit, gentle bob.
      const t = u.time;
      const az = t * 0.045, el = 0.55 + 0.3 * Math.sin(t * 0.037);
      const dist = 7.5 * P.distance * (u.width < u.height ? 1.4 : 1);
      const eye = [Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist];
      const view = mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
      const proj = mat4.perspective(45 * Math.PI / 180, u.width / Math.max(1, u.height), 0.05, 100);
      mat4.multiply(proj, view, this.vp);

      // --- simulate ---
      const src = this.cur, dst = 1 - src;
      const sp = this.simProg.use();
      sp.f3('uG1', ...G0.p[0]).f3('uG2', ...G0.p[1]).f3('uV1', ...G0.v[0]).f3('uV2', ...G0.v[1])
        .f('uH', h).i('uSteps', steps);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.bindVertexArray(this.vaos[src]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.posB[dst]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, this.velB[dst]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, this.seedB[dst]);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, this.count);
      gl.endTransformFeedback();
      for (let i = 0; i < 3; i++) gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, i, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.disable(gl.RASTERIZER_DISCARD);
      this.cur = dst;

      // --- background + core glows ---
      const G = this._cores();
      const proj2 = (p) => {
        const m = this.vp;
        const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
        const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
        const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
        return w > 0.05 ? [x / w * 0.5 + 0.5, y / w * 0.5 + 0.5, 3 / w] : [0, 0, 0];
      };
      const c1 = proj2(G.p[0]), c2 = proj2(G.p[1]);
      gl.disable(gl.DEPTH_TEST);
      const bp = this.bgProg.use();
      ctx.setCommon(bp, audio, u);
      bp.f4('uCores', c1[0], c1[1], c2[0], c2[1]).f2('uCoreVis', c1[2], c2[2]).f('uFlare', this.flare).f('uFade', this.fade);
      ctx.drawQuad();

      // --- stars ---
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const dp = this.drawProg.use();
      ctx.setCommon(dp, audio, u);
      dp.m4('uVP', this.vp).f('uSize', 0.006 * P.size).f('uBright', 0.28 * P.brightness).f('uFade', this.fade);
      gl.bindVertexArray(this.vaos[this.cur]);
      gl.drawArrays(gl.POINTS, 0, this.count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    dispose() {
      const gl = this.gl;
      [this.simProg, this.drawProg, this.bgProg].forEach((p) => p.dispose());
      this.vaos.forEach((v) => gl.deleteVertexArray(v));
      [...this.posB, ...this.velB, ...this.seedB].forEach((b) => gl.deleteBuffer(b));
      gl.deleteTransformFeedback(this.tf);
    }
  }

  VIZ.registerScene({
    id: 'galaxies',
    name: 'Galaxy Collision',
    blurb: 'Two spiral galaxies fly through each other and tear out tidal tails. Kicks fast-forward the encounter; young stars sparkle with the highs.',
    params: [
      { key: 'speed', label: 'Encounter speed', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'surge', label: 'Fast-forward on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'brightness', label: 'Star brightness', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'size', label: 'Star size', min: 0.4, max: 2.5, step: 0.05, value: 1 },
      { key: 'distance', label: 'Camera distance', min: 0.6, max: 1.6, step: 0.05, value: 1 },
      { key: 'passages', label: 'Passages before a new pair', min: 0.5, max: 3, step: 0.1, value: 1, fmt: (v) => (v * 1.6).toFixed(1) },
    ],
    create: (ctx) => new GalaxiesScene(ctx),
  });
})();

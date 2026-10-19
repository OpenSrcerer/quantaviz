/* lorenz.js — Lorenz Attractor.
 * Edward Lorenz's 1963 weather model: three coupled equations
 *     x' = sigma (y - x),   y' = x (rho - z) - y,   z' = x y - beta z
 * whose solutions never settle and never repeat, looping forever around two wings — the
 * "butterfly". Three tracers start a hair's breadth apart and, being chaotic, soon go their own
 * ways (the butterfly effect); every so often two of them are dropped back next to the first so
 * you can watch them diverge again. Each draws a glowing ribbon; the camera orbits.
 *   bass  -> kicks push rho up: the attractor swells and the tracers race
 *   mids  -> the ribbon is painted with the mids as it is drawn, so the trail is a history of
 *            the music (bright where the mids were loud)
 *   highs -> each high onset nudges the tracers (tiny perturbations, big consequences)
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NT = 3;
  const NP = 2600;          // points per trail
  const H = 0.005;

  const SEG_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aA;      // x, y, z, energy
layout(location = 1) in vec4 aB;
${VIZ.glsl.common}
uniform mat4 uVP;
uniform float uWidth;
uniform float uN;
uniform float uBase;     // instance index offset
out float vSide;
out float vAge;
out float vE;
void main() {
  int corner = gl_VertexID;
  vec4 c0 = uVP * vec4(aA.x, aA.z - 25.0, aA.y, 1.0);
  vec4 c1 = uVP * vec4(aB.x, aB.z - 25.0, aB.y, 1.0);
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * asp;
  float l = length(d);
  d = l > 1e-6 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x) / asp;
  vec4 pos = (corner < 2) ? c0 : c1;
  float side = (corner == 0 || corner == 2) ? -1.0 : 1.0;
  float age = (float(gl_InstanceID) + uBase) / uN;          // 0 oldest .. 1 newest
  float e = (corner < 2) ? aA.w : aB.w;
  float w = uWidth * (0.6 + 1.6 * e) * (0.4 + 0.6 * age);
  pos.xy += n * side * w * 2.0 / uRes.y * pos.w;
  gl_Position = pos;
  vSide = side; vAge = age; vE = e;
}`;
  const SEG_FS = `#version 300 es
precision highp float;
in float vSide;
in float vAge;
in float vE;
out vec4 fragColor;
${VIZ.glsl.common}
uniform float uTint;
uniform float uBright;
void main() {
  float a = exp(-vSide * vSide * 2.5);
  vec3 col = palette(uTint + 0.25 * vE) * (0.25 + 2.2 * vE);
  col += vec3(1.0) * pow(vAge, 30.0) * 1.5;
  fragColor = vec4(col * a * pow(vAge, 1.6) * uBright, 1.0);
}`;
  const HEAD_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aA;
${VIZ.glsl.common}
uniform mat4 uVP;
uniform float uSize;
void main() {
  vec4 c = uVP * vec4(aA.x, aA.z - 25.0, aA.y, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(uSize * uRes.y / c.w, 2.0, 40.0);
}`;
  const HEAD_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
${VIZ.glsl.common}
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  fragColor = vec4((palette(1.0) + 0.5) * (exp(-r2 * 8.0) * 2.0 + exp(-r2 * 2.0) * 0.3) * (1.0 + 2.0 * uHighPulse), 1.0);
}`;

  class LorenzScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.segProg = ctx.program(SEG_VS, SEG_FS, { label: 'lorenz-seg' });
      this.headProg = ctx.program(HEAD_VS, HEAD_FS, { label: 'lorenz-head' });
      this.vp = new Float32Array(16);
      this.trails = [];
      const base = [1, 1, 20];
      for (let t = 0; t < NT; t++) {
        this.trails.push({ s: [base[0] + t * 1e-3, base[1], base[2]], ring: new Float32Array(NP * 4), head: 0, n: 0 });
      }
      this.lin = new Float32Array(NP * 4);
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, NP * 4 * 4 * NT, gl.DYNAMIC_DRAW);
      this.headBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.headBuf);
      gl.bufferData(gl.ARRAY_BUFFER, NT * 16, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.vao = gl.createVertexArray();
      this.headVao = gl.createVertexArray();
      gl.bindVertexArray(this.headVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.headBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.boost = 0;
      this.acc = 0;
      this.reseedT = 0;
      // Warm up so the first frame already shows wings.
      for (let i = 0; i < 6000; i++) this._step(28, 0.3);
    }
    _deriv(s, rho) {
      return [10 * (s[1] - s[0]), s[0] * (rho - s[2]) - s[1], s[0] * s[1] - (8 / 3) * s[2]];
    }
    _step(rho, e) {
      for (const tr of this.trails) {
        const s = tr.s;
        const k1 = this._deriv(s, rho);
        const s2 = s.map((v, i) => v + k1[i] * H / 2);
        const k2 = this._deriv(s2, rho);
        const s3 = s.map((v, i) => v + k2[i] * H / 2);
        const k3 = this._deriv(s3, rho);
        const s4 = s.map((v, i) => v + k3[i] * H);
        const k4 = this._deriv(s4, rho);
        for (let i = 0; i < 3; i++) s[i] += (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * H / 6;
        const o = tr.head * 4;
        tr.ring[o] = s[0]; tr.ring[o + 1] = s[1]; tr.ring[o + 2] = s[2]; tr.ring[o + 3] = e;
        tr.head = (tr.head + 1) % NP;
        tr.n = Math.min(NP, tr.n + 1);
      }
    }
    resize() { /* resolution read per frame */ }
    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx, mat4 = VIZ.mat4;
      const P = u.params;
      const dt = Math.min(u.dt, 0.05);
      const k = audio.kick;
      this.boost += (k - this.boost) * (1 - Math.exp(-dt / (k > this.boost ? 0.04 : 0.6)));
      const rho = 28 + 12 * this.boost * P.chaos;
      // Integrate: ~170 steps of H per second, faster on kicks.
      this.acc += dt * 170 * P.speed * (1 + 1.2 * this.boost);
      let n = Math.min(40, Math.floor(this.acc));
      this.acc -= n;
      const e = Math.min(1, audio.mid * 1.1 + audio.midPulse * 0.4);
      while (n-- > 0) this._step(rho, e);
      // Highs: tiny perturbations.
      if (audio.highOnset) {
        for (let t = 1; t < NT; t++) for (let i = 0; i < 3; i++) this.trails[t].s[i] += (Math.random() - 0.5) * 0.08 * audio.highPulse * P.nudge;
      }
      // Every ~35 s drop two tracers back beside the first so the divergence plays again.
      this.reseedT += dt;
      if (this.reseedT > 35) {
        this.reseedT = 0;
        const s0 = this.trails[0].s;
        for (let t = 1; t < NT; t++) this.trails[t].s = [s0[0] + t * 1e-3, s0[1], s0[2]];
      }

      // Camera: orbit the attractor's actual centre (world = (x, z - 25, y)) and keep it framed.
      // Centroid and extent come from a sparse sample of the trails, eased so the view glides.
      let cx = 0, cy = 0, cz = 0, cnt = 0;
      for (const tr of this.trails) {
        for (let i = 0; i < tr.n; i += 25) { const o = i * 4; cx += tr.ring[o]; cy += tr.ring[o + 2] - 25; cz += tr.ring[o + 1]; cnt++; }
      }
      cx /= cnt; cy /= cnt; cz /= cnt;
      let ext = 0;
      for (const tr of this.trails) {
        for (let i = 0; i < tr.n; i += 25) {
          const o = i * 4;
          ext = Math.max(ext, Math.hypot(tr.ring[o] - cx, tr.ring[o + 2] - 25 - cy, tr.ring[o + 1] - cz));
        }
      }
      if (!this.camC) { this.camC = [cx, cy, cz]; this.camE = ext; }
      const ease = 1 - Math.exp(-dt / 3);
      this.camC[0] += (cx - this.camC[0]) * ease;
      this.camC[1] += (cy - this.camC[1]) * ease;
      this.camC[2] += (cz - this.camC[2]) * ease;
      this.camE += (ext - this.camE) * ease;
      const t = u.time;
      const az = t * 0.07, el = 0.25 + 0.2 * Math.sin(t * 0.05);
      const fov = 45 * Math.PI / 180;
      const fit = this.camE / Math.tan(fov / 2) / Math.min(1, u.width / u.height);
      const dist = fit * 1.05 * P.distance;
      const C = this.camC;
      const eye = [C[0] + Math.sin(az) * Math.cos(el) * dist, C[1] + Math.sin(el) * dist, C[2] + Math.cos(az) * Math.cos(el) * dist];
      const view = mat4.lookAt(eye, C, [0, 1, 0]);
      const proj = mat4.perspective(fov, u.width / Math.max(1, u.height), 0.5, 600);
      mat4.multiply(proj, view, this.vp);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const sp = this.segProg.use();
      ctx.setCommon(sp, audio, u);
      sp.m4('uVP', this.vp).f('uWidth', 1.3 * P.width).f('uBright', 0.5 * P.brightness);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      const heads = new Float32Array(NT * 4);
      this.trails.forEach((tr, ti) => {
        // Unroll the ring oldest -> newest.
        const cnt = tr.n;
        const start = (tr.head - cnt + NP) % NP;
        const first = Math.min(cnt, NP - start);
        this.lin.set(tr.ring.subarray(start * 4, (start + first) * 4), 0);
        if (first < cnt) this.lin.set(tr.ring.subarray(0, (cnt - first) * 4), first * 4);
        const off = ti * NP * 16;
        gl.bufferSubData(gl.ARRAY_BUFFER, off, this.lin, 0, cnt * 4);
        heads.set(this.lin.subarray((cnt - 1) * 4, cnt * 4), ti * 4);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, off);
        gl.vertexAttribDivisor(0, 1);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, off + 16);
        gl.vertexAttribDivisor(1, 1);
        sp.f('uTint', [0.35, 0.6, 0.85][ti]).f('uN', cnt).f('uBase', 0);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cnt - 1);
      });
      gl.vertexAttribDivisor(0, 0);
      gl.vertexAttribDivisor(1, 0);
      gl.bindVertexArray(null);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.headBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, heads);
      const hp = this.headProg.use();
      ctx.setCommon(hp, audio, u);
      hp.m4('uVP', this.vp).f('uSize', 0.9);
      gl.bindVertexArray(this.headVao);
      gl.drawArrays(gl.POINTS, 0, NT);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.BLEND);
    }
    dispose() {
      const gl = this.gl;
      this.segProg.dispose(); this.headProg.dispose();
      gl.deleteBuffer(this.buf); gl.deleteBuffer(this.headBuf);
      gl.deleteVertexArray(this.vao); gl.deleteVertexArray(this.headVao);
    }
  }

  VIZ.registerScene({
    id: 'lorenz',
    name: 'Lorenz Attractor',
    blurb: 'Three chaotic tracers draw the Lorenz butterfly, painted with the mids as they go. Kicks push the system wilder; highs nudge them apart.',
    params: [
      { key: 'speed', label: 'Tracer speed', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'chaos', label: 'Rho push on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'nudge', label: 'Nudge on highs', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'width', label: 'Ribbon width', min: 0.4, max: 3, step: 0.05, value: 1 },
      { key: 'brightness', label: 'Brightness', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'distance', label: 'Camera distance', min: 0.6, max: 1.6, step: 0.05, value: 1 },
    ],
    create: (ctx) => new LorenzScene(ctx),
  });
})();

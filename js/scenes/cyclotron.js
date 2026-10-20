/* cyclotron.js — Cyclotron.
 * Lawrence's 1932 trick, seen from above: two hollow copper "dees" between the poles of a big
 * magnet, with a radio-frequency voltage across the gap between them. A charged particle
 * circles in the magnetic field; every time it crosses the gap the voltage has flipped to push
 * it forward, so it gains energy, its orbit widens, and it spirals outward. The beautiful part
 * is that the orbit period doesn't depend on the radius (f = qB / 2 pi m), so one fixed radio
 * frequency keeps every particle in step all the way out. At the rim a deflector peels them off
 * down a beam pipe onto a target; the gauge reads the beam energy.
 *   bass  -> the RF voltage across the gap: louder bass and every kick give each crossing more
 *            energy, so the particles spiral out faster
 *   mids  -> the particles' and the gap's glow
 *   highs -> sparks at the target and flicker in the ion source
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NP = 40;
  const AW = 1280, AH = 800, AX = 0.8, AY = 0.5;    // trail buffer covers p in [-AX, AX] x [-AY, AY]
  const TAU = Math.PI * 2;

  const SEG_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSeg;    // previous x, y, current x, y
layout(location = 1) in float aI;
uniform float uW;
out float vSide;
out float vI;
void main() {
  int corner = gl_VertexID;
  vec2 a = aSeg.xy, b = aSeg.zw;
  vec2 d = b - a;
  float L = length(d);
  vec2 t = L > 1e-6 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  float side = (corner == 0 || corner == 2) ? -1.0 : 1.0;
  vec2 p = (corner < 2 ? a - t * uW : b + t * uW) + n * uW * side;
  gl_Position = vec4(p.x / ${AX.toFixed(2)}, p.y / ${AY.toFixed(2)}, 0.0, 1.0);
  vSide = side;
  vI = aI;
}`;
  const SEG_FS = `#version 300 es
precision highp float;
in float vSide;
in float vI;
out vec4 fragColor;
void main() { fragColor = vec4(vec3(exp(-vSide * vSide * 2.5) * vI), 1.0); }`;
  const FADE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPrev;
uniform float uDecay;
void main() { fragColor = vec4(texture(uPrev, vUv).rgb * uDecay, 1.0); }`;

  const FINAL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform sampler2D uAcc;
uniform vec2 uC;
uniform float uR;
uniform float uGap;
uniform float uRf;        // RF phase
uniform float uV;         // RF voltage, 0..~2
uniform vec4 uPipe;       // exit point, target
uniform float uFlash;
uniform float uNeedle;    // 0..1 of full scale
uniform vec2 uGauge;      // gauge centre
const float PI = 3.14159265;

float sdBox(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
float segDist(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  vec2 d = p - uC;
  float r = length(d);
  // The lab bench and the magnet's pole piece.
  vec3 col = vec3(0.07, 0.075, 0.08) + 0.02 * noise2(p * 300.0);
  float pole = 1.0 - smoothstep(uR + 0.07, uR + 0.07 + px, r);
  float brushed = 0.5 + 0.5 * noise2(vec2(atan(d.y, d.x) * 40.0, r * 4.0));
  col = mix(col, vec3(0.1, 0.105, 0.115) * (0.8 + 0.25 * brushed) * (1.0 - 0.3 * r / uR), pole);
  col *= 1.0 - 0.5 * exp(-abs(r - uR - 0.07) / 0.006) * step(uR + 0.07, r);

  // The dees: translucent copper half-discs either side of the gap, bright rims.
  float inDisc = 1.0 - smoothstep(uR - px, uR + px, r);
  float inGap = 1.0 - smoothstep(uGap - px, uGap + px, abs(d.x));
  float dee = inDisc * (1.0 - inGap);
  vec3 copper = mix(vec3(0.3, 0.13, 0.05), palette(0.8) * 0.3, 0.1);
  float bevel = exp(-(uR - r) / 0.01) + exp(-(abs(d.x) - uGap) / 0.008);
  float sheen = pow(max(0.0, 1.0 - abs(d.x + d.y * 0.6 - 0.05) / 0.12), 3.0);   // a soft highlight across the lids
  col = mix(col, col * 0.25 + copper * (0.18 + 0.12 * (d.y / uR + 1.0) * 0.5 + 0.35 * sheen), dee * 0.9);
  col += copper * bevel * dee * 0.5;

  // The gap: the RF field flips twice per orbit; chevrons show its direction.
  float field = sin(uRf);
  float gapGlow = inGap * inDisc * abs(field) * (0.08 + 0.2 * uV) * (0.5 + 0.8 * uMid);
  col += palette(0.55) * gapGlow;
  float chev = abs(fract(d.y * 22.0) - 0.5);
  float arrow = 1.0 - smoothstep(0.004, 0.0055, abs(abs(chev - 0.25) * 0.05 - (d.x * sign(field)) * 0.5 - 0.004));
  col += palette(0.9) * arrow * inGap * inDisc * abs(field) * 0.3;

  // Trails from the persistence buffer.
  vec2 auv = vec2(p.x / ${AX.toFixed(2)}, p.y / ${AY.toFixed(2)}) * 0.5 + 0.5;
  vec3 tr = texture(uAcc, auv).rgb;
  vec3 beamCol = mix(palette(0.95), vec3(0.75, 0.9, 1.0), 0.4);
  col += beamCol * (1.0 - exp(-tr * 1.3)) * 1.6;

  // Ion source at the centre.
  col += vec3(1.0, 0.85, 0.6) * exp(-r / 0.006) * (0.8 + 0.6 * uHigh * noise2(vec2(uTime * 30.0, 0.0)));

  // The beam pipe and the target (a Faraday cup).
  float pd = segDist(p, uPipe.xy, uPipe.zw);
  col = mix(col, vec3(0.3, 0.31, 0.33), (1.0 - smoothstep(0.006, 0.0075, pd)) * (1.0 - inDisc));
  col += vec3(0.6) * exp(-pow((pd - 0.0068) / px, 2.0)) * 0.2 * (1.0 - inDisc);
  vec2 tp = p - uPipe.zw;
  float tgt = sdBox(tp, vec2(0.022, 0.03));
  col = mix(col, vec3(0.42, 0.4, 0.36), 1.0 - smoothstep(0.0, px * 1.5, tgt));
  col += mix(beamCol, vec3(1.0), 0.5) * exp(-length(tp) / 0.025) * uFlash * 1.5;
  col += vec3(1.0, 0.9, 0.7) * pow(noise2(tp * 400.0 + uTime * 20.0), 18.0) * exp(-length(tp) / 0.04) * (0.5 * uHigh + 2.0 * uHighPulse) * 6.0;

  // The analog gauge: beam energy.
  vec2 g = p - uGauge;
  float gr = length(g);
  float face = 1.0 - smoothstep(0.075, 0.075 + px, gr);
  col = mix(col, vec3(0.9, 0.88, 0.8), face);
  col = mix(col, vec3(0.15), (1.0 - smoothstep(0.0, px * 1.5, abs(gr - 0.075))) * 0.8);
  if (face > 0.0) {
    float ang = atan(g.x, g.y);                       // 0 straight up
    float span = 2.1;                                 // +-120 degrees
    float tk = abs(fract((ang / span * 0.5 + 0.5) * 10.0 + 0.5) - 0.5);
    float tickZone = step(abs(ang), span) * smoothstep(0.052, 0.056, gr) * (1.0 - smoothstep(0.066, 0.068, gr));
    col = mix(col, vec3(0.1), (1.0 - smoothstep(0.03, 0.06, tk)) * tickZone);
    float red = step(span * 0.6, ang) * step(ang, span) * smoothstep(0.06, 0.062, gr) * (1.0 - smoothstep(0.066, 0.068, gr));
    col = mix(col, vec3(0.75, 0.15, 0.1), red);
    float na = (uNeedle * 2.0 - 1.0) * span;
    vec2 nd = vec2(sin(na), cos(na));
    float needle = segDist(g, -nd * 0.012, nd * 0.064);
    col = mix(col, vec3(0.7, 0.1, 0.08), 1.0 - smoothstep(px * 0.8, px * 1.8, needle));
    col = mix(col, vec3(0.1), 1.0 - smoothstep(0.006, 0.007, gr));
  }
  // An RF voltage bar under the gauge.
  vec2 bp = p - (uGauge + vec2(-0.075, -0.1));
  if (bp.x > 0.0 && bp.x < 0.15 && abs(bp.y) < 0.008) {
    float seg = floor(bp.x / 0.15 * 12.0);
    float lit = step(seg, uV / 2.0 * 12.0) * step(0.15, fract(bp.x / 0.15 * 12.0));
    vec3 lc = seg < 8.0 ? vec3(0.3, 1.0, 0.35) : seg < 10.0 ? vec3(1.0, 0.8, 0.2) : vec3(1.0, 0.25, 0.15);
    col = mix(col, mix(lc * 0.12, lc, lit), step(0.15, fract(bp.x / 0.15 * 12.0)));
  }
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class CyclotronScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.segProg = ctx.program(SEG_VS, SEG_FS, { label: 'cyclotron-trails' });
      this.fadeProg = ctx.fsProgram(FADE, 'cyclotron-fade');
      this.finalProg = ctx.fsProgram(FINAL, 'cyclotron');
      this.acc = [0, 1].map(() => ctx.createTarget(AW, AH, { hdr: true }));
      for (const t of this.acc) { t.bind(); t.clear(0, 0, 0, 1); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.cur = 0;
      this.seg = new Float32Array(NP * 4);
      this.inten = new Float32Array(NP);
      this.segBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.seg.byteLength, gl.DYNAMIC_DRAW);
      this.iBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.iBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.inten.byteLength, gl.DYNAMIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.iBuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.parts = [];
      this.injectT = 0;
      this.rf = 0;
      this.boost = 0;
      this.flash = 0;
      this.needle = 0;
      this.needleV = 0;
      this.lastE = 0;
    }
    resize() { /* fixed-size trail buffer */ }
    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const k = audio.kick;
      this.boost += (k - this.boost) * (1 - Math.exp(-dt / (k > this.boost ? 0.02 : 0.3)));
      const C = [-0.1, 0.02], R = 0.36, RX = 0.335;
      const omega = TAU * 1.6 * P.speed;                      // the cyclotron frequency: same at every radius
      const V = Math.min(2, (0.45 + 0.9 * audio.bass + 1.6 * this.boost) * P.voltage);
      this.rf += omega * dt;
      // Exit: the deflector at the rim on the right, a straight pipe up and out to the target.
      const E = [C[0] + RX, C[1]];
      const T = [C[0] + R + 0.2, C[1] + 0.36];
      const pipeL = Math.hypot(T[0] - E[0], T[1] - E[1]);
      const pdir = [(T[0] - E[0]) / pipeL, (T[1] - E[1]) / pipeL];

      // Inject from the ion source.
      this.injectT += dt * (0.8 + 1.6 * audio.level) * P.current;
      while (this.injectT >= 1 && this.parts.length < NP) {
        this.injectT -= 1;
        this.parts.push({ th: Math.random() * TAU, r: 0.012, s: -1, prev: null, e: 0 });
      }
      this.injectT = Math.min(this.injectT, 1);

      let maxR2 = 0;
      let n = 0;
      for (const q of this.parts) {
        const before = q.s < 0 ? [C[0] + Math.cos(q.th) * q.r, C[1] + Math.sin(q.th) * q.r] : [E[0] + pdir[0] * q.s, E[1] + pdir[1] * q.s];
        if (q.s < 0) {
          // Orbit; at each gap crossing (the vertical line through the centre) gain energy.
          const th0 = q.th;
          q.th += omega * dt;
          const crossings = Math.floor((q.th - Math.PI / 2) / Math.PI) - Math.floor((th0 - Math.PI / 2) / Math.PI);
          for (let c = 0; c < crossings; c++) q.r = Math.sqrt(q.r * q.r + 0.0035 * V);
          // Extract once wide enough, as it passes the deflector.
          const wrapped = Math.floor(q.th / TAU) !== Math.floor(th0 / TAU);
          if (q.r >= RX && wrapped) { q.s = 0; q.r = RX; q.e = q.r * q.r; }
        } else {
          q.s += omega * RX * dt;
          if (q.s >= pipeL) { q.dead = true; this.flash = 1; this.lastE = q.e; }
        }
        maxR2 = Math.max(maxR2, q.s < 0 ? q.r * q.r : RX * RX);
        const now = q.s < 0 ? [C[0] + Math.cos(q.th) * q.r, C[1] + Math.sin(q.th) * q.r] : [E[0] + pdir[0] * Math.min(q.s, pipeL), E[1] + pdir[1] * Math.min(q.s, pipeL)];
        if (n < NP) {
          this.seg.set([before[0], before[1], now[0], now[1]], n * 4);
          // Light per second, not per frame, so the trails look the same at 60 and 144 Hz.
          this.inten[n] = (0.35 + 0.9 * audio.mid) * (0.5 + 0.5 * Math.min(1, q.r / RX)) * P.glow * dt * 60;
          n++;
        }
      }
      this.parts = this.parts.filter((q) => !q.dead);
      this.flash *= Math.exp(-dt / 0.15);
      // The gauge needle: a little spring, so it swings like a real meter.
      const goal = Math.min(1, Math.max(maxR2, this.lastE * this.flash) / (RX * RX));
      this.needleV += (60 * (goal - this.needle) - 9 * this.needleV) * dt;
      this.needle = Math.max(0, Math.min(1.05, this.needle + this.needleV * dt));

      gl.disable(gl.DEPTH_TEST);
      const src = this.acc[this.cur], dst = this.acc[1 - this.cur];
      dst.bind();
      gl.disable(gl.BLEND);
      this.fadeProg.use().tex('uPrev', src.tex).f('uDecay', Math.exp(-dt / (0.3 * P.trails)));
      ctx.drawQuad();
      if (n) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.seg, 0, n * 4);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inten, 0, n);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this.segProg.use().f('uW', 0.0042);
        gl.bindVertexArray(this.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      }
      this.cur = 1 - this.cur;

      target.bind();
      const asp = u.width / u.height;
      const gauge = [Math.min(0.5 * asp - 0.11, C[0] + R + 0.3), -0.3];
      const fp = this.finalProg.use();
      ctx.setCommon(fp, audio, u);
      fp.tex('uAcc', this.acc[this.cur].tex)
        .f2('uC', C[0], C[1]).f('uR', R).f('uGap', 0.012)
        .f('uRf', this.rf).f('uV', V)
        .f4('uPipe', E[0], E[1], T[0], T[1])
        .f('uFlash', this.flash).f('uNeedle', this.needle).f2('uGauge', gauge[0], gauge[1]);
      ctx.drawQuad();
    }
    dispose() {
      const gl = this.gl;
      [this.segProg, this.fadeProg, this.finalProg].forEach((p) => p.dispose());
      this.acc.forEach((t) => t.dispose());
      gl.deleteBuffer(this.segBuf); gl.deleteBuffer(this.iBuf);
      gl.deleteVertexArray(this.vao);
    }
  }

  VIZ.registerScene({
    id: 'cyclotron',
    name: 'Cyclotron',
    blurb: 'Particles spiral outward between the dees, pushed at every gap crossing by an RF voltage that follows the bass. At the rim they shoot down the beam pipe onto the target.',
    params: [
      { key: 'voltage', label: 'RF voltage (bass drive)', min: 0.2, max: 2, step: 0.05, value: 1 },
      { key: 'speed', label: 'Cyclotron frequency', min: 0.3, max: 2, step: 0.05, value: 1 },
      { key: 'current', label: 'Beam current', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'trails', label: 'Trail length', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'glow', label: 'Beam brightness', min: 0.3, max: 3, step: 0.05, value: 1 },
    ],
    create: (ctx) => new CyclotronScene(ctx),
  });
})();

/* scope.js — Oscilloscope.
 * A bench oscilloscope with a green P31 phosphor screen, drawing the actual audio waveform.
 * Two modes, and an auto mode that switches between them now and then:
 *   XY    - the waveform against a delayed copy of itself (x = s(t), y = s(t - tau)): a delay
 *           embedding, the trick Takens used to rebuild an attractor from one signal. Pure tones
 *           make ellipses, chords make Lissajous knots, noise makes fur.
 *   sweep - the classic time trace, triggered on a rising zero crossing so it stands still.
 * Rather than flash a new figure every frame, it captures a stretch of the waveform and a slow
 * writing head draws it out over ~0.6 s (a kick starts a fresh pass), into a persistence buffer
 * that fades like phosphor. Like a real CRT the trace is brightest where the beam moves slowly.
 *   bass  -> kicks punch the beam brighter and the trace swells; the timebase breathes
 *   mids  -> beam focus and brightness
 *   highs -> shot-noise jitter on the beam, the graticule glows
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const N = 512;          // audio.wave length
  const ACC = 1024;

  const SEG_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aA;
layout(location = 1) in vec2 aB;
uniform float uWidth;    // in screen units of the square (0..1 across)
uniform float uBeam;
out float vSide;
out float vI;
void main() {
  int corner = gl_VertexID;
  vec2 d = aB - aA;
  float L = length(d);
  vec2 t = L > 1e-6 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  float side = (corner == 0 || corner == 2) ? -1.0 : 1.0;
  vec2 p = (corner < 2 ? aA - t * uWidth : aB + t * uWidth) + n * uWidth * side;
  gl_Position = vec4(p * 2.0, 0.0, 1.0);
  vSide = side;
  // A CRT spends more time per unit length where the beam is slow: brighter there.
  vI = uBeam * min(1.0, 0.0035 / (L + 0.0004));
}`;
  const SEG_FS = `#version 300 es
precision highp float;
in float vSide;
in float vI;
out vec4 fragColor;
void main() {
  float a = exp(-vSide * vSide * 3.0);
  fragColor = vec4(vec3(a * vI), 1.0);
}`;
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
uniform float uSize;
uniform vec3 uPhos;
uniform float uMode;     // 0 XY .. 1 sweep (eased)
uniform vec2 uHead;      // the beam spot, in screen coordinates (-0.5..0.5)
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  // The instrument: a dark bezel around a slightly curved screen.
  vec3 col = mix(vec3(0.09, 0.095, 0.085), vec3(0.05), smoothstep(-0.5, 0.5, p.y));
  float half_ = uSize * 0.5;
  float bez = sdBox(p, vec2(half_ + 0.035), 0.03);
  col = mix(col, vec3(0.16, 0.165, 0.15) + 0.03 * (p.y + 0.5), 1.0 - smoothstep(0.0, px * 1.5, bez));
  col *= 1.0 - 0.5 * exp(-abs(bez) / 0.004) * step(0.0, bez);
  float scr = sdBox(p, vec2(half_), 0.025);
  if (scr < 0.0) {
    vec2 q = p / uSize;                                   // -0.5..0.5 across the screen
    q *= 1.0 + 0.08 * dot(q, q);                          // tube curvature
    vec2 uv = q + 0.5;
    vec3 glass = vec3(0.012, 0.025, 0.016);
    // Graticule: 10 x 8 divisions, finer ticks on the centre lines.
    vec2 g = q * vec2(10.0, 10.0);
    vec2 gf = abs(fract(g) - 0.5);
    float grid = 1.0 - smoothstep(0.0, 0.02 + px * 6.0, min(gf.x, gf.y));
    vec2 tk = abs(fract(q * 50.0) - 0.5);
    float ticks = (1.0 - smoothstep(0.0, 0.06, tk.x)) * step(abs(q.y), 0.008) + (1.0 - smoothstep(0.0, 0.06, tk.y)) * step(abs(q.x), 0.008);
    vec3 trace = texture(uAcc, uv).rgb;
    float e = trace.r;
    vec3 beam = uPhos * (1.0 - exp(-e * 1.4)) * 2.0 + vec3(0.9, 1.0, 0.9) * pow(max(e - 1.2, 0.0), 1.5) * 0.4;
    col = glass + uPhos * (grid + ticks) * (0.05 + 0.08 * uHigh) + beam;
    float hd = length(q - uHead);
    col += mix(uPhos, vec3(1.0), 0.6) * (exp(-hd * hd / 0.00002) * 1.6 + exp(-hd / 0.02) * 0.12);
    // Glass reflection and edge darkening.
    col += vec3(0.04) * exp(-pow((q.x + q.y - 0.5) / 0.12, 2.0)) * 0.6;
    col *= 1.0 - 0.6 * smoothstep(0.32, 0.5, max(abs(q.x), abs(q.y)));
  }
  // Mode LEDs under the screen.
  for (int i = 0; i < 2; i++) {
    vec2 lp = vec2((float(i) - 0.5) * 0.06, -half_ - 0.018);
    float on = i == 0 ? 1.0 - uMode : uMode;
    float d = length(p - lp);
    col += mix(vec3(0.05, 0.02, 0.0), vec3(1.0, 0.65, 0.15), on) * (1.0 - smoothstep(0.004, 0.0055, d)) + vec3(1.0, 0.6, 0.1) * on * exp(-d / 0.008) * 0.25;
  }
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class ScopeScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.segProg = ctx.program(SEG_VS, SEG_FS, { label: 'scope-beam' });
      this.fadeProg = ctx.fsProgram(FADE, 'scope-fade');
      this.finalProg = ctx.fsProgram(FINAL, 'scope');
      this.acc = [0, 1].map(() => ctx.createTarget(ACC, ACC, { hdr: true }));
      for (const t of this.acc) { t.bind(); t.clear(0, 0, 0, 1); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.cur = 0;
      this.pts = new Float32Array(N * 2);
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, this.pts.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.vao = gl.createVertexArray();
      this.gain = 2.5;
      this.boost = 0;
      this.mode = 0;            // eased 0 XY .. 1 sweep
      this.modeGoal = 0;
      this.modeT = 0;
      this.kicks = 0;
      this.trig = new VIZ.KickTrigger(0.35);
    }
    resize() { /* fixed-size persistence buffer */ }
    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      // A scope's input bandwidth: a zero-phase low-pass (forward + backward one-pole) so hats
      // and saw edges don't turn the figures into fur.
      const raw = audio.wave;
      const w = this.lp || (this.lp = new Float32Array(N));
      const al = Math.max(0.03, Math.min(1, P.bandwidth * 0.16));
      let y = raw[0];
      for (let i = 0; i < N; i++) { y += (raw[i] - y) * al; w[i] = y; }
      for (let i = N - 1; i >= 0; i--) { y += (w[i] - y) * al; w[i] = y; }
      const k = audio.kick;
      this.boost += (k - this.boost) * (1 - Math.exp(-dt / (k > this.boost ? 0.02 : 0.25)));
      // Auto mode: swap between XY and sweep every 24 kicks (or 30 s).
      this.modeT += dt;
      const hitNow = this.trig.update(k);
      if (hitNow) this.kicks++;
      if (P.mode < 0.5) this.modeGoal = 0;
      else if (P.mode > 1.5) this.modeGoal = 1;
      else if (this.kicks >= 24 || this.modeT > 30) { this.kicks = 0; this.modeT = 0; this.modeGoal = 1 - this.modeGoal; }
      this.mode += (this.modeGoal - this.mode) * (1 - Math.exp(-dt / 0.6));
      const sweep = this.mode > 0.5;
      // Auto-gain: keep the trace a comfortable size whatever the level.
      let pk = 0;
      for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(w[i]));
      const want = 0.38 / Math.max(pk, 0.05);
      this.gain += (Math.min(want, 8) - this.gain) * (1 - Math.exp(-dt / 0.8));
      const g = this.gain * P.gain * (1 + 0.35 * this.boost);
      const jit = (0.002 + 0.006 * audio.high + 0.01 * audio.highPulse) * P.noise;
      // A slow writing head: capture a stretch of waveform, then let the beam draw it out over
      // ~0.6 s instead of flashing a whole new figure every frame. A kick past the halfway mark
      // starts a fresh pass, so the drawing keeps time with the music.
      if (!this.snapN || this.head >= this.snapN - 1 || (hitNow && this.head > this.snapN * 0.5)) {
        const pts = this.pts;
        let count;
        if (!sweep) {
          // Delay embedding; tau drifts slowly so the figures morph.
          const tau = Math.max(1, P.delay * (10 + 6 * Math.sin(u.time * 0.11)));
          const ti = Math.floor(tau), tf = tau - ti;
          count = N - ti - 1;
          const c = Math.cos(Math.PI / 4), sn = Math.sin(Math.PI / 4);
          for (let i = 0; i < count; i++) {
            const x = w[i];
            const y = w[i + ti] * (1 - tf) + w[i + ti + 1] * tf;
            // Rotated 45 degrees, as a vectorscope shows it: a near-mono signal stands upright.
            pts[i * 2] = (c * x - sn * y) * g + (Math.random() - 0.5) * jit;
            pts[i * 2 + 1] = (sn * x + c * y) * g + (Math.random() - 0.5) * jit;
          }
        } else {
          // Triggered sweep: start at the first rising zero crossing so the trace holds still.
          let t0 = 0;
          for (let i = 1; i < N / 2; i++) if (w[i - 1] < 0 && w[i] >= 0) { t0 = i; break; }
          count = Math.min(N - t0, 300);
          for (let i = 0; i < count; i++) {
            pts[i * 2] = -0.46 + 0.92 * (i / (count - 1));
            pts[i * 2 + 1] = w[t0 + i] * g * 0.9 + (Math.random() - 0.5) * jit;
          }
        }
        this.snapN = count;
        this.head = 0;
      }
      const h0 = Math.floor(this.head);
      this.head = Math.min(this.snapN - 1, this.head + dt * this.snapN / (0.6 / P.speed));
      const h1 = Math.max(h0 + 1, Math.floor(this.head));
      const segs = Math.min(h1, this.snapN - 1) - h0;
      const hx = this.pts[Math.min(h1, this.snapN - 1) * 2], hy = this.pts[Math.min(h1, this.snapN - 1) * 2 + 1];

      gl.disable(gl.DEPTH_TEST);
      // --- phosphor: fade, then this frame's beam ---
      const src = this.acc[this.cur], dst = this.acc[1 - this.cur];
      dst.bind();
      gl.disable(gl.BLEND);
      this.fadeProg.use().tex('uPrev', src.tex).f('uDecay', Math.exp(-dt / (0.35 * P.persist)));
      ctx.drawQuad();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pts, h0 * 2, (segs + 1) * 2);
      gl.bindVertexArray(this.vao);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 8, 8);
      gl.vertexAttribDivisor(1, 1);
      const sp = this.segProg.use();
      // Each segment of a pass is drawn exactly once, so the trace's brightness doesn't depend on
      // the frame rate.
      sp.f('uWidth', (0.0016 + 0.0016 * (1 - audio.mid)) * P.width).f('uBeam', (0.55 + 0.9 * audio.mid + 1.3 * this.boost) * P.brightness);
      if (segs > 0) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segs);
      gl.vertexAttribDivisor(0, 0);
      gl.vertexAttribDivisor(1, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.BLEND);
      this.cur = 1 - this.cur;

      // --- the instrument ---
      target.bind();
      const size = Math.min(0.86, (u.width / u.height) * 0.86);
      const fp = this.finalProg.use();
      ctx.setCommon(fp, audio, u);
      const t = Math.max(0, Math.min(1, P.tint));
      const pal = u.palette;
      fp.tex('uAcc', this.acc[this.cur].tex).f('uSize', size).f('uMode', this.mode).f2('uHead', hx, hy)
        .f3('uPhos', 0.3 * (1 - t) + pal[9] * t, 1.0 * (1 - t) + pal[10] * t, 0.42 * (1 - t) + pal[11] * t);
      ctx.drawQuad();
    }
    dispose() {
      const gl = this.gl;
      [this.segProg, this.fadeProg, this.finalProg].forEach((p) => p.dispose());
      this.acc.forEach((t) => t.dispose());
      gl.deleteBuffer(this.buf);
      gl.deleteVertexArray(this.vao);
    }
  }

  VIZ.registerScene({
    id: 'scope',
    name: 'Oscilloscope',
    blurb: 'The waveform itself on a phosphor screen: plotted against its own delayed copy (XY) or as a triggered sweep. Kicks punch the beam; highs fizz it.',
    params: [
      { key: 'mode', label: 'Display mode', min: 0, max: 2, step: 1, value: 1, fmt: (v) => ['XY', 'auto', 'sweep'][v | 0] },
      { key: 'delay', label: 'XY delay (tau)', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'speed', label: 'Writing speed', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'persist', label: 'Phosphor persistence', min: 0.3, max: 4, step: 0.05, value: 1 },
      { key: 'brightness', label: 'Intensity', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'width', label: 'Focus (beam width)', min: 0.4, max: 3, step: 0.05, value: 1 },
      { key: 'bandwidth', label: 'Bandwidth (smooth .. raw)', min: 0.2, max: 6, step: 0.05, value: 1 },
      { key: 'gain', label: 'Volts / div', min: 0.3, max: 2.5, step: 0.05, value: 1 },
      { key: 'noise', label: 'Beam noise on highs', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'tint', label: 'Phosphor tint (green .. palette)', min: 0, max: 1, step: 0.01, value: 0.15 },
    ],
    create: (ctx) => new ScopeScene(ctx),
  });
})();

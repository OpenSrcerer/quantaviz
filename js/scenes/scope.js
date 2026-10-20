/* scope.js — Oscilloscope.
 * A three-channel bench oscilloscope with a phosphor screen, drawing the actual audio. The input
 * is split by a crossover into three bands, each on its own channel with its own beam colour:
 *   CH1  lows   (below ~150 Hz)    green
 *   CH2  mids   (~150 Hz - 2 kHz)  amber
 *   CH3  highs  (above ~2 kHz)     cyan
 * Two display modes:
 *   roll (default) - the way a real scope shows music on a slow timebase, or a patient monitor
 *        shows a heartbeat: one timebase, ~3 s per screen, the three beams crawling left to right
 *        together in real time, each drawing its band's envelope (kicks swell the lows lane,
 *        snares and hats texture the highs). An erase bar runs just ahead of the beams and wipes
 *        the previous sweep.
 *   XY - each band against a delayed copy of itself (a delay embedding), three figures side by
 *        side, each drawn out slowly by its own beam from a captured stretch of signal.
 * Like a real CRT, a trace is brightest where its beam moves slowly.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const N = 512;          // audio.wave length (~12 kHz, ~42 ms)
  const ACC = 1024;
  const RATE = 12000;     // approximate sample rate of audio.wave
  const X_L = -0.46, X_R = 0.46;

  const CHANNELS = [
    { name: 'low', win: 512, tau: 30, pass: 2.2, xy: 0.13, cx: -0.3, base: 0.27, col: [0.35, 1.0, 0.45] },
    { name: 'mid', win: 200, tau: 6, pass: 1.8, xy: 0.13, cx: 0.0, base: 0.0, col: [1.0, 0.68, 0.22] },
    { name: 'high', win: 72, tau: 2, pass: 1.4, xy: 0.13, cx: 0.3, base: -0.27, col: [0.42, 0.85, 1.0] },
  ];

  const SEG_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aA;
layout(location = 1) in vec2 aB;
uniform float uWidth;
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
  vI = uBeam * min(0.6, 0.0035 / (L + 0.0006));
}`;
  const SEG_FS = `#version 300 es
precision highp float;
in float vSide;
in float vI;
out vec4 fragColor;
uniform vec3 uColor;
void main() { fragColor = vec4(uColor * exp(-vSide * vSide * 3.0) * vI, 1.0); }`;
  const FADE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPrev;
uniform float uDecay;
uniform vec2 uErase;       // uv x range wiped ahead of the beams (roll mode); empty when unused
void main() {
  float e = step(uErase.x, vUv.x) * step(vUv.x, uErase.y);
  fragColor = vec4(texture(uPrev, vUv).rgb * uDecay * (1.0 - 0.85 * e), 1.0);
}`;

  const FINAL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform sampler2D uAcc;
uniform float uSize;
uniform float uMode;       // 1 roll .. 0 XY (eased)
uniform vec2 uHead[3];     // beam spots, screen coordinates (-0.5..0.5)
uniform vec3 uCh[3];       // channel colours
uniform vec3 uBase;        // roll baselines per channel
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  vec3 col = mix(vec3(0.09, 0.095, 0.085), vec3(0.05), smoothstep(-0.5, 0.5, p.y));
  float half_ = uSize * 0.5;
  float bez = sdBox(p, vec2(half_ + 0.035), 0.03);
  col = mix(col, vec3(0.16, 0.165, 0.15) + 0.03 * (p.y + 0.5), 1.0 - smoothstep(0.0, px * 1.5, bez));
  col *= 1.0 - 0.5 * exp(-abs(bez) / 0.004) * step(0.0, bez);
  float scr = sdBox(p, vec2(half_), 0.025);
  if (scr < 0.0) {
    vec2 q = p / uSize;
    q *= 1.0 + 0.08 * dot(q, q);                          // tube curvature
    vec2 uv = q + 0.5;
    vec3 glass = vec3(0.012, 0.022, 0.016);
    vec2 gf = abs(fract(q * 10.0) - 0.5);
    float grid = 1.0 - smoothstep(0.0, 0.02 + px * 6.0, min(gf.x, gf.y));
    vec2 tk = abs(fract(q * 50.0) - 0.5);
    float ticks = (1.0 - smoothstep(0.0, 0.06, tk.x)) * step(abs(q.y), 0.008) + (1.0 - smoothstep(0.0, 0.06, tk.y)) * step(abs(q.x), 0.008);
    vec3 e = texture(uAcc, uv).rgb;
    vec3 beam = (1.0 - exp(-e * 1.4)) * 2.0 + vec3(pow(max(max(e.r, max(e.g, e.b)) - 1.2, 0.0), 1.5) * 0.35);
    col = glass + vec3(0.35, 0.8, 0.45) * (grid + ticks) * (0.045 + 0.07 * uHigh) + beam;
    for (int i = 0; i < 3; i++) {
      float hd = length(q - uHead[i]);
      col += mix(uCh[i], vec3(1.0), 0.55) * (exp(-hd * hd / 0.00002) * 1.5 + exp(-hd / 0.018) * 0.1);
      float by = i == 0 ? uBase.x : i == 1 ? uBase.y : uBase.z;
      vec2 m = q - vec2(-0.485, by);
      float tri = step(0.0, m.x) * step(abs(m.y), 0.012 - m.x * 0.6) * step(m.x, 0.02);
      col += uCh[i] * tri * uMode * 0.8;
    }
    col += vec3(0.04) * exp(-pow((q.x + q.y - 0.5) / 0.12, 2.0)) * 0.6;
    col *= 1.0 - 0.6 * smoothstep(0.32, 0.5, max(abs(q.x), abs(q.y)));
  }
  for (int i = 0; i < 3; i++) {
    vec2 lp = vec2(-half_ + 0.03 + float(i) * 0.035, -half_ - 0.018);
    float d = length(p - lp);
    col += uCh[i] * (1.0 - smoothstep(0.004, 0.0055, d)) + uCh[i] * exp(-d / 0.008) * 0.2;
  }
  for (int i = 0; i < 2; i++) {
    vec2 lp = vec2(half_ - 0.065 + float(i) * 0.035, -half_ - 0.018);
    float on = i == 0 ? uMode : 1.0 - uMode;
    float d = length(p - lp);
    col += mix(vec3(0.05, 0.02, 0.0), vec3(1.0, 0.65, 0.15), on) * (1.0 - smoothstep(0.004, 0.0055, d)) + vec3(1.0, 0.6, 0.1) * on * exp(-d / 0.008) * 0.25;
  }
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  // Zero-phase one-pole low-pass (forward then backward), into `out`.
  function lowpass(src, out, a) {
    let y = src[0];
    for (let i = 0; i < src.length; i++) { y += (src[i] - y) * a; out[i] = y; }
    for (let i = src.length - 1; i >= 0; i--) { y += (out[i] - y) * a; out[i] = y; }
  }

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
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, N * 2 * 4, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.vao = gl.createVertexArray();
      this.lpLow = new Float32Array(N);
      this.lpMid = new Float32Array(N);
      this.bandSig = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
      this.ch = CHANNELS.map((c) => ({ ...c, pts: new Float32Array(N * 2), n: 0, head: 0, peak: 0.1, hx: 0, hy: c.base, emin: 0, emax: 0, pmin: null, pmax: null }));
      this.roll = new Float32Array(16 * 2);   // per-frame roll segments, as A/B pairs
      this.rx = X_L;                          // the roll timebase's beam position
      this.heads = new Float32Array(6);
      this.chCol = new Float32Array(9);
      this.boost = 0;
      this.mode = 1;
      this.trig = new VIZ.KickTrigger(0.35);
    }
    resize() { /* fixed-size persistence buffer */ }

    /** XY mode: capture a new pass for channel `c` from its band signal `w`. */
    _capture(c, w, P, time) {
      const win = Math.min(N, Math.round(c.win * P.window));
      let pk = 0;
      for (let i = 0; i < win; i++) pk = Math.max(pk, Math.abs(w[i]));
      const g = c.xy / Math.max(pk, c.peak * 0.35, 0.01) * P.gain;
      const tau = Math.max(1, c.tau * P.delay * (1 + 0.25 * Math.sin(time * 0.11 + c.base * 10)));
      const ti = Math.floor(tau), tf = tau - ti;
      const n = Math.min(win, N - ti - 1);
      const cs = Math.cos(Math.PI / 4), sn = Math.sin(Math.PI / 4);
      for (let i = 0; i < n; i++) {
        const x = w[i], y = w[i + ti] * (1 - tf) + w[i + ti + 1] * tf;
        c.pts[i * 2] = c.cx + (cs * x - sn * y) * g;
        c.pts[i * 2 + 1] = (sn * x + cs * y) * g;
      }
      c.n = n;
      c.head = 0;
    }

    _bindPairs(gl, stride) {
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
      gl.vertexAttribDivisor(1, 1);
    }

    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      // Crossover: lows below ~150 Hz, mids up to ~2 kHz, highs above.
      const raw = audio.wave;
      lowpass(raw, this.lpLow, 0.06);
      lowpass(raw, this.lpMid, 0.5);
      const [sl, sm, sh] = this.bandSig;
      for (let i = 0; i < N; i++) { sl[i] = this.lpLow[i]; sm[i] = this.lpMid[i] - this.lpLow[i]; sh[i] = raw[i] - this.lpMid[i]; }
      this.ch.forEach((c, ci) => {
        let pk = 0;
        const sig = this.bandSig[ci];
        for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(sig[i]));
        c.peak = Math.max(pk, c.peak * Math.exp(-dt / 2.0));
      });

      const k = audio.kick;
      this.boost += (k - this.boost) * (1 - Math.exp(-dt / (k > this.boost ? 0.02 : 0.25)));
      const hitNow = this.trig.update(k);
      const roll = P.display < 0.5;
      this.mode += ((roll ? 1 : 0) - this.mode) * (1 - Math.exp(-dt / 0.4));
      const events = [hitNow, audio.midOnset, audio.highOnset];
      const levels = [audio.bass, audio.mid, audio.high];
      const bandOn = [P.lows, P.mids, P.highs];
      const t = Math.max(0, Math.min(1, P.tint)), pal = u.palette;

      // Roll timebase: the beams' position, and the stretch wiped just ahead of them.
      const T = 3.2 / P.speed;
      let x0 = this.rx, x1 = this.rx + dt / T * (X_R - X_L);
      let wrapped = false;
      if (x1 > X_R) { x0 = X_L; x1 = X_L + (x1 - X_R); wrapped = true; }
      this.rx = x1;

      gl.disable(gl.DEPTH_TEST);
      const src = this.acc[this.cur], dst = this.acc[1 - this.cur];
      dst.bind();
      gl.disable(gl.BLEND);
      const fp0 = this.fadeProg.use().tex('uPrev', src.tex);
      if (roll) fp0.f('uDecay', Math.exp(-dt / (T * 1.5 * P.persist))).f2('uErase', x1 + 0.5 + 0.004, x1 + 0.5 + 0.045);
      else fp0.f('uDecay', Math.exp(-dt / (0.5 * P.persist))).f2('uErase', 2, 2);
      ctx.drawQuad();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const sp = this.segProg.use();

      this.ch.forEach((c, ci) => {
        const colr = [0, 1, 2].map((j) => c.col[j] * (1 - t) + pal[3 + ci * 3 + j] * t);
        this.chCol.set(colr, ci * 3);
        const bright = (0.5 + 0.8 * levels[ci] + (ci === 0 ? 1.0 * this.boost : 0)) * P.brightness * bandOn[ci];
        if (roll) {
          // This frame's slice of the band: its envelope (min/max over the newest samples),
          // smoothed a little so the outline flows instead of chattering.
          const sig = this.bandSig[ci];
          const kN = Math.max(160, Math.min(N, Math.round(dt * RATE)));   // at least ~13 ms: a full low cycle
          let mn = 0, mx = 0;
          for (let i = N - kN; i < N; i++) { mn = Math.min(mn, sig[i]); mx = Math.max(mx, sig[i]); }
          const aUp = 1 - Math.exp(-dt / 0.02), aDn = 1 - Math.exp(-dt / 0.09);
          c.emax += (mx - c.emax) * (mx > c.emax ? aUp : aDn);
          c.emin += (mn - c.emin) * (mn < c.emin ? aUp : aDn);
          const g = 0.12 / Math.max(c.peak, 0.01) * P.gain;
          const top = c.base + Math.min(0.13, c.emax * g), bot = c.base + Math.max(-0.13, c.emin * g);
          if (wrapped || c.pmax === null) { c.pmax = top; c.pmin = bot; }
          const r = this.roll;
          // Upper and lower outline from the previous slice, and a faint fill between them.
          r.set([x0, c.pmax, x1, top, x0, c.pmin, x1, bot, x1, bot, x1, top], 0);
          c.pmax = top; c.pmin = bot;
          c.hx = x1; c.hy = (top + bot) * 0.5;
          this.heads.set([c.hx, c.hy], ci * 2);
          if (bandOn[ci] <= 0) return;
          this._bindPairs(gl, 16);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, r, 0, 8);
          sp.f('uWidth', 0.0016 * P.width).f('uBeam', bright).f3('uColor', ...colr);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 2);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, r, 8, 4);
          sp.f('uBeam', bright * 0.25);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
        } else {
          if (!c.n || c.head >= c.n - 1 || (events[ci] && c.head > c.n * 0.6)) this._capture(c, this.bandSig[ci], P, u.time);
          const h0 = Math.floor(c.head);
          c.head = Math.min(c.n - 1, c.head + dt * c.n / (c.pass / P.speed));
          const h1 = Math.min(c.n - 1, Math.max(h0 + 1, Math.floor(c.head)));
          const segs = h1 - h0;
          c.hx = c.pts[h1 * 2]; c.hy = c.pts[h1 * 2 + 1];
          c.pmax = null;
          this.heads.set([c.hx, c.hy], ci * 2);
          if (segs <= 0 || bandOn[ci] <= 0) return;
          this._bindPairs(gl, 8);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, c.pts, h0 * 2, (segs + 1) * 2);
          sp.f('uWidth', 0.0017 * P.width).f('uBeam', bright).f3('uColor', ...colr);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segs);
        }
      });
      gl.vertexAttribDivisor(0, 0);
      gl.vertexAttribDivisor(1, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.BLEND);
      this.cur = 1 - this.cur;

      target.bind();
      const size = Math.min(0.86, (u.width / u.height) * 0.86);
      const fp = this.finalProg.use();
      ctx.setCommon(fp, audio, u);
      fp.tex('uAcc', this.acc[this.cur].tex).f('uSize', size).f('uMode', this.mode)
        .f2v('uHead', this.heads).f3v('uCh', this.chCol)
        .f3('uBase', CHANNELS[0].base, CHANNELS[1].base, CHANNELS[2].base);
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
    blurb: 'A three-channel scope rolling on a slow timebase: lows, mids and highs crawl across the screen like a patient monitor, each drawing its band\'s envelope.',
    params: [
      { key: 'display', label: 'Display mode', min: 0, max: 1, step: 1, value: 0, fmt: (v) => ['roll', 'XY'][v | 0] },
      { key: 'speed', label: 'Timebase speed', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'lows', label: 'CH1 lows (green)', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'mids', label: 'CH2 mids (amber)', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'highs', label: 'CH3 highs (cyan)', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'persist', label: 'Phosphor persistence', min: 0.3, max: 4, step: 0.05, value: 1 },
      { key: 'brightness', label: 'Intensity', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'width', label: 'Focus (beam width)', min: 0.4, max: 3, step: 0.05, value: 1 },
      { key: 'gain', label: 'Volts / div', min: 0.3, max: 2.5, step: 0.05, value: 1 },
      { key: 'window', label: 'XY capture length', min: 0.3, max: 2, step: 0.05, value: 1 },
      { key: 'delay', label: 'XY delay (tau)', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'tint', label: 'Channel colours (classic .. palette)', min: 0, max: 1, step: 0.01, value: 0 },
    ],
    create: (ctx) => new ScopeScene(ctx),
  });
})();

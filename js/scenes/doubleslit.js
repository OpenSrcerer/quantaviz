/* doubleslit.js — Double Slit.
 * The experiment Feynman called the only mystery of quantum mechanics. A source sends waves at a
 * barrier with two slits; behind it the two diffracted waves interfere (each slit is three Huygens
 * sources, so it also has a single-slit envelope). On the detector screen single photons land one
 * at a time, each at a random spot drawn from |psi|², and a long exposure slowly builds the fringes
 * out of dots, as in Tonomura's electron build-up. The live curve next to the screen is |psi|².
 * Every kick is a measurement: detectors at the slits light up and learn which way each photon
 * went, the cross term vanishes, the wave behind the barrier splits into two separate waves and
 * photons land in two plain bands. Then the detectors switch off and the fringes come back.
 *   bass  -> the which-way measurement (the big change)
 *   mids  -> wave brightness, and the wavelength: the mid centroid sets it (higher = shorter,
 *            tighter fringes, shifted colour)
 *   highs -> bursts of photons (each hit is one dot)
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;
  const ACC_W = 128, ACC_H = 512;
  const MAX_NEW = 320, MAX_RECENT = 400, TABLE = 256;
  const FLASH_LIFE = 0.35;

  const GEO = `
uniform float uXe, uXb, uXs, uPw, uSlitD, uSlitW, uK, uPhase, uL0;
// Amplitudes of the two slits at p (complex, relative phase included).
void slits(vec2 p, out vec2 A1, out vec2 A2) {
  A1 = vec2(0.0); A2 = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    float off = float(j) * uSlitW / 3.0;
    float r1 = length(p - vec2(uXb, 0.5 * uSlitD + off));
    float r2 = length(p - vec2(uXb, -0.5 * uSlitD + off));
    float ph1 = uK * (r1 + uL0) - uPhase, ph2 = uK * (r2 + uL0) - uPhase;
    A1 += vec2(cos(ph1), sin(ph1)) / sqrt(r1 + 0.03);
    A2 += vec2(cos(ph2), sin(ph2)) / sqrt(r2 + 0.03);
  }
  A1 /= 3.0; A2 /= 3.0;
}
`;

  const FS_FINAL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${GEO}
uniform float uMeasure;
uniform float uGain;
uniform float uEmit;
uniform float uLam;      // 0 long .. 1 short wavelength
uniform float uAsp;
uniform float uExposure;
uniform sampler2D uAcc;

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAsp, 1.0);
  float px = 1.0 / uRes.y;
  vec3 col = palette(0.0) * 0.18;
  vec3 waveCol = palette(0.35 + 0.6 * uLam);
  if (p.x < uXb) {
    float r = length(p - vec2(uXe, 0.0));
    float ph = uK * r - uPhase;
    float crest = 0.5 + 0.5 * cos(ph);
    col += waveCol * (0.12 / (r + 0.03)) * (0.2 + 0.8 * crest * crest) * uGain;
  } else if (p.x < uXs) {
    vec2 A1, A2;
    slits(p, A1, A2);
    vec2 S = A1 + A2;
    float I = mix(dot(S, S), dot(A1, A1) + dot(A2, A2), uMeasure);
    float C = mix(S.x * S.x, A1.x * A1.x + A2.x * A2.x, uMeasure);
    col += waveCol * (0.04 * I + 0.11 * C) * uGain;
  } else if (p.x < uXs + uPw) {
    vec2 uv = vec2((p.x - uXs) / uPw, p.y + 0.5);
    col = palette(0.0) * 0.3 + texture(uAcc, uv).rgb * uExposure;
    float edge = min(p.x - uXs, uXs + uPw - p.x);
    col += palette(0.5) * 0.25 * (1.0 - smoothstep(0.0, 2.0 * px, edge));
  } else {
    // |psi|² along the screen, drawn as a filled curve beside it.
    vec2 A1, A2;
    slits(vec2(uXs, p.y), A1, A2);
    vec2 S = A1 + A2;
    float I = mix(dot(S, S), dot(A1, A1) + dot(A2, A2), uMeasure);
    float x0 = uXs + uPw + 0.012;
    float xc = x0 + I * 0.028;
    float inside = step(x0, p.x) * (1.0 - smoothstep(xc - px, xc + px, p.x));
    float rim = exp(-pow((p.x - xc) / (1.5 * px), 2.0)) * step(x0, p.x);
    col += waveCol * (inside * 0.12 + rim * 0.9) * (0.5 + 0.5 * uGain);
  }
  // The barrier, with the slits cut out; which-way detectors glow at the slits during a measurement.
  if (abs(p.x - uXb) < 0.007) {
    float ds = abs(abs(p.y) - 0.5 * uSlitD);
    float open = 1.0 - smoothstep(0.5 * uSlitW - px, 0.5 * uSlitW + px, ds);
    col = mix(palette(0.2) * 0.35 + 0.03, col, open);
  }
  for (int s = -1; s <= 1; s += 2) {
    vec2 dpos = p - vec2(uXb, float(s) * 0.5 * uSlitD);
    col += palette(1.0) * exp(-dot(dpos, dpos) / 0.0006) * uMeasure * 2.5;
  }
  // The source.
  float de = length(p - vec2(uXe, 0.0));
  col += palette(0.9) * (exp(-de * 60.0) * 3.0 + exp(-de * 14.0) * 0.3) * (0.6 + 2.0 * uEmit);
  col *= 0.6 + 0.6 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  const FS_FADE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPrev;
uniform float uDecay;
uniform float uFloor;
void main() { fragColor = vec4(max(texture(uPrev, vUv).rgb * uDecay - uFloor, 0.0), 1.0); }`;

  const VS_DOT = `#version 300 es
layout(location = 0) in vec3 aP;   // x, y in the panel (0..1), strength 0..1
uniform vec4 uRect;                // clip-space x0, y0, x1, y1
uniform float uSize;
uniform float uGrow;
out float vA;
void main() {
  gl_Position = vec4(mix(uRect.xy, uRect.zw, aP.xy), 0.0, 1.0);
  vA = aP.z;
  gl_PointSize = uSize * (1.0 + uGrow * 2.5 * aP.z);
}`;
  const FS_DOT = `#version 300 es
precision highp float;
in float vA;
out vec4 fragColor;
uniform vec3 uColor;
uniform float uGain;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  fragColor = vec4(uColor * exp(-r2 * 3.0) * uGain * vA, 1.0);
}`;

  class DoubleSlitScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.progFinal = ctx.fsProgram(FS_FINAL, 'doubleslit');
      this.progFade = ctx.fsProgram(FS_FADE, 'doubleslit-fade');
      this.progDot = ctx.program(VS_DOT, FS_DOT, { label: 'doubleslit-dots' });
      this.acc = [0, 1].map(() => ctx.createTarget(ACC_W, ACC_H, { hdr: true }));
      for (const t of this.acc) { t.bind(); t.clear(0, 0, 0, 1); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.cur = 0;
      this.newData = new Float32Array(MAX_NEW * 3);
      this.flashData = new Float32Array(MAX_RECENT * 3);
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, Math.max(MAX_NEW, MAX_RECENT) * 12, gl.DYNAMIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.recent = [];
      this.lambda = 0.036;
      this.phase = 0;
      this.measure = 0;
      this.carry = 0;
      this.emit = 0;
      this.cdf = new Float32Array(TABLE + 1);
    }
    resize() { /* the exposure has its own fixed size */ }

    _amp(geo, x, y, out, o) {
      // Same as the shader's slits(): two complex amplitudes at (x, y).
      let a1r = 0, a1i = 0, a2r = 0, a2i = 0;
      for (let j = -1; j <= 1; j++) {
        const off = (j * geo.w) / 3;
        const r1 = Math.hypot(x - geo.xb, y - (0.5 * geo.d + off));
        const r2 = Math.hypot(x - geo.xb, y - (-0.5 * geo.d + off));
        const p1 = geo.k * r1, p2 = geo.k * r2;
        const s1 = 1 / Math.sqrt(r1 + 0.03), s2 = 1 / Math.sqrt(r2 + 0.03);
        a1r += Math.cos(p1) * s1; a1i += Math.sin(p1) * s1;
        a2r += Math.cos(p2) * s2; a2i += Math.sin(p2) * s2;
      }
      const sr = a1r + a2r, si = a1i + a2i;
      out[o] = (sr * sr + si * si) / 9;
      out[o + 1] = (a1r * a1r + a1i * a1i + a2r * a2r + a2i * a2i) / 9;
    }

    render(target, audio, u) {
      const gl = this.gl;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const A = u.width / u.height;
      const geo = { xe: -0.42 * A, xb: -0.1 * A, xs: 0.3 * A, pw: 0.065 * A, d: 0.15 * P.separation, w: 0.03 };

      // Mids: the wavelength follows the mid centroid (slowly), the waves' brightness the mid level.
      let s = 0, wsum = 0;
      for (let i = 32; i < 88; i++) { const b = audio.bands[i]; s += b * (i - 32) / 55; wsum += b; }
      const c = wsum > 1e-3 ? s / wsum : 0.5;
      const lamN = clamp((c - 0.25) / 0.5, 0, 1);
      const lamT = (0.05 - 0.024 * lamN) * P.wavelength;
      this.lambda += (lamT - this.lambda) * (1 - Math.exp(-dt / 2.0));
      geo.k = TAU / this.lambda;
      this.phase += dt * geo.k * 0.2 * P.speed;
      const L0 = Math.hypot(geo.xb - geo.xe, 0.5 * geo.d);

      // Bass: kicks switch the which-way detectors on.
      const k = clamp(audio.kick * P.measure, 0, 1);
      this.measure += (k - this.measure) * (1 - Math.exp(-dt / (k > this.measure ? 0.02 : 0.3)));
      const m = this.measure;

      // |psi|² on the screen -> CDF for sampling hits.
      const tmp = [0, 0];
      let acc = 0;
      this.cdf[0] = 0;
      for (let j = 0; j < TABLE; j++) {
        this._amp(geo, geo.xs, (j + 0.5) / TABLE - 0.5, tmp, 0);
        acc += tmp[0] * (1 - m) + tmp[1] * m;
        this.cdf[j + 1] = acc;
      }

      // Highs: photon bursts on high onsets, plus a trickle with the level.
      this.carry += dt * P.rate * (0.15 + 1.6 * audio.level);
      let n = Math.floor(this.carry);
      this.carry -= n;
      if (audio.highOnset) { n += Math.round(P.burst * audio.highPulse); this.emit = 1; }
      this.emit *= Math.exp(-dt / 0.12);
      n = Math.min(n, MAX_NEW);
      const nd = this.newData;
      for (let i = 0; i < n; i++) {
        const pick = Math.random() * acc;
        let lo = 0, hi = TABLE;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cdf[mid] <= pick) lo = mid; else hi = mid; }
        const y = (lo + Math.random()) / TABLE;
        const x = 0.08 + Math.random() * 0.84;
        nd[i * 3] = x; nd[i * 3 + 1] = y; nd[i * 3 + 2] = 1;
        this.recent.push({ x, y, age: 0 });
      }
      for (const r of this.recent) r.age += dt;
      this.recent = this.recent.filter((r) => r.age < FLASH_LIFE);
      if (this.recent.length > MAX_RECENT) this.recent.splice(0, this.recent.length - MAX_RECENT);

      gl.disable(gl.DEPTH_TEST);
      // --- the exposure: fade, then this frame's hits ---
      const src = this.acc[this.cur], dst = this.acc[1 - this.cur];
      dst.bind();
      gl.disable(gl.BLEND);
      this.progFade.use().tex('uPrev', src.tex)
        .f('uDecay', Math.exp(-dt / Math.max(1, P.memory)))
        .f('uFloor', dst.hdr ? 0 : 1 / 255);
      this.ctx.drawQuad();
      const dotCol = u.palette.subarray(9, 12);
      if (n) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, nd, 0, n * 3);
        this.progDot.use().f4('uRect', -1, -1, 1, 1).f('uSize', 2.6).f('uGrow', 0)
          .f3('uColor', dotCol[0] + 0.3, dotCol[1] + 0.3, dotCol[2] + 0.3).f('uGain', 0.55);
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.POINTS, 0, n);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      }
      this.cur = 1 - this.cur;

      // --- the picture ---
      target.bind();
      const fp = this.progFinal.use();
      this.ctx.setCommon(fp, audio, u);
      fp.f('uXe', geo.xe).f('uXb', geo.xb).f('uXs', geo.xs).f('uPw', geo.pw)
        .f('uSlitD', geo.d).f('uSlitW', geo.w).f('uK', geo.k).f('uPhase', this.phase).f('uL0', L0)
        .f('uMeasure', m)
        .f('uGain', 0.35 + 1.5 * audio.mid + 0.5 * audio.midPulse)
        .f('uEmit', this.emit)
        .f('uLam', clamp((0.05 * P.wavelength - this.lambda) / (0.026 * P.wavelength), 0, 1))
        .f('uAsp', A)
        .f('uExposure', 1)
        .tex('uAcc', this.acc[this.cur].tex);
      this.ctx.drawQuad();

      // --- fresh hits flash on the screen ---
      const nr = this.recent.length;
      if (nr) {
        const fd = this.flashData;
        for (let i = 0; i < nr; i++) {
          const r = this.recent[i];
          fd[i * 3] = r.x; fd[i * 3 + 1] = r.y; fd[i * 3 + 2] = 1 - r.age / FLASH_LIFE;
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, fd, 0, nr * 3);
        const x0 = (2 * geo.xs) / A, x1 = (2 * (geo.xs + geo.pw)) / A;
        this.progDot.use().f4('uRect', x0, -1, x1, 1).f('uSize', Math.max(2, u.height / 260)).f('uGrow', 1)
          .f3('uColor', 1, 1, 1).f('uGain', 1.6);
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.POINTS, 0, nr);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
    }

    dispose() {
      const gl = this.gl;
      [this.progFinal, this.progFade, this.progDot].forEach((p) => p.dispose());
      this.acc.forEach((t) => t.dispose());
      gl.deleteBuffer(this.buf);
      gl.deleteVertexArray(this.vao);
    }
  }

  VIZ.registerScene({
    id: 'doubleslit',
    name: 'Double Slit',
    blurb: 'Single photons build an interference pattern dot by dot; the highs fire photon bursts. Every kick measures which slit they took, and the fringes collapse.',
    params: [
      { key: 'measure', label: 'Measurement on kicks', min: 0, max: 1.5, step: 0.05, value: 1 },
      { key: 'rate', label: 'Photon trickle', min: 0, max: 400, step: 5, value: 120, fmt: (v) => Math.round(v) + ' / s' },
      { key: 'burst', label: 'Photons per high hit', min: 0, max: 200, step: 5, value: 60 },
      { key: 'memory', label: 'Exposure memory', min: 2, max: 60, step: 1, value: 14, fmt: (v) => v + ' s' },
      { key: 'separation', label: 'Slit separation', min: 0.5, max: 2, step: 0.05, value: 1 },
      { key: 'wavelength', label: 'Wavelength', min: 0.6, max: 1.6, step: 0.05, value: 1 },
      { key: 'speed', label: 'Wave speed', min: 0, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new DoubleSlitScene(ctx),
  });
})();

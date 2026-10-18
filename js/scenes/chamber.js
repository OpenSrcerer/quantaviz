/* chamber.js — Bubble Chamber.
 * A particle-detector photograph that paints itself to the music. Every beat is a collision: a
 * spray of charged tracks leaves the vertex and curls in a uniform magnetic field that the bass
 * drives (r = p / qB). Tracks lose energy to the liquid and spiral inward, neutral particles
 * are invisible until they decay into a "vee" of two opposite charges, and now and then a track
 * knocks out a tight little delta-electron spiral. Hold the mouse to plant a local magnetic
 * anomaly; move the window and the photograph slides with inertia.
 *
 * CPU physics (a few hundred tracks, exact rotation integrator), instanced WebGL2 rendering into
 * a ping-ponged HDR accumulation buffer that fades like a long exposure.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;

  const MAX_TRACKS = 400;
  const MAX_SEG = 900;        // 2 substeps x 400 tracks fits with room to spare
  const MAX_STARS = 64;
  const MINSEG = 0.015;       // shortest segment we emit (world units); keeps joint cross-fades exact
  const HH = MINSEG * 0.5;    // half-width of the along-track cross-fade between segments
  const BUBBLES = 90;         // bubbles per world unit along a track
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const GLSL_HH = HH.toFixed(5);
  const GLSL_BUB = BUBBLES.toFixed(1);

  /* ---------------- shaders ---------------- */
  // Fade pass: previous accumulation * decay (and optionally slid by the window motion).
  const FADE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPrev;
uniform float uDecay;
uniform float uFloor;
uniform vec2 uShift;
void main() {
  vec2 uv = vUv - uShift;
  vec3 c = texture(uPrev, uv).rgb * uDecay;
  c = max(c - uFloor, 0.0);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) c = vec3(0.0);
  fragColor = vec4(c, 1.0);
}`;

  // Track segments: a short quad from the previous to the new position of a track.
  const SEG_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;   // x: 0..1 along, y: -1..1 across
layout(location = 1) in vec2 aP0;
layout(location = 2) in vec2 aP1;
layout(location = 3) in vec4 aInfo;     // bandT, charge, speed/3, age
layout(location = 4) in vec2 aExtra;    // distance travelled at P0, speed at P0 / 3
uniform float uAspect;
uniform vec2 uRes;
const float HH = ${GLSL_HH};
out vec2 vLocal;
flat out vec4 vSeg;
flat out vec4 vInfo;
flat out vec2 vSp;
void main() {
  vec2 d = aP1 - aP0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float px = 2.0 / uRes.y;
  float w = max(0.006 + 0.004 * aInfo.z, 4.0 * px);
  float e = max(HH, 3.2 * px);
  float s = mix(-e, len + e, aCorner.x);
  float a = aCorner.y * w;
  vec2 p = aP0 + dir * s + n * a;
  vLocal = vec2(s, a);
  vSeg = vec4(len, w, aExtra.x, 0.0);
  vInfo = aInfo;
  vSp = vec2(aExtra.y, aInfo.z);
  gl_Position = vec4(p.x / uAspect, p.y, 0.0, 1.0);
}`;

  const SEG_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
flat in vec4 vSeg;
flat in vec4 vInfo;
flat in vec2 vSp;
out vec4 fragColor;
${VIZ.glsl.common}
const float HH = ${GLSL_HH};
const float BUB = ${GLSL_BUB};
void main() {
  float px = 2.0 / uRes.y;
  float s = vLocal.x;
  float len = vSeg.x;
  float w = vSeg.y;
  float dist0 = vSeg.z;
  float bandT = vInfo.x;
  float charge = vInfo.y;
  float age = vInfo.w;
  float k = clamp(s / max(len, 1e-5), 0.0, 1.0);
  float speed = mix(vSp.x, vSp.y, k) * 3.0;
  float taper = smoothstep(0.03, 0.4, speed);
  float fresh = 1.0 + 0.9 * exp(-age * 5.0);

  // Soft along-track weight: consecutive segments cross-fade to a constant sum of 1.
  float wa = smoothstep(-HH, HH, s) * (1.0 - smoothstep(len - HH, len + HH, s));
  float dn = abs(vLocal.y) / w;
  float tr = 1.0 - smoothstep(0.0, 1.0, dn);
  float trail = tr * tr * 0.5;
  float core = 1.0 - smoothstep(0.0, 0.22, dn);

  // Bubbles: one dot every 1/BUB along the track; a segment owns the dots whose centre lies in [0, len).
  float kc = floor((dist0 + s) * BUB + 0.5);
  float sc = kc / BUB - dist0;
  float own = step(0.0, sc) * (1.0 - step(len, sc));
  float rb = min(2.0 * px, 0.42 / BUB);
  float db = length(vec2(s - sc, vLocal.y));
  float bub = own * (1.0 - smoothstep(rb - 0.8 * px, rb + 0.8 * px, db));
  float bcore = own * (1.0 - smoothstep(0.0, rb * 0.55, db));

  vec3 tint = palette(0.35 + 0.65 * bandT) * (0.9 + 2.2 * bandMid(bandT)) * (charge > 0.0 ? 1.0 : 0.85);   // mids light the tracks
  vec3 col = tint * trail * 0.45 * wa + vec3(1.0, 0.96, 0.9) * core * 0.14 * wa;
  col += (tint * 0.6 + vec3(0.3)) * bub + vec3(0.45) * bcore;
  col *= taper * fresh;
  fragColor = vec4(col, 1.0);
}`;

  // Star bursts (collision / decay vertices), drawn additively into the accumulation buffer.
  const STAR_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aData;     // x, y, size, rotation
layout(location = 2) in vec2 aData2;    // palette position, intensity
uniform float uAspect;
out vec2 vLocal;
out vec2 vD2;
void main() {
  float c = cos(aData.w), s = sin(aData.w);
  vec2 q = mat2(c, -s, s, c) * aCorner;
  vLocal = aCorner;
  vD2 = aData2;
  vec2 p = aData.xy + q * aData.z;
  gl_Position = vec4(p.x / uAspect, p.y, 0.0, 1.0);
}`;

  const STAR_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vD2;
out vec4 fragColor;
${VIZ.glsl.common}
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
void main() {
  float d = sdStar5(vLocal, 0.8, 0.45);
  float aa = fwidth(d) * 1.5;
  float fill = 1.0 - smoothstep(-aa, aa, d);
  float glow = exp(-max(d, 0.0) * 7.0) * (1.0 - smoothstep(0.7, 1.0, length(vLocal)));
  vec3 tint = palette(vD2.x);
  vec3 col = tint * (2.2 * fill + 0.5 * glow);
  col += vec3(0.8) * fill * (1.0 - smoothstep(0.0, 0.35, length(vLocal)));
  fragColor = vec4(col * vD2.y, 1.0);
}`;

  // Live heads of the charged tracks: bright 4-6 px dots.
  const HEAD_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aHead;     // x, y, bandT, speed/3
uniform float uAspect;
uniform vec2 uRes;
out vec2 vLocal;
out vec3 vH;
void main() {
  float px = 2.0 / uRes.y;
  float rpx = 2.0 + 1.2 * aHead.w;
  float ext = rpx + 3.0;
  vLocal = aCorner * ext;
  vH = vec3(rpx, aHead.z, aHead.w * 3.0);
  vec2 p = aHead.xy + aCorner * ext * px;
  gl_Position = vec4(p.x / uAspect, p.y, 0.0, 1.0);
}`;

  const HEAD_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vH;
out vec4 fragColor;
${VIZ.glsl.common}
void main() {
  float d = length(vLocal);
  float r = vH.x;
  float core = 1.0 - smoothstep(r - 0.8, r + 0.6, d);
  float glow = exp(-d * d / (r * r * 1.6)) * (1.0 - smoothstep(r + 0.5, r + 3.0, d));
  vec3 tint = palette(0.35 + 0.65 * vH.y);
  float e = bandMid(vH.y);
  float taper = smoothstep(0.04, 0.3, vH.z);
  vec3 col = mix(tint, vec3(1.0), 0.65) * (1.6 + 1.6 * e) * core + tint * (0.6 + e) * glow * 0.8;
  fragColor = vec4(col * taper, 1.0);
}`;

  // Final pass: the photograph on a dark chamber window with a faint grid.
  const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
uniform sampler2D uAccum;
uniform float uField;
uniform vec2 uPtr;
uniform float uPtrOn;
void main() {
  float asp = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(asp, 1.0) * 2.0;
  float px = 2.0 / uRes.y;
  vec3 photo = texture(uAccum, vUv).rgb;

  float vig = 1.0 - smoothstep(0.2, 2.3, length(p));
  float lum = 0.4 + 0.6 * vig;
  vec3 bg = uCol[0] * 0.35 * lum;

  // fine grid every 0.1 world units, stronger every 0.5
  vec2 g1 = abs(fract(p * 10.0 + 0.5) - 0.5) / 10.0;
  float l1 = 1.0 - smoothstep(0.0, px * 1.2, min(g1.x, g1.y));
  vec2 g5 = abs(fract(p * 2.0 + 0.5) - 0.5) / 2.0;
  float l5 = 1.0 - smoothstep(0.0, px * 1.6, min(g5.x, g5.y));
  vec3 gridCol = mix(palette(0.4), vec3(1.0), 0.35);
  bg += gridCol * (0.03 * l1 + 0.025 * l5) * lum * (0.8 + 0.5 * uBeat);

  // field-out-of-the-page symbols at the major crossings, growing with the field strength
  vec2 cell = fract(p * 2.0 + 0.5) - 0.5;
  float dc = length(cell) / 2.0;
  float rr = 0.016 + 0.006 * uField;
  float q = (dc - rr) / (px * 1.1);
  float fring = exp(-q * q);
  float fdot = 1.0 - smoothstep(px * 1.2, px * 2.4, dc);
  bg += gridCol * (0.35 * fring + 0.6 * fdot) * 0.05 * lum * (0.5 + 0.35 * uField);

  // magnetic anomaly under the pointer
  float pd = length(p - uPtr);
  float rq = (pd - 0.35) / (px * 2.5);
  bg += palette(0.8) * (exp(-rq * rq) * 0.15 + (1.0 - smoothstep(0.0, 0.35, pd)) * 0.04) * uPtrOn;

  vec3 col = (photo + bg) * (0.5 + 0.7 * uIntensity);
  fragColor = vec4(col, 1.0);
}`;

  /* ---------------- helpers ---------------- */
  function makeVao(gl, baseBuf, baseLoc, baseSize, instBuf, layout, stride) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, baseBuf);
    gl.enableVertexAttribArray(baseLoc);
    gl.vertexAttribPointer(baseLoc, baseSize, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    for (const a of layout) {
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, stride, a.offset);
      gl.vertexAttribDivisor(a.loc, 1);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vao;
  }

  function dynamicBuffer(gl, data) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return b;
  }

  /* ---------------- scene ---------------- */
  class ChamberScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.progFade = ctx.fsProgram(FADE_FS, 'chamber-fade');
      this.progFinal = ctx.fsProgram(FINAL_FS, 'chamber-final');
      this.progSeg = ctx.program(SEG_VS, SEG_FS, { label: 'chamber-seg' });
      this.progStar = ctx.program(STAR_VS, STAR_FS, { label: 'chamber-star' });
      this.progHead = ctx.program(HEAD_VS, HEAD_FS, { label: 'chamber-head' });

      // Base geometry: a strip quad (x 0..1 along, y -1..1 across) and a centred -1..1 quad.
      this.stripBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stripBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
      this.quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // Instance buffers.
      this.segData = new Float32Array(MAX_SEG * 10);
      this.starData = new Float32Array(MAX_STARS * 6);
      this.headData = new Float32Array(MAX_TRACKS * 4);
      this.segBuf = dynamicBuffer(gl, this.segData);
      this.starBuf = dynamicBuffer(gl, this.starData);
      this.headBuf = dynamicBuffer(gl, this.headData);

      this.vaoSeg = makeVao(gl, this.stripBuf, 0, 2, this.segBuf,
        [{ loc: 1, size: 2, offset: 0 }, { loc: 2, size: 2, offset: 8 }, { loc: 3, size: 4, offset: 16 }, { loc: 4, size: 2, offset: 32 }], 40);
      this.vaoStar = makeVao(gl, this.quadBuf, 0, 2, this.starBuf,
        [{ loc: 1, size: 4, offset: 0 }, { loc: 2, size: 2, offset: 16 }], 24);
      this.vaoHead = makeVao(gl, this.quadBuf, 0, 2, this.headBuf,
        [{ loc: 1, size: 4, offset: 0 }], 16);

      // Accumulation pair (ping-pong). Real size arrives in resize().
      this.acc = [ctx.createTarget(2, 2, { hdr: true }), ctx.createTarget(2, 2, { hdr: true })];
      this.cur = 0;

      this.tracks = [];
      this.pending = [];
      this.stars = [];
      this.nSeg = 0;
      this.aspect = 1;
      this.chaos = 1;
      this.high = 0;
      this.idle = 0;
      this.ptrOn = 0;
    }

    resize(w, h) {
      const gl = this.gl;
      for (const t of this.acc) {
        t.resize(w, h);
        t.bind();
        t.clear(0, 0, 0, 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.cur = 0;
    }

    /* ---- population ---- */
    _make(x, y, vx, vy, q, t) {
      const sp = Math.hypot(vx, vy);
      const tr = {
        x, y, vx, vy, sp, q, t, age: 0,
        ex: x, ey: y, es: sp, dist: 0,       // last emitted segment end, its speed, path length so far
        k: 1, loss: 1, maxAge: 6, decayAt: 0, deltaAt: -1, dead: false,
      };
      // Highs: delta electrons (tight little spirals) spin off more often when the treble is busy.
      if (q !== 0 && Math.random() < 0.1 * this.chaos * (0.4 + 1.8 * this.high)) tr.deltaAt = 0.15 + Math.random() * 0.9;
      this.pending.push(tr);
      return tr;
    }

    _flush() {
      const tr = this.tracks;
      for (const p of this.pending) tr.push(p);
      this.pending.length = 0;
      let j = 0;
      for (let i = 0; i < tr.length; i++) if (!tr[i].dead) tr[j++] = tr[i];
      tr.length = j;
      if (tr.length > MAX_TRACKS) tr.splice(0, tr.length - MAX_TRACKS);
    }

    _star(x, y, size, tint) {
      this.stars.push({ x, y, size, tint, age: 0, life: 0.4, rot: Math.random() * TAU });
      if (this.stars.length > MAX_STARS) this.stars.shift();
    }

    _collide(beat, P) {
      beat = clamp(beat || 0, 0, 1);
      const asp = this.aspect;
      const strong = beat > 0.85;
      let cx, cy;
      if (strong) { cx = (Math.random() - 0.5) * 0.08; cy = (Math.random() - 0.5) * 0.08; }
      else { cx = -asp * (0.3 + Math.random() * 0.5); cy = Math.random() - 0.5; }
      const n = 4 + Math.round(8 * beat * (P.multiplicity !== undefined ? P.multiplicity : 1));
      const pNeutral = clamp(0.2 * this.chaos, 0, 0.6);
      for (let i = 0; i < n; i++) {
        const speed = 0.9 + Math.random() * 1.7;
        // Forward cone (mostly +x, +-50 deg); the strong centre events fly out in every direction.
        const a = strong ? Math.random() * TAU : (Math.random() + Math.random() - 1) * 0.8727;
        const neutral = Math.random() < pNeutral;
        const q = neutral ? 0 : (Math.random() < 0.5 ? 1 : -1);
        const tr = this._make(cx + (Math.random() - 0.5) * 0.006, cy + (Math.random() - 0.5) * 0.006,
          Math.cos(a) * speed, Math.sin(a) * speed, q, Math.random());
        if (neutral) tr.decayAt = 0.2 + Math.random() * 0.5;
      }
      this._flush();
      this._star(cx, cy, 0.05 + 0.02 * beat, 0.95);
    }

    // Neutral V0 decay: two opposite charges with the parent's velocity +- a perpendicular kick.
    _vee(p) {
      p.dead = true;
      const sp = Math.hypot(p.vx, p.vy) || 1e-3;
      const nx = -p.vy / sp, ny = p.vx / sp;
      const kick = sp * (0.25 + Math.random() * 0.45);
      this._make(p.x, p.y, p.vx + nx * kick, p.vy + ny * kick, 1, clamp(p.t + (Math.random() - 0.5) * 0.2, 0, 1));
      this._make(p.x, p.y, p.vx - nx * kick, p.vy - ny * kick, -1, clamp(p.t + (Math.random() - 0.5) * 0.2, 0, 1));
      this._star(p.x, p.y, 0.03 + Math.random() * 0.025, 0.95);
    }

    // Delta electron: slow, light (curls very tightly), knocked out sideways from the parent track.
    _delta(p) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const ang = Math.atan2(p.vy, p.vx) + side * (1.1 + Math.random() * 0.9);
      const s = 0.2 + Math.random() * 0.22;
      const d = this._make(p.x, p.y, Math.cos(ang) * s, Math.sin(ang) * s, -1, clamp(p.t + (Math.random() - 0.5) * 0.3, 0, 1));
      d.deltaAt = -1; d.k = 6; d.loss = 1.6; d.maxAge = 2.2;
    }

    _seg(t, sp) {
      const dx = t.x - t.ex, dy = t.y - t.ey;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < MINSEG || this.nSeg >= MAX_SEG) return;
      const a = this.segData, o = this.nSeg++ * 10;
      a[o] = t.ex; a[o + 1] = t.ey; a[o + 2] = t.x; a[o + 3] = t.y;
      a[o + 4] = t.t; a[o + 5] = t.q > 0 ? 1 : -1; a[o + 6] = sp / 3; a[o + 7] = t.age;
      a[o + 8] = t.dist; a[o + 9] = t.es / 3;
      t.dist += d; t.ex = t.x; t.ey = t.y; t.es = sp;
    }

    /* ---- physics ---- */
    _step(h, B, down, ptx, pty) {
      const tr = this.tracks, n = tr.length, asp = this.aspect;
      for (let i = 0; i < n; i++) {
        const t = tr[i];
        t.age += h;
        if (t.q === 0) {
          t.x += t.vx * h; t.y += t.vy * h;
          if (t.age >= t.decayAt) this._vee(t);
        } else {
          let b = B;
          if (down) {
            const d = Math.hypot(t.x - ptx, t.y - pty);
            b *= 1 + 3 * (1 - sstep(0.25, 0.35, d));
          }
          // a = q B (vy, -vx): rotate the velocity exactly, move along the chord of the arc.
          const th = t.q * t.k * b * h;
          const hf = th * 0.5;
          const c2 = Math.cos(hf), s2 = Math.sin(hf);
          const mvx = t.vx * c2 + t.vy * s2, mvy = -t.vx * s2 + t.vy * c2;
          const sinc = Math.abs(hf) < 1e-3 ? 1 : Math.sin(hf) / hf;
          t.x += mvx * h * sinc; t.y += mvy * h * sinc;
          const c = Math.cos(th), s = Math.sin(th);
          let vx = t.vx * c + t.vy * s, vy = -t.vx * s + t.vy * c;
          let sp = Math.hypot(vx, vy);
          // Energy loss to the liquid (a touch stronger when slow, so the tails curl up).
          const f = Math.exp(-h * (0.35 + 0.12 / (0.15 + sp)) * t.loss);
          vx *= f; vy *= f; sp *= f;
          t.vx = vx; t.vy = vy; t.sp = sp;
          this._seg(t, sp);
          if (t.deltaAt >= 0 && t.age >= t.deltaAt) { t.deltaAt = -1; this._delta(t); }
          if (sp < 0.05) t.dead = true;
        }
        if (t.age > t.maxAge || Math.abs(t.x) > asp + 0.1 || Math.abs(t.y) > 1.1) t.dead = true;
      }
    }

    /* ---- render ---- */
    render(target, audio, u) {
      const gl = this.gl, P = u.params || {};
      const pv = (k, d) => (P[k] !== undefined ? P[k] : d);
      const asp = (this.aspect = u.aspect);
      const dt = Math.min(u.dt, 0.05);
      this.chaos = pv('chaos', 1);
      this.high = audio.high;

      // Window moved: the photograph (and the tracks) slide in screen space.
      const sh = 2 / Math.max(1, window.innerHeight);
      const shX = -u.motion.dx * sh, shY = u.motion.dy * sh;
      if (shX || shY) {
        for (const t of this.tracks) { t.x += shX; t.y += shY; t.ex += shX; t.ey += shY; }
        for (const s of this.stars) { s.x += shX; s.y += shY; }
      }

      // Pointer anomaly.
      const down = !!u.pointer.down;
      const ptx = (u.pointer.x - 0.5) * 2 * asp, pty = (u.pointer.y - 0.5) * 2;
      this.ptrOn += ((down ? 1 : 0) - this.ptrOn) * (1 - Math.exp(-dt / 0.08));

      // Age the star bursts, then let this frame's events (which may add new ones) happen.
      for (let i = this.stars.length - 1; i >= 0; i--) {
        const s = this.stars[i];
        s.age += dt;
        if (s.age >= s.life) this.stars.splice(i, 1);
      }
      this.idle += dt;
      if (audio.onset) { this._collide(audio.beat, P); this.idle = 0; }
      else if (this.idle > 3.5) { this._collide(0.35, P); this.idle = 1.5; }   // keep a silent chamber alive

      // Physics: 2 substeps.
      this.nSeg = 0;
      const B = (0.6 + 1.6 * audio.bass) * pv('field', 1);
      const hstep = dt / 2;
      for (let s = 0; s < 2; s++) {
        this._step(hstep, B, down, ptx, pty);
        this._flush();
      }

      // --- fill instance data ---
      const nSeg = this.nSeg;
      const stD = this.starData;
      let ns = 0;
      for (const s of this.stars) {
        if (ns >= MAX_STARS) break;
        const k = s.age / s.life;
        const grow = 1 - (1 - k) * (1 - k) * (1 - k);
        const fade = (1 - k) * (1 - k);
        const o = ns * 6;
        stD[o] = s.x; stD[o + 1] = s.y; stD[o + 2] = s.size * (0.55 + 0.7 * grow); stD[o + 3] = s.rot;
        stD[o + 4] = s.tint; stD[o + 5] = fade * (dt / 0.14);
        ns++;
      }
      const hd = this.headData;
      let nh = 0;
      for (const t of this.tracks) {
        if (t.q === 0 || t.dead || t.sp <= 0.05 || nh >= MAX_TRACKS) continue;
        const o = nh * 4;
        hd[o] = t.x; hd[o + 1] = t.y; hd[o + 2] = t.t; hd[o + 3] = t.sp / 3;
        nh++;
      }

      gl.disable(gl.DEPTH_TEST);

      // --- pass 1: fade the previous exposure into the other accumulation target ---
      const src = this.acc[this.cur], dst = this.acc[1 - this.cur];
      const exposure = Math.max(0.1, pv('exposure', 1.8));
      dst.bind();
      gl.disable(gl.BLEND);
      const fp = this.progFade.use();
      fp.tex('uPrev', src.tex)
        .f('uDecay', Math.exp(-dt / exposure))
        .f('uFloor', dst.hdr ? 0.02 * dt : 0.0045)
        .f2('uShift', shX / (2 * asp), shY / 2);
      this.ctx.drawQuad();

      // --- pass 2: this frame's segments and star bursts, added to the exposure ---
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      if (nSeg) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.segData, 0, nSeg * 10);
        const p = this.progSeg.use();
        this.ctx.setCommon(p, audio, u);
        p.f('uAspect', asp);
        gl.bindVertexArray(this.vaoSeg);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nSeg);
      }
      if (ns) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, stD, 0, ns * 6);
        const p = this.progStar.use();
        this.ctx.setCommon(p, audio, u);
        p.f('uAspect', asp);
        gl.bindVertexArray(this.vaoStar);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, ns);
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.BLEND);
      this.cur = 1 - this.cur;

      // --- pass 3: the photograph on the chamber window, then the live track heads ---
      target.bind();
      const fin = this.progFinal.use();
      this.ctx.setCommon(fin, audio, u);
      fin.tex('uAccum', this.acc[this.cur].tex)
        .f('uField', B)
        .f2('uPtr', ptx, pty)
        .f('uPtrOn', this.ptrOn);
      this.ctx.drawQuad();

      if (nh) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.headBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, hd, 0, nh * 4);
        const p = this.progHead.use();
        this.ctx.setCommon(p, audio, u);
        p.f('uAspect', asp);
        gl.bindVertexArray(this.vaoHead);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nh);
      }

      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
    }

    dispose() {
      const gl = this.gl;
      [this.progFade, this.progFinal, this.progSeg, this.progStar, this.progHead].forEach((p) => p.dispose());
      [this.stripBuf, this.quadBuf, this.segBuf, this.starBuf, this.headBuf].forEach((b) => gl.deleteBuffer(b));
      [this.vaoSeg, this.vaoStar, this.vaoHead].forEach((v) => gl.deleteVertexArray(v));
      this.acc.forEach((t) => t.dispose());
    }
  }

  VIZ.registerScene({
    id: 'chamber',
    name: 'Bubble Chamber',
    blurb: 'Every beat is a particle collision: charged tracks curl in a bass-driven magnetic field, neutrals decay into vees, and the photograph fades like a long exposure. Hold the mouse to bend the field.',
    params: [
      { key: 'field', label: 'Magnetic field', min: 0.2, max: 3, step: 0.01, value: 1 },
      { key: 'multiplicity', label: 'Multiplicity', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'exposure', label: 'Exposure', min: 0.5, max: 6, step: 0.1, value: 1.8, fmt: (v) => v.toFixed(1) + ' s' },
      { key: 'chaos', label: 'Delta electrons & decays', min: 0, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new ChamberScene(ctx),
  });
})();

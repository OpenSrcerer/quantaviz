/* quarks.js — Quark Soup.
 * A cartoon sandbox of colour-charged quarks (red / green / blue and their anti-colours) bound into
 * hadrons by gluon strings. Beats pump energy into the soup, strings stretch, and when a string
 * stretches too far it snaps and a new quark / antiquark pair is born at the break (string
 * breaking, the way real hadrons are made). Bass squeezes the "bag" the quarks live in, treble
 * makes them jitter, crowded mesons annihilate into photon stars. Drag a quark with the mouse;
 * move the window and the soup keeps its inertia in screen space.
 *
 * CPU physics (a few hundred bodies), instanced WebGL2 rendering with SDF sprites.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;

  const MAX_QUARKS = 220;
  const MAX_BONDS = 260;
  const MAX_PHOTONS = 600;
  const SEG = 16;
  const CHARGE = [[1.0, 0.16, 0.22], [0.2, 1.0, 0.3], [0.22, 0.5, 1.0]];
  const ANTI = [[0.15, 0.95, 0.95], [1.0, 0.25, 0.95], [1.0, 0.85, 0.2]];
  const TENSION = 3.6;        // string pull (acceleration units) once stretched
  const BOND_DAMP = 1.4;
  const REPULSE = 110;
  const BAG_K = 30;
  const GRAB_K = 160;
  const GRAB_D = 14;
  const LBREAK = 0.42;        // extension beyond rest length that snaps a string (× tension param)
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------------- shaders ---------------- */
  const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform float uBag;
uniform vec4 uBursts[8];
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0;
  float r = length(p);
  vec3 col = uCol[0] * (0.42 - 0.22 * smoothstep(0.0, 1.6, r));
  float dots = smoothstep(0.35, 0.0, length(fract(p * 9.0) - 0.5));
  col += uCol[0] * dots * 0.12;
  float d = abs(r - uBag);
  col += palette(0.5) * exp(-d * d * 900.0) * (0.12 + 0.7 * uBass);
  col += palette(0.3) * smoothstep(uBag, uBag - 0.6, r) * 0.03;
  for (int i = 0; i < 8; i++) {
    float age = uTime - uBursts[i].z;
    if (age > 0.0 && age < 0.7) {
      float rr = 0.04 + age * 1.1;
      float dd = abs(length(p - uBursts[i].xy) - rr);
      float fade = 1.0 - age / 0.7;
      col += palette(0.95) * exp(-dd * dd * 4000.0) * fade * fade * uBursts[i].w * 0.6;
    }
  }
  fragColor = vec4(col, 1.0);
}`;

  const STRING_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aBase;
layout(location = 1) in vec2 aP0;
layout(location = 2) in vec2 aP1;
layout(location = 3) in vec4 aInfo;
uniform float uAspect;
uniform float uTime;
out float vT;
out float vSide;
out vec4 vInfo;
void main() {
  float t = aBase.x;
  float side = aBase.y;
  vec2 dir = aP1 - aP0;
  float len = max(length(dir), 1e-4);
  vec2 n = vec2(-dir.y, dir.x) / len;
  float env = sin(t * 3.14159265);
  float wob = sin(t * 12.566 + uTime * 7.0 + aInfo.y) * 0.03 * (1.0 - aInfo.x) * (0.4 + aInfo.w) * env;
  float w = (0.02 * (1.0 + 0.7 * aInfo.w) * (1.1 - 0.75 * aInfo.x) + 0.007) * (0.55 + 0.45 * env);
  vec2 p = mix(aP0, aP1, t) + n * (wob + side * w);
  vT = t; vSide = side; vInfo = aInfo;
  gl_Position = vec4(p.x / uAspect, p.y, 0.0, 1.0);
}`;

  const STRING_FS = `#version 300 es
precision highp float;
in float vT;
in float vSide;
in vec4 vInfo;
out vec4 fragColor;
${VIZ.glsl.common}
void main() {
  float s = abs(vSide);
  float aa = fwidth(s) * 1.5;
  float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, s);
  float inner = 1.0 - smoothstep(0.62 - aa, 0.62 + aa, s);
  vec3 tube = palette(0.45 + 0.5 * vInfo.x) * (0.7 + 1.4 * vInfo.x + 0.5 * vInfo.w);
  float bead = smoothstep(0.75, 1.0, sin(vT * 18.0 - uTime * (6.0 + 8.0 * vInfo.w) + vInfo.y));
  tube += palette(0.95) * bead * (0.35 + 1.2 * vInfo.x + 0.4 * vInfo.w) * (1.0 - s);
  vec3 col = mix(uCol[0] * 0.3, tube, inner);
  fragColor = vec4(col, alpha);
}`;

  const QUARK_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aPos;
layout(location = 2) in float aRadius;
layout(location = 3) in vec3 aColor;
layout(location = 4) in vec4 aFace;
uniform float uAspect;
uniform vec2 uRes;
out vec2 vLocal;
out vec3 vColor;
out vec4 vFace;
out float vRadiusPx;
void main() {
  vLocal = aCorner * 1.4;
  vColor = aColor;
  vFace = aFace;
  vRadiusPx = aRadius * uRes.y * 0.5;
  vec2 p = aPos + aCorner * 1.4 * aRadius;
  gl_Position = vec4(p.x / uAspect, p.y, 0.0, 1.0);
}`;

  const QUARK_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vColor;
in vec4 vFace;
in float vRadiusPx;
out vec4 fragColor;
uniform float uFaces;
uniform vec3 uOutline;
float sdEllipse(vec2 p, vec2 r) { return (length(p / r) - 1.0) * min(r.x, r.y); }
void main() {
  float aa = 1.5 / max(vRadiusPx, 1.0);
  vec2 p = vLocal;
  float d = length(p) - 1.0;
  float body = 1.0 - smoothstep(-aa, aa, d);
  if (body <= 0.002) discard;
  float inner = 1.0 - smoothstep(-0.12 - aa, -0.12 + aa, d);
  float shade = smoothstep(0.9, -0.6, dot(p, normalize(vec2(0.6, -0.8))));
  vec3 fill = vColor * (0.75 + 0.35 * shade);
  fill += vec3(0.7) * smoothstep(0.4, 0.0, length(p - vec2(-0.38, 0.42)));
  vec3 col = mix(uOutline, fill, inner);
  if (uFaces > 0.5) {
    float blink = vFace.x, mouth = vFace.y, worry = vFace.z;
    float eyeScale = 1.0 + 0.35 * worry;
    vec2 er = vec2(0.15, max(0.03, 0.17 * blink)) * eyeScale;
    float dE = min(sdEllipse(p - vec2(-0.33, 0.2), er), sdEllipse(p - vec2(0.33, 0.2), er));
    float eyes = 1.0 - smoothstep(-aa, aa, dE);
    float dH = min(length(p - vec2(-0.28, 0.26)), length(p - vec2(0.38, 0.26))) - 0.055 * eyeScale;
    float hl = (1.0 - smoothstep(-aa, aa, dH)) * step(0.35, blink);
    float mw = mix(0.26, 0.15, worry);
    float mh = 0.035 + 0.22 * max(mouth, worry * 0.8);
    float dM = sdEllipse(p - vec2(0.0, -0.3), vec2(mw, mh));
    float mo = 1.0 - smoothstep(-aa, aa, dM);
    vec3 dark = vec3(0.03, 0.02, 0.05);
    col = mix(col, dark, max(eyes, mo) * inner);
    col = mix(col, vec3(1.6), hl * inner);
  }
  fragColor = vec4(col, body);
}`;

  const PHOTON_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aData;
layout(location = 2) in vec2 aData2;
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

  const PHOTON_FS = `#version 300 es
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
  float rim = 1.0 - smoothstep(0.0, 0.12, abs(d));
  float glow = exp(-max(d, 0.0) * 7.0);
  vec3 tint = palette(vD2.x);
  vec3 col = tint * (2.2 * fill + 0.5 * glow);
  col = mix(col, uCol[0] * 0.4, rim * fill * 0.8);
  float a = max(fill, glow * 0.45) * vD2.y;
  fragColor = vec4(col, a);
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

  /* ---------------- scene ---------------- */
  class QuarkScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.progBg = ctx.fsProgram(BG_FS, 'quarks-bg');
      this.progString = ctx.program(STRING_VS, STRING_FS, { label: 'quarks-string' });
      this.progQuark = ctx.program(QUARK_VS, QUARK_FS, { label: 'quarks-quark' });
      this.progPhoton = ctx.program(PHOTON_VS, PHOTON_FS, { label: 'quarks-photon' });

      // Base geometry.
      this.quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const strip = [];
      for (let i = 0; i <= SEG; i++) { const t = i / SEG; strip.push(t, -1, t, 1); }
      this.stripBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stripBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strip), gl.STATIC_DRAW);

      // Instance buffers.
      this.stringData = new Float32Array(MAX_BONDS * 8);
      this.quarkData = new Float32Array(MAX_QUARKS * 10);
      this.photonData = new Float32Array(MAX_PHOTONS * 6);
      this.stringBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stringBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.stringData.byteLength, gl.DYNAMIC_DRAW);
      this.quarkBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quarkBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.quarkData.byteLength, gl.DYNAMIC_DRAW);
      this.photonBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.photonBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.photonData.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.vaoString = makeVao(gl, this.stripBuf, 0, 2, this.stringBuf,
        [{ loc: 1, size: 2, offset: 0 }, { loc: 2, size: 2, offset: 8 }, { loc: 3, size: 4, offset: 16 }], 32);
      this.vaoQuark = makeVao(gl, this.quadBuf, 0, 2, this.quarkBuf,
        [{ loc: 1, size: 2, offset: 0 }, { loc: 2, size: 1, offset: 8 }, { loc: 3, size: 3, offset: 12 }, { loc: 4, size: 4, offset: 24 }], 40);
      this.vaoPhoton = makeVao(gl, this.quadBuf, 0, 2, this.photonBuf,
        [{ loc: 1, size: 4, offset: 0 }, { loc: 2, size: 2, offset: 16 }], 24);

      this.quarks = [];
      this.hadrons = [];
      this.photons = [];
      this.bursts = new Float32Array(32).fill(-100);
      this.burstIdx = 0;
      this.grab = null;
      this.wasDown = false;
      this.nextId = 0;
      this.aspect = 1;
      this.time = 0;
      this.bagR = 0.9;
      this.pointerW = { x: 0, y: 0 };
      this.vacuumTimer = 0;
      this._seed();
    }

    resize() { /* orthographic; nothing to allocate */ }

    /* ---- population ---- */
    _makeQuark(x, y, color, anti) {
      const q = {
        id: this.nextId++, x, y, vx: 0, vy: 0, ax: 0, ay: 0, r: 0.055, color, anti, hadron: null,
        blinkAt: this.time + 1 + Math.random() * 4, blink: 1, worry: 0,
      };
      this.quarks.push(q);
      return q;
    }
    _makeHadron(quarks, type, bandT) {
      const h = { quarks, type, bandT: bandT === undefined ? Math.random() : bandT, energy: 0, born: this.time, bonds: [] };
      for (const q of quarks) q.hadron = h;
      const pairs = type === 'baryon' ? [[0, 1], [1, 2], [2, 0]] : [[0, 1]];
      h.bonds = pairs.map(([a, b]) => ({ a: quarks[a], b: quarks[b], stretch: 0, phase: Math.random() * TAU }));
      this.hadrons.push(h);
      return h;
    }
    _spawnBaryon(x, y) {
      const base = Math.random() * TAU;
      const qs = [0, 1, 2].map((c) => this._makeQuark(x + Math.cos(base + c * TAU / 3) * 0.1, y + Math.sin(base + c * TAU / 3) * 0.1, c, false));
      return this._makeHadron(qs, 'baryon');
    }
    _spawnMeson(x, y, color) {
      const a = Math.random() * TAU;
      const q1 = this._makeQuark(x + Math.cos(a) * 0.08, y + Math.sin(a) * 0.08, color, false);
      const q2 = this._makeQuark(x - Math.cos(a) * 0.08, y - Math.sin(a) * 0.08, color, true);
      return this._makeHadron([q1, q2], 'meson');
    }
    _seed() {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU, r = 0.45;
        this._spawnBaryon(Math.cos(a) * r, Math.sin(a) * r);
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.5, r = 0.2;
        this._spawnMeson(Math.cos(a) * r, Math.sin(a) * r, i % 3);
      }
    }
    _dropHadron(h, keepQuarks) {
      const i = this.hadrons.indexOf(h);
      if (i >= 0) this.hadrons.splice(i, 1);
      if (!keepQuarks) {
        for (const q of h.quarks) {
          const j = this.quarks.indexOf(q);
          if (j >= 0) this.quarks.splice(j, 1);
          if (this.grab === q) this.grab = null;
        }
      }
    }
    _burst(x, y, strength) {
      const i = this.burstIdx * 4;
      this.bursts[i] = x; this.bursts[i + 1] = y; this.bursts[i + 2] = this.time; this.bursts[i + 3] = strength;
      this.burstIdx = (this.burstIdx + 1) % 8;
    }
    _emit(x, y, count, speed, vx0, vy0) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * TAU, s = speed * (0.5 + Math.random());
        this.photons.push({
          x, y, vx: (vx0 || 0) + Math.cos(a) * s, vy: (vy0 || 0) + Math.sin(a) * s,
          life: 1, decay: 0.5 + Math.random() * 0.6, size: 0.028 + Math.random() * 0.04,
          rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 9, t: 0.5 + Math.random() * 0.5,
        });
      }
      while (this.photons.length > MAX_PHOTONS) this.photons.shift();
    }

    /* ---- string breaking: q-qbar pair creation at the break point ---- */
    _break(h, bond) {
      if (this.quarks.length > MAX_QUARKS - 4) return;
      let far, others, bandT = h.bandT;
      if (h.type === 'meson') {
        far = h.quarks.find((q) => !q.anti);
        others = [h.quarks.find((q) => q.anti)];
      } else {
        const k = h.quarks.find((q) => q !== bond.a && q !== bond.b);
        const da = Math.hypot(bond.a.x - (bond.b.x + k.x) / 2, bond.a.y - (bond.b.y + k.y) / 2);
        const db = Math.hypot(bond.b.x - (bond.a.x + k.x) / 2, bond.b.y - (bond.a.y + k.y) / 2);
        far = da > db ? bond.a : bond.b;
        others = h.quarks.filter((q) => q !== far);
      }
      const cx = others.reduce((s, q) => s + q.x, 0) / others.length;
      const cy = others.reduce((s, q) => s + q.y, 0) / others.length;
      const mx = (far.x + cx) / 2, my = (far.y + cy) / 2;
      let dx = far.x - cx, dy = far.y - cy;
      const d = Math.hypot(dx, dy) || 1e-4; dx /= d; dy /= d;
      const vx = (far.vx + others.reduce((s, q) => s + q.vx, 0) / others.length) / 2;
      const vy = (far.vy + others.reduce((s, q) => s + q.vy, 0) / others.length) / 2;
      // New pair: a quark of the far quark's colour goes back to the group, its antiquark follows the far quark.
      const newQ = this._makeQuark(mx - dx * 0.04, my - dy * 0.04, far.color, false);
      const newQb = this._makeQuark(mx + dx * 0.04, my + dy * 0.04, far.color, true);
      newQ.vx = vx - dx * 0.4; newQ.vy = vy - dy * 0.4;
      newQb.vx = vx + dx * 0.4; newQb.vy = vy + dy * 0.4;
      newQ.r = newQb.r = 0.02;   // they grow in
      this._dropHadron(h, true);
      if (h.type === 'meson') {
        this._makeHadron([far, newQb], 'meson', bandT);
        this._makeHadron([newQ, others[0]], 'meson');
      } else {
        this._makeHadron([others[0], others[1], newQ], 'baryon', bandT);
        this._makeHadron([far, newQb], 'meson');
      }
      this._burst(mx, my, 1.0);
      this._emit(mx, my, 3, 0.9, vx, vy);
    }

    _annihilate(h) {
      const [a, b] = h.quarks;
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      this._dropHadron(h, false);
      this._burst(x, y, 0.8);
      this._emit(x, y, 5, 1.2, (a.vx + b.vx) / 2, (a.vy + b.vy) / 2);
    }

    /* ---- physics ---- */
    _physics(dt, audio, P) {
      const quarks = this.quarks, n = quarks.length;
      for (const h of this.hadrons) h.energy = audio.bandMid(h.bandT);   // mids: light & body
      const bagR = (0.93 - 0.34 * audio.kick * P.pressure) * Math.min(1, this.aspect);   // every kick squeezes the bag
      this.bagR += (bagR - this.bagR) * (1 - Math.exp(-dt / 0.035));
      const sub = 3, hstep = dt / sub;
      const jit = audio.high * 28 * P.energy;
      const lbreak = LBREAK * P.tension;
      for (let s = 0; s < sub; s++) {
        for (let i = 0; i < n; i++) { quarks[i].ax = 0; quarks[i].ay = 0; }
        for (const hd of this.hadrons) {
          for (const b of hd.bonds) {
            const a = b.a, c = b.b;
            let dx = c.x - a.x, dy = c.y - a.y;
            const d = Math.hypot(dx, dy) || 1e-4;
            dx /= d; dy /= d;
            const rest = hd.dying ? 0 : (a.r + c.r) * 1.6 + 0.02;
            const ext = d - rest;
            let f;
            if (ext > 0) f = TENSION * Math.min(1, ext / 0.03) * (1 + 0.4 * hd.energy) * (hd.dying ? 3 : 1);
            else f = ext * 50;
            const rv = (c.vx - a.vx) * dx + (c.vy - a.vy) * dy;
            f += rv * BOND_DAMP;
            a.ax += f * dx; a.ay += f * dy;
            c.ax -= f * dx; c.ay -= f * dy;
            b.stretch = clamp(ext / lbreak, 0, 1);
          }
        }
        for (let i = 0; i < n; i++) {
          const a = quarks[i];
          for (let j = i + 1; j < n; j++) {
            const c = quarks[j];
            let dx = c.x - a.x, dy = c.y - a.y;
            const rr = a.r + c.r + 0.012;
            const d2 = dx * dx + dy * dy;
            if (d2 < rr * rr) {
              const d = Math.sqrt(d2) || 1e-4;
              const f = (rr - d) * REPULSE;
              dx /= d; dy /= d;
              a.ax -= f * dx; a.ay -= f * dy;
              c.ax += f * dx; c.ay += f * dy;
            }
          }
        }
        const damp = Math.exp(-hstep * 1.1);
        const wx = this.aspect, wy = 1;
        for (let i = 0; i < n; i++) {
          const q = quarks[i];
          const dc = Math.hypot(q.x, q.y);
          const lim = this.bagR - q.r;
          if (dc > lim) { const f = (dc - lim) * BAG_K; q.ax -= f * q.x / dc; q.ay -= f * q.y / dc; }
          if (jit > 0) { q.ax += (Math.random() - 0.5) * jit; q.ay += (Math.random() - 0.5) * jit; }
          if (this.grab === q) {
            q.ax += (this.pointerW.x - q.x) * GRAB_K - q.vx * GRAB_D;
            q.ay += (this.pointerW.y - q.y) * GRAB_K - q.vy * GRAB_D;
          }
          q.vx = (q.vx + q.ax * hstep) * damp;
          q.vy = (q.vy + q.ay * hstep) * damp;
          q.x += q.vx * hstep;
          q.y += q.vy * hstep;
          if (q.x < -wx + q.r) { q.x = -wx + q.r; q.vx = Math.abs(q.vx) * 0.55; }
          else if (q.x > wx - q.r) { q.x = wx - q.r; q.vx = -Math.abs(q.vx) * 0.55; }
          if (q.y < -wy + q.r) { q.y = -wy + q.r; q.vy = Math.abs(q.vy) * 0.55; }
          else if (q.y > wy - q.r) { q.y = wy - q.r; q.vy = -Math.abs(q.vy) * 0.55; }
        }
      }
    }

    _events(dt, audio, P) {
      // Beats pump energy into hadrons, scaled by each hadron's own frequency band.
      if (audio.onset) {
        const k = (0.6 + 1.3 * audio.beat) * P.energy;
        for (const hd of this.hadrons) {
          const e = 0.3 + 1.4 * hd.energy;
          for (const q of hd.quarks) {
            const a = Math.random() * TAU, m = k * e * (0.6 + 0.8 * Math.random());
            q.vx += Math.cos(a) * m; q.vy += Math.sin(a) * m;
          }
        }
      }
      // Highs: sparkle — a photon star pops off a random quark on high-frequency onsets.
      if (audio.highOnset && this.quarks.length) {
        const q = this.quarks[Math.floor(Math.random() * this.quarks.length)];
        this._emit(q.x, q.y, 1, 0.5 + audio.high, q.vx, q.vy);
      }
      // String breaking (pair creation): one at a time, with a short cooldown, only while there is room.
      const pop = P.population;
      this.breakCooldown = Math.max(0, (this.breakCooldown || 0) - dt);
      if (this.breakCooldown <= 0 && this.quarks.length < pop) {
        let best = null, bestStretch = 1;
        for (const hd of this.hadrons) {
          if (hd.dying) continue;
          for (const b of hd.bonds) if (b.stretch >= bestStretch) { bestStretch = b.stretch; best = { hd, b }; }
        }
        if (best) { this._break(best.hd, best.b); this.breakCooldown = 0.14; }
      }
      // Crowding: mesons are pulled together and annihilate into photons.
      const nq = this.quarks.length;
      const pressure = clamp((nq - pop * 0.4) / (pop * 0.45), 0, 1);
      if (Math.random() < (0.06 + 4.0 * pressure) * dt) {
        const cands = this.hadrons.filter((h) => h.type === 'meson' && !h.dying && this.time - h.born > 2);
        if (cands.length) cands[Math.floor(Math.random() * cands.length)].dying = this.time;
      }
      for (const hd of this.hadrons.slice()) {
        if (hd.type !== 'meson') continue;
        const [a, c] = hd.quarks;
        const d = Math.hypot(c.x - a.x, c.y - a.y);
        if (hd.dying && (d < (a.r + c.r) * 0.9 || this.time - hd.dying > 2.5)) this._annihilate(hd);
      }
      // Vacuum fluctuations keep a quiet soup alive.
      this.vacuumTimer += dt;
      if (nq < 26 && this.vacuumTimer > 2.5) {
        this.vacuumTimer = 0;
        const a = Math.random() * TAU, r = Math.random() * this.bagR * 0.7;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        const h = this._spawnMeson(x, y, Math.floor(Math.random() * 3));
        for (const q of h.quarks) q.r = 0.02;
        this._burst(x, y, 0.5);
        this._emit(x, y, 2, 0.6);
      }
      // Grow-in, blinking, worry.
      for (const q of this.quarks) {
        const target = 0.055 * (1 + 0.45 * q.hadron.energy);
        q.r += (target - q.r) * (1 - Math.exp(-dt / 0.12));
        let worry = 0;
        for (const b of q.hadron.bonds) if (b.a === q || b.b === q) worry = Math.max(worry, b.stretch);
        q.worry += (worry - q.worry) * (1 - Math.exp(-dt / 0.08));
        const bt = this.time - q.blinkAt;
        if (bt > 0) {
          if (bt < 0.16) q.blink = 0.1 + 0.9 * Math.abs(bt / 0.08 - 1);
          else { q.blink = 1; q.blinkAt = this.time + 1.5 + Math.random() * 5; }
        }
      }
      // Photons.
      const k = Math.exp(-dt * 0.9);
      for (let i = this.photons.length - 1; i >= 0; i--) {
        const p = this.photons[i];
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= k; p.vy *= k;
        p.rot += p.spin * dt;
        p.life -= p.decay * dt;
        if (p.life <= 0) this.photons.splice(i, 1);
      }
    }

    /* ---- render ---- */
    render(target, audio, u) {
      const gl = this.gl, P = u.params;
      this.aspect = u.aspect;
      this.time = u.time;
      this.pointerW.x = (u.pointer.x - 0.5) * 2 * this.aspect;
      this.pointerW.y = (u.pointer.y - 0.5) * 2;
      if (u.pointer.down && !this.wasDown) {
        let best = null, bd = 0.2;
        for (const q of this.quarks) {
          const d = Math.hypot(q.x - this.pointerW.x, q.y - this.pointerW.y);
          if (d < bd) { bd = d; best = q; }
        }
        this.grab = best;
      }
      if (!u.pointer.down) this.grab = null;
      this.wasDown = u.pointer.down;

      // Window moved: the soup is inertial in screen space (see the gravity sandbox).
      const sh = 2 / Math.max(1, window.innerHeight);
      const shiftX = -u.motion.dx * sh, shiftY = u.motion.dy * sh;
      if (shiftX || shiftY) {
        for (const q of this.quarks) { q.x += shiftX; q.y += shiftY; }
        for (const p of this.photons) { p.x += shiftX; p.y += shiftY; }
      }

      const dt = Math.min(u.dt, 0.05);
      this._physics(dt, audio, P);
      this._events(dt, audio, P);

      // --- fill instance data ---
      let nb = 0;
      const sd = this.stringData;
      for (const hd of this.hadrons) {
        for (const b of hd.bonds) {
          if (nb >= MAX_BONDS) break;
          const o = nb * 8;
          sd[o] = b.a.x; sd[o + 1] = b.a.y; sd[o + 2] = b.b.x; sd[o + 3] = b.b.y;
          sd[o + 4] = b.stretch; sd[o + 5] = b.phase; sd[o + 6] = hd.bandT; sd[o + 7] = hd.energy;
          nb++;
        }
      }
      const qd = this.quarkData;
      const mouthBase = clamp(audio.level * 0.5 + audio.beat * 0.35, 0, 1);
      let nq = 0;
      for (const q of this.quarks) {
        if (nq >= MAX_QUARKS) break;
        const o = nq * 10;
        const col = q.anti ? ANTI[q.color] : CHARGE[q.color];
        const bright = (0.62 + 0.45 * q.hadron.energy) * (q.hadron.dying ? 1.6 : 1);
        qd[o] = q.x; qd[o + 1] = q.y; qd[o + 2] = q.r;
        qd[o + 3] = col[0] * bright; qd[o + 4] = col[1] * bright; qd[o + 5] = col[2] * bright;
        qd[o + 6] = q.blink; qd[o + 7] = clamp(mouthBase * (0.4 + 0.9 * q.hadron.energy), 0, 1); qd[o + 8] = q.worry; qd[o + 9] = q.id;
        nq++;
      }
      const pd = this.photonData;
      let np = 0;
      for (const p of this.photons) {
        if (np >= MAX_PHOTONS) break;
        const o = np * 6;
        pd[o] = p.x; pd[o + 1] = p.y; pd[o + 2] = p.size * (0.6 + 0.4 * p.life); pd[o + 3] = p.rot;
        pd[o + 4] = p.t; pd[o + 5] = clamp(p.life * 1.5, 0, 1);
        np++;
      }

      // --- draw ---
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      const bg = this.progBg.use();
      this.ctx.setCommon(bg, audio, u);
      bg.f('uBag', this.bagR).f4v('uBursts', this.bursts);
      this.ctx.drawQuad();

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      if (nb) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.stringBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, sd, 0, nb * 8);
        const p = this.progString.use();
        this.ctx.setCommon(p, audio, u);
        p.f('uAspect', this.aspect);
        gl.bindVertexArray(this.vaoString);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 2 * (SEG + 1), nb);
      }
      if (nq) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quarkBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, qd, 0, nq * 10);
        const p = this.progQuark.use();
        p.f('uAspect', this.aspect).f2('uRes', u.width, u.height).f('uFaces', P.faces)
          .f3('uOutline', u.palette[0] * 0.35, u.palette[1] * 0.35, u.palette[2] * 0.35);
        gl.bindVertexArray(this.vaoQuark);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nq);
      }
      if (np) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.photonBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, pd, 0, np * 6);
        const p = this.progPhoton.use();
        this.ctx.setCommon(p, audio, u);
        p.f('uAspect', this.aspect);
        gl.bindVertexArray(this.vaoPhoton);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, np);
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.BLEND);
    }

    dispose() {
      const gl = this.gl;
      [this.progBg, this.progString, this.progQuark, this.progPhoton].forEach((p) => p.dispose());
      [this.quadBuf, this.stripBuf, this.stringBuf, this.quarkBuf, this.photonBuf].forEach((b) => gl.deleteBuffer(b));
      [this.vaoString, this.vaoQuark, this.vaoPhoton].forEach((v) => gl.deleteVertexArray(v));
    }
  }

  VIZ.registerScene({
    id: 'quarks',
    name: 'Quark Soup',
    blurb: 'Colour-charged quarks on gluon strings. Beats stretch the strings until they snap into new quark pairs. Drag a quark; shake the window.',
    params: [
      { key: 'energy', label: 'Beat energy', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'tension', label: 'String toughness', min: 0.4, max: 2.5, step: 0.05, value: 1 },
      { key: 'pressure', label: 'Bass squeeze', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'population', label: 'Max quarks', min: 30, max: 200, step: 10, value: 60, fmt: (v) => String(v) },
      { key: 'faces', label: 'Faces', min: 0, max: 1, step: 1, value: 1, fmt: (v) => (v ? 'on' : 'off') },
    ],
    create: (ctx) => new QuarkScene(ctx),
  });
})();

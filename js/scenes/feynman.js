/* feynman.js — Feynman Diagrams.
 * Spacetime scrolls past (time runs left to right, so the diagrams drift left), and the music
 * writes particle interactions onto it in Feynman's notation: fermions as arrowed lines, photons
 * wavy, gluons curly, W and Z bosons dashed, loops for virtual pairs. Each diagram draws itself
 * in time order, with a glowing quantum riding along every line.
 *   bass  -> every kick writes a big two-vertex process: an annihilation (s-channel) or an
 *            exchange (t-channel), and the scroll surges
 *   mids  -> a mid onset writes an emission or a vacuum-polarisation loop; lines glow with the mids
 *   highs -> vacuum bubbles: little virtual-pair loops pop in and out
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NSEG = 56, NVTX = 20;
  const FERMION = 0, PHOTON = 1, GLUON = 2, WEAK = 3, LOOP = 4;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define NSEG ${NSEG}
#define NVTX ${NVTX}
uniform vec4 uSeg[NSEG];     // a.xy, b.xy (LOOP: centre.xy, radius, -)
uniform vec4 uInfo[NSEG];    // type (-1 = unused), colour t, reveal 0..1, alpha
uniform vec3 uVtx[NVTX];     // x, y, alpha
uniform float uScroll;
uniform float uScale;

float lineMask(float d, float w, float px) { return 1.0 - smoothstep(w, w + 1.5 * px, d); }

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  vec3 col = palette(0.0) * 0.12;
  // Scrolling spacetime grid (time -> right) and faint light-cone diagonals.
  vec2 g = vec2(p.x + uScroll, p.y) * 10.0;
  vec2 gf = abs(fract(g) - 0.5);
  float grid = 1.0 - smoothstep(0.0, 0.03 + px * 10.0, min(gf.x, gf.y));
  col += palette(0.3) * grid * 0.05;
  vec2 lc = vec2(p.x + uScroll + p.y, p.x + uScroll - p.y) * 2.5;
  vec2 lf = abs(fract(lc) - 0.5);
  col += palette(0.5) * (1.0 - smoothstep(0.0, 0.01 + px * 3.0, min(lf.x, lf.y))) * 0.02;

  float w = 0.0022 * uScale;
  for (int i = 0; i < NSEG; i++) {
    vec4 inf = uInfo[i];
    if (inf.x < 0.0) continue;
    int type = int(inf.x + 0.5);
    vec4 s = uSeg[i];
    vec3 c = palette(inf.y) * (0.6 + 1.6 * uMid);
    float m = 0.0;
    float rideU = 0.0;
    if (type == ${LOOP}) {
      vec2 d = p - s.xy;
      float ang = atan(d.y, d.x);
      float rev = step(fract(ang / 6.2831853 + 0.25), inf.z);
      float dd = abs(length(d) - s.z);
      m = lineMask(dd, w, px) * rev;
      float rp = fract(uTime * 0.5 + inf.y * 3.0) * 6.2831853;
      vec2 rq = s.xy + s.z * vec2(cos(rp), sin(rp));
      m += exp(-dot(p - rq, p - rq) / (w * w * 6.0)) * 1.5 * step(0.99, inf.z);
    } else {
      vec2 ab = s.zw - s.xy;
      float L = length(ab);
      if (L < 1e-5) continue;
      vec2 t = ab / L;
      vec2 n = vec2(-t.y, t.x);
      vec2 q = p - s.xy;
      float u = dot(q, t), v = dot(q, n);
      float shown = L * inf.z;
      if (u < -0.03 || u > shown + 0.03) continue;
      float inside = step(0.0, u) * step(u, shown);
      float dd;
      if (type == ${PHOTON}) {
        float A = 0.007 * uScale, k = 6.2831853 / (0.022 * uScale);
        float y = A * sin(k * u);
        dd = abs(v - y) / sqrt(1.0 + pow(A * k * cos(k * u), 2.0));
      } else if (type == ${GLUON}) {
        float A = 0.007 * uScale, lam = A * 1.4;
        float cu = (floor(u / lam) + 0.5) * lam;
        dd = abs(length(vec2(u - cu, v - A * 0.6)) - A);
        dd = min(dd, abs(length(vec2(u - cu - lam, v - A * 0.6)) - A));
      } else if (type == ${WEAK}) {
        dd = abs(v) + (step(0.55, fract(u / (0.016 * uScale))) * 1.0);
      } else {
        dd = abs(v);
        // Arrow at the middle.
        float au = u - L * 0.5;
        float aw = 0.009 * uScale;
        if (abs(au) < aw && inf.z > 0.55) {
          float hw = (aw - au) * 0.55;
          if (abs(v) < hw) dd = 0.0;
        }
      }
      m = lineMask(dd, w, px) * inside;
      // A quantum riding along the line.
      float ru = fract(uTime * 0.35 + inf.y * 5.0) * shown;
      vec2 rq = vec2(ru - u, v);
      m += exp(-dot(rq, rq) / (w * w * 8.0)) * 1.4 * inside;
    }
    col += c * m * inf.w;
    col += c * m * inf.w * 0.15 * (1.0 + uMidPulse);
  }
  for (int i = 0; i < NVTX; i++) {
    vec3 vx = uVtx[i];
    if (vx.z <= 0.0) continue;
    float d = length(p - vx.xy);
    col += (palette(1.0) + 0.4) * (exp(-d * d / (w * w * 5.0)) * 2.0 + exp(-d / (w * 8.0)) * 0.15) * vx.z;
  }
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // Templates in local units (time -> +x). Each segment: [type, ax, ay, bx, by, order].
  const TEMPLATES = {
    schannel: (b) => ({ segs: [[FERMION, -0.18, -0.12, -0.06, 0, 0], [FERMION, -0.06, 0, -0.18, 0.12, 0], [b, -0.06, 0, 0.06, 0, 1], [FERMION, 0.06, 0, 0.18, 0.12, 2], [FERMION, 0.18, -0.12, 0.06, 0, 2]], vtx: [[-0.06, 0], [0.06, 0]] }),
    tchannel: (b) => ({ segs: [[FERMION, -0.18, 0.1, 0, 0.1, 0], [FERMION, 0, 0.1, 0.18, 0.13, 2], [FERMION, -0.18, -0.1, 0, -0.1, 0], [FERMION, 0, -0.1, 0.18, -0.13, 2], [b, 0, 0.1, 0, -0.1, 1]], vtx: [[0, 0.1], [0, -0.1]] }),
    emission: () => ({ segs: [[FERMION, -0.15, 0, 0, 0, 0], [FERMION, 0, 0, 0.15, -0.05, 1], [PHOTON, 0, 0, 0.13, 0.1, 1]], vtx: [[0, 0]] }),
    polar: () => ({ segs: [[PHOTON, -0.16, 0, -0.05, 0, 0], [LOOP, 0, 0, 0.05, 0, 1], [PHOTON, 0.05, 0, 0.16, 0, 2]], vtx: [[-0.05, 0], [0.05, 0]] }),
    bubble: () => ({ segs: [[LOOP, 0, 0, 0.018 + Math.random() * 0.02, 0, 0]], vtx: [] }),
  };

  class FeynmanScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'feynman');
      this.trig = new VIZ.KickTrigger(0.35);
      this.diagrams = [];
      this.scroll = 0;
      this.boost = 0;
      this.seg = new Float32Array(NSEG * 4);
      this.info = new Float32Array(NSEG * 4);
      this.vtx = new Float32Array(NVTX * 3);
      this.asp = 1.6;
      this.idle = 0;
      this.lastX = -1e9;
      this.lastS = 1;
    }
    _spawn(kind, scale, life) {
      const boson = pick([PHOTON, GLUON, WEAK, PHOTON]);
      const tpl = TEMPLATES[kind](boson);
      const half = this.asp / 2;
      // Diagrams queue up in time order along the timeline; bubbles pop up anywhere.
      let x;
      if (kind === 'bubble') {
        x = this.scroll + (Math.random() - 0.2) * half;
      } else {
        x = Math.max(this.scroll + half - 0.22 * scale, this.lastX + 0.2 * (this.lastS + scale));
        if (x - this.scroll > half + 0.5) return;        // the queue is full: skip this one
        this.lastX = x; this.lastS = scale;
      }
      this.diagrams.push({
        x,                                             // world x (scrolls with time)
        y: kind === 'bubble' ? (Math.random() - 0.5) * 0.8 : (Math.random() - 0.5) * 0.5,
        s: scale, age: 0, life,
        col: Math.random(), tpl,
      });
      // Keep the segment budget.
      let n = this.diagrams.reduce((a, d) => a + d.tpl.segs.length, 0);
      while (n > NSEG && this.diagrams.length) n -= this.diagrams.shift().tpl.segs.length;
    }
    resize(w, h) { this.asp = w / Math.max(1, h); }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      this.asp = u.width / u.height;
      const k = audio.kick;
      this.boost += (k - this.boost) * (1 - Math.exp(-dt / (k > this.boost ? 0.05 : 0.6)));
      this.scroll += dt * 0.13 * P.speed * (1 + 1.5 * this.boost);
      const hit = this.trig.update(k);
      if (hit) this._spawn(Math.random() < 0.55 ? 'schannel' : 'tchannel', (0.9 + 0.5 * hit) * P.size, 99);
      if (audio.midOnset && audio.midPulse > 0.6 && Math.random() < 0.5 * P.mids) this._spawn(Math.random() < 0.6 ? 'emission' : 'polar', 0.7 * P.size, 99);
      if (audio.highOnset && Math.random() < 0.7 * P.bubbles) this._spawn('bubble', P.size, 0.8 + Math.random() * 0.8);
      // Idle: an occasional diagram so it is never empty.
      this.idle += dt;
      if (this.idle > 4) { this.idle = 0; if (this.diagrams.length < 2) this._spawn('emission', 0.8 * P.size, 99); }
      if (hit) this.idle = 0;

      const half = this.asp / 2;
      this.diagrams = this.diagrams.filter((d) => d.age < d.life && d.x - this.scroll > -half - 0.4 * d.s);
      this.info.fill(0);
      for (let i = 0; i < NSEG; i++) this.info[i * 4] = -1;
      this.vtx.fill(0);
      let si = 0, vi = 0;
      for (const d of this.diagrams) {
        d.age += dt;
        const ox = d.x - this.scroll, oy = d.y, s = d.s;
        const fadeOut = d.life < 50 ? Math.max(0, Math.min(1, (d.life - d.age) / 0.3)) : 1;
        const edge = Math.min(1, Math.max(0, (ox + half + 0.3 * s) / 0.3));
        const alpha = Math.min(1, d.age / 0.15) * fadeOut * edge;
        for (const sg of d.tpl.segs) {
          if (si >= NSEG) break;
          const [type, ax, ay, bx, by, order] = sg;
          const reveal = Math.max(0, Math.min(1, (d.age - order * 0.18) / 0.22));
          const o = si * 4;
          if (type === LOOP) {
            this.seg[o] = ox + ax * s; this.seg[o + 1] = oy + ay * s; this.seg[o + 2] = bx * s; this.seg[o + 3] = 0;
          } else {
            this.seg[o] = ox + ax * s; this.seg[o + 1] = oy + ay * s; this.seg[o + 2] = ox + bx * s; this.seg[o + 3] = oy + by * s;
          }
          this.info[o] = type;
          this.info[o + 1] = (d.col + (type === FERMION ? 0 : 0.35 + 0.15 * type)) % 1 * 0.65 + 0.3;
          this.info[o + 2] = reveal;
          this.info[o + 3] = alpha;
          si++;
        }
        for (const v of d.tpl.vtx) {
          if (vi >= NVTX) break;
          this.vtx[vi * 3] = ox + v[0] * s; this.vtx[vi * 3 + 1] = oy + v[1] * s;
          this.vtx[vi * 3 + 2] = alpha * Math.min(1, Math.max(0, (d.age - 0.15) / 0.2)) * (1 + 1.5 * audio.beatPulse);
          vi++;
        }
      }
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f4v('uSeg', this.seg).f4v('uInfo', this.info).f3v('uVtx', this.vtx).f('uScroll', this.scroll).f('uScale', 1);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'feynman',
    name: 'Feynman Diagrams',
    blurb: 'Spacetime scrolls by and the music writes particle physics onto it: kicks are annihilations and exchanges, mid hits emissions, highs pop virtual-pair bubbles.',
    params: [
      { key: 'speed', label: 'Scroll speed', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'size', label: 'Diagram size', min: 0.5, max: 2, step: 0.05, value: 1 },
      { key: 'mids', label: 'Emissions on mid hits', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'bubbles', label: 'Vacuum bubbles on highs', min: 0, max: 1.5, step: 0.05, value: 1 },
    ],
    create: (ctx) => new FeynmanScene(ctx),
  });
})();

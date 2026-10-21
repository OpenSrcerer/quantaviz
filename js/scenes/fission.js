/* fission.js — Chain Reaction.
 * A textbook figure that won't sit still: a lattice of uranium-235 nuclei on blueprint paper.
 * A neutron hits a nucleus, it becomes uranium-236 in an excited state, wobbles like a liquid drop,
 * necks, and tears in two: barium and krypton (or xenon and strontium, or caesium and rubidium),
 * flying apart on their Coulomb repulsion, plus two or three fresh neutrons and a gamma ray. If
 * enough of those neutrons find more uranium before they leak out or get swallowed by the boron
 * control rods, it's a chain reaction. The instruments on the right count it all: the neutron
 * population, k_eff (neutrons born per neutron lost; above 1 the reaction grows), power, dose rate
 * and a Geiger counter. If the population runs away, the reactor SCRAMs and drops every rod.
 * Off to the side, deuterium and tritium fuse into helium and a fast neutron, and the fission
 * fragments beta-decay into their daughters (the labels change as they do).
 *   bass  -> kicks fire the neutron source at the fuel, harder kicks at more nuclei; the bass
 *            level pulls the control rods out, so loud passages run hotter and longer
 *   mids  -> D-T fusion events, and the Cherenkov glow of the core
 *   highs -> beta decays of the fragments (and the Geiger counter's clicks)
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const TAU = Math.PI * 2;
  const B = 0.0078;                 // nucleon radius (world units, screen height = 1)
  const MAX_N = 150;                // free neutrons alive at once
  const SCRAM_N = 55;               // population that trips the SCRAM
  const MAX_SPR = 5000;
  const NFL = 16;                   // GL glows
  const V_N = 0.4;                  // neutron speed
  const PROTON = [0.86, 0.2, 0.15], NEUTRON = [0.72, 0.77, 0.84];
  const SYM = ['n', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
    'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
    'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
    'Pm', 'Sm', 'Eu', 'Gd'];
  SYM[92] = 'U';
  // n + U-235 -> heavy + light + nu neutrons. Mass numbers and charges both add up.
  const CHANNELS = [
    [141, 56, 92, 36, 3], [140, 54, 94, 38, 2], [137, 55, 96, 37, 3], [144, 56, 89, 36, 3],
    [134, 52, 100, 40, 2], [139, 53, 95, 39, 2], [132, 50, 101, 42, 3],
  ];
  const MONO = '"Lucida Console", "Courier New", "DejaVu Sans Mono", monospace';
  const UI = 'Tahoma, Verdana, "DejaVu Sans", sans-serif';
  const INK = 'rgb(214, 232, 255)';
  const DIM = 'rgba(190, 215, 245, 0.5)';
  const AMBER = 'rgb(255, 184, 64)';
  const RED = 'rgb(255, 72, 56)';
  const GREEN = 'rgb(110, 240, 120)';
  const CYAN = 'rgb(120, 220, 255)';
  const iso = (A, Z) => VIZ.sup(A) + SYM[Z];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sci = (x) => {
    if (x <= 0) return '0';
    const e = Math.floor(Math.log10(x));
    return (x / Math.pow(10, e)).toFixed(1) + '×10' + VIZ.sup(e);
  };

  const SPR_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aA;      // x, y, radius, glow
layout(location = 1) in vec4 aC;      // rgb, alpha
uniform float uAsp;
out vec2 vQ;
out vec4 vC;
out float vG;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  float pad = aA.w > 0.001 ? 3.0 : 1.15;
  vQ = c * pad;
  vec2 p = aA.xy + c * aA.z * pad;
  gl_Position = vec4(p.x * 2.0 / uAsp, p.y * 2.0, 0.0, 1.0);
  vC = aC;
  vG = aA.w;
}`;
  const SPR_FS = `#version 300 es
precision highp float;
in vec2 vQ;
in vec4 vC;
in float vG;
out vec4 fragColor;
uniform vec3 uHot;
void main() {
  float d = length(vQ);
  float aa = fwidth(d) * 1.2;
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  vec3 n = vec3(vQ, sqrt(max(0.0, 1.0 - d * d)));
  vec3 L = normalize(vec3(-0.55, 0.6, 0.75));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(reflect(-L, n).z, 0.0), 22.0);
  vec3 col = vC.rgb * (0.22 + 0.9 * diff) + vec3(spec * 0.55);
  col = mix(col, vec3(0.02, 0.03, 0.05), smoothstep(0.78, 0.98, d) * 0.85);   // the ink outline of a textbook drawing
  col += uHot * vG * 0.8 * (1.0 - d * d * 0.6);
  float halo = vG * exp(-max(d - 1.0, 0.0) * 2.5) * step(1.0, d) * 0.18;
  float a = disc * vC.a;
  fragColor = vec4(col * a + uHot * halo * vC.a, a);
}`;

  const BG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform vec4 uField;               // x0, y0, x1, y1
uniform float uCore;               // Cherenkov glow 0..1
uniform vec4 uGlow[${NFL}];        // x, y, radius, intensity
uniform vec3 uGlowC[${NFL}];
uniform int uNG;
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  // Blueprint paper: deep blue, faint grid, a little mottling.
  vec3 col = vec3(0.012, 0.035, 0.07) * (0.85 + 0.3 * noise2(p * 6.0)) * (1.15 - 0.45 * length(p));
  vec2 g1 = abs(fract(p / 0.025 + 0.5) - 0.5) * 0.025;
  vec2 g2 = abs(fract(p / 0.1 + 0.5) - 0.5) * 0.1;
  float minor = 1.0 - smoothstep(0.0, px * 0.9, min(g1.x, g1.y));
  float major = 1.0 - smoothstep(0.0, px * 1.2, min(g2.x, g2.y));
  col += vec3(0.25, 0.5, 0.75) * (minor * 0.035 + major * 0.08);
  // The core: water, and the blue Cherenkov light fast particles make in it.
  vec2 q = clamp(p, uField.xy, uField.zw);
  float inside = 1.0 - smoothstep(0.0, 0.02, length(p - q));
  float shimmer = 0.6 + 0.4 * fbm2(p * 7.0 + vec2(uTime * 0.15, -uTime * 0.1));
  col += vec3(0.012, 0.04, 0.09) * inside * (0.6 + 0.4 * shimmer);
  col += vec3(0.08, 0.3, 1.0) * inside * uCore * shimmer * 0.22;
  for (int i = 0; i < ${NFL}; i++) {
    if (i >= uNG) break;
    vec4 g = uGlow[i];
    float d = length(p - g.xy) / g.z;
    col += uGlowC[i] * g.w * (exp(-d * d * 2.5) * 0.8 + exp(-d * 1.6) * 0.1);
  }
  col *= 0.75 + 0.4 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  function relax(balls, R) {
    const n = balls.length, minD = 2 * B * 0.9, lim = Math.max(0, R - B * 0.55);
    for (let it = 0; it < 30; it++) {
      for (let i = 0; i < n; i++) {
        const a = balls[i];
        for (let j = i + 1; j < n; j++) {
          const b = balls[j];
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const d = Math.hypot(dx, dy, dz) || 1e-6;
          if (d < minD) {
            const k = (minD - d) / d * 0.5;
            a.x -= dx * k; a.y -= dy * k; a.z -= dz * k;
            b.x += dx * k; b.y += dy * k; b.z += dz * k;
          }
        }
      }
      for (const a of balls) {
        const d = Math.hypot(a.x, a.y, a.z);
        if (d > lim) { const k = lim / d; a.x *= k; a.y *= k; a.z *= k; }
        else { a.x *= 0.985; a.y *= 0.985; a.z *= 0.985; }   // gentle pull inward packs it
      }
    }
    return balls;
  }
  const radiusFor = (n) => B * 1.12 * Math.cbrt(n);
  function makeBalls(nP, nN) {
    const n = nP + nN, R = radiusFor(n);
    const balls = [];
    for (let i = 0; i < n; i++) {
      let x, y, z;
      do { x = rnd(-1, 1); y = rnd(-1, 1); z = rnd(-1, 1); } while (x * x + y * y + z * z > 1);
      balls.push({ x: x * R, y: y * R, z: z * R, p: false, ph: Math.random() * TAU, pc: 0 });
    }
    relax(balls, R);
    const idx = balls.map((_, i) => i).sort(() => Math.random() - 0.5);
    for (let i = 0; i < nP; i++) { balls[idx[i]].p = true; balls[idx[i]].pc = 1; }
    balls.sort((a, b) => a.z - b.z);
    return balls;
  }

  class FissionScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.bg = ctx.fsProgram(BG, 'fission-bg');
      this.spr = ctx.program(SPR_VS, SPR_FS, { label: 'fission-nucleons' });
      this.hud = new VIZ.Hud(ctx);
      this.inst = new Float32Array(MAX_SPR * 8);
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
      gl.vertexAttribDivisor(1, 1);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.glowU = new Float32Array(NFL * 4);
      this.glowC = new Float32Array(NFL * 3);

      this.trig = new VIZ.KickTrigger(0.32);
      this.layoutAsp = 0;
      this.nuclei = [];
      this.sites = [];
      this.neutrons = [];
      this.gammas = [];
      this.betas = [];
      this.beams = [];
      this.glows = [];
      this.events = [];             // floating labels and marks
      this.fusions = [];            // D and T on their way in
      this.rodIns = 0.7;
      this.bassS = 0;
      this.boost = 0;
      this.scram = 0;
      this.fusCool = 0;
      this.core = 0;
      this.t = 0;
      // Instruments: 0.1 s bins for rates, a 15 s population history.
      this.bins = Array.from({ length: 30 }, () => ({ born: 0, lost: 0, fis: 0, fus: 0, mev: 0, rad: 0 }));
      this.bin = 0;
      this.binT = 0;
      this.hist = new Float32Array(150);
      this.histT = 0;
      this.k = 0;
      this.energy = 0;
      this.clicks = [];
      this.led = 0;
      this.dose = 0.12;
      this.lastEq = CHANNELS[0];
      this.quietT = 10;
    }

    _layout(asp, panels) {
      // Without the instrument panel and legend, the core gets the whole screen.
      const m = 0.035;
      const panel = panels ? Math.min(0.36, asp * 0.3) : 0;
      this.F = [-asp / 2 + m + 0.07, -0.5 + (panels ? 0.19 : 0.06), asp / 2 - m - panel - (panels ? 0.035 : 0.01), 0.5 - (panels ? 0.085 : 0.05)];
      this.panelW = panel;
      const [x0, y0, x1, y1] = this.F;
      const nR = Math.max(2, Math.round((x1 - x0) / 0.4));
      this.rods = [];
      for (let i = 0; i < nR; i++) this.rods.push(x0 + (x1 - x0) * (i + 0.5) / nR);
      this.sites = [];
      // A new layout starts a clean core; leftovers would sit outside the new frame.
      this.nuclei = []; this.neutrons = []; this.gammas = []; this.betas = []; this.beams = []; this.fusions = []; this.events = [];
      const S = 0.122, rowH = S * 0.866;
      for (let r = 0, y = y0 + 0.07; y < y1 - 0.06; r++, y += rowH) {
        for (let x = x0 + 0.07 + (r & 1) * S * 0.5; x < x1 - 0.06; x += S) {
          if (this.rods.some((rx) => Math.abs(rx - x) < 0.055)) continue;
          const site = { x: x + rnd(-0.012, 0.012), y: y + rnd(-0.012, 0.012), nuc: null, timer: rnd(0, 0.6) };
          this.sites.push(site);
        }
      }
      this.src = [x0 - 0.045, (y0 + y1) / 2];
      this.layoutAsp = asp;
      this.layoutPanels = panels;
    }

    _fuel(site) {
      const n = { kind: 'fuel', x: site.x, y: site.y, vx: 0, vy: 0, rot: Math.random() * TAU, spin: rnd(-0.4, 0.4),
        balls: makeBalls(14, 22), A: 235, Z: 92, state: 'idle', t: 0, alpha: 0, scale: 0.6, heat: 0, age: 0, site };
      n.R = radiusFor(36);
      site.nuc = n;
      this.nuclei.push(n);
      return n;
    }

    _glow(x, y, r, i, c) {
      this.glows.push({ x, y, r, i, c });
    }

    _event(x, y, text, color, life, opts = {}) {
      this.events.push(Object.assign({ x, y, text, color, life, age: 0, rise: 0.03, size: 1 }, opts));
    }

    _stat(key, v = 1) { this.bins[this.bin][key] += v; }

    _excite(n, fromX, fromY, dur) {
      if (n.state !== 'idle') return;
      n.state = 'excited';
      n.t = 0;
      n.dur = dur;
      n.spin = 0;
      const ch = CHANNELS[(Math.random() * CHANNELS.length) | 0];
      n.ch = ch;
      // The captured neutron joins the drop, sliding in from where it hit.
      const c = Math.cos(-n.rot), s = Math.sin(-n.rot);
      const lx = (fromX - n.x) * c - (fromY - n.y) * s, ly = (fromX - n.x) * s + (fromY - n.y) * c;
      n.balls.push({ x: lx, y: ly, z: n.R * 0.5, p: false, ph: 0, pc: 0, inT: 0, ix: lx, iy: ly });
      // Pick the fission axis, the neck neutrons that will fly free, and which side each ball goes.
      const axis = Math.random() * TAU;
      n.ax = Math.cos(axis); n.ay = Math.sin(axis);
      const proj = n.balls.map((b, i) => ({ i, a: b.x * n.ax + b.y * n.ay, p: b.p }));
      const neck = proj.filter((q) => !q.p).sort((q, r) => Math.abs(q.a) - Math.abs(r.a)).slice(0, ch[4]);
      for (const q of neck) n.balls[q.i].side = 0;
      const rest = proj.filter((q) => n.balls[q.i].side !== 0).sort((q, r) => q.a - r.a);
      const cut = Math.round(rest.length * ch[0] / (ch[0] + ch[2]));
      rest.forEach((q, k) => { n.balls[q.i].side = k < cut ? -1 : 1; });
      n.A = 236;
      this._glow(n.x, n.y, 0.04, 0.25, [0.5, 0.75, 1.0]);
    }

    _ballPos(n, b) {
      // Local position of a ball, including the excitation's stretch and the fragments' settling.
      let x = b.x, y = b.y;
      if (b.inT !== undefined && b.inT < 1) { const e = b.inT * b.inT * (3 - 2 * b.inT); x = b.ix * (1 - e) + b.x * e; y = b.iy * (1 - e) + b.y * e; }
      if (n.state === 'excited') {
        const t = Math.min(1, n.t / n.dur);
        const a = x * n.ax + y * n.ay;
        const qx = x - a * n.ax, qy = y - a * n.ay;
        const wob = Math.sin(n.t * 55) * 0.18 * (1 - t) * n.R;
        const sep = n.R * (1.1 * t * t) + wob;
        const along = b.side === 0 ? a * (1 - t) : a * (1 + 0.25 * t) + b.side * sep;
        const sq = b.side === 0 ? 1 - 0.6 * t : 1 - 0.28 * t;
        x = n.ax * along + qx * sq;
        y = n.ay * along + qy * sq;
      }
      if (b.tx !== undefined && n.age < 0.7) {
        const t = Math.min(1, n.age / 0.7);
        const e = 1 - Math.pow(1 - t, 3) + Math.sin(t * 14) * 0.08 * (1 - t);   // settle with a liquid-drop jiggle
        x = b.sx + (b.tx - b.sx) * e; y = b.sy + (b.ty - b.sy) * e;
      }
      return [x, y];
    }

    _split(n) {
      const ch = n.ch;
      const groups = { '-1': [], '1': [] };
      const born = [];
      const c = Math.cos(n.rot), s = Math.sin(n.rot);
      for (const b of n.balls) {
        const [lx, ly] = this._ballPos(n, b);
        if (b.side === 0) born.push([n.x + lx * c - ly * s, n.y + lx * s + ly * c]);
        else groups[b.side].push({ x: lx, y: ly, z: b.z, p: b.p, ph: b.ph, pc: b.pc });
      }
      const speeds = { '-1': 0.24, '1': 0.24 * ch[0] / ch[2] };      // momentum conservation: the light one is faster
      for (const side of ['-1', '1']) {
        const g = groups[side];
        if (!g.length) continue;
        let cx = 0, cy = 0;
        for (const b of g) { cx += b.x; cy += b.y; }
        cx /= g.length; cy /= g.length;
        for (const b of g) { b.x -= cx; b.y -= cy; b.sx = b.x; b.sy = b.y; }
        const R = radiusFor(g.length);
        const tgt = relax(g.map((b) => ({ x: b.x, y: b.y, z: b.z })), R);
        g.forEach((b, i) => { b.tx = tgt[i].x; b.ty = tgt[i].y; b.x = b.tx; b.y = b.ty; b.z = tgt[i].z; });
        const wx = cx * c - cy * s, wy = cx * s + cy * c;
        const dir = +side;
        const dx = n.ax * c - n.ay * s, dy = n.ax * s + n.ay * c;
        const heavy = side === '-1';
        this.nuclei.push({
          kind: 'frag', x: n.x + wx, y: n.y + wy, vx: dx * dir * speeds[side], vy: dy * dir * speeds[side],
          rot: n.rot, spin: rnd(-0.5, 0.5), balls: g, R, A: heavy ? ch[0] : ch[2], Z: heavy ? ch[1] : ch[3],
          state: 'idle', t: 0, alpha: 1, scale: 1, heat: 1, age: 0, life: rnd(4.5, 6.5), push: 0.7,
        });
      }
      for (const [x, y] of born) {
        const a = Math.random() * TAU;
        this._neutron(x, y, Math.cos(a), Math.sin(a), rnd(0.9, 1.15));
        this._stat('born');
      }
      // A prompt gamma ray, the flash, and the energy bill.
      const ga = Math.random() * TAU;
      this.gammas.push({ x: n.x, y: n.y, dx: Math.cos(ga), dy: Math.sin(ga), age: 0 });
      this._stat('rad');
      const mev = Math.round(rnd(196, 208));
      this._stat('fis'); this._stat('mev', mev);
      this.energy += mev;
      this.lastEq = ch;
      this._glow(n.x, n.y, 0.06, 0.55, this.hot);
      this._event(n.x, n.y + n.R + 0.02, '+' + mev + ' MeV', AMBER, 1.6, { rise: 0.05 });
      if (n.site) { n.site.nuc = null; n.site.timer = rnd(3.5, 7); }
      n.dead = true;
    }

    _neutron(x, y, dx, dy, sp = 1, tag) {
      if (this.neutrons.length >= MAX_N) return null;
      const q = { x, y, dx, dy, v: V_N * sp, ox: x, oy: y, age: 0, tag };
      this.neutrons.push(q);
      return q;
    }

    _kick(strength, P) {
      const idle = this.nuclei.filter((n) => n.kind === 'fuel' && n.state === 'idle' && n.alpha > 0.7);
      const count = Math.min(idle.length, Math.max(1, Math.round((0.5 + strength * 4.5) * P.drive)));
      for (let i = 0; i < count; i++) {
        const j = (Math.random() * idle.length) | 0;
        const n = idle.splice(j, 1)[0];
        const ang = Math.atan2(n.y - this.src[1], n.x - this.src[0]);
        const hx = n.x - Math.cos(ang) * n.R, hy = n.y - Math.sin(ang) * n.R;
        this.beams.push({ x0: this.src[0], y0: this.src[1], x1: hx, y1: hy, age: 0 });
        this._excite(n, hx, hy, 0.2 + 0.05 * i);
        this._stat('lost');           // the source neutron is spent in the capture
        this._stat('born');
      }
      this.boost = Math.max(this.boost, strength);
      this._glow(this.src[0], this.src[1], 0.04, 0.4 * strength, [0.6, 0.85, 1.0]);
    }

    _fusion() {
      const [x0, y0, x1, y1] = this.F;
      let best = null;
      for (let tries = 0; tries < 12; tries++) {
        const x = rnd(x0 + 0.1, x1 - 0.1), y = rnd(y0 + 0.1, y1 - 0.1);
        let dmin = 1;
        for (const n of this.nuclei) dmin = Math.min(dmin, Math.hypot(n.x - x, n.y - y));
        if (!best || dmin > best[2]) best = [x, y, dmin];
      }
      const [x, y] = best;
      const a = Math.random() * TAU, D = 0.11;
      const mk = (nP, nN, A, ang) => ({
        kind: 'light', x: x + Math.cos(ang) * D, y: y + Math.sin(ang) * D, vx: -Math.cos(ang) * D / 0.4, vy: -Math.sin(ang) * D / 0.4,
        rot: Math.random() * TAU, spin: rnd(-2, 2), balls: makeBalls(nP, nN), R: radiusFor(nP + nN), A, Z: 1,
        state: 'idle', t: 0, alpha: 0, scale: 1, heat: 0.3, age: 0, life: 99,
      });
      const d = mk(1, 1, 2, a), t = mk(1, 2, 3, a + Math.PI);
      this.nuclei.push(d, t);
      this.fusions.push({ x, y, d, t, age: 0, ang: a });
    }

    _beta(P) {
      const frags = this.nuclei.filter((n) => n.kind === 'frag' && n.age > 0.6 && n.alpha > 0.5);
      if (!frags.length) return;
      const n = frags[(Math.random() * frags.length) | 0];
      const nb = n.balls.filter((b) => !b.p);
      if (!nb.length) return;
      nb[(Math.random() * nb.length) | 0].p = true;            // a neutron becomes a proton...
      n.Z = Math.min(SYM.length - 1, n.Z + 1);                  // ...and the nucleus is the next element up
      n.flash = 1;
      const a = Math.random() * TAU;
      this.betas.push({ x: n.x, y: n.y, vx: Math.cos(a) * 0.75, vy: Math.sin(a) * 0.75, age: 0, nx: -Math.cos(a), ny: -Math.sin(a) });
      this._glow(n.x, n.y, 0.025, 0.3, [0.45, 0.85, 1.0]);
      this._stat('rad');
      this._click();
      if (Math.random() < 0.4) {
        const ga = Math.random() * TAU;
        this.gammas.push({ x: n.x, y: n.y, dx: Math.cos(ga), dy: Math.sin(ga), age: 0 });
        this._stat('rad');
      }
    }

    _click() { this.clicks.push(this.t); this.led = 1; }

    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const asp = u.width / u.height;
      this.t += dt;
      const panels = P.panels > 0.5;
      if (Math.abs(asp - this.layoutAsp) > 0.01 || panels !== this.layoutPanels) this._layout(asp, panels);
      const [fx0, fy0, fx1, fy1] = this.F;
      const pal = u.palette;
      this.hot = [pal[9] * 0.5 + 0.5, pal[10] * 0.5 + 0.4, pal[11] * 0.5 + 0.25];

      // ---- control rods: the bass pulls them out; a SCRAM drops them all ----
      this.bassS += (audio.bass - this.bassS) * (1 - Math.exp(-dt / 0.6));
      this.boost *= Math.exp(-dt / 0.8);
      const withdraw = Math.min(0.9, 0.12 + 0.75 * this.bassS * P.rods + 0.3 * this.boost * P.rods);
      let goal = 1 - withdraw;
      if (this.scram > 0) { this.scram -= dt; goal = 1; }
      const rate = this.scram > 0 ? 2.5 : 0.35;
      this.rodIns += Math.max(-rate * dt, Math.min(rate * dt, goal - this.rodIns));
      const rodBot = fy1 - this.rodIns * (fy1 - fy0);
      const RW = 0.011;

      // ---- triggers ----
      const kick = this.trig.update(audio.kick);
      if (kick > 0) this._kick(kick, P);
      this.fusCool -= dt;
      if (audio.midOnset && this.fusCool <= 0 && Math.random() < 0.7 * P.fusion) { this._fusion(); this.fusCool = 0.5; }
      if (audio.highOnset && Math.random() < 0.85 * P.decay) this._beta(P);
      if (Math.random() < dt * 0.4) this._click();                           // background counts

      // ---- fuel sites refill ----
      for (const s of this.sites) {
        if (s.nuc) continue;
        s.timer -= dt;
        if (s.timer <= 0) this._fuel(s);
      }

      // ---- nuclei ----
      for (const n of this.nuclei) {
        n.age += dt;
        n.rot += n.spin * dt;
        n.x += n.vx * dt; n.y += n.vy * dt;
        if (n.kind === 'fuel') {
          n.alpha = Math.min(1, n.alpha + dt / 0.8);
          n.scale = 0.6 + 0.4 * n.alpha;
          n.x += (n.site.x + Math.sin(n.age * 0.7 + n.rot) * 0.004 - n.x) * dt;
          n.y += (n.site.y + Math.cos(n.age * 0.6) * 0.004 - n.y) * dt;
        }
        if (n.kind === 'frag') {
          const drag = Math.exp(-dt * 1.5);
          n.vx *= drag; n.vy *= drag;
          n.heat *= Math.exp(-dt / 0.7);
          n.push = Math.max(0, n.push - dt);
          if (n.age > n.life - 1.2) n.alpha = Math.max(0, (n.life - n.age) / 1.2);
          if (n.age > n.life) n.dead = true;
        }
        if (n.kind === 'light' && n.life < 99) {
          n.vx *= Math.exp(-dt * 0.6); n.vy *= Math.exp(-dt * 0.6);
          n.heat *= Math.exp(-dt / 0.5);
          if (n.age > n.life - 1) n.alpha = Math.max(0, n.life - n.age);
          if (n.age > n.life) n.dead = true;
        } else if (n.kind === 'light') n.alpha = Math.min(1, n.alpha + dt / 0.15);
        if (n.flash) n.flash = Math.max(0, n.flash - dt * 2);
        for (const b of n.balls) if (b.inT !== undefined && b.inT < 1) b.inT = Math.min(1, b.inT + dt / 0.12);
        for (const b of n.balls) b.pc += ((b.p ? 1 : 0) - b.pc) * Math.min(1, dt * 6);
        if (n.state === 'excited') {
          n.t += dt;
          n.heat = Math.min(1, n.t / n.dur) * 0.6;
          if (n.t >= n.dur) this._split(n);
        }
      }

      // ---- fusion: D and T meet ----
      for (const f of this.fusions) {
        f.age += dt;
        if (f.age >= 0.4) {
          f.d.dead = true; f.t.dead = true; f.done = true;
          const a = f.ang + Math.PI / 2 + rnd(-0.4, 0.4);
          const he = { kind: 'light', x: f.x, y: f.y, vx: Math.cos(a) * 0.08, vy: Math.sin(a) * 0.08, rot: Math.random() * TAU, spin: rnd(-1, 1),
            balls: makeBalls(2, 2), R: radiusFor(4), A: 4, Z: 2, state: 'idle', t: 0, alpha: 1, scale: 1, heat: 1, age: 0, life: 3.5 };
          this.nuclei.push(he);
          const q = this._neutron(f.x, f.y, -Math.cos(a), -Math.sin(a), 1.7, 1);
          if (q) this._stat('born');
          this._stat('fus'); this._stat('mev', 17.6);
          this.energy += 17.6;
          this._glow(f.x, f.y, 0.07, 0.9 * (0.6 + 0.6 * audio.mid), [pal[6] * 0.6 + 0.4, pal[7] * 0.6 + 0.4, pal[8] * 0.6 + 0.4]);
          this._event(f.x, f.y - 0.035, '+17.6 MeV', CYAN, 1.6, { rise: -0.03 });
        }
      }
      this.fusions = this.fusions.filter((f) => !f.done);

      // ---- free neutrons ----
      const fuel = this.nuclei.filter((n) => n.kind === 'fuel' && n.state === 'idle' && n.alpha > 0.6);
      const pFis = Math.min(0.97, 0.7 * P.reactivity);
      for (const q of this.neutrons) {
        q.age += dt;
        q.x += q.dx * q.v * dt; q.y += q.dy * q.v * dt;
        if (q.v > V_N) q.v = Math.max(V_N, q.v - dt * 0.4);          // fast neutrons slow down in the water
        if (q.x < fx0 || q.x > fx1 || q.y < fy0 || q.y > fy1 || q.age > 6) { q.dead = true; this._stat('lost'); continue; }
        // Control rods soak them up.
        if (q.y > rodBot && this.rods.some((rx) => Math.abs(q.x - rx) < RW)) {
          q.dead = true; this._stat('lost');
          this._event(q.x, q.y, '×', DIM, 0.6, { rise: 0 });
          continue;
        }
        for (const n of fuel) {
          if (n.state !== 'idle') continue;
          const dx = q.x - n.x, dy = q.y - n.y;
          if (dx * dx + dy * dy > (n.R + B) * (n.R + B)) continue;
          if (q.hit === n) continue;
          if (Math.random() < pFis) {
            q.dead = true; this._stat('lost');
            this._excite(n, q.x, q.y, 0.28);
          } else {
            // Elastic scatter: bounce off in a new direction.
            const a = Math.random() * TAU;
            q.dx = Math.cos(a); q.dy = Math.sin(a); q.ox = q.x; q.oy = q.y; q.hit = n;
            n.flash = 0.6;
          }
          break;
        }
      }
      this.neutrons = this.neutrons.filter((q) => !q.dead);
      if (this.neutrons.length > SCRAM_N && this.scram <= 0) {
        this.scram = 3.5;
        this._event((fx0 + fx1) / 2, fy1 - 0.08, 'SCRAM', RED, 2.5, { rise: 0, size: 2.4, bold: true });
      }

      for (const g of this.gammas) { g.age += dt; g.x += g.dx * 1.6 * dt; g.y += g.dy * 1.6 * dt; }
      this.gammas = this.gammas.filter((g) => g.age < 1.4 && Math.abs(g.x) < asp / 2 + 0.2 && Math.abs(g.y) < 0.7);
      for (const b of this.betas) { b.age += dt; b.x += b.vx * dt; b.y += b.vy * dt; }
      this.betas = this.betas.filter((b) => b.age < 1.2);
      for (const b of this.beams) b.age += dt;
      this.beams = this.beams.filter((b) => b.age < 0.4);
      for (const e of this.events) { e.age += dt; e.y += e.rise * dt; }
      this.events = this.events.filter((e) => e.age < e.life);
      for (const g of this.glows) g.i *= Math.exp(-dt / 0.22);
      this.glows = this.glows.filter((g) => g.i > 0.02);
      this.nuclei = this.nuclei.filter((n) => !n.dead);

      // ---- instruments ----
      this.binT += dt;
      while (this.binT >= 0.1) {
        this.binT -= 0.1;
        this.bin = (this.bin + 1) % this.bins.length;
        Object.assign(this.bins[this.bin], { born: 0, lost: 0, fis: 0, fus: 0, mev: 0, rad: 0 });
      }
      let born = 0, lost = 0, fis = 0, fus = 0, mev = 0, rad = 0;
      for (const b of this.bins) { born += b.born; lost += b.lost; fis += b.fis; fus += b.fus; mev += b.mev; rad += b.rad; }
      const win = this.bins.length * 0.1;
      this.quietT = this.neutrons.length || fis ? 0 : this.quietT + dt;
      const kRaw = lost >= 3 ? born / lost : (this.quietT > 1 ? 0 : this.k);
      this.k += (kRaw - this.k) * (1 - Math.exp(-dt / 0.5));
      this.rates = { fis: fis / win, fus: fus / win, mev: mev / win };
      this.dose += (0.12 + rad / win * 1.6 - this.dose) * (1 - Math.exp(-dt / 0.8));
      this.core += (Math.min(1, (fis / win) / 8) * (0.4 + 0.9 * audio.mid) - this.core) * (1 - Math.exp(-dt / 0.3));
      while (this.clicks.length && this.clicks[0] < this.t - 6) this.clicks.shift();
      for (let i = 0; i < rad; i++) if (Math.random() < dt * 2) this._click();
      this.led *= Math.exp(-dt / 0.06);
      this.histT += dt;
      while (this.histT >= 0.1) { this.histT -= 0.1; this.hist.copyWithin(0, 1); this.hist[this.hist.length - 1] = this.neutrons.length; }

      // ---- draw: paper and glows ----
      target.bind();
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      const glows = this.glows.slice().sort((a, b) => b.i - a.i).slice(0, NFL);
      glows.forEach((g, i) => { this.glowU.set([g.x, g.y, g.r, g.i], i * 4); this.glowC.set(g.c, i * 3); });
      const bp = this.bg.use();
      ctx.setCommon(bp, audio, u);
      bp.f4('uField', fx0, fy0, fx1, fy1).f('uCore', this.core * P.glow)
        .f4v('uGlow', this.glowU).f3v('uGlowC', this.glowC).i('uNG', glows.length);
      ctx.drawQuad();

      // ---- draw: nucleons ----
      let k = 0;
      const put = (x, y, r, glow, col, a) => {
        if (k >= MAX_SPR) return;
        this.inst.set([x, y, r, glow, col[0], col[1], col[2], a], k * 8);
        k++;
      };
      const tmp = [0, 0, 0];
      for (const n of this.nuclei) {
        const c = Math.cos(n.rot), s = Math.sin(n.rot);
        const sc = n.scale;
        const glow = Math.max(n.heat, (n.flash || 0) * 0.5) * P.glow;
        for (const b of n.balls) {
          let [lx, ly] = this._ballPos(n, b);
          lx += Math.sin(this.t * 9 + b.ph) * B * 0.12; ly += Math.cos(this.t * 7.3 + b.ph * 1.7) * B * 0.12;   // quantum jitter
          for (let i = 0; i < 3; i++) tmp[i] = NEUTRON[i] + (PROTON[i] - NEUTRON[i]) * b.pc;
          put(n.x + (lx * c - ly * s) * sc, n.y + (lx * s + ly * c) * sc, B * sc, glow, tmp, n.alpha);
        }
      }
      const glowN = 0.35 * P.glow;
      for (const q of this.neutrons) put(q.x, q.y, B, glowN, NEUTRON, 1);
      for (const b of this.betas) put(b.x, b.y, B * 0.45, 1.2 * P.glow, [0.5, 0.9, 1.0], Math.min(1, (1.2 - b.age) * 3));
      if (k) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, k * 8);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this.spr.use().f('uAsp', asp).f3('uHot', this.hot[0], this.hot[1], this.hot[2]);
        gl.bindVertexArray(this.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      }

      // ---- draw: the diagram ----
      this._drawHud(u, audio, P, rodBot, RW);
      this.hud.draw(1.3);
    }

    _drawHud(u, audio, P, rodBot, RW) {
      // Graphics that belong to the scene go on the world layer (they shake and glow with it);
      // every bit of text and the instrument panel goes on the screen overlay, untouched by effects.
      const w = VIZ.Hud.pen(this.hud.begin(u.width, u.height), u.width, u.height);
      const ug = this.hud.beginUI();
      const o = ug ? VIZ.Hud.pen(ug, ug.canvas.width, ug.canvas.height) : null;
      const lab = P.labels && o, pan = P.panels && o;
      this._drawWorld(w, rodBot, RW);
      if (lab) this._drawLabels(o, RW);
      if (pan) { this._legend(o); this._panel(o); }
    }

    _drawWorld(p, rodBot, RW) {
      const { g, X, Y, S, H, line, arrow } = p;
      const [fx0, fy0, fx1, fy1] = this.F;
      // Drawing frame: a double border.
      g.strokeStyle = INK; g.lineWidth = Math.max(1, H / 600);
      g.globalAlpha = 0.75;
      g.strokeRect(X(fx0), Y(fy1), X(fx1) - X(fx0), Y(fy0) - Y(fy1));
      g.globalAlpha = 0.3;
      const o = S(0.008);
      g.strokeRect(X(fx0) - o, Y(fy1) - o, X(fx1) - X(fx0) + 2 * o, Y(fy0) - Y(fy1) + 2 * o);

      // Control rods: hatched boron carbide.
      for (const rx of this.rods) {
        const x0 = X(rx - RW), x1 = X(rx + RW), y0 = Y(fy1) - S(0.012), y1 = Y(rodBot);
        g.globalAlpha = 1;
        g.fillStyle = 'rgb(38, 44, 54)';
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        g.save();
        g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
        g.strokeStyle = 'rgba(200, 220, 255, 0.35)'; g.lineWidth = 1;
        for (let yy = y0 - (x1 - x0); yy < y1; yy += S(0.012)) line(x0, yy + (x1 - x0), x1, yy);
        g.restore();
        g.strokeStyle = INK; g.lineWidth = Math.max(1, H / 700); g.globalAlpha = 0.8;
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }

      // The neutron source on the left wall.
      const sx = X(this.src[0]), sy = Y(this.src[1]);
      g.globalAlpha = 0.9;
      g.fillStyle = 'rgb(30, 36, 46)'; g.strokeStyle = INK; g.lineWidth = Math.max(1, H / 700);
      g.fillRect(sx - S(0.022), sy - S(0.05), S(0.044), S(0.1));
      g.strokeRect(sx - S(0.022), sy - S(0.05), S(0.044), S(0.1));
      g.fillStyle = CYAN;
      g.beginPath(); g.arc(sx + S(0.022), sy, S(0.008), 0, TAU); g.fill();

      // Beams from the source: the kick's neutrons, drawn as a dashed arrow.
      for (const b of this.beams) {
        const a = 1 - b.age / 0.4;
        g.globalAlpha = a; g.strokeStyle = CYAN; g.fillStyle = CYAN; g.lineWidth = Math.max(1.2, H / 500);
        g.setLineDash([S(0.01), S(0.007)]);
        g.lineDashOffset = -b.age * S(0.2);
        arrow(X(b.x0) + S(0.03), Y(b.y0), X(b.x1), Y(b.y1), S(0.014));
        g.setLineDash([]);
      }

      // Neutron tracks: a fading tail and an arrowhead in front of each.
      g.lineWidth = Math.max(1, H / 650);
      for (const q of this.neutrons) {
        const L = Math.min(0.11, Math.hypot(q.x - q.ox, q.y - q.oy));
        const hx = X(q.x), hy = Y(q.y), tx = X(q.x - q.dx * L), ty = Y(q.y - q.dy * L);
        const gr = g.createLinearGradient(tx, ty, hx, hy);
        gr.addColorStop(0, 'rgba(170, 210, 255, 0)');
        gr.addColorStop(1, q.tag ? 'rgba(140, 240, 255, 0.95)' : 'rgba(170, 210, 255, 0.75)');
        g.strokeStyle = gr; g.globalAlpha = 1;
        line(tx, ty, hx, hy);
        g.fillStyle = 'rgba(200, 228, 255, 0.85)';
        const ax = hx + q.dx * S(B * 2.6), ay = hy - q.dy * S(B * 2.6);
        g.beginPath();
        g.moveTo(ax + q.dx * S(0.008), ay - q.dy * S(0.008));
        g.lineTo(ax - q.dy * S(0.004), ay - q.dx * S(0.004));
        g.lineTo(ax + q.dy * S(0.004), ay + q.dx * S(0.004));
        g.closePath(); g.fill();
      }

      // Gamma rays: a wavy packet heading off at the speed of light (more or less).
      g.lineWidth = Math.max(1.2, H / 520);
      for (const r of this.gammas) {
        const a = Math.max(0, 1 - r.age / 1.4);
        g.strokeStyle = 'rgb(255, 240, 120)'; g.globalAlpha = a * 0.9;
        g.beginPath();
        const len = 0.11, nx = -r.dy, ny = r.dx;
        for (let i = 0; i <= 40; i++) {
          const s = i / 40 * len;
          const wv = Math.sin((s - r.age * 1.6) / 0.012 * TAU / 2.2) * 0.006 * Math.sin(i / 40 * Math.PI);
          const x = r.x - r.dx * s + nx * wv, y = r.y - r.dy * s + ny * wv;
          if (i === 0) g.moveTo(X(x), Y(y)); else g.lineTo(X(x), Y(y));
        }
        g.stroke();
      }

      // Beta electrons: a short streak, and the antineutrino's dotted line going the other way.
      for (const b of this.betas) {
        const a = Math.max(0, 1 - b.age / 1.2);
        g.globalAlpha = a; g.strokeStyle = CYAN; g.lineWidth = Math.max(1, H / 700);
        line(X(b.x - b.vx * 0.08), Y(b.y - b.vy * 0.08), X(b.x), Y(b.y));
        g.setLineDash([2, S(0.008)]);
        g.strokeStyle = DIM;
        const ox = b.x - b.vx * b.age, oy = b.y - b.vy * b.age;
        line(X(ox), Y(oy), X(ox + b.nx * b.age * 0.5), Y(oy + b.ny * b.age * 0.5));
        g.setLineDash([]);
      }

      // Repulsion arrows on fresh fragments.
      for (const n of this.nuclei) {
        if (n.kind !== 'frag' || n.push <= 0) continue;
        const cx = X(n.x), cy = Y(n.y), r = S(n.R * n.scale);
        const d = Math.hypot(n.vx, n.vy) || 1;
        const ux = n.vx / d, uy = -n.vy / d;
        g.globalAlpha = n.push / 0.7 * 0.85; g.strokeStyle = AMBER; g.fillStyle = AMBER; g.lineWidth = Math.max(1, H / 600);
        arrow(cx + ux * r * 1.4, cy + uy * r * 1.4, cx + ux * (r * 1.4 + S(0.04)), cy + uy * (r * 1.4 + S(0.04)), S(0.009));
      }
      g.globalAlpha = 1;
    }

    _drawLabels(p, RW) {
      const { g, X, Y, S, fs, font, line } = p;
      const [fx0, , , fy1] = this.F;
      g.textBaseline = 'middle';
      for (const rx of this.rods) {
        g.save();
        g.translate(X(rx + RW) + S(0.012), Y(fy1) + S(0.04));
        g.rotate(Math.PI / 2);
        font(fs * 0.75, false);
        g.fillStyle = DIM; g.textAlign = 'left';
        g.fillText('CONTROL ROD · B' + VIZ.sub(4) + 'C', 0, 0);
        g.restore();
      }
      g.save(); g.translate(X(this.src[0]) - S(0.006), Y(this.src[1]) + S(0.045)); g.rotate(-Math.PI / 2);
      font(fs * 0.75, false); g.fillStyle = DIM; g.textAlign = 'left';
      g.fillText('Am–Be n SOURCE', 0, 0);
      g.restore();

      g.textAlign = 'left';
      for (const q of this.neutrons) {
        if (!q.tag || q.age >= 1.2) continue;
        font(fs * 0.8, false); g.fillStyle = CYAN; g.globalAlpha = 1 - q.age / 1.2;
        g.fillText('n  14.1 MeV', X(q.x) + S(0.014), Y(q.y) - S(0.014));
      }
      for (const r of this.gammas) {
        if (r.age >= 0.5) continue;
        g.globalAlpha = 1 - r.age / 0.5;
        font(fs * 1.05, false, 'Georgia, serif'); g.fillStyle = 'rgb(255, 240, 120)';
        g.fillText('γ', X(r.x - r.dx * 0.05 - r.dy * 0.02), Y(r.y - r.dy * 0.05 + r.dx * 0.02));
      }
      for (const b of this.betas) {
        if (b.age >= 0.7) continue;
        g.globalAlpha = 1 - b.age / 0.7;
        font(fs * 0.95, true, 'Georgia, serif'); g.fillStyle = CYAN;
        g.fillText('β' + VIZ.sup('-'), X(b.x) + S(0.01), Y(b.y) - S(0.01));
        const ox = b.x - b.vx * b.age + b.nx * b.age * 0.5, oy = b.y - b.vy * b.age + b.ny * b.age * 0.5;
        font(fs * 0.85, false, 'Georgia, serif'); g.fillStyle = DIM;
        g.fillText('ν̄', X(ox) + S(0.006), Y(oy));
      }

      // Nucleus labels, with leader lines on the fragments.
      for (const n of this.nuclei) {
        if (n.alpha < 0.05) continue;
        const cx = X(n.x), cy = Y(n.y), r = S(n.R * n.scale);
        if (n.kind === 'fuel') {
          const ex = n.state === 'excited';
          font(fs * (ex ? 0.95 : 0.78), ex);
          g.fillStyle = ex ? AMBER : DIM; g.globalAlpha = n.alpha * (ex ? 1 : 0.85);
          g.fillText(ex ? VIZ.sup(236) + 'U*' : VIZ.sup(235) + 'U', cx + r * 0.8, cy + r * 1.25);
        } else if (n.kind === 'frag') {
          g.globalAlpha = n.alpha;
          g.strokeStyle = DIM; g.lineWidth = 1;
          const lx = cx + r + S(0.018), ly = cy - r - S(0.012);
          line(cx + r * 0.7, cy - r * 0.7, lx, ly);
          font(fs * 0.95, true);
          g.fillStyle = n.flash ? CYAN : INK;
          g.fillText(iso(n.A, n.Z), lx + S(0.004), ly);
        } else {
          font(fs * 0.85, true);
          g.globalAlpha = n.alpha; g.fillStyle = n.Z === 2 ? GREEN : INK;
          const name = n.A === 2 ? VIZ.sup(2) + 'H (D)' : n.A === 3 ? VIZ.sup(3) + 'H (T)' : VIZ.sup(4) + 'He';
          g.fillText(name, cx + r + S(0.008), cy - r - S(0.008));
        }
      }

      // Floating labels and marks.
      g.textAlign = 'center';
      for (const e of this.events) {
        const a = Math.min(1, (e.life - e.age) / 0.4, e.age / 0.08);
        g.globalAlpha = Math.max(0, a); g.fillStyle = e.color;
        font(fs * e.size, e.bold || e.text.indexOf('MeV') >= 0);
        if (e.text === 'SCRAM') g.globalAlpha *= 0.55 + 0.45 * (Math.sin(this.t * 18) > 0 ? 1 : 0);
        g.fillText(e.text, X(e.x), Y(e.y));
      }
      g.globalAlpha = 1;
    }

    _legend(p) {
      const { g, X, Y, S, H, fs, font, line, arrow } = p;
      const [fx0, fy0, fx1, fy1] = this.F;
      // Title, and a dimension line under the core.
      g.globalAlpha = 0.9; g.fillStyle = INK;
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      font(fs * 1.1, true, UI);
      g.fillText('FIG. 29 — FISSION OF ' + VIZ.sup(235) + 'U  ·  D–T FUSION', X(fx0), Y(fy1) - S(0.022));
      g.globalAlpha = 0.6; g.strokeStyle = INK;
      const dimY = Y(fy0) + S(0.03);
      g.lineWidth = Math.max(1, H / 900);
      arrow((X(fx0) + X(fx1)) / 2 - S(0.09), dimY, X(fx0) + 1, dimY, S(0.01));
      arrow((X(fx0) + X(fx1)) / 2 + S(0.09), dimY, X(fx1) - 1, dimY, S(0.01));
      line(X(fx0), dimY - S(0.012), X(fx0), dimY + S(0.012));
      line(X(fx1), dimY - S(0.012), X(fx1), dimY + S(0.012));
      font(fs * 0.85, false);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(((fx1 - fx0) * 1.2).toFixed(1) + ' × 10' + VIZ.sup(-13) + ' m', (X(fx0) + X(fx1)) / 2, dimY);

      let y = Y(fy0) + S(0.075);
      const x = X(fx0);
      g.globalAlpha = 0.95; g.textAlign = 'left'; g.textBaseline = 'middle';
      const dot = (cx, col) => {
        g.fillStyle = col; g.beginPath(); g.arc(cx, y, S(B * 1.2), 0, TAU); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1; g.stroke();
      };
      font(fs * 0.85, false);
      let cx = x;
      dot(cx + S(0.008), 'rgb(220, 60, 45)');
      g.fillStyle = INK; g.fillText('proton', cx + S(0.022), y); cx += S(0.11);
      dot(cx + S(0.008), 'rgb(190, 200, 214)');
      g.fillStyle = INK; g.fillText('neutron', cx + S(0.022), y); cx += S(0.125);
      g.strokeStyle = 'rgb(255, 240, 120)'; g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i <= 12; i++) { const xx = cx + i * S(0.0025); const yy = y + Math.sin(i * 1.3) * S(0.004); if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
      g.stroke();
      g.fillStyle = INK; g.fillText('γ ray', cx + S(0.038), y); cx += S(0.11);
      g.fillStyle = CYAN; g.beginPath(); g.arc(cx + S(0.006), y, S(0.0035), 0, TAU); g.fill();
      g.fillStyle = INK; g.fillText('β' + VIZ.sup('-') + ' electron', cx + S(0.02), y); cx += S(0.16);
      g.fillStyle = 'rgb(38,44,54)'; g.fillRect(cx, y - S(0.01), S(0.014), S(0.02));
      g.strokeStyle = INK; g.strokeRect(cx, y - S(0.01), S(0.014), S(0.02));
      g.fillStyle = INK; g.fillText('absorber', cx + S(0.024), y);

      const ch = this.lastEq;
      y += S(0.045);
      font(fs * 1.0, false, 'Georgia, "Times New Roman", serif');
      g.fillStyle = INK;
      g.fillText('n + ' + iso(235, 92) + ' → ' + iso(236, 92) + '* → ' + iso(ch[0], ch[1]) + ' + ' + iso(ch[2], ch[3]) +
        ' + ' + ch[4] + 'n + γ   (≈ 200 MeV)', x, y);
      y += S(0.038);
      g.fillText(iso(2, 1) + ' + ' + iso(3, 1) + ' → ' + iso(4, 2) + ' (3.5 MeV) + n (14.1 MeV)', x, y);
    }

    _panel(p) {
      const { g, W, H, S, fs, font } = p;
      const m = S(0.035), pw = S(this.panelW);
      const x0 = W - m - pw;
      let y = m;
      const pad = S(0.014);
      g.textBaseline = 'middle';
      // The warning sign: black trefoil on yellow; it flashes when the core runs away.
      const alarm = this.scram > 0 || this.k > 1.06;
      const blink = alarm && Math.sin(this.t * 12) > 0;
      const sh = S(0.13);
      g.globalAlpha = 1;
      g.fillStyle = blink ? 'rgb(255, 236, 90)' : 'rgb(240, 200, 30)';
      g.fillRect(x0, y, pw, sh);
      g.lineWidth = S(0.004); g.strokeStyle = alarm ? RED : 'rgb(20, 18, 10)';
      g.strokeRect(x0 + S(0.004), y + S(0.004), pw - S(0.008), sh - S(0.008));
      const tr = sh * 0.36, tcx = x0 + sh * 0.5, tcy = y + sh * 0.5;
      g.fillStyle = 'rgb(18, 16, 10)';
      g.beginPath(); g.arc(tcx, tcy, tr * 0.2, 0, TAU); g.fill();
      for (const a of [Math.PI / 2, Math.PI / 2 + TAU / 3, Math.PI / 2 - TAU / 3]) {
        g.beginPath();
        g.arc(tcx, tcy, tr, a - Math.PI / 6, a + Math.PI / 6);
        g.arc(tcx, tcy, tr * 0.32, a + Math.PI / 6, a - Math.PI / 6, true);
        g.closePath(); g.fill();
      }
      g.textAlign = 'left';
      font(sh * 0.2, true, UI);
      g.fillText('CAUTION', x0 + sh * 0.98, y + sh * 0.28);
      font(sh * 0.15, true, UI);
      g.fillText('RADIATION AREA', x0 + sh * 0.98, y + sh * 0.53);
      font(sh * 0.11, false, UI);
      g.fillText(this.scram > 0 ? 'SCRAM IN PROGRESS' : 'AUTHORISED STAFF ONLY', x0 + sh * 0.98, y + sh * 0.76);
      y += sh + S(0.016);

      // The instrument box.
      const bh = H - m - y;
      g.fillStyle = 'rgba(4, 10, 18, 0.88)';
      g.fillRect(x0, y, pw, bh);
      g.strokeStyle = INK; g.lineWidth = Math.max(1, H / 700); g.globalAlpha = 0.7;
      g.strokeRect(x0, y, pw, bh);
      g.globalAlpha = 1;
      font(fs * 0.85, true, UI);
      g.fillStyle = INK;
      g.fillText('REACTOR INSTRUMENTATION', x0 + pad, y + S(0.022));
      y += S(0.045);

      // Status lamps.
      const kk = this.k;
      const shutdown = this.quietT > 1;
      const st = this.scram > 0 ? 3 : shutdown ? -1 : kk > 1.05 ? 2 : kk > 0.95 ? 1 : 0;
      const lamps = [['SUB', GREEN], ['CRIT', AMBER], ['SUPER', RED], ['SCRAM', RED]];
      const lw = (pw - pad * 2) / 4;
      lamps.forEach(([name, col], i) => {
        const on = st === i && (i < 3 || Math.sin(this.t * 14) > -0.3);
        const lx = x0 + pad + lw * i + lw / 2;
        g.fillStyle = on ? col : 'rgba(120, 130, 140, 0.25)';
        g.beginPath(); g.arc(lx, y, S(0.009), 0, TAU); g.fill();
        g.strokeStyle = 'rgba(0, 0, 0, 0.6)'; g.lineWidth = 1; g.stroke();
        font(fs * 0.62, on, UI); g.textAlign = 'center';
        g.fillStyle = on ? col : DIM;
        g.fillText(name, lx, y + S(0.02));
      });
      g.textAlign = 'left';
      y += S(0.05);

      const row = (label, value, col) => {
        font(fs * 0.78, false); g.fillStyle = DIM;
        g.fillText(label, x0 + pad, y);
        font(fs * 1.0, true); g.fillStyle = col || AMBER; g.textAlign = 'right';
        g.fillText(value, x0 + pw - pad, y);
        g.textAlign = 'left';
        y += S(0.031);
      };
      const n = this.neutrons.length;
      row('NEUTRONS', String(n).padStart(3, '0'));
      row('k_eff', shutdown ? '0.00' : kk.toFixed(2), st === 2 || st === 3 ? RED : st === 1 ? AMBER : GREEN);
      row('FISSIONS', this.rates.fis.toFixed(1) + ' /s');
      row('FUSIONS', this.rates.fus.toFixed(1) + ' /s');
      const watts = this.rates.mev * 1.602e-13;
      row('POWER', this.rates.mev >= 1000 ? (this.rates.mev / 1000).toFixed(2) + ' GeV/s' : this.rates.mev.toFixed(0) + ' MeV/s');
      row('  = ', sci(watts) + ' W', DIM);
      row('ENERGY Σ', this.energy >= 1e4 ? (this.energy / 1000).toFixed(1) + ' GeV' : this.energy.toFixed(0) + ' MeV');
      row('DOSE RATE', this.dose.toFixed(2) + ' µSv/h', this.dose > 5 ? RED : this.dose > 1.5 ? AMBER : GREEN);
      // The Geiger counter: counts per minute and a lamp that ticks with every count.
      const cpm = this.clicks.length * 10;
      font(fs * 0.78, false); g.fillStyle = DIM;
      g.fillText('GEIGER', x0 + pad, y);
      g.fillStyle = this.led > 0.3 ? 'rgb(255, 90, 60)' : 'rgba(255, 90, 60, 0.18)';
      g.beginPath(); g.arc(x0 + pad + S(0.085), y, S(0.0065), 0, TAU); g.fill();
      font(fs * 1.0, true); g.fillStyle = AMBER; g.textAlign = 'right';
      g.fillText(cpm + ' CPM', x0 + pw - pad, y);
      g.textAlign = 'left';
      y += S(0.04);

      // Rod position.
      font(fs * 0.78, false); g.fillStyle = DIM;
      g.fillText('CONTROL RODS', x0 + pad, y);
      g.textAlign = 'right'; g.fillStyle = INK;
      g.fillText(Math.round(this.rodIns * 100) + '% IN', x0 + pw - pad, y);
      g.textAlign = 'left';
      y += S(0.02);
      const bw = pw - pad * 2, bhh = S(0.012);
      g.strokeStyle = DIM; g.lineWidth = 1;
      g.strokeRect(x0 + pad, y, bw, bhh);
      g.fillStyle = this.scram > 0 ? RED : 'rgb(150, 170, 195)';
      g.fillRect(x0 + pad + 1, y + 1, (bw - 2) * this.rodIns, bhh - 2);
      y += bhh + S(0.035);

      // Neutron population history, log scale.
      const gh = Math.max(S(0.08), H - m - y - S(0.03));
      font(fs * 0.72, false, UI); g.fillStyle = DIM;
      g.fillText('NEUTRON POPULATION (15 s, log)', x0 + pad, y - S(0.012));
      const gx = x0 + pad, gw = pw - pad * 2;
      g.strokeStyle = 'rgba(190, 215, 245, 0.25)'; g.lineWidth = 1;
      const lg = (v) => Math.log10(1 + v) / Math.log10(1 + MAX_N);
      for (const v of [1, 10, 100]) {
        const yy = y + gh - lg(v) * gh;
        g.beginPath(); g.moveTo(gx, yy); g.lineTo(gx + gw, yy); g.stroke();
        font(fs * 0.6, false); g.fillStyle = DIM; g.textAlign = 'left';
        g.fillText(String(v), gx + 2, yy - S(0.007));
      }
      const scramY = y + gh - lg(SCRAM_N) * gh;
      g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255, 72, 56, 0.6)';
      g.beginPath(); g.moveTo(gx, scramY); g.lineTo(gx + gw, scramY); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = DIM; g.strokeRect(gx, y, gw, gh);
      g.strokeStyle = AMBER; g.lineWidth = Math.max(1.2, H / 600);
      g.beginPath();
      const L = this.hist.length;
      for (let i = 0; i < L; i++) {
        const xx = gx + (i / (L - 1)) * gw, yy = y + gh - lg(this.hist[i]) * gh;
        if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy);
      }
      g.stroke();
      g.fillStyle = AMBER;
      g.beginPath(); g.arc(gx + gw, y + gh - lg(this.hist[L - 1]) * gh, S(0.005), 0, TAU); g.fill();
    }

    resize() { /* the layout follows the aspect ratio inside render */ }
    dispose() {
      const gl = this.gl;
      this.bg.dispose(); this.spr.dispose(); this.hud.dispose();
      gl.deleteBuffer(this.buf);
      gl.deleteVertexArray(this.vao);
    }
  }

  VIZ.registerScene({
    id: 'fission',
    name: 'Chain Reaction',
    blurb: 'Neutrons split uranium nuclei into lighter elements and more neutrons. Kicks fire the neutron source, the bass pulls the control rods, mids fuse deuterium and tritium, highs beta-decay the fragments.',
    params: [
      { key: 'drive', label: 'Kick → neutrons fired', min: 0.2, max: 2, step: 0.05, value: 1 },
      { key: 'rods', label: 'Bass pulls the control rods', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'reactivity', label: 'Fission chance (reactivity)', min: 0.4, max: 1.6, step: 0.05, value: 1 },
      { key: 'fusion', label: 'Fusion on the mids', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'decay', label: 'Beta decay on the highs', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'glow', label: 'Glow', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'labels', label: 'Labels on the diagram', toggle: true, value: 1 },
      { key: 'panels', label: 'Instruments, legend & title', toggle: true, value: 1 },
    ],
    create: (ctx) => new FissionScene(ctx),
  });
})();

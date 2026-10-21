/* orbitals.js — Electron Cloud.
 * An atom drawn as what quantum mechanics says it is: a probability cloud. Every occupied orbital
 * is a real hydrogen-like wavefunction (Laguerre radial part times a real spherical harmonic),
 * sized by Slater's screening rules, filled in aufbau order with Hund's rule (and the chromium and
 * copper exceptions), and coloured by the sign of its phase. The cloud is raymarched as glowing
 * volume; the white specks are "measurements": electron positions sampled from |psi|^2, a fresh set
 * many times a second.
 * Kicks are photons. One lifts an electron to an empty orbital (dipole rules: l changes by one);
 * while it's on its way the atom is in a superposition of the two states and the cloud sloshes
 * back and forth at the beat between them, which is exactly the oscillating dipole that radiates.
 * Then it falls back and emits a photon of the right wavelength, which lands on the spectrometer.
 * Every so often the nucleus changes: proton capture, beta decay, electron capture, positron
 * emission, alpha decay, neutron capture. The atom becomes another element (or isotope), picks up
 * or sheds electrons to stay neutral, and the cloud reorganises itself into the new configuration.
 *   bass  -> kicks drive the quantum jumps (and the transmutations wait for one); the bass level
 *            turns the view and squeezes the cloud a little
 *   mids  -> the glow of the cloud, and how fast the superposition beats
 *   highs -> the measurement specks
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const TAU = Math.PI * 2;
  const STEPS = 56;
  const GAMMA = 1.7;               // radial compression: display radius = r^(1/GAMMA), so the core shells get some room

  // Subshells in filling (Madelung) order; 4d only ever holds an excited electron here.
  const SUB = ['1s', '2s', '2p', '3s', '3p', '4s', '3d', '4p', '4d'];
  const SN = [1, 2, 2, 3, 3, 4, 3, 4, 4];
  const SL = [0, 0, 1, 0, 1, 0, 2, 1, 2];
  const BASE = [0, 1, 2, 5, 6, 9, 10, 15, 18];
  const NSLOT = 23;
  const CAP = SL.map((l) => 2 * (2 * l + 1));
  const NSTAR = SN.map((n) => (n <= 3 ? n : 3.7));
  const GROUP = [0, 1, 1, 2, 2, 4, 3, 4, 5];            // Slater groups: 1s | 2sp | 3sp | 3d | 4sp | 4d
  const GN = [1, 2, 3, 3, 4, 4];
  const GD = [false, false, false, true, false, true];
  const ORB = [['s'], ['p_z', 'p_x', 'p_y'], ['d_z²', 'd_xz', 'd_yz', 'd_xy', 'd_x²−y²']];
  const ML = [['0'], ['0', '±1', '±1'], ['0', '±1', '±1', '±2', '±2']];
  const RAD = [
    (r) => 1, (r) => 2 - r, (r) => r, (r) => 6 - 6 * r + r * r, (r) => r * (4 - r),
    (r) => 24 - 36 * r + 12 * r * r - r * r * r, (r) => r * r, (r) => r * (20 - 10 * r + r * r), (r) => r * r * (6 - r),
  ];
  // r * R_nl(rho): the radial amplitude weighted so shells show as shells, not as a spike at the nucleus.
  const amp = (s, r) => r * RAD[s](r) * Math.exp(-0.5 * r);
  const NORM = [], ROUT = [];
  for (let s = 0; s < 9; s++) {
    let mx = 0;
    for (let r = 0; r < 80; r += 0.01) mx = Math.max(mx, Math.abs(amp(s, r)));
    NORM.push(1 / mx);
    let ro = 0;
    for (let r = 80; r > 0; r -= 0.02) if (Math.abs(amp(s, r)) / mx > 0.12) { ro = r; break; }
    ROUT.push(ro);
  }

  const SYM = ['', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
    'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr'];
  const NAME = ['', 'Hydrogen', 'Helium', 'Lithium', 'Beryllium', 'Boron', 'Carbon', 'Nitrogen', 'Oxygen', 'Fluorine', 'Neon',
    'Sodium', 'Magnesium', 'Aluminium', 'Silicon', 'Phosphorus', 'Sulfur', 'Chlorine', 'Argon', 'Potassium', 'Calcium',
    'Scandium', 'Titanium', 'Vanadium', 'Chromium', 'Manganese', 'Iron', 'Cobalt', 'Nickel', 'Copper', 'Zinc',
    'Gallium', 'Germanium', 'Arsenic', 'Selenium', 'Bromine', 'Krypton'];
  const MASS = [0, 1.008, 4.0026, 6.94, 9.0122, 10.81, 12.011, 14.007, 15.999, 18.998, 20.180, 22.990, 24.305, 26.982, 28.085,
    30.974, 32.06, 35.45, 39.948, 39.098, 40.078, 44.956, 47.867, 50.942, 51.996, 54.938, 55.845, 58.933, 58.693, 63.546,
    65.38, 69.723, 72.630, 74.922, 78.971, 79.904, 83.798];
  const ASTD = [0, 1, 4, 7, 9, 11, 12, 14, 16, 19, 20, 23, 24, 27, 28, 31, 32, 35, 40, 39, 40, 45, 48, 51, 52, 55, 56, 59, 58,
    63, 64, 69, 74, 75, 80, 79, 84];
  const IE = [0, 13.598, 24.587, 5.392, 9.323, 8.298, 11.260, 14.534, 13.618, 17.423, 21.565, 5.139, 7.646, 5.986, 8.152,
    10.487, 10.360, 12.968, 15.760, 4.341, 6.113, 6.561, 6.828, 6.746, 6.767, 7.434, 7.902, 7.881, 7.640, 7.726, 9.394,
    5.999, 7.899, 9.789, 9.752, 11.814, 13.999];
  const NOBLE = [2, 10, 18, 36];
  const MONO = '"Lucida Console", "Courier New", "DejaVu Sans Mono", monospace';
  const UI = 'Tahoma, Verdana, "DejaVu Sans", sans-serif';
  const SERIF = 'Georgia, "Times New Roman", serif';
  const INK = 'rgb(222, 232, 250)';
  const DIM = 'rgba(200, 214, 240, 0.55)';
  const AMBER = 'rgb(255, 190, 80)';
  const CYAN = 'rgb(130, 225, 255)';
  const RED = 'rgb(255, 92, 70)';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const nStable = (Z) => ASTD[Z] - Z;
  const iso = (A, Z, q = 0) => VIZ.sup(A) + SYM[Z] + (q ? VIZ.sup((Math.abs(q) > 1 ? Math.abs(q) : '') + (q > 0 ? '+' : '-')) : '');
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function neutralFill(E) {
    const c = new Array(9).fill(0);
    let e = E;
    for (let s = 0; s < 8 && e > 0; s++) { const k = Math.min(CAP[s], e); c[s] = k; e -= k; }
    return c;
  }
  function configOf(Z, E) {
    let c;
    if (E >= Z) {
      c = neutralFill(E);
      if (E === Z && (Z === 24 || Z === 29)) { c[5] = 1; c[6] = Z === 24 ? 5 : 10; }     // half and full d shells win
    } else {
      c = configOf(Z, Z);
      for (let k = Z - E; k > 0; k--) {
        // Ions lose the outermost electrons first: highest n, then highest l (so 4s goes before 3d).
        let best = -1;
        for (let s = 0; s < 9; s++) if (c[s] > 0 && (best < 0 || SN[s] > SN[best] || (SN[s] === SN[best] && SL[s] > SL[best]))) best = s;
        if (best >= 0) c[best]--;
      }
    }
    return c;
  }
  function zeffs(Z, c) {
    const gc = [0, 0, 0, 0, 0, 0];
    c.forEach((k, s) => { gc[GROUP[s]] += k; });
    const out = [];
    for (let s = 0; s < 9; s++) {
      const G = GROUP[s], n = GN[G];
      let S = (gc[G] - (c[s] > 0 ? 1 : 0)) * (G === 0 ? 0.3 : 0.35);
      for (let H = 0; H < G; H++) S += gc[H] * (GD[G] || GN[H] <= n - 2 ? 1 : GN[H] === n - 1 ? 0.85 : 0);
      out.push(Math.max(1, Z - S));
    }
    return out;
  }
  function waveCss(nm, a = 1) {
    if (nm < 380) return `rgba(190, 160, 255, ${a})`;
    if (nm > 750) return `rgba(200, 60, 40, ${a})`;
    let r = 0, g = 0, b = 0;
    if (nm < 440) { r = -(nm - 440) / 60; b = 1; } else if (nm < 490) { g = (nm - 440) / 50; b = 1; } else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
    else if (nm < 580) { r = (nm - 510) / 70; g = 1; } else if (nm < 645) { r = 1; g = -(nm - 645) / 65; } else r = 1;
    const f = nm < 420 ? 0.3 + 0.7 * (nm - 380) / 40 : nm > 700 ? 0.3 + 0.7 * (750 - nm) / 50 : 1;
    return `rgba(${Math.round(255 * Math.pow(r * f, 0.8))}, ${Math.round(255 * Math.pow(g * f, 0.8))}, ${Math.round(255 * Math.pow(b * f, 0.8))}, ${a})`;
  }
  // The other phase gets the opposite hue, so a p orbital's two lobes never look alike.
  function complement([r, g, b]) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 1e-4) return [0.9 * r + 0.1, 0.6 * g + 0.2, 0.5 * b + 0.4];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 180 + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [a, b2, e] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [a + m, b2 + m, e + m];
  }
  const fmtNm = (nm) => (nm < 10 ? nm.toFixed(2) : nm < 100 ? nm.toFixed(1) : nm.toFixed(0)) + ' nm';

  const VOL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
uniform vec3 uCamPos, uCamF, uCamR, uCamU;
uniform float uFocal;
uniform float uK[9];
uniform float uNorm[9];
uniform float uW[9];
uniform float uAct[9];
uniform float uOcc[${NSLOT}];
uniform int uVg, uVe;
uniform vec3 uV;                 // c_ground, c_excited, beat phase
uniform vec3 uPosC[3], uNegC[3], uExcP, uExcN;
uniform float uGain, uFrame;
const int BASE[9] = int[9](0, 1, 2, 5, 6, 9, 10, 15, 18);
const int LS[9] = int[9](0, 0, 1, 0, 1, 0, 2, 1, 2);
${VIZ.glsl.noise}
// Each orbital glows brightest on a thin shell of constant |psi|^2, with a faint fill inside:
// translucent lobes with lit edges, which reads as a shape where pure fog reads as a blob.
float shell(float d, float lvl) { float x = (d - lvl) / (lvl * 0.45); return 0.12 * d + exp(-x * x); }

float radial(int s, float r) {
  float p;
  if (s == 0) p = 1.0;
  else if (s == 1) p = 2.0 - r;
  else if (s == 2) p = r;
  else if (s == 3) p = 6.0 - 6.0 * r + r * r;
  else if (s == 4) p = r * (4.0 - r);
  else if (s == 5) p = 24.0 - 36.0 * r + 12.0 * r * r - r * r * r;
  else if (s == 6) p = r * r;
  else if (s == 7) p = r * (20.0 - 10.0 * r + r * r);
  else p = r * r * (6.0 - r);
  return r * p * exp(-0.5 * r);
}
// Real spherical harmonics, scaled to peak at 1. z is "up".
float ang(int l, int m, vec3 d) {
  if (l == 0) return 1.0;
  if (l == 1) return m == 0 ? d.z : (m == 1 ? d.x : d.y);
  if (m == 0) return 1.5 * d.z * d.z - 0.5;
  if (m == 1) return 2.0 * d.x * d.z;
  if (m == 2) return 2.0 * d.y * d.z;
  if (m == 3) return 2.0 * d.x * d.y;
  return d.x * d.x - d.y * d.y;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 rd = normalize(uCamF * uFocal + uCamR * p.x + uCamU * p.y);
  vec3 ro = uCamPos;
  float b = dot(ro, rd), c = dot(ro, ro) - 1.0, h = b * b - c;
  if (h < 0.0) { fragColor = vec4(0.0); return; }
  h = sqrt(h);
  float t0 = max(-b - h, 0.0), t1 = -b + h;
  float dt = (t1 - t0) / float(${STEPS});
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618034);
  vec3 acc = vec3(0.0);
  float D = 0.0;
  for (int i = 0; i < ${STEPS}; i++) {
    vec3 pos = ro + rd * (t0 + (float(i) + jit) * dt);
    float q = length(pos);
    vec3 d = pos / max(q, 1e-4);
    float r = pow(q, ${GAMMA.toFixed(2)});
    vec3 dO = vec3(d.x, d.z, d.y);
    float psiG = 0.0, psiE = 0.0;
    float lvl = 0.16 * (0.75 + 0.5 * noise3(pos * 3.5 + vec3(0.0, uTime * 0.5, 0.0)));   // the surfaces boil a little
    for (int s = 0; s < 9; s++) {
      if (uAct[s] < 0.001) continue;
      float R = radial(s, uK[s] * r) * uNorm[s];
      int l = LS[s];
      float w = uW[s];
      for (int m = 0; m < 5; m++) {
        if (m > 2 * l) break;
        int k = BASE[s] + m;
        float psi = R * ang(l, m, dO);
        float d1 = psi * psi;
        acc += shell(d1, lvl) * uOcc[k] * w * (psi >= 0.0 ? uPosC[l] : uNegC[l]);
        D += d1 * uOcc[k] * w;
        if (k == uVg) psiG = psi * sqrt(w);
        if (k == uVe) psiE = psi * sqrt(w);
      }
    }
    if (uVg >= 0) {
      // |c_g psi_g + c_e psi_e e^(i phi)|^2: the interference term is what makes it slosh.
      float re = uV.x * psiG + uV.y * psiE * cos(uV.z);
      float im = uV.y * psiE * sin(uV.z);
      float d2 = re * re + im * im;
      acc += shell(d2, lvl) * (re >= 0.0 ? uExcP : uExcN) * 1.3;
      D += d2;
    }
  }
  fragColor = vec4(acc * dt * uGain, D * dt * uGain);
}`;

  const FINAL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform sampler2D uVol;
uniform vec2 uVolRes;
uniform float uSpark;
uniform float uNuc;
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 col = vec3(0.008, 0.01, 0.02) + palette(0.0) * 0.25 * (1.0 - length(p));
  col += 0.006 * noise2(gl_FragCoord.xy * 0.7);
  vec4 v = texture(uVol, vUv);
  col += v.rgb;
  // Measurements: each little cell finds its electron with probability ~ the cloud's density there.
  vec2 cell = floor(gl_FragCoord.xy / 3.0);
  float seed = floor(uTime * 14.0);
  float dc = texture(uVol, (cell * 3.0 + 1.5) / uRes).a;
  float prob = (1.0 - exp(-dc * 2.5)) * uSpark;
  if (hash12(cell + seed * 37.13) < prob) {
    vec2 off = vec2(hash12(cell + seed * 3.1 + 0.5), hash12(cell + seed * 7.7 + 1.5)) * 2.0 + 0.5;
    float d = length(gl_FragCoord.xy - (cell * 3.0 + off));
    col += mix(vec3(0.9, 0.95, 1.0), palette(1.0), 0.25) * exp(-d * d * 1.4) * 1.8;
  }
  // The nucleus: a point, really. It flares when something happens to it.
  float r = length(p);
  col += vec3(1.0, 0.85, 0.7) * (exp(-r / 0.0025) * (0.6 + 2.5 * uNuc) + exp(-r / 0.02) * uNuc * 0.6);
  col *= 0.7 + 0.45 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  function packBalls(balls, iters) {
    const n = balls.length;
    const lim = Math.max(0, 1.12 * Math.cbrt(n) - 0.5);
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i++) {
        const a = balls[i];
        for (let j = i + 1; j < n; j++) {
          const b = balls[j];
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const d = Math.hypot(dx, dy, dz) || 1e-6;
          if (d < 1.8) { const k = (1.8 - d) / d * 0.25; a.x -= dx * k; a.y -= dy * k; a.z -= dz * k; b.x += dx * k; b.y += dy * k; b.z += dz * k; }
        }
      }
      for (const a of balls) {
        const d = Math.hypot(a.x, a.y, a.z);
        if (d > lim) { const k = lim / d; a.x *= k; a.y *= k; a.z *= k; } else { a.x *= 0.99; a.y *= 0.99; a.z *= 0.99; }
      }
    }
  }

  class OrbitalScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.gl = ctx.gl;
      this.volProg = ctx.fsProgram(VOL, 'orbitals-volume');
      this.finalProg = ctx.fsProgram(FINAL, 'orbitals');
      this.vol = ctx.createTarget(2, 2, { hdr: true });
      this.hud = new VIZ.Hud(ctx);
      this.trig = new VIZ.KickTrigger(0.3);
      this.frame = 0;
      this.t = 0;
      this.yaw = Math.random() * TAU;
      this.perm = SL.map((l) => shuffle([...Array(2 * l + 1).keys()]));
      this.kickEnv = 0;
      this.nucFlash = 0;
      this.actors = [];
      this.log = [];
      this.lines = [];
      this.exc = null;
      this.proc = null;
      this.hole = 0;
      this.nextT = rnd(7, 11);
      this.isoT = rnd(3, 6);
      this.beat = 0;
      const start = [1, 6, 8, 10, 11, 26, 29][(Math.random() * 7) | 0];
      this.Z = start; this.N = nStable(start); this.E = start;
      this.counts = configOf(this.Z, this.E);
      this.occT = this._slots(this.counts);
      this.occ = Float32Array.from(this.occT);
      this.zT = zeffs(this.Z, this.counts);
      this.z = this.zT.slice();
      this.Rv = this._viewR(this.occ, this.z);
      this.nuc = [];
      for (let i = 0; i < this.Z + this.N; i++) this.nuc.push(this._ball(i < this.Z, 1));
      packBalls(this.nuc, 60);
      this.nuc.sort((a, b) => a.z - b.z);
    }

    _ball(p, s = 0) {
      const a = Math.random() * TAU, c = rnd(-1, 1), r = 1.12 * Math.cbrt(this.nuc ? this.nuc.length + 1 : 1);
      return { x: Math.cos(a) * Math.sqrt(1 - c * c) * r, y: Math.sin(a) * Math.sqrt(1 - c * c) * r, z: c * r, p, pc: p ? 1 : 0, s, out: 0 };
    }

    _slots(c) {
      const occ = new Float32Array(NSLOT);
      for (let s = 0; s < 9; s++) {
        const m = 2 * SL[s] + 1;
        for (let i = 0; i < m; i++) occ[BASE[s] + this.perm[s][i]] = (c[s] > i ? 1 : 0) + (c[s] > m + i ? 1 : 0);
      }
      return occ;
    }

    _subOcc(occ, s) { let t = 0; for (let m = 0; m <= 2 * SL[s]; m++) t += occ[BASE[s] + m]; return t; }

    _viewR(occ, z) {
      let R = 0.5;
      for (let s = 0; s < 9; s++) {
        const w = Math.min(1, this._subOcc(occ, s));
        if (w > 0.01) R = Math.max(R, ROUT[s] * NSTAR[s] / (2 * z[s]) * (0.4 + 0.6 * w));
      }
      // An excited electron swells the atom, but only so far: Rydberg-sized orbitals would shrink the rest to a dot.
      const x = this.exc;
      if (x) R = Math.max(R, Math.min(R * 1.5, ROUT[x.es] * NSTAR[x.es] / (2 * z[x.es])) * (0.4 + 0.6 * x.ce * x.ce));
      return R;
    }

    /** Point the atom at a new (Z, N, E); the cloud morphs there over the next second or so. */
    _setAtom(Z, N, E) {
      const old = this.counts;
      this.Z = Z; this.N = N; this.E = E;
      this.counts = configOf(Z, E);
      for (let s = 0; s < 9; s++) if (this.counts[s] !== old[s] && this.counts[s] < CAP[s]) shuffle(this.perm[s]);   // which p or d orbitals: anyone's guess
      this._retarget();
    }
    _retarget() {
      this.occT = this._slots(this.counts);
      if (this.hole) this.occT[0] = Math.max(0, this.occT[0] - 1);
      this.zT = zeffs(this.Z, this.counts);
    }

    _say(text, color = INK) { this.log.push({ text, color, t: this.t }); if (this.log.length > 6) this.log.shift(); }

    _actor(a) { this.actors.push(Object.assign({ t: 0 }, a)); }

    // ---- quantum jumps ----
    _excite(strength, P) {
      const c = this.counts;
      let gs = -1;
      for (let s = 0; s < 8; s++) if (c[s] > 0) gs = s;
      if (gs < 0) return;
      const cand = [];
      for (let s = gs + 1; s < 9; s++) if (c[s] === 0 && Math.abs(SL[s] - SL[gs]) === 1) cand.push(s);
      if (!cand.length) return;
      const es = cand[Math.min(cand.length - 1, Math.floor(Math.random() * cand.length * (0.4 + strength)))];
      const gSlots = [];
      for (let m = 0; m <= 2 * SL[gs]; m++) if (this.occ[BASE[gs] + m] > 0.9) gSlots.push(BASE[gs] + m);
      if (!gSlots.length) return;
      const g = gSlots[(Math.random() * gSlots.length) | 0];
      const e = BASE[es] + ((Math.random() * (2 * SL[es] + 1)) | 0);
      // Energies: the ground level from the real ionisation energy, the excited one Rydberg-like
      // with a quantum defect that grows with the size of the core underneath.
      const core = SN[gs] - 1;
      const delta = [Math.max(0, 0.9 * core - 0.5), Math.max(0, 0.83 * core - 0.8), Math.max(0, 0.25 * (core - 2))][SL[es]];
      const Eg = -IE[this.Z];
      const Ee = Math.max(Eg + 0.5, -13.6 / Math.pow(SN[es] - delta, 2));
      const nm = 1239.84 / (Ee - Eg);
      this.exc = { g, e, gs, es, phase: 'up', t: 0, hold: rnd(0.6, 2.2) * P.hold, cg: 1, ce: 0, nm, Eg, Ee };
      const a = Math.random() * TAU;
      this._actor({ kind: 'photon', dir: -1, x: Math.cos(a), y: Math.sin(a), dur: 0.3, nm, label: true });
      this._say(`absorbs hν   ${SUB[gs]} → ${SUB[es]}   λ = ${fmtNm(nm)}`, waveCss(nm));
    }
    _emit(stimulated) {
      const x = this.exc;
      x.phase = 'down'; x.t = 0;
      const a = Math.random() * TAU;
      this._actor({ kind: 'photon', dir: 1, x: Math.cos(a), y: Math.sin(a), dur: 1.4, nm: x.nm, label: true });
      if (stimulated) this._actor({ kind: 'photon', dir: 1, x: Math.cos(a), y: Math.sin(a), dur: 1.4, nm: x.nm, off: 0.012 });
      this.lines.push({ nm: x.nm, t: this.t });
      if (this.lines.length > 30) this.lines.shift();
      this._say(`${stimulated ? 'stimulated emission' : 'emits hν'}   ${SUB[x.es]} → ${SUB[x.gs]}   λ = ${fmtNm(x.nm)}`, waveCss(x.nm));
    }

    // ---- nuclear changes ----
    _process(type) {
      const Z = this.Z, N = this.N, A = Z + N, steps = [];
      const edge = () => { const a = Math.random() * TAU; return [Math.cos(a) * 0.8, Math.sin(a) * 0.8]; };
      const capture = (t0) => {
        // A stray electron spirals in and drops into the lowest free orbital.
        steps.push([t0, () => { this._actor({ kind: 'spiral', a0: Math.random() * TAU, dur: 1.1 }); }]);
        steps.push([t0 + 0.6, () => { this._setAtom(this.Z, this.N, this.E + 1); }]);
        steps.push([t0 + 1.0, () => {
          const a = Math.random() * TAU;
          const nm = 1239.84 / Math.max(0.5, IE[this.Z]);
          this._actor({ kind: 'photon', dir: 1, x: Math.cos(a), y: Math.sin(a), dur: 1.2, nm, label: true });
          this._say(`${iso(this.Z + this.N, this.Z, 1)} + e⁻ → ${iso(this.Z + this.N, this.Z)} + hν`, CYAN);
        }]);
      };
      const eject = (t0) => {
        steps.push([t0, () => {
          this._setAtom(this.Z, this.N, this.E - 1);
          const a = Math.random() * TAU;
          this._actor({ kind: 'out', p: 'e', x: Math.cos(a), y: Math.sin(a), r0: 0.15, dur: 0.9 });
          this._say(`ionisation: an electron leaves`, DIM);
        }]);
      };
      let end = 2.4;
      if (type === 'pcap') {
        const [x, y] = edge();
        this._actor({ kind: 'in', p: 'p', x, y, dur: 0.7 });
        steps.push([0.7, () => { this._nucAdd(true); this._setAtom(Z + 1, N, this.E); this.nucFlash = 1; this._gamma(); this._say(`p capture   ${iso(A, Z)} + p → ${iso(A + 1, Z + 1, 1)} + γ`, AMBER); }]);
        capture(1.0);
      } else if (type === 'bminus') {
        steps.push([0, () => {
          this._nucFlip(false); this._setAtom(Z + 1, N - 1, this.E); this.nucFlash = 1;
          const a = Math.random() * TAU;
          this._actor({ kind: 'out', p: 'e', x: Math.cos(a), y: Math.sin(a), r0: 0, dur: 0.7, fast: true, tag: 'β⁻' });
          this._actor({ kind: 'out', p: 'nu', x: -Math.cos(a + 0.5), y: -Math.sin(a + 0.5), r0: 0, dur: 0.8, tag: 'ν̄ₑ' });
          this._say(`β⁻ decay   ${iso(A, Z)} → ${iso(A, Z + 1, 1)} + e⁻ + ν̄ₑ`, AMBER);
        }]);
        capture(0.8);
      } else if (type === 'ec') {
        // An inner 1s electron is swallowed by a proton; an outer one falls into the hole.
        steps.push([0, () => { this.hole = 1; this._retarget(); this._actor({ kind: 'fall', dur: 0.45 }); }]);
        steps.push([0.45, () => {
          this._nucFlip(true); this.Z = Z - 1; this.N = N + 1; this.nucFlash = 1;
          const a = Math.random() * TAU;
          this._actor({ kind: 'out', p: 'nu', x: Math.cos(a), y: Math.sin(a), r0: 0, dur: 0.8, tag: 'νₑ' });
          this._say(`e⁻ capture   ${iso(A, Z)} + e⁻ → ${iso(A, Z - 1)} + νₑ`, AMBER);
        }]);
        steps.push([1.0, () => {
          this.hole = 0;
          this._setAtom(Z - 1, N + 1, this.E - 1);
          const kev = 10.2e-3 * (Z - 1) * (Z - 1) * 0.75 + 0.0102;
          const a = Math.random() * TAU;
          this._actor({ kind: 'photon', dir: 1, x: Math.cos(a), y: Math.sin(a), dur: 1.0, nm: 1.23984 / kev, label: true });
          this._say(`Kα X-ray   ${kev < 1 ? (kev * 1000).toFixed(0) + ' eV' : kev.toFixed(1) + ' keV'}   (an outer electron fills the 1s hole)`, CYAN);
        }]);
        end = 2.0;
      } else if (type === 'bplus') {
        steps.push([0, () => {
          this._nucFlip(true); this._setAtom(Z - 1, N + 1, this.E); this.nucFlash = 1;
          const a = Math.random() * TAU;
          this._actor({ kind: 'out', p: 'pos', x: Math.cos(a), y: Math.sin(a), r0: 0, dur: 0.6, tag: 'e⁺', annihilate: true });
          this._actor({ kind: 'out', p: 'nu', x: -Math.cos(a), y: -Math.sin(a), r0: 0, dur: 0.8, tag: 'νₑ' });
          this._say(`β⁺ decay   ${iso(A, Z)} → ${iso(A, Z - 1, -1)} + e⁺ + νₑ`, AMBER);
        }]);
        eject(1.1);
        end = 2.0;
      } else if (type === 'alpha') {
        steps.push([0, () => {
          this._nucRemove(true); this._nucRemove(true); this._nucRemove(false); this._nucRemove(false);
          this._setAtom(Z - 2, N - 2, this.E); this.nucFlash = 1;
          const a = Math.random() * TAU;
          this._actor({ kind: 'out', p: 'alpha', x: Math.cos(a), y: Math.sin(a), r0: 0, dur: 1.0, tag: '⁴He²⁺' });
          this._say(`α decay   ${iso(A, Z)} → ${iso(A - 4, Z - 2, -2)} + ⁴He²⁺`, AMBER);
        }]);
        eject(0.9);
        eject(1.5);
        end = 2.4;
      } else if (type === 'ncap') {
        const [x, y] = edge();
        this._actor({ kind: 'in', p: 'n', x, y, dur: 0.7 });
        steps.push([0.7, () => { this._nucAdd(false); this.N = N + 1; this.nucFlash = 0.7; this._gamma(); this._say(`n capture   ${iso(A, Z)} + n → ${iso(A + 1, Z)} + γ`, DIM); }]);
        end = 1.3;
      } else if (type === 'nemit') {
        steps.push([0, () => {
          this._nucRemove(false); this.N = N - 1; this.nucFlash = 0.6;
          const a = Math.random() * TAU;
          this._actor({ kind: 'out', p: 'n', x: Math.cos(a), y: Math.sin(a), r0: 0, dur: 0.9 });
          this._say(`n emission   ${iso(A, Z)} → ${iso(A - 1, Z)} + n`, DIM);
        }]);
        end = 1.0;
      }
      steps.sort((a, b) => a[0] - b[0]);
      this.proc = { type, t: 0, steps, end };
    }
    _gamma() {
      const a = Math.random() * TAU;
      this._actor({ kind: 'photon', dir: 1, x: Math.cos(a), y: Math.sin(a), dur: 0.9, nm: 0.002, gamma: true });
    }
    _nucAdd(p) { const b = this._ball(p, 0); this.nuc.push(b); }
    _nucFlip(fromP) {
      const c = this.nuc.filter((b) => b.p === fromP && !b.out);
      if (c.length) c[(Math.random() * c.length) | 0].p = !fromP;
    }
    _nucRemove(p) {
      const c = this.nuc.filter((b) => b.p === p && !b.out);
      if (!c.length) return;
      const b = c.reduce((m, q) => (Math.hypot(q.x, q.y, q.z) > Math.hypot(m.x, m.y, m.z) ? q : m));
      b.out = 0.001;
    }

    _choose(P) {
      const Z = this.Z, N = this.N;
      let up;
      if (P.element >= 1 && Math.round(P.element) !== Z) up = Math.round(P.element) > Z;
      else if (P.element >= 1) return N < nStable(Z) - 1 ? 'ncap' : N > nStable(Z) + 1 ? 'nemit' : null;
      else up = Z <= 2 ? true : Z >= 36 ? false : Math.random() < (Z < 6 ? 0.7 : Z > 30 ? 0.35 : 0.5);
      if (up) return N > nStable(Z) || (Z > 1 && Math.random() < 0.3) ? 'bminus' : 'pcap';
      if (N < nStable(Z)) return Math.random() < 0.55 ? 'ec' : 'bplus';
      if (Z >= 8 && Math.round(P.element) !== Z - 1 && Math.random() < 0.35) return 'alpha';
      return Math.random() < 0.6 ? 'ec' : 'bplus';
    }

    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      this.t += dt;
      this.frame++;
      const pal = u.palette;
      const kick = this.trig.update(audio.kick);
      this.kickEnv = Math.max(this.kickEnv * Math.exp(-dt / 0.25), kick);
      this.nucFlash *= Math.exp(-dt / 0.3);

      // ---- what happens next ----
      if (this.proc) {
        const pr = this.proc;
        pr.t += dt;
        while (pr.steps.length && pr.steps[0][0] <= pr.t) pr.steps.shift()[1]();
        if (pr.t >= pr.end && !pr.steps.length) this.proc = null;
      }
      const x = this.exc;
      if (x) {
        x.t += dt;
        if (x.phase === 'up') {
          const s = Math.min(1, x.t / 0.45);
          const a = 1.2 * s * s * (3 - 2 * s);
          x.cg = Math.cos(a); x.ce = Math.sin(a);
          if (s >= 1) { x.phase = 'hold'; x.t = 0; }
        } else if (x.phase === 'hold') {
          const a = 1.2 + 0.15 * Math.sin(this.t * 1.7);
          x.cg = Math.cos(a); x.ce = Math.sin(a);
          if (x.t >= x.hold) this._emit(false);
          else if (kick > 0 && x.t > 0.25) this._emit(true);        // a second photon knocks it down: stimulated emission
        } else {
          const s = Math.min(1, x.t / 0.6);
          const a = 1.2 * (1 - s * s * (3 - 2 * s));
          x.cg = Math.cos(a); x.ce = Math.sin(a);
          if (s >= 1) this.exc = null;
        }
      }
      if (!this.proc && !this.exc) {
        this.nextT -= dt * P.transmute;
        this.isoT -= dt;
        const pinned = P.element >= 1 && Math.round(P.element) !== this.Z;
        if (pinned) this.nextT = Math.min(this.nextT, 1.2);
        if (this.nextT <= 0 && (kick > 0 || this.nextT < -2.5)) {
          const type = this._choose(P);
          if (type) this._process(type);
          this.nextT = rnd(8, 14);
        } else if (this.isoT <= 0 && kick > 0) {
          const ns = nStable(this.Z);
          if (this.N < ns - 1) this._process('ncap');
          else if (this.N > ns + 1) this._process('nemit');
          else if (Math.random() < 0.15) this._process('ncap');
          this.isoT = rnd(3, 6);
        } else if (kick > 0 && Math.random() < 0.9 * P.jumps) this._excite(kick, P);
      }

      // ---- the cloud eases toward its target ----
      const ko = 1 - Math.exp(-dt / 0.35), kz = 1 - Math.exp(-dt / 0.6);
      for (let i = 0; i < NSLOT; i++) this.occ[i] += (this.occT[i] - this.occ[i]) * ko;
      for (let s = 0; s < 9; s++) this.z[s] += (this.zT[s] - this.z[s]) * kz;
      this.Rv += (this._viewR(this.occ, this.z) - this.Rv) * (1 - Math.exp(-dt / 0.9));
      this.beat += dt * TAU * (2.2 + 2.5 * audio.mid);

      // ---- nucleus inset physics ----
      for (const b of this.nuc) {
        b.s = Math.min(1, b.s + dt / 0.25);
        b.pc += ((b.p ? 1 : 0) - b.pc) * Math.min(1, dt * 5);
        if (b.out) { b.out += dt; const d = Math.hypot(b.x, b.y, b.z) || 1; b.x += b.x / d * dt * 14; b.y += b.y / d * dt * 14; }
      }
      this.nuc = this.nuc.filter((b) => !(b.out > 0.6));
      const inside = this.nuc.filter((b) => !b.out);
      packBalls(inside, 2);
      this.nuc.sort((a, b) => a.z - b.z);

      for (const a of this.actors) a.t += dt;
      this.actors = this.actors.filter((a) => a.t < a.dur + (a.annihilate ? 0.6 : 0));

      // ---- camera ----
      this.yaw += dt * (0.1 + 0.45 * audio.bass) * P.spin;
      const pitch = 0.35 + 0.22 * Math.sin(this.t * 0.11);
      const Dc = 3.2, focal = 1.25;
      const cp = [Math.cos(pitch) * Math.sin(this.yaw) * Dc, Math.sin(pitch) * Dc, Math.cos(pitch) * Math.cos(this.yaw) * Dc];
      const F = cp.map((v) => -v / Dc);
      let R = [F[2], 0, -F[0]];
      const rl = Math.hypot(R[0], R[2]);
      R = [-R[0] / rl, 0, -R[2] / rl];
      const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
      this.cam = { F, R, U, Dc, focal };

      // ---- volume pass, half resolution ----
      const vw = Math.max(2, (u.width * 0.5) | 0), vh = Math.max(2, (u.height * 0.5) | 0);
      this.vol.resize(vw, vh);
      const RvU = this.Rv * 1.05 * (1 + 0.05 * this.kickEnv);
      const K = new Float32Array(9), W = new Float32Array(9), Act = new Float32Array(9);
      let wsum = 0, outerN = 1;
      for (let s = 0; s < 9; s++) if (this._subOcc(this.occ, s) > 0.05) outerN = Math.max(outerN, SN[s]);
      for (let s = 0; s < 9; s++) {
        K[s] = 2 * this.z[s] / NSTAR[s] * RvU;
        const rOut = ROUT[s] * NSTAR[s] / (2 * this.z[s]);
        Act[s] = this._subOcc(this.occ, s);
        // Closed core subshells would fog everything; the open ones and the outer shell carry the shapes.
        const open = Act[s] > 0.05 && (Act[s] < CAP[s] - 0.05 || SN[s] === outerN) ? 1 : 0;
        W[s] = Math.min(3, Math.max(1, Math.pow(this.Rv / Math.max(rOut, 1e-3), 0.3))) * (0.3 + 0.7 * open) * (SL[s] ? 1 : 0.6);
        wsum += Act[s] * W[s];
      }
      const occU = Float32Array.from(this.occ);
      if (x) { occU[x.g] = Math.max(0, occU[x.g] - 1); Act[x.gs] += 1; Act[x.es] += 1; W[x.es] = Math.max(W[x.es], W[x.gs], 1); }
      const col = (t) => {
        t = Math.min(1, Math.max(0, t)) * 3;
        const i = Math.min(2, Math.floor(t)), f = t - i;
        return [0, 1, 2].map((c) => pal[i * 3 + c] + (pal[(i + 1) * 3 + c] - pal[i * 3 + c]) * f);
      };
      const posC = [], negC = [];
      for (let l = 0; l < 3; l++) { const c = col(0.45 + 0.12 * l); posC.push(...c); negC.push(...complement(c)); }
      const exP = col(1.0).map((v) => v * 0.6 + 0.4), exN = col(0.6).map((v) => v * 0.6 + 0.3);
      this.vol.bind();
      gl.disable(gl.BLEND);
      const vp = this.volProg.use();
      ctx.setCommon(vp, audio, u);
      vp.f3('uCamPos', cp[0], cp[1], cp[2]).f3('uCamF', F[0], F[1], F[2]).f3('uCamR', R[0], R[1], R[2]).f3('uCamU', U[0], U[1], U[2])
        .f('uFocal', focal).fv('uK', K).fv('uNorm', NORM).fv('uW', W).fv('uAct', Act).fv('uOcc', occU)
        .i('uVg', x ? x.g : -1).i('uVe', x ? x.e : -1).f3('uV', x ? x.cg : 1, x ? x.ce : 0, this.beat)
        .f3v('uPosC', posC).f3v('uNegC', negC).f3('uExcP', exP[0], exP[1], exP[2]).f3('uExcN', exN[0], exN[1], exN[2])
        .f('uGain', (0.55 + 0.9 * audio.mid) * 1.1 * P.glow / (1.0 + 0.4 * Math.sqrt(wsum))).f('uFrame', this.frame % 64);
      ctx.drawQuad();

      target.bind();
      const fp = this.finalProg.use();
      ctx.setCommon(fp, audio, u);
      fp.tex('uVol', this.vol.tex).f('uSpark', (0.012 + 0.07 * audio.high + 0.12 * audio.highPulse) * P.sparkle).f('uNuc', this.nucFlash);
      ctx.drawQuad();

      this._drawHud(u, P, pal);
      this.hud.draw(1.3);
    }

    _drawHud(u, P, pal) {
      const W = u.width, H = u.height;
      const g = this.hud.begin(W, H);
      const S = (l) => l * H;
      const cx = W / 2, cy = H / 2;
      const fs = Math.max(9, Math.round(H / 62));
      const m = S(0.03);
      const font = (px, bold, fam = MONO) => { g.font = (bold ? 'bold ' : '') + Math.round(px) + 'px ' + fam; };
      const lab = P.labels;
      const pxPerUnit = S(this.cam.focal / this.cam.Dc);
      g.textBaseline = 'middle';

      // Bohr-radius rings, a ruler for the cloud.
      if (lab) {
        g.strokeStyle = DIM; g.lineWidth = 1; g.setLineDash([2, 5]);
        font(fs * 0.7, false);
        let lastR = -1e9;
        for (const d of [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20]) {
          const f = d / (this.Rv * 1.05);
          if (f < 0.03 || f > 1) continue;
          const r = Math.pow(f, 1 / GAMMA) * pxPerUnit;
          if (r - lastR < S(0.035)) continue;
          lastR = r;
          g.globalAlpha = 0.35;
          g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
          g.globalAlpha = 0.7; g.fillStyle = DIM; g.textAlign = 'left';
          g.fillText(d + ' a₀', cx + r + 3, cy - S(0.008));
        }
        g.setLineDash([]);
        g.globalAlpha = 0.6;
        font(fs * 0.68, false);
        g.textAlign = 'center';
        g.fillText('a₀ = 52.9 pm   ·   radial scale compressed   ·   nucleus not to scale', cx, H - m - S(0.105));
      }

      // Particles on their way in or out, and photons.
      for (const a of this.actors) this._drawActor(g, a, cx, cy, S, fs, font, lab);

      // Element tile, periodic-table style.
      const Z = this.Z, q = this.Z - this.E;
      const T = S(0.15);
      const last = this.counts.reduce((acc, k, s) => (k > 0 ? s : acc), 0);
      const block = NOBLE.includes(Z) ? [150, 110, 230] : SL[last] === 0 ? [235, 95, 80] : SL[last] === 1 ? [230, 200, 70] : [90, 160, 240];
      g.globalAlpha = 1;
      g.fillStyle = `rgba(${block[0]}, ${block[1]}, ${block[2]}, 0.16)`;
      g.fillRect(m, m, T, T);
      g.strokeStyle = `rgb(${block[0]}, ${block[1]}, ${block[2]})`; g.lineWidth = Math.max(1.5, H / 450);
      g.strokeRect(m, m, T, T);
      g.fillStyle = INK; g.textAlign = 'left';
      font(T * 0.13, true, UI);
      g.fillText(String(Z), m + T * 0.08, m + T * 0.14);
      g.textAlign = 'right';
      font(T * 0.1, false, UI);
      g.fillText(MASS[Z].toFixed(3), m + T * 0.93, m + T * 0.14);
      g.textAlign = 'center';
      font(T * 0.42, true, UI);
      g.fillText(SYM[Z], m + T / 2, m + T * 0.52);
      font(T * 0.11, false, UI);
      g.fillText(NAME[Z], m + T / 2, m + T * 0.84);

      const tx = m + T + S(0.02);
      g.textAlign = 'left';
      font(fs * 1.45, true, SERIF);
      g.fillText(iso(Z + this.N, Z, q), tx, m + S(0.022));
      font(fs * 0.8, false);
      g.fillStyle = DIM;
      g.fillText(`Z = ${Z}   N = ${this.N}   e⁻ = ${this.E}`, tx, m + S(0.055));
      g.fillStyle = INK;
      font(fs * 1.15, false, SERIF);
      g.fillText(this._configStr(true), tx, m + S(0.09));
      font(fs * 0.72, false);
      g.fillStyle = DIM;
      g.fillText(this._configStr(false), tx, m + S(0.122));

      // Caption.
      if (lab) {
        g.textAlign = 'center';
        font(fs * 0.95, true, UI);
        g.fillStyle = INK; g.globalAlpha = 0.85;
        g.fillText('FIG. 30 — ELECTRON ORBITALS  |ψ|²', cx, m + S(0.01));
        font(fs * 0.7, false, UI);
        g.fillStyle = DIM;
        g.fillText('hydrogen-like wavefunctions · Slater screening · colour = phase of ψ · dots = sampled positions', cx, m + S(0.036));
        g.globalAlpha = 1;
      }

      this._boxes(g, m, H, S, fs, font);
      this._nucleus(g, W, m, S, fs, font);
      this._quantum(g, W, m, S, fs, font);
      this._spectrum(g, W, H, m, S, fs, font);
      // The event log, newest at the bottom.
      g.textAlign = 'right';
      font(fs * 0.78, false);
      let ly = H - m;
      for (let i = this.log.length - 1; i >= 0; i--) {
        const e = this.log[i];
        const age = this.t - e.t;
        g.globalAlpha = Math.max(0.15, 1 - age / 25) * (i === this.log.length - 1 ? 1 : 0.7);
        g.fillStyle = e.color;
        g.fillText(e.text, W - m, ly);
        ly -= S(0.026);
      }
      g.globalAlpha = 1;
    }

    _configStr(short) {
      const c = this.counts;
      const order = [0, 1, 2, 3, 4, 6, 5, 7];        // conventional n-then-l order: 3d before 4s
      let core = 0;
      if (short) for (const ng of [18, 10, 2]) if (this.E > ng && neutralFill(ng).every((k, s) => k === 0 || c[s] === k)) { core = ng; break; }
      const coreFill = core ? neutralFill(core) : null;
      const parts = core ? ['[' + SYM[core] + ']'] : [];
      for (const s of order) {
        if (!c[s]) continue;
        if (coreFill && coreFill[s] === c[s]) continue;
        parts.push(SUB[s] + VIZ.sup(c[s]));
      }
      if (this.exc) parts.push('(+ ' + SUB[this.exc.es] + '¹*)');
      return parts.join(' ') || '—';
    }

    _boxes(g, m, H, S, fs, font) {
      // Orbital box diagram: one box per orbital, ↑ and ↓ for the two spins, energy going up.
      const x = this.exc;
      const show = [];
      let top = 0;
      for (let s = 0; s < 9; s++) if (this._subOcc(this.occ, s) > 0.02 || (x && s === x.es)) top = s;
      for (let s = 0; s <= Math.min(8, top + 1); s++) show.push(s);
      const rowH = S(0.034), bw = S(0.024);
      const y0 = H - m - S(0.04);
      g.textAlign = 'left';
      font(fs * 0.72, false, UI);
      g.fillStyle = DIM;
      g.fillText('ORBITAL OCCUPANCY', m, y0 - show.length * rowH - S(0.012));
      const pos = {};
      show.forEach((s, i) => {
        const y = y0 - i * rowH;
        font(fs * 0.85, true);
        g.fillStyle = INK; g.globalAlpha = 0.9;
        g.fillText(SUB[s], m, y);
        const n = 2 * SL[s] + 1;
        const bx = m + S(0.04);
        for (let k = 0; k < n; k++) {
          const slot = BASE[s] + k;
          const X = bx + k * bw;
          g.globalAlpha = 0.7; g.strokeStyle = DIM; g.lineWidth = 1;
          g.strokeRect(X, y - bw / 2, bw, bw);
          let o = this.occ[slot];
          let ex = 0;
          if (x && slot === x.g) o -= 1 - x.cg * x.cg;
          if (x && slot === x.e) ex = x.ce * x.ce;
          const arrow = (dx, up, a, c) => {
            if (a <= 0.02) return;
            g.globalAlpha = Math.min(1, a); g.strokeStyle = c; g.fillStyle = c; g.lineWidth = Math.max(1.2, H / 600);
            const ax = X + bw * dx, h = bw * 0.36, dir = up ? -1 : 1;
            g.beginPath(); g.moveTo(ax, y - dir * h); g.lineTo(ax, y + dir * h); g.stroke();
            g.beginPath(); g.moveTo(ax, y + dir * h); g.lineTo(ax - bw * 0.1, y + dir * (h - bw * 0.16)); g.lineTo(ax + bw * 0.1, y + dir * (h - bw * 0.16)); g.closePath(); g.fill();
          };
          arrow(0.36, true, Math.min(1, o), INK);
          arrow(0.64, false, o - 1, INK);
          arrow(0.5, true, ex, AMBER);
          pos[slot] = [X + bw / 2, y];
        }
      });
      if (x && pos[x.g] && pos[x.e]) {
        // The jump itself.
        const [ax, ay] = pos[x.g], [bx2, by] = pos[x.e];
        const sx = m + S(0.04) + 5.3 * bw;
        g.globalAlpha = 0.9; g.strokeStyle = waveCss(x.nm); g.fillStyle = g.strokeStyle; g.lineWidth = Math.max(1.2, H / 600);
        g.beginPath(); g.moveTo(ax + bw * 0.5, ay); g.quadraticCurveTo(sx + S(0.03), (ay + by) / 2, bx2 + bw * 0.5, by); g.stroke();
        font(fs * 0.8, false, SERIF);
        g.textAlign = 'left';
        g.fillText('hν', sx + S(0.022), (ay + by) / 2);
      }
      g.globalAlpha = 1;
    }

    _nucleus(g, W, m, S, fs, font) {
      const r = S(0.075), cx = W - m - r, cy = m + r + S(0.012);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(6, 8, 16, 0.85)';
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.strokeStyle = DIM; g.lineWidth = 1; g.stroke();
      const n = this.nuc.filter((b) => !b.out).length || 1;
      const scale = Math.min(r * 0.17, r * 0.78 / (1.12 * Math.cbrt(n) + 0.6));
      g.save();
      g.beginPath(); g.arc(cx, cy, r - 1, 0, TAU); g.clip();
      for (const b of this.nuc) {
        const bx = cx + b.x * scale, by = cy - b.y * scale, br = scale * 0.98 * (b.out ? 1 : 0.4 + 0.6 * b.s);
        g.globalAlpha = b.out ? Math.max(0, 1 - b.out / 0.6) : 1;
        const pr = [210, 60, 45], nr = [175, 185, 200];
        const c = pr.map((v, i) => Math.round(nr[i] + (v - nr[i]) * b.pc));
        const gr = g.createRadialGradient(bx - br * 0.35, by - br * 0.35, br * 0.1, bx, by, br);
        gr.addColorStop(0, `rgb(${Math.min(255, c[0] + 70)}, ${Math.min(255, c[1] + 70)}, ${Math.min(255, c[2] + 70)})`);
        gr.addColorStop(0.75, `rgb(${c[0]}, ${c[1]}, ${c[2]})`);
        gr.addColorStop(1, `rgb(${c[0] >> 2}, ${c[1] >> 2}, ${c[2] >> 2})`);
        g.fillStyle = gr;
        g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fill();
      }
      g.restore();
      if (this.nucFlash > 0.05) {
        g.globalAlpha = this.nucFlash; g.strokeStyle = AMBER; g.lineWidth = 2;
        g.beginPath(); g.arc(cx, cy, r + 3, 0, TAU); g.stroke();
      }
      g.globalAlpha = 1;
      g.textAlign = 'center';
      font(fs * 0.7, false, UI);
      g.fillStyle = DIM;
      g.fillText('NUCLEUS  ×10⁵', cx, cy + r + S(0.016));
      font(fs * 0.85, true);
      g.fillStyle = INK;
      g.fillText(`${this.Z}p  ${this.N}n   A = ${this.Z + this.N}`, cx, cy + r + S(0.042));
    }

    _quantum(g, W, m, S, fs, font) {
      // The electron we're watching: the excited one, or the outermost.
      const x = this.exc;
      let slot, s;
      if (x) { slot = x.e; s = x.es; } else {
        s = this.counts.reduce((acc, k, i) => (k > 0 ? i : acc), 0);
        slot = BASE[s];
        for (let k = 0; k <= 2 * SL[s]; k++) if (this.occ[BASE[s] + k] > 0.5) slot = BASE[s] + k;
      }
      const l = SL[s], mi = slot - BASE[s];
      const zf = this.z[s], ns = NSTAR[s];
      const rMean = ns * ns / zf * (1.5 - l * (l + 1) / (2 * SN[s] * SN[s]));
      const E = x ? x.Ee * x.ce * x.ce + x.Eg * x.cg * x.cg : -IE[this.Z];
      let y = m + S(0.21);
      const right = W - m;
      g.textAlign = 'right';
      font(fs * 0.72, false, UI);
      g.fillStyle = x ? AMBER : DIM;
      g.fillText(x ? (x.phase === 'hold' ? 'EXCITED STATE' : 'SUPERPOSITION') : 'OUTERMOST ELECTRON', right, y);
      y += S(0.03);
      const rows = [
        ['orbital', SN[s] + ORB[l][mi]],
        ['n', String(SN[s])],
        ['ℓ', String(l)],
        ['mℓ', ML[l][mi]],
        ['mₛ', '±½'],
        ['Z_eff', zf.toFixed(2)],
        ['⟨r⟩', rMean.toFixed(2) + ' a₀'],
        ['E', E.toFixed(2) + ' eV'],
      ];
      for (const [k, v] of rows) {
        font(fs * 0.78, false); g.fillStyle = DIM; g.textAlign = 'right';
        g.fillText(k, right - S(0.13), y);
        font(fs * 0.95, true); g.fillStyle = x ? AMBER : INK;
        g.fillText(v, right, y);
        y += S(0.027);
      }
      if (x && x.phase !== 'hold') {
        font(fs * 0.72, false, SERIF); g.fillStyle = DIM;
        g.fillText(`ψ = ${x.cg.toFixed(2)}·ψ(${SUB[x.gs]}) + ${x.ce.toFixed(2)}·e^{−iωt}·ψ(${SUB[x.es]})`, right, y + S(0.006));
      }
    }

    _spectrum(g, W, H, m, S, fs, font) {
      // A little spectrometer: emitted lines pile up where they belong; UV and X-ray off to the left.
      const w = Math.min(S(0.62), W * 0.34), h = S(0.045);
      const x0 = W / 2 - w / 2, y0 = H - m - h - S(0.035);
      const uvW = w * 0.12, irW = w * 0.08;
      const vx0 = x0 + uvW, vw = w - uvW - irW;
      const L0 = 380, L1 = 750;
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(4, 6, 12, 0.9)';
      g.fillRect(x0, y0, w, h);
      g.globalAlpha = 0.16;
      for (let i = 0; i < 60; i++) {
        g.fillStyle = waveCss(L0 + (L1 - L0) * (i + 0.5) / 60);
        g.fillRect(vx0 + vw * i / 60, y0, vw / 60 + 1, h);
      }
      g.globalAlpha = 0.8;
      g.strokeStyle = DIM; g.lineWidth = 1;
      g.strokeRect(x0, y0, w, h);
      g.beginPath(); g.moveTo(vx0, y0); g.lineTo(vx0, y0 + h); g.moveTo(vx0 + vw, y0); g.lineTo(vx0 + vw, y0 + h); g.stroke();
      font(fs * 0.62, false);
      g.fillStyle = DIM; g.textAlign = 'center';
      for (const t of [400, 500, 600, 700]) {
        const xx = vx0 + vw * (t - L0) / (L1 - L0);
        g.beginPath(); g.moveTo(xx, y0 + h); g.lineTo(xx, y0 + h + 4); g.stroke();
        g.fillText(String(t), xx, y0 + h + S(0.014));
      }
      g.fillText('UV / X', x0 + uvW / 2, y0 + h + S(0.014));
      g.fillText('IR', vx0 + vw + irW / 2, y0 + h + S(0.014));
      g.textAlign = 'left';
      font(fs * 0.7, false, UI);
      g.fillText('EMISSION SPECTRUM  λ (nm)', x0, y0 - S(0.012));
      const place = (nm, i) => {
        if (nm < L0) return x0 + uvW * (0.15 + 0.7 * ((Math.log10(Math.max(nm, 0.01)) + 2) / (Math.log10(L0) + 2)));
        if (nm > L1) return vx0 + vw + irW * Math.min(0.85, 0.15 + 0.7 * (nm - L1) / 2000);
        return vx0 + vw * (nm - L0) / (L1 - L0);
      };
      this.lines.forEach((ln, i) => {
        const age = this.t - ln.t;
        const a = Math.max(0.12, Math.exp(-age / 30));
        const xx = place(ln.nm, i);
        g.globalAlpha = a; g.strokeStyle = waveCss(ln.nm, 1); g.lineWidth = Math.max(2, H / 360);
        g.beginPath(); g.moveTo(xx, y0 + 2); g.lineTo(xx, y0 + h - 2); g.stroke();
      });
      const lastL = this.lines[this.lines.length - 1];
      if (lastL) {
        g.globalAlpha = Math.max(0.3, 1 - (this.t - lastL.t) / 10);
        font(fs * 0.8, true);
        g.fillStyle = waveCss(lastL.nm); g.textAlign = 'right';
        g.fillText('λ = ' + fmtNm(lastL.nm), x0 + w, y0 - S(0.012));
      }
      g.globalAlpha = 1;
    }

    _drawActor(g, a, cx, cy, S, fs, font, lab) {
      const u = Math.min(1, a.t / a.dur);
      const ball = (x, y, r, c, alpha = 1) => {
        g.globalAlpha = alpha;
        const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, c); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      };
      const colOf = { p: 'rgb(230, 70, 55)', n: 'rgb(190, 200, 215)', e: CYAN, pos: 'rgb(255, 120, 200)', alpha: 'rgb(255, 200, 90)' };
      if (a.kind === 'in') {
        const e = u * u;
        const x = cx + a.x * (1 - e) * S(1), y = cy - a.y * (1 - e) * S(1);
        g.globalAlpha = 0.5; g.strokeStyle = colOf[a.p]; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x, y); g.lineTo(cx + a.x * (1 - Math.max(0, e - 0.15)) * S(1), cy - a.y * (1 - Math.max(0, e - 0.15)) * S(1)); g.stroke();
        ball(x, y, S(0.008), colOf[a.p]);
        if (lab) { font(fs * 0.85, true, SERIF); g.fillStyle = colOf[a.p]; g.textAlign = 'left'; g.fillText(a.p === 'p' ? 'p⁺' : 'n', x + S(0.012), y - S(0.012)); }
      } else if (a.kind === 'out') {
        if (a.p === 'nu') {
          const d = (0.02 + u * 0.7) * S(1);
          g.globalAlpha = 1 - u; g.strokeStyle = DIM; g.setLineDash([2, 6]); g.lineWidth = 1;
          g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + a.x * d, cy - a.y * d); g.stroke(); g.setLineDash([]);
          if (lab) { font(fs * 0.85, false, SERIF); g.fillStyle = DIM; g.textAlign = 'left'; g.fillText(a.tag, cx + a.x * d + 4, cy - a.y * d); }
          return;
        }
        const e = a.fast ? u : 1 - (1 - u) * (1 - u);
        const d = (a.r0 + e * 0.75) * S(1);
        const x = cx + a.x * d, y = cy - a.y * d;
        if (u < 1) {
          g.globalAlpha = 0.5 * (1 - u); g.strokeStyle = colOf[a.p]; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(cx + a.x * a.r0 * S(1), cy - a.y * a.r0 * S(1)); g.lineTo(x, y); g.stroke();
          ball(x, y, S(a.p === 'alpha' ? 0.012 : a.p === 'e' || a.p === 'pos' ? 0.005 : 0.008), colOf[a.p], 1 - u * 0.5);
          if (lab && a.tag) { font(fs * 0.9, true, SERIF); g.fillStyle = colOf[a.p]; g.textAlign = 'left'; g.fillText(a.tag, x + S(0.012), y - S(0.012)); }
        }
        if (a.annihilate && a.t > a.dur) {
          // The positron meets an electron: two 511 keV gammas, back to back.
          const k = (a.t - a.dur) / 0.6;
          g.globalAlpha = 1 - k; g.strokeStyle = 'rgb(255, 245, 160)'; g.lineWidth = 1.5;
          const ex = cx + a.x * 0.75 * S(1), ey = cy - a.y * 0.75 * S(1);
          for (const sgn of [1, -1]) {
            g.beginPath();
            for (let i = 0; i <= 20; i++) {
              const s = (k * 0.3 + i / 20 * 0.06) * S(1) * sgn;
              const w = Math.sin(i * 1.6) * S(0.004);
              const px = ex - a.y * s + a.x * w, py = ey - a.x * s - a.y * w;
              if (i) g.lineTo(px, py); else g.moveTo(px, py);
            }
            g.stroke();
          }
          if (k < 0.15) ball(ex, ey, S(0.02) * (1 - k * 5), 'rgb(255, 245, 200)', 1 - k * 5);
          if (lab) { font(fs * 0.75, false); g.fillStyle = 'rgb(255, 245, 160)'; g.textAlign = 'left'; g.fillText('2γ  511 keV', ex + S(0.015), ey + S(0.02)); }
        }
      } else if (a.kind === 'spiral') {
        const rr = (0.75 * Math.pow(1 - u, 1.6) + 0.12 * u) * S(1);
        const th = a.a0 + u * 3 * Math.PI;
        const x = cx + Math.cos(th) * rr, y = cy - Math.sin(th) * rr;
        g.globalAlpha = 0.35; g.strokeStyle = CYAN; g.lineWidth = 1.2;
        g.beginPath();
        for (let i = 0; i <= 16; i++) {
          const uu = Math.max(0, u - i * 0.012);
          const r2 = (0.75 * Math.pow(1 - uu, 1.6) + 0.12 * uu) * S(1), t2 = a.a0 + uu * 3 * Math.PI;
          const px = cx + Math.cos(t2) * r2, py = cy - Math.sin(t2) * r2;
          if (i) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.stroke();
        ball(x, y, S(0.005), CYAN, 1 - Math.max(0, u - 0.85) / 0.15);
        if (lab && u < 0.6) { font(fs * 0.85, true, SERIF); g.fillStyle = CYAN; g.textAlign = 'left'; g.fillText('e⁻', x + S(0.01), y - S(0.012)); }
      } else if (a.kind === 'fall') {
        const r0 = S(0.05) * (1 - u);
        const x = cx + r0, y = cy;
        ball(x, y, S(0.004), CYAN, 1 - u * 0.5);
      } else if (a.kind === 'photon') {
        // A wave packet; inbound ones arrive at the atom, outbound ones leave it.
        const c = a.gamma ? 'rgb(255, 245, 160)' : waveCss(a.nm);
        const head = a.dir > 0 ? 0.04 + u * 0.8 : 0.8 * (1 - u) + 0.02;
        const len = 0.1;
        const nx = -a.y, ny = a.x;
        const lam = a.gamma || a.nm < 380 ? 0.006 : a.nm > 750 ? 0.02 : 0.006 + 0.012 * (a.nm - 380) / 370;
        g.globalAlpha = a.dir > 0 ? 1 - u * 0.8 : 0.4 + 0.6 * u; g.strokeStyle = c; g.lineWidth = Math.max(1.4, S(0.0025));
        g.beginPath();
        for (let i = 0; i <= 36; i++) {
          const s = head + (a.dir > 0 ? -1 : 1) * i / 36 * len;
          if (s < 0.01) continue;
          const w = Math.sin(s / lam * TAU - a.t * 30) * 0.007 * Math.sin(i / 36 * Math.PI) + (a.off || 0);
          const px = cx + (a.x * s + nx * w) * S(1), py = cy - (a.y * s + ny * w) * S(1);
          if (i) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.stroke();
        if (lab && a.label && u < 0.7) {
          font(fs * 0.8, false, SERIF); g.fillStyle = c; g.textAlign = 'left';
          const t = a.gamma ? 'γ' : a.nm < 10 ? 'X-ray' : 'hν  ' + fmtNm(a.nm);
          g.fillText(t, cx + (a.x * head + nx * 0.02) * S(1), cy - (a.y * head + ny * 0.02) * S(1));
        }
      }
    }

    resize() { /* the volume target follows the frame size inside render */ }
    dispose() {
      this.volProg.dispose(); this.finalProg.dispose();
      this.vol.dispose(); this.hud.dispose();
    }
  }

  VIZ.registerScene({
    id: 'orbitals',
    name: 'Electron Cloud',
    blurb: 'Real hydrogen-like orbitals, filled shell by shell. Kicks lift electrons into excited states that fall back and emit their spectral line; now and then the nucleus transmutes and the cloud rebuilds itself as the next element.',
    params: [
      { key: 'jumps', label: 'Kick → quantum jumps', min: 0, max: 1, step: 0.05, value: 1 },
      { key: 'transmute', label: 'Transmutation rate', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'element', label: 'Hold element (0 = wander)', min: 0, max: 36, step: 1, value: 0 },
      { key: 'hold', label: 'Excited-state lifetime', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'sparkle', label: 'Measurement specks (highs)', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'spin', label: 'Rotation (bass)', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'glow', label: 'Cloud brightness (mids)', min: 0.2, max: 3, step: 0.05, value: 1 },
      { key: 'labels', label: 'Diagram labels', min: 0, max: 1, step: 1, value: 1 },
    ],
    create: (ctx) => new OrbitalScene(ctx),
  });
})();

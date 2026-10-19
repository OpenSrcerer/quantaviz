/* tokamak.js — Tokamak.
 * A fusion reactor seen from outside its open frame: sixteen D-shaped toroidal field coils, the
 * central solenoid and two poloidal field rings, with a 100-million-degree plasma ring floating
 * inside. The plasma is D-shaped too (elongated, as in ITER) and glows brightest in its core;
 * its magnetic field lines twist helically round the torus (field-line pitch set by the safety
 * factor q), drawn as bright helical stripes that flow round as the plasma rotates. Raymarched:
 * the coils are an SDF, the plasma is integrated as glowing gas along the same ray.
 *   bass  -> every kick is an edge-localised mode (ELM): the plasma edge erupts in filaments that
 *            lash out toward the wall and the core briefly crashes (a sawtooth)
 *   mids  -> plasma temperature: core brightness and colour
 *   highs -> turbulence flickering through the edge
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform vec3 uEye;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uELM;       // edge-localised mode envelope
uniform float uCrash;     // sawtooth crash envelope
uniform float uRot;       // plasma rotation angle
uniform float uQ;
uniform float uGlow;
const float R0 = 1.0;
const float A = 0.3;
const float KAPPA = 1.6;
const float TAU = 6.2831853;

float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

float coils(vec3 p) {
  float rho = length(p.xz);
  vec2 pol = vec2(rho - R0 - 0.08, p.y);
  // D-shaped ring profile in the poloidal plane.
  float ring = abs(sdRoundBox(pol, vec2(0.56, 0.78), 0.4)) - 0.04;
  float phi = atan(p.z, p.x);
  float sector = TAU / 16.0;
  float pl = mod(phi + sector * 0.5, sector) - sector * 0.5;
  float tor = abs(rho * sin(pl)) - 0.035;
  float tf = max(ring, tor);
  float cs = max(rho - 0.26, abs(p.y) - 1.15);
  vec2 pf1 = vec2(rho - 1.35, p.y - 1.0), pf2 = vec2(rho - 1.35, p.y + 1.0);
  float pf = min(length(pf1), length(pf2)) - 0.035;
  return min(min(tf, cs), pf);
}

// Plasma emission at p.
vec3 plasma(vec3 p) {
  float rho = length(p.xz);
  vec2 pol = vec2(rho - R0, p.y / KAPPA);
  float a = A * (1.0 - 0.12 * uCrash);
  float r = length(pol) / a;
  if (r > 2.2) return vec3(0.0);
  float th = atan(pol.y, pol.x);
  float phi = atan(p.z, p.x);
  float core = exp(-r * r * 2.2);
  // Helical field-line stripes: constant along th - phi / q.
  float helix = 0.5 + 0.5 * cos(6.0 * (th - phi / uQ) + uRot * 6.0);
  float shell = exp(-pow((r - 0.85) / 0.18, 2.0));
  vec3 hot = mix(palette(0.55), palette(1.0) + 0.3, clamp(0.3 + 0.9 * uMid, 0.0, 1.0));
  vec3 col = hot * core * (0.35 + 1.2 * uMid) * (1.0 - 0.5 * uCrash) + palette(0.75) * shell * (0.1 + 0.6 * helix * helix) * (0.4 + 0.8 * uMid);
  // Edge turbulence (highs) and ELM filaments (bass) just outside the edge.
  if (r > 0.7) {
    float turb = noise3(vec3(th * 4.0, phi * 10.0, uTime * 3.0));
    col += palette(0.8) * shell * turb * (0.4 * uHigh + 1.2 * uHighPulse);
    if (uELM > 0.01) {
      float fil = pow(0.5 + 0.5 * cos(20.0 * (th - phi / uQ) + uRot * 4.0), 8.0);
      float reach = 1.0 + 1.2 * uELM;
      float m = smoothstep(0.85, 1.0, r) * (1.0 - smoothstep(reach - 0.2, reach, r));
      col += (palette(0.95) + 0.4) * fil * m * uELM * 2.0 * (0.6 + 0.4 * noise3(vec3(phi * 6.0, r * 4.0, uTime * 5.0)));
    }
  }
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 rd = normalize(uFwd * 1.25 + uRight * p.x + uUp * p.y);
  vec3 ro = uEye;
  vec3 acc = vec3(0.0);
  vec3 col = mix(palette(0.0) * 0.08, palette(0.0) * 0.02, vUv.y);
  float t = max(0.0, length(ro) - 2.3);
  bool hit = false;
  vec3 hp;
  for (int i = 0; i < 110; i++) {
    vec3 q = ro + rd * t;
    float d = coils(q);
    if (d < 0.0015) { hit = true; hp = q; break; }
    float st = clamp(d * 0.9, 0.012, 0.06);
    acc += plasma(q) * st;
    t += st;
    if (t > length(ro) + 2.8) break;
  }
  if (hit) {
    const vec2 e = vec2(0.0015, 0.0);
    vec3 n = normalize(vec3(coils(hp + e.xyy) - coils(hp - e.xyy), coils(hp + e.yxy) - coils(hp - e.yxy), coils(hp + e.yyx) - coils(hp - e.yyx)));
    // Lit by the plasma ring: a light at the nearest point of the magnetic axis.
    vec2 dirxz = normalize(hp.xz + 1e-4);
    vec3 axisP = vec3(dirxz.x * R0, 0.0, dirxz.y * R0);
    vec3 L = axisP - hp;
    float dl = length(L);
    L /= dl;
    float diff = max(dot(n, L), 0.0) / (0.3 + dl * dl * 2.0);
    vec3 plasmaCol = mix(palette(0.55), palette(1.0), 0.5) * (0.5 + 1.5 * uMid + 1.5 * uELM);
    vec3 metal = palette(0.15) * 0.25 + vec3(0.05, 0.04, 0.035);
    float spec = pow(max(dot(reflect(rd, n), L), 0.0), 24.0) / (0.3 + dl * dl);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
    col = metal * (0.25 + 0.4 * max(dot(n, normalize(vec3(0.3, 0.8, 0.4))), 0.0)) + metal * diff * plasmaCol * 2.0 + plasmaCol * spec * 0.6 + vec3(0.1, 0.12, 0.15) * fres * 0.3;
  }
  col += acc * uGlow;
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  class TokamakScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'tokamak');
      this.trig = new VIZ.KickTrigger(0.35);
      this.elm = 0;
      this.crash = 0;
      this.rot = 0;
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const hit = this.trig.update(audio.kick);
      if (hit) { this.elm = Math.max(this.elm, hit * P.elm); this.crash = Math.max(this.crash, hit * P.elm); }
      this.elm *= Math.exp(-dt / 0.35);
      this.crash *= Math.exp(-dt / 0.6);
      this.rot += dt * P.rotation * (0.5 + 0.6 * audio.mid);
      const t = u.time;
      const az = t * 0.06, el = 0.42 + 0.18 * Math.sin(t * 0.045);
      const dist = 5.4 * P.distance * (u.width < u.height ? 1.4 : 1);
      const eye = [Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist];
      const f = norm([-eye[0], -0.1 - eye[1], -eye[2]]);
      const r = norm(cross(f, [0, 1, 0]));
      const up = cross(r, f);
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f3('uEye', ...eye).f3('uFwd', ...f).f3('uRight', ...r).f3('uUp', ...up)
        .f('uELM', this.elm).f('uCrash', this.crash).f('uRot', this.rot).f('uQ', P.q).f('uGlow', 0.55 * P.glow);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'tokamak',
    name: 'Tokamak',
    blurb: 'A fusion plasma held in a twisting magnetic cage. Every kick is an edge-localised mode erupting toward the wall; the core heats up with the mids.',
    params: [
      { key: 'elm', label: 'ELM eruption on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'rotation', label: 'Plasma rotation', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'q', label: 'Safety factor q (field twist)', min: 1, max: 5, step: 0.1, value: 3 },
      { key: 'glow', label: 'Plasma glow', min: 0.3, max: 2.5, step: 0.05, value: 1 },
      { key: 'distance', label: 'Camera distance', min: 0.7, max: 1.6, step: 0.05, value: 1 },
    ],
    create: (ctx) => new TokamakScene(ctx),
  });
})();
